# ffmpeg-peaks
Generates a waveform data (peaks) from an audio file using ffmpeg

#### Example

```javascript
const ffmpegPeaks = require('ffmpeg-peaks');

const ffpeaks = new ffmpegPeaks({
	width: 1640,
	precision: 1,
	numOfChannels: 2,
	sampleRate: 16000
});

ffpeaks.getPeaks('/my/input/audio.ogg', '/my/output/peaks.json', (err, peaks) => {
	if (err) return console.error(err);
	console.log(peaks);
});

ffpeaks.getPeaks('http:/my/url/audio.ogg', (err, peaks) => {
	if (err) return console.error(err);
	console.log(peaks);
});

```
