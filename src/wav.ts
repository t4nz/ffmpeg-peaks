import { createReadStream } from "node:fs";
import { open } from "node:fs/promises";
import type { PeakCollector } from "./get-peaks.js";

export interface WavInfo {
  bitsPerSample: number;
  blockAlign: number;
  channels: number;
  dataOffset: number;
  dataSize: number;
  format: 1 | 3;
  sampleRate: number;
}

export async function readWavInfo(path: string): Promise<WavInfo | null> {
  const file = await open(path, "r");
  try {
    const header = Buffer.alloc(12);
    if (
      (await file.read(header, 0, header.length, 0)).bytesRead !== header.length
    )
      return null;
    if (
      header.toString("ascii", 0, 4) !== "RIFF" ||
      header.toString("ascii", 8, 12) !== "WAVE"
    )
      return null;

    const { size } = await file.stat();
    let position = 12;
    let format: Omit<WavInfo, "dataOffset" | "dataSize"> | undefined;
    let dataOffset: number | undefined;
    let dataSize: number | undefined;

    while (position + 8 <= size) {
      const chunkHeader = Buffer.alloc(8);
      await file.read(chunkHeader, 0, 8, position);
      const id = chunkHeader.toString("ascii", 0, 4);
      const chunkSize = chunkHeader.readUInt32LE(4);
      const payload = position + 8;
      if (payload + chunkSize > size) return null;

      if (id === "fmt " && chunkSize >= 16) {
        const bytes = Buffer.alloc(Math.min(chunkSize, 40));
        await file.read(bytes, 0, bytes.length, payload);
        const audioFormat = bytes.readUInt16LE(0);
        if (audioFormat !== 1 && audioFormat !== 3) return null;
        format = {
          format: audioFormat,
          channels: bytes.readUInt16LE(2),
          sampleRate: bytes.readUInt32LE(4),
          blockAlign: bytes.readUInt16LE(12),
          bitsPerSample: bytes.readUInt16LE(14),
        };
      } else if (id === "data") {
        dataOffset = payload;
        dataSize = chunkSize;
      }

      if (format && dataOffset !== undefined && dataSize !== undefined) break;
      position = payload + chunkSize + (chunkSize % 2);
    }

    if (!format || dataOffset === undefined || dataSize === undefined)
      return null;
    if (!isSupported(format)) return null;
    return { ...format, dataOffset, dataSize };
  } finally {
    await file.close();
  }
}

export async function collectWav(
  path: string,
  info: WavInfo,
  collector: PeakCollector,
  startFrame: number,
  frameCount: number,
  signal?: AbortSignal,
): Promise<void> {
  if (frameCount === 0) return;
  const start = info.dataOffset + startFrame * info.blockAlign;
  const end = start + frameCount * info.blockAlign - 1;
  let remainder = Buffer.alloc(0);

  for await (const chunk of createReadStream(path, { start, end, signal })) {
    const data = remainder.length ? Buffer.concat([remainder, chunk]) : chunk;
    const readableBytes = data.length - (data.length % info.blockAlign);
    for (let frame = 0; frame < readableBytes; frame += info.blockAlign) {
      for (let channel = 0; channel < info.channels; channel++) {
        collector.add(
          readSample(data, frame + channel * (info.bitsPerSample / 8), info),
        );
      }
    }
    remainder =
      readableBytes < data.length
        ? data.subarray(readableBytes)
        : Buffer.alloc(0);
  }
}

function isSupported(info: Omit<WavInfo, "dataOffset" | "dataSize">): boolean {
  const bytesPerSample = info.bitsPerSample / 8;
  return (
    info.channels > 0 &&
    info.sampleRate > 0 &&
    info.blockAlign === info.channels * bytesPerSample &&
    ((info.format === 1 && [8, 16, 24, 32].includes(info.bitsPerSample)) ||
      (info.format === 3 && [32, 64].includes(info.bitsPerSample)))
  );
}

function readSample(data: Buffer, offset: number, info: WavInfo): number {
  if (info.format === 3)
    return info.bitsPerSample === 32
      ? data.readFloatLE(offset)
      : data.readDoubleLE(offset);
  if (info.bitsPerSample === 8) return (data.readUInt8(offset) - 128) / 128;
  if (info.bitsPerSample === 16) return data.readInt16LE(offset) / 32_768;
  if (info.bitsPerSample === 24) return data.readIntLE(offset, 3) / 8_388_608;
  return data.readInt32LE(offset) / 2_147_483_648;
}
