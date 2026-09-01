export type Peaks = number[] | number[][];

export class PeakCollector {
  private readonly channels: number[][];
  private sampleIndex = 0;

  constructor(
    private readonly splitChannels: boolean,
    private readonly length: number,
    private readonly step: number,
    private readonly totalFrames: number,
    private readonly channelCount: number,
  ) {
    if (
      ![length, step, channelCount].every(
        (value) => Number.isInteger(value) && value > 0,
      )
    )
      throw new TypeError(
        "length, step, and channelCount must be positive integers",
      );
    if (!Number.isInteger(totalFrames) || totalFrames < 0)
      throw new TypeError("totalFrames must be a non-negative integer");
    this.channels = Array.from({ length: channelCount }, () =>
      Array(length * 2).fill(0),
    );
  }

  add(value: number): void {
    const frame = Math.floor(this.sampleIndex / this.channelCount);
    const channel = this.sampleIndex % this.channelCount;
    this.sampleIndex++;
    if (frame % this.step !== 0 || this.totalFrames === 0) return;
    const range = Math.min(
      this.length - 1,
      Math.floor((frame * this.length) / this.totalFrames),
    );
    const peaks = this.channels[channel];
    peaks[2 * range] = Math.max(peaks[2 * range], value);
    peaks[2 * range + 1] = Math.min(peaks[2 * range + 1], value);
  }

  get(): Peaks {
    if (this.splitChannels) return this.channels;
    const merged = Array(this.length * 2).fill(0);
    for (const peaks of this.channels) {
      for (let range = 0; range < this.length; range++) {
        merged[2 * range] = Math.max(merged[2 * range], peaks[2 * range]);
        merged[2 * range + 1] = Math.min(
          merged[2 * range + 1],
          peaks[2 * range + 1],
        );
      }
    }
    return merged;
  }
}
