const fs       = require('fs');
const path     = require('path');
const os       = require('os');
const rimraf   = require('rimraf');
const spawn    = require('child_process').spawn;
const GetPeaks = require('./getPeaks');

class AudioPeaks {

	constructor(opts) {
		this.oddByte = null;
		this.sc = 0;
		
		this.opts = Object.assign({
			numOfChannels: 2,
			sampleRate: 44100,
			maxValue: 1.0,
			minValue: -1.0,
			width: 800,
			precision: 5
		}, opts || {});
	}
	
	/**
	 * Extracts peaks from an audio file.
	 * Writes a JSON file if an output path was specified.
	 * @param {String} sourcePath          - Source audio file path.
	 * @param {String|Function} outputPath - Output audio file path or Callback fn.
	 * @param {Function|Undefined} cb                - Callback fn
	 */
	getPeaks(sourcePath, outputPath, cb) {
		if (typeof sourcePath !== 'string') return cb(new Error(`sourcePath param is not valid`));
		
		if (typeof outputPath === 'function') {
			cb = outputPath;
			outputPath = undefined;
		}
		
		fs.access(sourcePath, (err) => {
			if (err) return cb(new Error(`File ${sourcePath} not found`));
			
			this.sourceFilePath = sourcePath;
			this.extractPeaks((err, peaks) => {
				if (err) return cb(err);
				if (!outputPath) return cb(null, peaks);
				
				let jsonPeaks;
				try {
					jsonPeaks = JSON.stringify(peaks);
				} catch (err) {
					return cb(err);
				}
				fs.writeFile(outputPath, jsonPeaks, (err) => {
					if (err) return cb(err);
					cb(null, peaks);
				});
			});
		});
	}
	
	/**
	 * Extracts data peaks from an audio file using ffmpeg.
	 * @param {Function} cb Callback fn
	 */
	extractPeaks(cb) {
		this.convertFile((err, rawfilepath) => {
			if (err) return cb(err);

			fs.stat(rawfilepath, (err, stats) => {
				if (err) return cb(err);
				
				const totalSamples = ~~((stats.size / 2) / this.opts.numOfChannels);
				this.peaks = new GetPeaks(this.opts.numOfChannels >= 2, this.opts.width, this.opts.precision, totalSamples);
				
				const readable = fs.createReadStream(rawfilepath);
				readable.on('data', this.onChunkRead.bind(this));
				readable.on('end', () => {
					rimraf(path.dirname(rawfilepath), (err) => {
						if (err) return cb(err);
						cb(null, this.peaks.get());
					});
				});
				readable.on('error', cb);
			});
		});
	}

	onChunkRead(chunk) {
		let i = 0;
		let value;
		let contentLength = chunk.length;
		let samples = [];
		
		for(let ii=0; ii<this.opts.numOfChannels; ii++) samples[ii] = [];
		
		if (this.oddByte !== null) {
			value = ((chunk.readInt8(i++, true) << 8) | this.oddByte) / 32768.0;
			samples[this.sc].push(value);
			this.sc = (this.sc+1) % this.opts.numOfChannels;
		}

		for (; i < contentLength; i += 2) {
			value = chunk.readInt16LE(i, true) / 32768.0;
			samples[this.sc].push(value);
			this.sc = (this.sc+1) % this.opts.numOfChannels;
		}
		this.oddByte = (i < contentLength ? chunk.readUInt8(i, true) : null);
		this.peaks.update(samples);
	}

	convertFile(cb) {
		let errorMsg = '';
		fs.mkdtemp('/tmp/ffpeaks-', (err, tmpPath) => {
			if (err) return cb(err);
			
			const rawfilepath = path.join(tmpPath, 'audio.raw');
			const ffmpeg = spawn('ffmpeg', [
				'-v', 'error',
				'-i', this.sourceFilePath,
				'-f', 's16le',
				'-ac', this.opts.numOfChannels,
				'-acodec', 'pcm_s16le',
				'-ar', this.opts.sampleRate,
				'-y', rawfilepath
			]);
			ffmpeg.stdout.on('end', () => cb(null, rawfilepath));
			ffmpeg.stderr.on('data', (err) => errorMsg += err.toString());
			ffmpeg.stderr.on('end', () => {
				if (errorMsg) cb(new Error(errorMsg));
			});
		});
	}
}

module.exports = AudioPeaks;