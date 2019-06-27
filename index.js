const fs = require('fs');
const request = require('request');
const path = require('path');
const os = require('os');
const rimraf = require('rimraf');
const spawn = require('child_process').spawn;
const GetPeaks = require('./getPeaks');

class AudioPeaks {
  constructor(opts = {}) {
    this.oddByte = null;
    this.sc = 0;

    this.opts = {
      numOfChannels: 2,
      sampleRate: 44100,
      maxValue: 1.0,
      minValue: -1.0,
      width: 1640,
      precision: 1,
      ...opts,
    };
  }

  /**
   * Extracts peaks from an audio file.
   * Writes a JSON file if an output path was specified.
   * @param {String} sourcePath          - Source audio file path.
   * @param {String|Function} outputPath - Output audio file path or Callback fn.
   * @param {Function|Undefined} cb                - Callback fn
   */
  getPeaks(sourcePath, outputPath, cb) {
    if (typeof sourcePath !== 'string') {
      return cb(new Error(`sourcePath param is not valid`));
    }

    if (typeof outputPath === 'function') {
      cb = outputPath;
      outputPath = undefined;
    }

    this.checkSourcePathAccessiblility(sourcePath, err => {
      if (err) return cb(err);

      this.sourceFilePath = sourcePath;
      this.extractPeaks((err, peaks) => {
        if (err) return cb(err);
        if (!outputPath) return cb(null, peaks);

        try {
          const jsonPeaks = JSON.stringify(peaks);
          fs.writeFile(outputPath, jsonPeaks, err => {
            if (err) return cb(err);
            cb(null, peaks);
          });
        } catch (err) {
          return cb(err);
        }
      });
    });
  }

  checkSourcePathAccessiblility(sourcePath, cb) {
    if (sourcePath.match(/^(?:\w+:)?\/\/(\S+)$/)) {
      request(sourcePath, { method: 'HEAD' }, (err, res) => {
        if (err) {
          return cb(err);
        }

        if (res.statusCode != 200) {
          return cb(new Error(`Url ${sourcePath} error: ${res.statusCode}`));
        }

        cb();
      });
    } else {
      fs.access(sourcePath, err => {
        if (err) {
          return cb(new Error(`File ${sourcePath} not found`));
        }

        cb();
      });
    }
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

        const totalSamples = ~~(stats.size / 2 / this.opts.numOfChannels);
        this.peaks = new GetPeaks(this.opts.numOfChannels >= 2, this.opts.width, this.opts.precision, totalSamples);

        const readable = fs.createReadStream(rawfilepath);
        readable.on('data', this.onChunkRead.bind(this));
        readable.on('error', cb);
        readable.on('end', () => {
          rimraf(path.dirname(rawfilepath), err => {
            if (err) return cb(err);
            cb(null, this.peaks.get());
          });
        });
      });
    });
  }

  onChunkRead(chunk) {
    let i = 0;
    let value;
    let samples = [];

    for (let j = 0; j < this.opts.numOfChannels; j++) samples[j] = [];

    if (this.oddByte !== null) {
      value = ((chunk.readInt8(i++, true) << 8) | this.oddByte) / 32768.0;
      samples[this.sc].push(value);
      this.sc = (this.sc + 1) % this.opts.numOfChannels;
    }

    for (; i + 1 < chunk.length; i += 2) {
      value = chunk.readInt16LE(i, true) / 32768.0;
      samples[this.sc].push(value);
      this.sc = (this.sc + 1) % this.opts.numOfChannels;
    }
    this.oddByte = i < chunk.length ? chunk.readUInt8(i, true) : null;
    this.peaks.update(samples);
  }

  convertFile(cb) {
    fs.mkdtemp(path.join(os.tmpdir(), 'ffpeaks-'), (err, tmpPath) => {
      if (err) return cb(err);

      let error = '';

      const rawfilepath = path.join(tmpPath, 'audio.raw');
      const ffmpeg = spawn('ffmpeg', [
        '-v',
        'error',
        '-i',
        this.sourceFilePath,
        '-f',
        's16le',
        '-ac',
        this.opts.numOfChannels,
        '-acodec',
        'pcm_s16le',
        '-ar',
        this.opts.sampleRate,
        '-y',
        rawfilepath,
      ]);

      ffmpeg.stdout.on('end', () => {
        if (!error.length) cb(null, rawfilepath);
      });

      ffmpeg.stderr.on('data', err => {
        error += err.toString();
      });

      ffmpeg.stderr.on('end', () => {
        if (error.length) {
          rimraf(tmpPath, () => cb(new Error(error)));
        }
      });
    });
  }
}

module.exports = AudioPeaks;
