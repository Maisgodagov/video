const { spawn } = require('child_process');
const path = require('path');
const os = require('os');
const fs = require('fs').promises;
const ffmpegInstaller = require('@ffmpeg-installer/ffmpeg');

async function segmentAudio(audioPath, segmentDurationSeconds = 60) {
  if (!ffmpegInstaller || !ffmpegInstaller.path) {
    throw new Error('FFmpeg is required for audio segmentation but is not available.');
  }

  const outputDir = await fs.mkdtemp(path.join(os.tmpdir(), 'audio-segments-'));
  const segmentPattern = path.join(outputDir, 'segment-%03d.wav');

  const ffmpegArgs = [
    '-i',
    audioPath,
    '-f',
    'segment',
    '-segment_time',
    String(segmentDurationSeconds),
    '-c',
    'copy',
    '-reset_timestamps',
    '1',
    segmentPattern
  ];

  await new Promise((resolve, reject) => {
    const ffmpeg = spawn(ffmpegInstaller.path, ffmpegArgs, {
      stdio: ['ignore', 'pipe', 'pipe']
    });
    let stderr = '';

    ffmpeg.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    ffmpeg.on('error', (error) => {
      reject(error);
    });

    ffmpeg.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`FFmpeg segmentation failed with code ${code}: ${stderr}`));
      } else {
        resolve();
      }
    });
  });

  const files = await fs.readdir(outputDir);
  const segments = files
    .filter((file) => file.startsWith('segment-') && file.endsWith('.wav'))
    .sort()
    .map((file, index) => ({
      filePath: path.join(outputDir, file),
      index
    }));

  return {
    segments,
    cleanup: async () => {
      await Promise.all(
        segments.map((segment) => fs.unlink(segment.filePath).catch(() => {}))
      );
      await fs.rmdir(outputDir).catch(() => {});
    }
  };
}

module.exports = { segmentAudio };
