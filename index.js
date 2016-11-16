const spawn = require('child_process').spawn;

module.exports = {

  /**
   * Extract data peaks from an audio file using ffmpeg.
   * @param {String} filePath Source audio file.
   * @param {Object} options Optional parameters.
   * @param {Function} cb Callback fn
   */
  getPeaks(filePath, options, cb) {
    var oddByte;
    var errorMsg = '';
    var samples = [];

    var defaults = {
      numOfChannels: 2,
      sampleRate: 44100,
      maxValue: 1.0,
      minValue: -1.0,
      width: 800,
      precision: 10
    };

    options = Object.assign(defaults, options || {});

    const normalizeSample = (sample) => {
      if (sample < 0) return Math.max(options.minValue, sample);
      return Math.min(options.maxValue, sample);
    };

    const ffmpeg = spawn('ffmpeg', [
      '-v', 'error',
      '-i', filePath,
      '-f', 's16le',
      '-ac', options.numOfChannels,
      '-acodec', 'pcm_s16le',
      '-ar', options.sampleRate,
      '-y','pipe:1'
    ]);

    ffmpeg.stdout.on('data', (data) => {
      var i = 0;
      var value;
      var contentLength = data.length;

      if (oddByte !== null) {
        value = ((data.readInt8(i++, true) << 8) | oddByte) / 32767.0;
        samples.push(normalizeSample(value));
      }

      for (; i < contentLength; i += 2) {
        value = data.readInt16LE(i, true) / 32767.0;
        samples.push(normalizeSample(value));
      }

      oddByte = (i < contentLength ? data.readUInt8(i, true) : null);
    });

    ffmpeg.stdout.on('end', () => {
      const samplesLength = samples.length;
      const sampleSize = samplesLength / options.width;
      const sampleStep = options.precision;

      var peaks = [];
      for (var c = 0; c < options.numOfChannels; c++) {
        for (var i = 0; i < options.width; i++) {
          var start = ~~(i * sampleSize);
          var end = ~~(start + sampleSize);
          var min = 0;
          var max = 0;
          for (var j = start; j < end; j += sampleStep) {
            var value = samples[j];
            if (value > max) {
              max = value;
            }
            if (value < min) {
              min = value;
            }
          }

          if (c === 0 || max > peaks[2 * i]) {
            peaks[2 * i] = max;
          }
          if (c === 0 || min < peaks[2 * i + 1]) {
            peaks[2 * i + 1] = min;
          }
        }
      }
      cb(null, peaks);
    });

    ffmpeg.stderr.on('data', (data) => errorMsg += data.toString());

    ffmpeg.stderr.on('end', () => {
      if (errorMsg) cb(new Error(errorMsg));
    });
  }

};
