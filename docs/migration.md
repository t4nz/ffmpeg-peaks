# Migrating from ffmpeg-peaks

Peakwright replaces `ffmpeg-peaks`. The maintained implementation is published under the `@peakwright` scope; the old package is deprecated and remains only as a compatibility wrapper.

## New projects

```sh
bun remove ffmpeg-peaks
bun add @peakwright/node
```

Update the import and command name:

```diff
- import AudioPeaks from "ffmpeg-peaks";
+ import Peakwright from "@peakwright/node";
```

```diff
- ffmpeg-peaks audio.mp3 peaks.json
+ peakwright audio.mp3 peaks.json
```

## Existing projects

Installing `ffmpeg-peaks@1` keeps the previous import and CLI names during migration. It delegates to Peakwright and contains no duplicate implementation, but npm will display a deprecation notice.

The callback-based `getPeaks()` method remains available. New code can adopt `generate()` for structured metadata, cancellation, and time ranges independently.
