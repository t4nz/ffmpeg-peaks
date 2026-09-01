import { PeakCollector, type Peaks } from "@peakwright/core";

export type WebInput = ArrayBuffer | Blob;
export type ChannelMode = "merge" | "split";

export interface WebPeakwrightOptions {
  channelMode?: ChannelMode;
  precision?: number;
  width?: number;
}

export interface WebWaveformData {
  version: 1;
  sampleRate: number;
  channels: number;
  channelMode: ChannelMode;
  points: number;
  duration: number;
  data: Peaks;
}

export default class WebPeakwright {
  private readonly channelMode: ChannelMode;
  private readonly precision: number;
  private readonly width: number;

  constructor(options: WebPeakwrightOptions = {}) {
    this.channelMode = options.channelMode ?? "merge";
    this.precision = options.precision ?? 1;
    this.width = options.width ?? 1_640;
    if (this.channelMode !== "merge" && this.channelMode !== "split")
      throw new TypeError('channelMode must be "merge" or "split"');
    if (
      ![this.precision, this.width].every(
        (value) => Number.isInteger(value) && value > 0,
      )
    )
      throw new TypeError("precision and width must be positive integers");
  }

  async generate(input: WebInput): Promise<WebWaveformData> {
    const buffer =
      input instanceof ArrayBuffer ? input : await input.arrayBuffer();
    const wav = parseWav(buffer);
    const frames = Math.floor(wav.dataSize / wav.blockAlign);
    const collector = new PeakCollector(
      this.channelMode === "split",
      this.width,
      this.precision,
      frames,
      wav.channels,
    );
    const view = new DataView(buffer, wav.dataOffset, wav.dataSize);
    const bytes = wav.bitsPerSample / 8;
    for (let frame = 0; frame < frames; frame++)
      for (let channel = 0; channel < wav.channels; channel++)
        collector.add(
          readSample(view, frame * wav.blockAlign + channel * bytes, wav),
        );
    return {
      version: 1,
      sampleRate: wav.sampleRate,
      channels: this.channelMode === "split" ? wav.channels : 1,
      channelMode: this.channelMode,
      points: this.width,
      duration: frames / wav.sampleRate,
      data: collector.get(),
    };
  }
}

interface WavInfo {
  bitsPerSample: number;
  blockAlign: number;
  channels: number;
  dataOffset: number;
  dataSize: number;
  format: 1 | 3;
  sampleRate: number;
}

function parseWav(buffer: ArrayBuffer): WavInfo {
  const view = new DataView(buffer);
  if (
    view.byteLength < 12 ||
    text(view, 0, 4) !== "RIFF" ||
    text(view, 8, 12) !== "WAVE"
  )
    throw new TypeError("Input must be a RIFF/WAVE file");
  let position = 12;
  let format: Omit<WavInfo, "dataOffset" | "dataSize"> | undefined;
  let dataOffset: number | undefined;
  let dataSize: number | undefined;
  while (position + 8 <= view.byteLength) {
    const id = text(view, position, position + 4);
    const size = view.getUint32(position + 4, true);
    const payload = position + 8;
    if (payload + size > view.byteLength)
      throw new TypeError("Invalid WAV chunk size");
    if (id === "fmt " && size >= 16) {
      const audioFormat = view.getUint16(payload, true);
      if (audioFormat !== 1 && audioFormat !== 3)
        throw new TypeError("Unsupported WAV encoding");
      format = {
        format: audioFormat,
        channels: view.getUint16(payload + 2, true),
        sampleRate: view.getUint32(payload + 4, true),
        blockAlign: view.getUint16(payload + 12, true),
        bitsPerSample: view.getUint16(payload + 14, true),
      };
    } else if (id === "data") {
      dataOffset = payload;
      dataSize = size;
    }
    position = payload + size + (size % 2);
  }
  if (
    !format ||
    dataOffset === undefined ||
    dataSize === undefined ||
    !supported(format)
  )
    throw new TypeError("Unsupported or incomplete WAV file");
  return { ...format, dataOffset, dataSize };
}

function supported(info: Omit<WavInfo, "dataOffset" | "dataSize">): boolean {
  const bytes = info.bitsPerSample / 8;
  return (
    info.channels > 0 &&
    info.sampleRate > 0 &&
    info.blockAlign === info.channels * bytes &&
    ((info.format === 1 && [8, 16, 24, 32].includes(info.bitsPerSample)) ||
      (info.format === 3 && [32, 64].includes(info.bitsPerSample)))
  );
}

function readSample(view: DataView, offset: number, info: WavInfo): number {
  if (info.format === 3)
    return info.bitsPerSample === 32
      ? view.getFloat32(offset, true)
      : view.getFloat64(offset, true);
  if (info.bitsPerSample === 8) return (view.getUint8(offset) - 128) / 128;
  if (info.bitsPerSample === 16) return view.getInt16(offset, true) / 32_768;
  if (info.bitsPerSample === 24) {
    const value =
      view.getUint8(offset) |
      (view.getUint8(offset + 1) << 8) |
      (view.getUint8(offset + 2) << 16);
    return (value & 0x80_0000 ? value - 0x100_0000 : value) / 8_388_608;
  }
  return view.getInt32(offset, true) / 2_147_483_648;
}

function text(view: DataView, start: number, end: number): string {
  return String.fromCharCode(
    ...new Uint8Array(view.buffer, view.byteOffset + start, end - start),
  );
}
