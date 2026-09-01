# Command-line guide

The `peakwright` command generates JSON waveform data from a local audio file, URL, or standard input.

## Run without installing

```sh
bunx peakwright ./audio.ogg
```

JSON is written to standard output. Pass an output path to write it to a file instead:

```sh
bunx peakwright ./audio.ogg ./peaks.json
```

## Global installation

```sh
bun add --global peakwright
peakwright ./audio.ogg ./peaks.json
```

## Options

| Option | Description | Default |
| --- | --- | ---: |
| `-w, --width <number>` | Number of waveform ranges | `1640` |
| `-p, --precision <number>` | Sample step; higher values inspect fewer samples | `1` |
| `-c, --channels <number>` | Number of output audio channels | `2` |
| `-r, --sample-rate <number>` | Output sample rate in Hz | `44100` |
| `--split-channels` | Return a waveform for every channel | |
| `--merge-channels` | Merge channels into one waveform | yes |
| `--format <raw\|json>` | Raw arrays or structured metadata | `raw` |
| `--ffmpeg-path <path>` | FFmpeg executable | `ffmpeg` |
| `--start <seconds>` | Start time | `0` |
| `--duration <seconds>` | Maximum duration to process | full input |
| `-h, --help` | Show command help | |
| `-v, --version` | Show the package version | |

Example for a mono waveform with 800 ranges:

```sh
peakwright ./podcast.mp3 ./waveform.json --channels 1 --width 800 --format json
```

## Output

Raw output is a flat array of alternating maximum and minimum values. With `--split-channels`, it is an array of those arrays, one per channel. Values are normalized between `-1` and `1`.

Structured JSON includes format version, sample rate, channel mode, point count, processed duration, and peak data.

## Pipelines

Use `-` for standard input or output:

```sh
ffmpeg -i video.mp4 -f wav - | peakwright - - --format json > waveform.json
```

The command exits with a non-zero status when input validation or decoding fails. Local PCM and IEEE Float WAV files use the built-in decoder. Other formats, URLs, stdin, and conversions require FFmpeg on `PATH` or supplied through `--ffmpeg-path`.
