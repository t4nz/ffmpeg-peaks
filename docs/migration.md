# Migrating from ffmpeg-peaks

Peakwright is the new name of `ffmpeg-peaks`. The maintained implementation is published as `peakwright`; the old package name remains available as a compatibility wrapper.

## New projects

```sh
bun remove ffmpeg-peaks
bun add peakwright
```

Update the import and command name:

```diff
- import AudioPeaks from "ffmpeg-peaks";
+ import Peakwright from "peakwright";
```

```diff
- ffmpeg-peaks audio.mp3 peaks.json
+ peakwright audio.mp3 peaks.json
```

## Existing projects

Installing `ffmpeg-peaks@1` keeps the previous import and CLI names. It delegates to Peakwright and contains no duplicate implementation.

The callback-based `getPeaks()` method remains available. New code can adopt `generate()` for structured metadata, cancellation, and time ranges independently.
