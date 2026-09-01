import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { PeakCollector } from "../packages/core/dist/index.js";
import AudioPeaks from "../packages/node/dist/index.js";
import WebPeakwright from "../packages/web/dist/index.js";

const exec = promisify(execFile);

test("collects interleaved PCM in the portable core", () => {
  const collector = new PeakCollector(false, 2, 1, 4, 2);
  for (const value of [1000, -2000, 3000, -4000, 5000, -6000, 7000, -8000])
    collector.add(value / 32768);

  assert.deepEqual(collector.get(), [
    3000 / 32768,
    -4000 / 32768,
    7000 / 32768,
    -8000 / 32768,
  ]);
});

test("decodes WAV data through the browser package", async () => {
  for (const [format, bits] of [
    [1, 8],
    [1, 16],
    [1, 24],
    [1, 32],
    [3, 32],
    [3, 64],
  ]) {
    const wav = createMinimalWav(format, bits);
    const waveform = await new WebPeakwright({ width: 2 }).generate(
      wav.buffer.slice(wav.byteOffset, wav.byteOffset + wav.byteLength),
    );
    assert.equal(waveform.data.length, 4);
    assert.ok(Math.abs(waveform.data[0] - 0.25) < 0.01);
    assert.ok(Math.abs(waveform.data[1] + 0.5) < 0.01);
  }
});

test("decodes every documented native WAV sample encoding", async () => {
  const directory = await mkdtemp(join(tmpdir(), "peakwright-formats-test-"));
  try {
    for (const [format, bits] of [
      [1, 8],
      [1, 16],
      [1, 24],
      [1, 32],
      [3, 32],
      [3, 64],
    ]) {
      const input = join(directory, `${format}-${bits}.wav`);
      await writeFile(input, createMinimalWav(format, bits));
      const peaks = await new AudioPeaks({
        width: 2,
        ffmpegPath: "missing-ffmpeg",
      }).getPeaks(input);
      assert.ok(Math.abs(peaks[0] - 0.25) < 0.01);
      assert.ok(Math.abs(peaks[1] + 0.5) < 0.01);
      assert.ok(Math.abs(peaks[2] - 0.75) < 0.01);
      assert.ok(Math.abs(peaks[3] + 1) < 0.01);
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("preserves raw and callback APIs while adding structured output", async () => {
  const fixture = await createFixture();
  try {
    const instance = new AudioPeaks({
      width: 10,
      ffmpegPath: "missing-ffmpeg",
    });
    const peaks = await instance.getPeaks(fixture.input);
    assert.equal(peaks.length, 20);

    const callbackPeaks = await new Promise((resolve, reject) => {
      instance.getPeaks(fixture.input, (error, result) =>
        error ? reject(error) : resolve(result),
      );
    });
    assert.deepEqual(callbackPeaks, peaks);

    const waveform = await instance.generate(fixture.input, {
      format: "json",
      duration: 0.05,
    });
    assert.equal(waveform.data.length, 20);
    assert.equal(waveform.version, 1);
    assert.equal(waveform.channels, 1);
    assert.equal(waveform.points, 10);
    assert.ok(waveform.duration > 0.04 && waveform.duration <= 0.05);
  } finally {
    await rm(fixture.directory, { recursive: true, force: true });
  }
});

test("supports split channels, files, and stdin/stdout CLI pipelines", async () => {
  const fixture = await createFixture();
  try {
    const output = join(fixture.directory, "peaks.json");
    const split = await new AudioPeaks({
      width: 8,
      channelMode: "split",
      ffmpegPath: "missing-ffmpeg",
    }).generate(fixture.input, { format: "json", outputPath: output });
    assert.equal(split.channels, 2);
    assert.equal(split.data.length, 2);
    assert.deepEqual(JSON.parse(await readFile(output, "utf8")), split);

    const { stdout } = await runCli(
      ["-", "-", "--width", "8", "--channels", "1", "--format", "json"],
      await readFile(fixture.input),
    );
    const piped = JSON.parse(stdout);
    assert.equal(piped.points, 8);
    assert.equal(piped.channels, 1);
    assert.equal(piped.data.length, 16);
  } finally {
    await rm(fixture.directory, { recursive: true, force: true });
  }
});

test("supports native ranges and cancellation without FFmpeg", async () => {
  const fixture = await createFixture();
  try {
    const waveform = await new AudioPeaks({
      width: 4,
      ffmpegPath: "missing-ffmpeg",
    }).generate(fixture.input, { format: "json", start: 0.03, duration: 0.02 });
    assert.equal(waveform.data.length, 8);
    assert.equal(waveform.duration, 0.02);

    const controller = new AbortController();
    controller.abort();
    await assert.rejects(
      new AudioPeaks({ ffmpegPath: "missing-ffmpeg" }).generate(fixture.input, {
        signal: controller.signal,
      }),
      { name: "AbortError" },
    );
  } finally {
    await rm(fixture.directory, { recursive: true, force: true });
  }
});

test("falls back to FFmpeg for conversion, compressed audio, and URLs", async () => {
  const fixture = await createFixture();
  const mp3 = join(fixture.directory, "tone.mp3");
  try {
    await assert.rejects(
      new AudioPeaks({
        sampleRate: 8000,
        ffmpegPath: "missing-ffmpeg",
      }).generate(fixture.input),
      /missing-ffmpeg/,
    );

    await exec("ffmpeg", ["-v", "error", "-i", fixture.input, "-y", mp3]);
    const compressed = await new AudioPeaks({ width: 4 }).generate(mp3, {
      format: "json",
    });
    assert.equal(compressed.data.length, 8);

    const server = createServer((_request, response) => {
      response.setHeader("content-type", "audio/mpeg");
      readFile(mp3).then(
        (body) => response.end(body),
        (error) => response.destroy(error),
      );
    });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    try {
      const address = server.address();
      const remote = await new AudioPeaks({ width: 4 }).generate(
        `http://127.0.0.1:${address.port}/tone.mp3`,
      );
      assert.equal(remote.length, 8);
    } finally {
      await new Promise((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    }
  } finally {
    await rm(fixture.directory, { recursive: true, force: true });
  }
});

test("provides stable CLI help, version, and validation errors", async () => {
  const help = await exec(process.execPath, [
    "packages/cli/dist/cli.js",
    "--help",
  ]);
  assert.match(help.stdout, /^Usage: peakwright/);
  const version = await exec(process.execPath, [
    "packages/cli/dist/cli.js",
    "--version",
  ]);
  assert.equal(version.stdout.trim(), "1.0.0");
  await assert.rejects(
    exec(process.execPath, ["packages/cli/dist/cli.js", "--unknown"]),
    /Unknown option/,
  );
});

test("rejects invalid configuration, ranges, and missing inputs", async () => {
  assert.throws(() => new AudioPeaks({ width: 0 }), /width/);
  assert.throws(
    () => new AudioPeaks({ channelMode: "invalid" }),
    /channelMode/,
  );
  assert.throws(() => new AudioPeaks({ ffmpegPath: "" }), /ffmpegPath/);

  const instance = new AudioPeaks();
  await assert.rejects(instance.generate(""), /sourcePath/);
  await assert.rejects(instance.generate("missing-audio.wav"), /not found/);
  await assert.rejects(
    instance.generate("missing-audio.wav", { start: -1 }),
    /start/,
  );
  await assert.rejects(
    instance.generate("missing-audio.wav", { duration: 0 }),
    /duration/,
  );
  await assert.rejects(
    instance.generate("missing-audio.wav", { format: "xml" }),
    /format/,
  );
});

async function createFixture() {
  const directory = await mkdtemp(join(tmpdir(), "peakwright-test-"));
  const input = join(directory, "tone.wav");
  await writeFile(input, createWav());
  return { directory, input };
}

function createWav() {
  const sampleRate = 44_100;
  const channels = 2;
  const frames = sampleRate / 10;
  const dataSize = frames * channels * 2;
  const wav = Buffer.alloc(44 + dataSize);
  wav.write("RIFF", 0);
  wav.writeUInt32LE(36 + dataSize, 4);
  wav.write("WAVEfmt ", 8);
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(channels, 22);
  wav.writeUInt32LE(sampleRate, 24);
  wav.writeUInt32LE(sampleRate * channels * 2, 28);
  wav.writeUInt16LE(channels * 2, 32);
  wav.writeUInt16LE(16, 34);
  wav.write("data", 36);
  wav.writeUInt32LE(dataSize, 40);
  for (let frame = 0; frame < frames; frame++) {
    const sample = Math.round(
      Math.sin((frame * 440 * Math.PI * 2) / sampleRate) * 16_000,
    );
    wav.writeInt16LE(sample, 44 + frame * 4);
    wav.writeInt16LE(-sample, 46 + frame * 4);
  }
  return wav;
}

function createMinimalWav(format, bits) {
  const samples = [-0.5, 0.25, -1, 0.75];
  const bytes = bits / 8;
  const dataSize = samples.length * bytes;
  const wav = Buffer.alloc(44 + dataSize);
  wav.write("RIFF", 0);
  wav.writeUInt32LE(36 + dataSize, 4);
  wav.write("WAVEfmt ", 8);
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(format, 20);
  wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(8000, 24);
  wav.writeUInt32LE(8000 * bytes, 28);
  wav.writeUInt16LE(bytes, 32);
  wav.writeUInt16LE(bits, 34);
  wav.write("data", 36);
  wav.writeUInt32LE(dataSize, 40);
  samples.forEach((sample, index) => {
    writeSample(wav, 44 + index * bytes, sample, format, bits);
  });
  return wav;
}

function writeSample(buffer, offset, sample, format, bits) {
  if (format === 3) {
    if (bits === 32) buffer.writeFloatLE(sample, offset);
    else buffer.writeDoubleLE(sample, offset);
  } else if (bits === 8)
    buffer.writeUInt8(Math.round((sample + 1) * 127.5), offset);
  else if (bits === 16) buffer.writeInt16LE(Math.round(sample * 32767), offset);
  else if (bits === 24)
    buffer.writeIntLE(Math.round(sample * 8388607), offset, 3);
  else buffer.writeInt32LE(Math.round(sample * 2147483647), offset);
}

function runCli(args, input) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [
      "packages/cli/dist/cli.js",
      ...args,
    ]);
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("close", (code) =>
      code === 0 ? resolve({ stdout, stderr }) : reject(new Error(stderr)),
    );
    child.stdin.end(input);
  });
}
