# Changelog

All notable changes are documented here. This project follows [Semantic Versioning](https://semver.org/).

## [Unreleased]

## [1.0.0] - 2026-09-01

### Added

- TypeScript source and generated type declarations.
- Promise-based library API while retaining callback compatibility.
- Peakwright product name, logo, and `peakwright` command-line interface.
- Constant-memory PCM streaming.
- Structured waveform metadata output.
- Merged and split-channel modes.
- stdin/stdout pipelines, time ranges, `AbortSignal`, and configurable FFmpeg paths.
- Native streaming decoding for PCM and IEEE Float WAV files without FFmpeg.
- Separate `ffmpeg-peaks` compatibility package.
- Biome formatting and linting.
- Automated tests, dependency updates, and security checks.

### Changed

- Require Node.js 22 or newer.
- Publish as an ECMAScript module.
- Improve npm and GitHub discovery metadata for FFmpeg, waveform, TypeScript, Bun, and CLI searches.

### Removed

- Deprecated `request` and `rimraf` runtime dependencies.

[Unreleased]: https://github.com/t4nz/ffmpeg-peaks/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/t4nz/ffmpeg-peaks/compare/v0.3.3...v1.0.0
