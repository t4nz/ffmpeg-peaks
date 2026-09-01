#!/usr/bin/env node
import AudioPeaks, {
  type AudioPeaksOptions,
  type GenerateOptions,
  type OutputFormat,
} from "./index.js";

const help = `Usage: peakwright <input> [output] [options]

Generate waveform peak data from an audio file, URL, or standard input (-).

Options:
  -w, --width <number>       Number of waveform ranges (default: 1640)
  -p, --precision <number>   Sample step (default: 1)
  -c, --channels <number>    Audio channels decoded by FFmpeg (default: 2)
  -r, --sample-rate <number> Sample rate in Hz (default: 44100)
      --split-channels       Return peaks for each channel
      --merge-channels       Merge channels into one waveform (default)
      --format <raw|json>    Raw peaks or structured output (default: raw)
      --ffmpeg-path <path>   FFmpeg executable (default: ffmpeg)
      --start <seconds>      Start time
      --duration <seconds>   Maximum duration to process
  -h, --help                 Show this help
  -v, --version              Show the package version`;

const integerOptions: Record<string, keyof AudioPeaksOptions> = {
  "--width": "width",
  "-w": "width",
  "--precision": "precision",
  "-p": "precision",
  "--channels": "numOfChannels",
  "-c": "numOfChannels",
  "--sample-rate": "sampleRate",
  "-r": "sampleRate",
};

async function main(args: string[]): Promise<void> {
  if (args.includes("--help") || args.includes("-h"))
    return void console.log(help);
  if (args.includes("--version") || args.includes("-v")) {
    const packageJson = await import("../package.json", {
      with: { type: "json" },
    });
    return void console.log(packageJson.default.version);
  }

  const audioOptions: AudioPeaksOptions = {};
  const generateOptions: GenerateOptions = {};
  const positional: string[] = [];
  for (let index = 0; index < args.length; index++) {
    const argument = args[index];
    const integerName = integerOptions[argument];
    if (integerName) {
      const value = Number(args[++index]);
      if (!Number.isInteger(value) || value <= 0)
        throw new Error(`${argument} requires a positive integer`);
      if (integerName === "width") audioOptions.width = value;
      else if (integerName === "precision") audioOptions.precision = value;
      else if (integerName === "numOfChannels")
        audioOptions.numOfChannels = value;
      else audioOptions.sampleRate = value;
    } else if (
      argument === "--split-channels" ||
      argument === "--merge-channels"
    ) {
      audioOptions.channelMode =
        argument === "--split-channels" ? "split" : "merge";
    } else if (argument === "--format") {
      const value = args[++index] as OutputFormat;
      if (value !== "raw" && value !== "json")
        throw new Error("--format requires raw or json");
      generateOptions.format = value;
    } else if (argument === "--ffmpeg-path") {
      audioOptions.ffmpegPath = requireValue(args, ++index, argument);
    } else if (argument === "--start" || argument === "--duration") {
      const value = Number(requireValue(args, ++index, argument));
      if (
        !Number.isFinite(value) ||
        value < (argument === "--start" ? 0 : Number.MIN_VALUE)
      ) {
        throw new Error(
          `${argument} requires a ${argument === "--start" ? "non-negative" : "positive"} number`,
        );
      }
      generateOptions[argument === "--start" ? "start" : "duration"] = value;
    } else if (argument.startsWith("-") && argument !== "-") {
      throw new Error(`Unknown option: ${argument}`);
    } else positional.push(argument);
  }

  if (positional.length < 1 || positional.length > 2) throw new Error(help);
  if (positional[1] && positional[1] !== "-")
    generateOptions.outputPath = positional[1];
  const result = await new AudioPeaks(audioOptions).generate(
    positional[0],
    generateOptions,
  );
  if (!generateOptions.outputPath) console.log(JSON.stringify(result));
}

function requireValue(args: string[], index: number, option: string): string {
  const value = args[index];
  if (!value) throw new Error(`${option} requires a value`);
  return value;
}

main(process.argv.slice(2)).catch((error: Error) => {
  console.error(`peakwright: ${error.message}`);
  process.exitCode = 1;
});
