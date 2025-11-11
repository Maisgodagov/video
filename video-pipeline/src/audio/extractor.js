const ffmpeg = require('fluent-ffmpeg');
const ffmpegPath = require('@ffmpeg-installer/ffmpeg').path;
const ffprobePath = require('@ffprobe-installer/ffprobe').path;
const path = require('path');

ffmpeg.setFfmpegPath(ffmpegPath);
ffmpeg.setFfprobePath(ffprobePath);

/**
 * Extract audio from video file and collect metadata
 * @param {string} videoPath - Path to input video file
 * @param {string} outputDir - Directory to save extracted audio
 * @returns {Promise<{audioPath: string, durationSeconds: number | null}>}
 */
async function extractAudio(videoPath, outputDir) {
  const videoName = path.basename(videoPath, path.extname(videoPath));
  const audioPath = path.join(outputDir, `${videoName}.wav`);

  console.log(`Extracting audio from: ${videoPath}`);

  const durationSeconds = await new Promise((resolve) => {
    ffmpeg.ffprobe(videoPath, (err, metadata) => {
      if (err) {
        console.warn('Could not determine video duration via ffprobe:', err.message);
        return resolve(null);
      }
      const duration = metadata?.format?.duration;
      resolve(typeof duration === 'number' ? Math.round(duration) : null);
    });
  });

  await new Promise((resolve, reject) => {
    ffmpeg(videoPath)
      .output(audioPath)
      .audioCodec('pcm_s16le')
      .audioChannels(1)
      .audioFrequency(16000)
      .on('start', (cmd) => {
        console.log('FFmpeg command:', cmd);
      })
      .on('progress', (progress) => {
        console.log(`Processing: ${progress.percent?.toFixed(2)}% done`);
      })
      .on('end', () => {
        console.log(`Audio extracted successfully: ${audioPath}`);
        resolve();
      })
      .on('error', (err) => {
        console.error('Error extracting audio:', err);
        reject(err);
      })
      .run();
  });

  return { audioPath, durationSeconds };
}

module.exports = { extractAudio };
