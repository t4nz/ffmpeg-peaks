import { spawn } from "node:child_process";
import { createReadStream } from "node:fs";
import { access, mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PeakCollector, type Peaks } from "./get-peaks.js";
import { collectWav, readWavInfo } from "./wav.js";

export type ChannelMode = "merge" | "split";
export type OutputFormat = "raw" | "json";

export interface AudioPeaksOptions {
  channelMode?: ChannelMode;
  ffmpegPath?: string;
  numOfChannels?: number;
  sampleRate?: number;
  width?: number;
  precision?: number;
}

export interface GenerateOptions {
  duration?: number;
  format?: OutputFormat;
  outputPath?: string;
  signal?: AbortSignal;
  start?: number;
}

export interface WaveformData {
  version: 1;
  sampleRate: number;
  channels: number;
  channelMode: ChannelMode;
  points: number;
  duration: number;
  data: Peaks;
}

export type PeaksCallback = (error: Error | null, peaks?: Peaks) => void;

const defaults = {
  channelMode: "merge",
  ffmpegPath: "ffmpeg",
  numOfChannels: 2,
  sampleRate: 44_100,
  width: 1_640,
  precision: 1,
} as const;

export default class AudioPeaks {
  private readonly options: Required<AudioPeaksOptions>;
  private readonly requestedChannels?: number;
  private readonly requestedSampleRate?: number;

  constructor(options: AudioPeaksOptions = {}) {
    this.requestedChannels = options.numOfChannels;
    this.requestedSampleRate = options.sampleRate;
    this.options = { ...defaults, ...options };
    for (const name of [
      "numOfChannels",
      "sampleRate",
      "width",
      "precision",
    ] as const) {
      const value = this.options[name];
      if (!Number.isInteger(value) || value <= 0)
        throw new TypeError(`${name} must be a positive integer`);
    }
    if (!this.options.ffmpegPath)
      throw new TypeError("ffmpegPath must be a non-empty string");
    if (!(["merge", "split"] as const).includes(this.options.channelMode)) {
      throw new TypeError('channelMode must be "merge" or "split"');
    }
  }

  async generate(
    sourcePath: string,
    options: GenerateOptions = {},
  ): Promise<Peaks | WaveformData> {
    this.validateGenerateOptions(sourcePath, options);
    if (sourcePath !== "-" && !URL.canParse(sourcePath)) {
      await access(sourcePath).catch(() =>
        Promise.reject(new Error(`File ${sourcePath} not found`)),
      );
      const native = await this.generateNativeWav(sourcePath, options);
      if (native) return native;
    }

    const temporaryDirectory = await mkdtemp(join(tmpdir(), "peakwright-"));
    const rawPath = join(temporaryDirectory, "audio.raw");

    try {
      await this.convert(sourcePath, rawPath, options);
      const { size } = await stat(rawPath);
      const totalFrames = Math.trunc(size / 2 / this.options.numOfChannels);
      const collector = new PeakCollector(
        this.options.channelMode === "split",
        this.options.width,
        this.options.precision,
        totalFrames,
        this.options.numOfChannels,
      );
      for await (const chunk of createReadStream(rawPath))
        collector.update(chunk);

      return this.finish(
        collector.get(),
        this.options.sampleRate,
        this.options.numOfChannels,
        totalFrames,
        options,
      );
    } finally {
      await rm(temporaryDirectory, { recursive: true, force: true });
    }
  }

  private async generateNativeWav(
    sourcePath: string,
    options: GenerateOptions,
  ): Promise<Peaks | WaveformData | null> {
    const info = await readWavInfo(sourcePath);
    if (
      !info ||
      (this.requestedChannels !== undefined &&
        this.requestedChannels !== info.channels) ||
      (this.requestedSampleRate !== undefined &&
        this.requestedSampleRate !== info.sampleRate)
    )
      return null;

    const availableFrames = Math.floor(info.dataSize / info.blockAlign);
    const startFrame = Math.min(
      availableFrames,
      Math.floor((options.start ?? 0) * info.sampleRate),
    );
    const remainingFrames = availableFrames - startFrame;
    const requestedFrames =
      options.duration === undefined
        ? remainingFrames
        : Math.floor(options.duration * info.sampleRate);
    const frameCount = Math.min(remainingFrames, requestedFrames);
    const collector = new PeakCollector(
      this.options.channelMode === "split",
      this.options.width,
      this.options.precision,
      frameCount,
      info.channels,
    );
    await collectWav(
      sourcePath,
      info,
      collector,
      startFrame,
      frameCount,
      options.signal,
    );
    return this.finish(
      collector.get(),
      info.sampleRate,
      info.channels,
      frameCount,
      options,
    );
  }

  private async finish(
    data: Peaks,
    sampleRate: number,
    sourceChannels: number,
    totalFrames: number,
    options: GenerateOptions,
  ): Promise<Peaks | WaveformData> {
    const result =
      options.format === "json"
        ? {
            version: 1 as const,
            sampleRate,
            channels: this.options.channelMode === "split" ? sourceChannels : 1,
            channelMode: this.options.channelMode,
            points: this.options.width,
            duration: totalFrames / sampleRate,
            data,
          }
        : data;
    if (options.outputPath)
      await writeFile(options.outputPath, JSON.stringify(result));
    return result;
  }

  getPeaks(sourcePath: string, outputPath?: string): Promise<Peaks>;
  getPeaks(sourcePath: string, callback: PeaksCallback): void;
  getPeaks(
    sourcePath: string,
    outputPath: string,
    callback: PeaksCallback,
  ): void;
  getPeaks(
    sourcePath: string,
    outputOrCallback?: string | PeaksCallback,
    callback?: PeaksCallback,
  ): Promise<Peaks> | undefined {
    const outputPath =
      typeof outputOrCallback === "string" ? outputOrCallback : undefined;
    const done =
      typeof outputOrCallback === "function" ? outputOrCallback : callback;
    const operation = this.generate(sourcePath, {
      outputPath,
      format: "raw",
    }) as Promise<Peaks>;
    if (!done) return operation;
    operation.then(
      (peaks) => done(null, peaks),
      (error: Error) => done(error),
    );
  }

  private validateGenerateOptions(
    sourcePath: string,
    options: GenerateOptions,
  ): void {
    if (!sourcePath)
      throw new TypeError("sourcePath must be a non-empty string");
    if (
      options.start !== undefined &&
      (!Number.isFinite(options.start) || options.start < 0)
    ) {
      throw new TypeError("start must be a non-negative number");
    }
    if (
      options.duration !== undefined &&
      (!Number.isFinite(options.duration) || options.duration <= 0)
    ) {
      throw new TypeError("duration must be a positive number");
    }
    if (
      options.format !== undefined &&
      options.format !== "raw" &&
      options.format !== "json"
    ) {
      throw new TypeError('format must be "raw" or "json"');
    }
  }

  private convert(
    sourcePath: string,
    outputPath: string,
    options: GenerateOptions,
  ): Promise<void> {
    const args = ["-v", "error"];
    if (options.start !== undefined) args.push("-ss", String(options.start));
    args.push("-i", sourcePath);
    if (options.duration !== undefined)
      args.push("-t", String(options.duration));
    args.push(
      "-f",
      "s16le",
      "-ac",
      String(this.options.numOfChannels),
      "-acodec",
      "pcm_s16le",
      "-ar",
      String(this.options.sampleRate),
      "-y",
      outputPath,
    );

    return new Promise((resolve, reject) => {
      const ffmpeg = spawn(this.options.ffmpegPath, args, {
        signal: options.signal,
      });
      let stderr = "";
      ffmpeg.stderr.on("data", (chunk) => {
        stderr += chunk;
      });
      ffmpeg.on("error", reject);
      ffmpeg.on("close", (code) => {
        if (code === 0) resolve();
        else
          reject(new Error(stderr.trim() || `FFmpeg exited with code ${code}`));
      });
      if (sourcePath === "-") process.stdin.pipe(ffmpeg.stdin);
      else ffmpeg.stdin.end();
    });
  }
}

export type { Peaks } from "./get-peaks.js";
