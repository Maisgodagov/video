const path = require('path');
const fs = require('fs').promises;
const ffmpeg = require('fluent-ffmpeg');
const ffmpegPath = require('@ffmpeg-installer/ffmpeg').path;
const config = require('../../config/config');

ffmpeg.setFfmpegPath(ffmpegPath);

async function ensureDir(dir) {
  await fs.mkdir(dir, { recursive: true });
}

function parseBitrateToBps(bitrateText) {
  if (!bitrateText) {
    return null;
  }

  const trimmed = String(bitrateText).trim().toLowerCase();
  const match = trimmed.match(/^(\d+(?:\.\d+)?)([kmg])?$/);
  if (!match) {
    return Number.parseInt(trimmed, 10) || null;
  }

  const value = Number.parseFloat(match[1]);
  const unit = match[2];
  if (!unit) {
    return Math.round(value);
  }
  const multipliers = {
    k: 1000,
    m: 1000 * 1000,
    g: 1000 * 1000 * 1000
  };
  return Math.round(value * multipliers[unit]);
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

async function normalizePlaylistPaths(playlistPath, replacements) {
  let content = await fs.readFile(playlistPath, 'utf8');

  replacements.forEach(({ from, to }) => {
    const candidates = [
      from,
      from.replace(/\\/g, '/'),
      from.replace(/\//g, '\\')
    ];

    candidates.forEach((candidate) => {
      content = content.replace(new RegExp(escapeRegExp(candidate), 'g'), to);
    });
  });

  await fs.writeFile(playlistPath, content, 'utf8');
}

function buildScaleFilter({ width, height }) {
  if (width && height) {
    return `scale=w=${width}:h=${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2`;
  }
  if (width) {
    return `scale=w=${width}:h=-2`;
  }
  if (height) {
    return `scale=w=-2:h=${height}`;
  }
  return null;
}

function runFfmpeg(command) {
  return new Promise((resolve, reject) => {
    command
      .on('start', (cmdLine) => {
        console.log(`  -> FFmpeg HLS command: ${cmdLine}`);
      })
      .on('error', (err, stdout, stderr) => {
        console.error('  -> FFmpeg HLS error:', err.message);
        reject(err);
      })
      .on('end', () => {
        resolve();
      })
      .run();
  });
}

async function generateHlsRendition(inputPath, outputDir, rendition, options) {
  const {
    segmentDuration,
    playlistType,
    videoCodec,
    audioCodec,
    preset,
    keyframeInterval,
    targetFrameRate,
    additionalVideoOptions
  } = options;

  const renditionName = rendition.name || `${rendition.width || rendition.height || 'stream'}`;
  const renditionPlaylist = `${renditionName}.m3u8`;
  const segmentPattern = `${renditionName}_%03d.m4s`;
  const segmentPatternFullPath = path.join(outputDir, segmentPattern);
  const initFileName = `${renditionName}_init.mp4`;
  const initFilePath = path.join(outputDir, initFileName);
  const outputPlaylistPath = path.join(outputDir, renditionPlaylist);
  const bitrate = rendition.videoBitrate || '1400k';
  const audioBitrate = rendition.audioBitrate || '128k';
  const scaleFilter = buildScaleFilter(rendition);

  const command = ffmpeg(inputPath)
    .inputOptions(['-fflags', '+genpts'])
    .outputOptions([
      '-c:v', videoCodec,
      '-profile:v', 'main',
      '-preset', preset,
      '-vsync', 'cfr',
      ...(targetFrameRate ? ['-r', String(targetFrameRate)] : []),
      '-b:v', bitrate,
      '-maxrate', bitrate,
      '-bufsize', parseBitrateToBps(bitrate) ? `${Math.round(parseBitrateToBps(bitrate) * 1.5)}` : bitrate,
      '-g', String(keyframeInterval),
      '-keyint_min', String(keyframeInterval),
      '-sc_threshold', '0',
      '-c:a', audioCodec,
      '-b:a', audioBitrate,
      '-ac', '2',
      '-hls_segment_type', 'fmp4',
      '-hls_fmp4_init_filename', initFilePath,
      '-hls_time', String(segmentDuration),
      '-hls_playlist_type', playlistType,
      '-hls_segment_filename', segmentPatternFullPath,
      '-hls_flags', 'independent_segments',
      '-hls_list_size', '0'
    ])
    .output(outputPlaylistPath)
    .audioCodec(audioCodec);

  if (scaleFilter) {
    command.videoFilters(scaleFilter);
  }

  if (Array.isArray(additionalVideoOptions) && additionalVideoOptions.length) {
    additionalVideoOptions.forEach((opt) => {
      command.outputOptions(opt);
    });
  }

  await runFfmpeg(command);
  await normalizePlaylistPaths(outputPlaylistPath, [
    { from: initFilePath, to: initFileName }
  ]);

  return {
    renditionName,
    playlistFile: renditionPlaylist,
    initFile: initFileName,
    segmentPattern: path.basename(segmentPattern)
  };
}

async function createMasterPlaylist(outputDir, masterName, renditions) {
  const lines = ['#EXTM3U'];

  renditions.forEach((rendition) => {
    const bandwidth = parseBitrateToBps(rendition.videoBitrate || '1000k');
    const audioBandwidth = parseBitrateToBps(rendition.audioBitrate || '128k') || 128000;
    const totalBandwidth = bandwidth ? Math.round(bandwidth + audioBandwidth) : null;
    const resolution =
      rendition.width && rendition.height ? `${rendition.width}x${rendition.height}` : null;

    const attributes = [];
    if (totalBandwidth) {
      attributes.push(`BANDWIDTH=${totalBandwidth}`);
    }
    if (resolution) {
      attributes.push(`RESOLUTION=${resolution}`);
    }
    attributes.push(`NAME="${rendition.name || resolution || 'stream'}"`);

    lines.push(`#EXT-X-STREAM-INF:${attributes.join(',')}`);
    lines.push(rendition.playlistFile);
  });

  const masterPath = path.join(outputDir, masterName);
  await fs.writeFile(masterPath, `${lines.join('\n')}\n`, 'utf8');
  return masterPath;
}

async function generateHlsPackages(inputPath, baseOutputDir, safeBaseName) {
  const hlsConfig = config.hls || {};
  if (!hlsConfig.enabled) {
    return null;
  }

  const options = {
    segmentDuration: hlsConfig.segmentDuration || 4,
    playlistType: hlsConfig.playlistType || 'vod',
    videoCodec: hlsConfig.videoCodec || 'libx264',
    audioCodec: hlsConfig.audioCodec || 'aac',
    preset: hlsConfig.preset || 'medium',
    keyframeInterval: hlsConfig.keyframeInterval || 48,
    masterPlaylistName: hlsConfig.masterPlaylistName || 'master.m3u8',
    renditions: Array.isArray(hlsConfig.renditions) && hlsConfig.renditions.length
      ? hlsConfig.renditions
      : [
          { name: '720p', width: 1280, height: 720, videoBitrate: '2800k', audioBitrate: '128k' },
          { name: '480p', width: 854, height: 480, videoBitrate: '1400k', audioBitrate: '96k' },
          { name: '360p', width: 640, height: 360, videoBitrate: '800k', audioBitrate: '64k' }
        ],
    additionalVideoOptions: hlsConfig.additionalVideoOptions || []
  };

  const outputDir = path.join(baseOutputDir, `${safeBaseName}-hls`);
  await fs.rm(outputDir, { recursive: true, force: true });
  await ensureDir(outputDir);

  const generatedRenditions = [];
  for (const rendition of options.renditions) {
    console.log(`  -> Generating HLS rendition: ${rendition.name || rendition.width || rendition.height}`);
    // eslint-disable-next-line no-await-in-loop
    const result = await generateHlsRendition(inputPath, outputDir, rendition, options);
    generatedRenditions.push({ ...rendition, ...result });
  }

  const masterPlaylistPath = await createMasterPlaylist(
    outputDir,
    options.masterPlaylistName,
    generatedRenditions
  );

  return {
    outputDir,
    masterPlaylistPath,
    masterPlaylistName: path.basename(masterPlaylistPath),
    renditions: generatedRenditions
  };
}

module.exports = {
  generateHlsPackages
};
