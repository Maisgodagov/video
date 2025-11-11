const ffmpeg = require('fluent-ffmpeg');
const ffmpegPath = require('@ffmpeg-installer/ffmpeg').path;
const path = require('path');
const fs = require('fs').promises;
const config = require('../../config/config');

ffmpeg.setFfmpegPath(ffmpegPath);

function extractLoudnessMeasurements(output) {
  const matches = output.match(/\{[\s\S]*?\}/g) || [];
  for (let i = matches.length - 1; i >= 0; i -= 1) {
    try {
      const candidate = JSON.parse(matches[i]);
      if (candidate && Object.prototype.hasOwnProperty.call(candidate, 'input_i')) {
        return candidate;
      }
    } catch (err) {
      // ignore bad JSON fragments
    }
  }
  return null;
}

async function analyzeLoudness(inputVideoPath, targetLufs, loudnessRange, truePeak) {
  return new Promise((resolve, reject) => {
    let measurementOutput = '';

    ffmpeg(inputVideoPath)
      .audioFilter(
        `loudnorm=I=${targetLufs}:LRA=${loudnessRange}:TP=${truePeak}:print_format=json`
      )
      .outputOptions('-f', 'null')
      .on('start', () => {
        console.log('  -> Analyzing audio loudness (first pass)...');
      })
      .on('stderr', (line) => {
        measurementOutput += `${line}\n`;
      })
      .on('end', () => {
        const measurements = extractLoudnessMeasurements(measurementOutput);
        if (!measurements) {
          return reject(
            new Error('Could not parse loudness measurements from FFmpeg output')
          );
        }

        console.log('  -> Measured loudness parameters:', {
          input_i: measurements.input_i,
          input_lra: measurements.input_lra,
          input_tp: measurements.input_tp,
          input_thresh: measurements.input_thresh
        });

        resolve(measurements);
      })
      .on('error', (err) => {
        reject(new Error(`Loudness analysis failed: ${err.message}`));
      })
      .save('-');
  });
}

async function normalizeVideoAudio(inputVideoPath, outputDir) {
  const {
    targetLufs,
    loudnessRange,
    truePeak,
    apply,
    audioCodec,
    audioBitrate
  } = config.audioNormalization || {};
  const videoCompression = config.videoCompression || {};

  const normalizeAudio = apply !== false;
  const compressVideo = videoCompression.apply !== false;

  if (!normalizeAudio && !compressVideo) {
    return inputVideoPath;
  }

  const videoName = path.basename(inputVideoPath);
  const outputPath = path.join(
    outputDir,
    `${path.parse(videoName).name}-normalized${path.extname(videoName)}`
  );

  if (outputPath === inputVideoPath) {
    throw new Error('Normalized output path collides with input path');
  }

  await fs.mkdir(outputDir, { recursive: true });

  const target_i = targetLufs ?? -16;
  const target_lra = loudnessRange ?? 11;
  const target_tp = truePeak ?? -1.5;
  const codec = audioCodec ?? 'aac';
  const bitrate = audioBitrate ?? '192k';

  if (normalizeAudio) {
    console.log('  -> Target normalization parameters:', {
      target_i,
      target_lra,
      target_tp,
      codec,
      bitrate
    });
  } else {
    console.log('  -> Audio normalization disabled via configuration.');
  }
  if (compressVideo) {
    console.log('  -> Video compression settings:', {
      codec: videoCompression.codec || 'libx264',
      preset: videoCompression.preset || 'medium',
      crf: Number.isFinite(videoCompression.crf) ? videoCompression.crf : 'auto',
      maxWidth: videoCompression.maxWidth || 'source',
      maxHeight: videoCompression.maxHeight || 'source',
      pixelFormat: videoCompression.pixelFormat || 'auto'
    });
  } else {
    console.log('  -> Video compression disabled via configuration.');
  }

  let measurements = null;
  let shouldNormalizeAudio = normalizeAudio;

  if (normalizeAudio) {
    try {
      measurements = await analyzeLoudness(inputVideoPath, target_i, target_lra, target_tp);
    } catch (error) {
      console.warn(
        `  -> Loudness analysis failed (${error.message}). Skipping audio normalization.`
      );
      shouldNormalizeAudio = false;
    }
  }

  const targetOffset = measurements && Number.isFinite(measurements.target_offset)
    ? measurements.target_offset
    : 0;

  const videoFilters = [];
  if (compressVideo) {
    const parseDimension = (value) => {
      if (value === null || value === undefined) {
        return null;
      }
      if (typeof value === 'number' && Number.isFinite(value)) {
        return value > 0 ? value : null;
      }
      const parsed = Number.parseInt(value, 10);
      return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
    };

    const maxWidth = parseDimension(videoCompression.maxWidth);
    const maxHeight = parseDimension(videoCompression.maxHeight);

    if (maxWidth && maxHeight) {
      videoFilters.push(
        `scale=${maxWidth}:${maxHeight}:force_original_aspect_ratio=decrease`
      );
      videoFilters.push('pad=ceil(iw/2)*2:ceil(ih/2)*2');
    } else if (maxWidth) {
      videoFilters.push(`scale='min(${maxWidth},iw)':-2`);
      videoFilters.push('pad=ceil(iw/2)*2:ceil(ih/2)*2');
    } else if (maxHeight) {
      videoFilters.push(`scale=-2:'min(${maxHeight},ih)'`);
      videoFilters.push('pad=ceil(iw/2)*2:ceil(ih/2)*2');
    }
  }

  return new Promise((resolve, reject) => {
    const command = ffmpeg(inputVideoPath);

    if (shouldNormalizeAudio && measurements) {
      const loudnormFilter = [
        `loudnorm=I=${target_i}`,
        `LRA=${target_lra}`,
        `TP=${target_tp}`,
        `measured_I=${measurements.input_i}`,
        `measured_LRA=${measurements.input_lra}`,
        `measured_TP=${measurements.input_tp}`,
        `measured_thresh=${measurements.input_thresh}`,
        `offset=${targetOffset}`,
        'linear=true',
        'print_format=summary'
      ].join(':');

      console.log('  -> Applying normalization (second pass)...');
      command.audioFilter(loudnormFilter).audioCodec(codec).audioBitrate(bitrate);
    } else {
      console.log('  -> Skipping audio normalization for output.');
      command.audioCodec('copy');
    }

    if (compressVideo) {
      const selectedCodec = videoCompression.codec || 'libx264';
      command.videoCodec(selectedCodec);

      if (videoFilters.length) {
        command.videoFilters(videoFilters.join(','));
      }

      if (videoCompression.preset) {
        command.outputOptions('-preset', videoCompression.preset);
      }
      if (Number.isFinite(videoCompression.crf)) {
        command.outputOptions('-crf', String(videoCompression.crf));
      }
      if (videoCompression.tune) {
        command.outputOptions('-tune', videoCompression.tune);
      }
      if (videoCompression.pixelFormat) {
        command.outputOptions('-pix_fmt', videoCompression.pixelFormat);
      }
      if (videoCompression.maxBitrate) {
        command.outputOptions('-maxrate', videoCompression.maxBitrate);
      }
      if (videoCompression.bufSize) {
        command.outputOptions('-bufsize', videoCompression.bufSize);
      }
      if (Array.isArray(videoCompression.additionalOptions) && videoCompression.additionalOptions.length) {
        command.outputOptions(videoCompression.additionalOptions);
      }
    } else {
      command.videoCodec('copy');
    }

    command
      .outputOptions('-movflags', 'faststart')
      .on('start', (cmdLine) => {
        console.log('  -> FFmpeg processing command:', cmdLine);
      })
      .on('progress', (progress) => {
        if (progress.percent) {
          console.log(`  -> Processing progress: ${progress.percent.toFixed(1)}%`);
        }
      })
      .on('end', () => {
        console.log(`  -> Video processed successfully: ${outputPath}`);
        resolve(outputPath);
      })
      .on('error', (err) => {
        console.error('  -> Video processing failed:', err.message);
        reject(err);
      })
      .save(outputPath);
  });
}

module.exports = { normalizeVideoAudio };
