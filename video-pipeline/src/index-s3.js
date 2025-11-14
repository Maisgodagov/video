const fs = require('fs').promises;
const path = require('path');
const crypto = require('crypto');
const config = require('../config/config');
const { extractAudio } = require('./audio/extractor');
const { transcribeAudio } = require('./transcription/whisper');
const { translateTranscription } = require('./translation/translator');
const { analyzeText } = require('./analysis/textAnalyzer');
const { generateExercises } = require('./exercises/generator');
const { runMigrations, saveVideoData, closeConnection } = require('./database/db');
const { uploadVideo, uploadHlsDirectory } = require('./storage/uploader');
const {
  validateProcessedVideo,
  validateTranslationStructure,
  validateAnalysisStructure,
  validateTranscriptionVariantsStructure
} = require('./types/dataTypes');
const { normalizeVideoAudio } = require('./audio/normalizer');
const { generateHlsPackages } = require('./video/hlsEncoder');
const { S3InputManager } = require('./storage/s3Input');

const SAFE_CHARSET = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';

function generateSafeId(length = 16) {
  const bytes = crypto.randomBytes(length);
  let result = '';
  for (let i = 0; i < length; i += 1) {
    result += SAFE_CHARSET[bytes[i] % SAFE_CHARSET.length];
  }
  return result;
}

function createSafeFileNames(videoPath) {
  const extensionRaw = path.extname(videoPath);
  const extension = extensionRaw ? extensionRaw.toLowerCase() : '.mp4';
  const safeBaseName = generateSafeId(16);
  return {
    safeBaseName,
    safeVideoFileName: `${safeBaseName}${extension}`,
    safeJsonFileName: `${safeBaseName}.json`,
    transcriptionJsonFileName: `${safeBaseName}.transcription.json`
  };
}

async function prepareVideoOutputs({
  normalizedVideoPath,
  safeBaseName,
  safeVideoFileName,
  uploadPrefix = 'videos'
}) {
  const hlsEnabled = config.hls && config.hls.enabled;
  let primaryUrl = null;
  let fallbackUrl = null;

  if (hlsEnabled) {
    try {
      console.log('  -> Generating HLS package...');
      const hlsResult = await generateHlsPackages(
        normalizedVideoPath,
        config.tempDir,
        safeBaseName
      );

      if (hlsResult) {
        console.log('  -> Uploading HLS package to storage...');
        primaryUrl = await uploadHlsDirectory(
          hlsResult.outputDir,
          uploadPrefix,
          safeBaseName,
          hlsResult.masterPlaylistName
        );

        if (config.hls.includeMp4Fallback) {
          console.log('  -> Uploading MP4 fallback asset...');
          fallbackUrl = await uploadVideo(
            normalizedVideoPath,
            uploadPrefix,
            safeVideoFileName
          );
        }
      }
    } catch (error) {
      console.error(
        '  -> HLS preparation failed, falling back to single MP4 upload:',
        error.message
      );
      primaryUrl = null;
    }
  }

  if (!primaryUrl) {
    console.log('  -> Uploading MP4 to storage...');
    primaryUrl = await uploadVideo(normalizedVideoPath, uploadPrefix, safeVideoFileName);
  }

  return { videoUrl: primaryUrl, fallbackUrl };
}

async function processVideo(videoPath) {
  const originalVideoName = path.basename(videoPath);
  const { safeBaseName, safeVideoFileName, safeJsonFileName } = createSafeFileNames(videoPath);
  console.log(`\n${'='.repeat(60)}`);
  console.log(`Processing video: ${originalVideoName}`);
  console.log('='.repeat(60));
  const startedAt = Date.now();

  let audioPath;
  let normalizedVideoPath;
  let success = false;

  try {
    console.log('\n[Step 1/8] Extracting audio and metadata...');
    const extraction = await extractAudio(videoPath, config.tempDir);
    audioPath = extraction.audioPath;
    const durationSeconds = extraction.durationSeconds;

    console.log('\n[Step 2/8] Transcribing with Whisper...');
    const transcriptionRaw = await transcribeAudio(audioPath);
    const transcription = validateTranscriptionVariantsStructure(transcriptionRaw, 'transcription');

    console.log('\n[Step 3/8] Translating subtitles with Gemini...');
    const translation = await translateTranscription(transcription.phrases);
    const validatedTranslation = validateTranslationStructure(translation);

    console.log('\n[Step 4/8] Analyzing text with Gemini...');
    const analysis = await analyzeText(transcription.plain.fullText);
    const validatedAnalysis = validateAnalysisStructure(analysis);

    console.log('\n[Step 5/8] Generating exercises with Gemini...');
    const exercises = await generateExercises(transcription.plain.fullText, validatedAnalysis);

    console.log('\n[Step 6/8] Normalizing audio loudness...');
    normalizedVideoPath = await normalizeVideoAudio(videoPath, config.tempDir);

    const normalizedDir = path.dirname(normalizedVideoPath);
    const sanitizedNormalizedPath = path.join(normalizedDir, safeVideoFileName);
    if (path.basename(normalizedVideoPath) !== safeVideoFileName) {
      await fs.rename(normalizedVideoPath, sanitizedNormalizedPath).catch(async (error) => {
        if (error.code === 'EXDEV') {
          await fs.copyFile(normalizedVideoPath, sanitizedNormalizedPath);
          await fs.unlink(normalizedVideoPath);
        } else {
          throw error;
        }
      });
      normalizedVideoPath = sanitizedNormalizedPath;
    }

    console.log('\n[Step 7/8] Preparing video outputs...');
    const { videoUrl } = await prepareVideoOutputs({
      normalizedVideoPath,
      safeBaseName,
      safeVideoFileName,
      uploadPrefix: 'videos'
    });

    console.log('\n[Step 8/8] Saving to database...');
    const videoData = {
      videoName: safeVideoFileName,
      transcription,
      translation: validatedTranslation,
      analysis: validatedAnalysis,
      exercises,
      durationSeconds,
      videoUrl,
      isAdultContent: validatedAnalysis.isAdultContent
    };

    const validated = validateProcessedVideo(videoData);
    const videoId = await saveVideoData(validated);

    const outputPath = path.join(
      config.outputDir,
      safeJsonFileName
    );
    await fs.writeFile(outputPath, JSON.stringify(validated, null, 2));

    console.log('\nVideo processed successfully!');
    console.log(`  - Database ID: ${videoId}`);
    console.log(`  - Output JSON: ${outputPath}`);
    console.log(`  - CEFR Level: ${validated.analysis.cefrLevel}`);
    console.log(`  - Topics: ${validated.analysis.topics.join(', ')}`);
    console.log(`  - Exercises: ${validated.exercises.length}`);
    if (typeof validated.durationSeconds === 'number') {
      console.log(`  - Duration (s): ${validated.durationSeconds}`);
    }
    console.log(`  - Video CDN URL: ${validated.videoUrl}`);
    console.log(`  - Processing time: ${((Date.now() - startedAt) / 1000).toFixed(2)}s`);

    success = true;
    return validated;
  } catch (error) {
    console.error(`\nError processing ${originalVideoName}:`, error);
    throw error;
  } finally {
    if (audioPath) {
      await fs.unlink(audioPath).catch(() => {});
    }
    if (normalizedVideoPath && normalizedVideoPath !== videoPath) {
      await fs.unlink(normalizedVideoPath).catch(() => {});
    }
    if (success) {
      await fs.unlink(videoPath).catch(() => {});
    }
  }
}

/**
 * Process videos from S3 bucket
 */
async function runS3Pipeline() {
  console.log(`\n${'='.repeat(60)}`);
  console.log('VIDEO PROCESSING PIPELINE (S3 INPUT)');
  console.log('='.repeat(60));

  const s3Manager = new S3InputManager();

  try {
    // Ensure directories exist
    await fs.mkdir(config.outputDir, { recursive: true });
    await fs.mkdir(config.tempDir, { recursive: true });

    console.log('\nRunning database migrations...');
    await runMigrations();

    console.log('\nFetching videos from S3 bucket...');
    console.log(`  Bucket: ${config.s3Input.bucket}`);
    console.log(`  Prefix: ${config.s3Input.pendingPrefix}`);

    const videos = await s3Manager.listPendingVideos();

    if (videos.length === 0) {
      console.log('\nNo videos found in S3 pending folder.');
      console.log(`Upload videos to: s3://${config.s3Input.bucket}/${config.s3Input.pendingPrefix}`);
      return;
    }

    console.log(`\nFound ${videos.length} video(s) in S3:`);
    videos.forEach((video, idx) => {
      console.log(`  ${idx + 1}. ${video.name} (${(video.size / 1024 / 1024).toFixed(2)} MB)`);
    });

    const results = [];

    for (let i = 0; i < videos.length; i++) {
      const video = videos[i];
      console.log(`\n\n${'='.repeat(60)}`);
      console.log(`Processing ${i + 1}/${videos.length}: ${video.name}`);
      console.log('='.repeat(60));
      const startedAt = Date.now();

      let localVideoPath = null;
      let processingKey = null;

      try {
        // Move to processing folder in S3
        processingKey = await s3Manager.moveToProcessing(video.key);

        // Download to local temp directory
        localVideoPath = await s3Manager.downloadVideo(processingKey, config.tempDir);

        // Process the video
        const result = await processVideo(localVideoPath);

        // Move to completed folder in S3
        await s3Manager.moveToCompleted(processingKey);

        const durationSeconds = (Date.now() - startedAt) / 1000;
        results.push({
          file: video.name,
          status: 'success',
          result,
          durationSeconds
        });

      } catch (error) {
        console.error(`\nProcessing failed for ${video.name}:`, error.message);

        // Move to failed folder in S3
        if (processingKey) {
          await s3Manager.moveToFailed(processingKey);
        }

        const durationSeconds = (Date.now() - startedAt) / 1000;
        results.push({
          file: video.name,
          status: 'failed',
          error: error.message,
          durationSeconds
        });
      } finally {
        // Clean up local file
        if (localVideoPath) {
          await fs.unlink(localVideoPath).catch(() => {});
        }
      }
    }

    // Print summary
    console.log(`\n\n${'='.repeat(60)}`);
    console.log('PROCESSING SUMMARY (S3 INPUT)');
    console.log('='.repeat(60));

    const successful = results.filter((r) => r.status === 'success').length;
    const failed = results.length - successful;

    console.log(`\nTotal videos: ${results.length}`);
    console.log(`Successful: ${successful}`);
    console.log(`Failed: ${failed}`);

    if (failed > 0) {
      console.log('\nFailed videos:');
      results
        .filter((r) => r.status === 'failed')
        .forEach((r) => console.log(`  - ${r.file}: ${r.error} (time: ${r.durationSeconds.toFixed(2)}s)`));
    }

    console.log('\nPer-video processing times:');
    results.forEach((r) => {
      console.log(
        `  - ${r.file}: ${r.durationSeconds.toFixed(2)}s [${r.status}]`
      );
    });

  } catch (error) {
    console.error('\nS3 Pipeline error:', error);
    throw error;
  } finally {
    await closeConnection();
  }
}

/**
 * Continuous polling mode - monitors S3 for new videos
 */
async function runS3PollingMode() {
  console.log(`\n${'='.repeat(60)}`);
  console.log('VIDEO PROCESSING PIPELINE (S3 POLLING MODE)');
  console.log('='.repeat(60));
  console.log(`\nPolling interval: ${config.s3Input.pollingIntervalSeconds} seconds`);
  console.log(`Bucket: ${config.s3Input.bucket}`);
  console.log(`Watching folder: ${config.s3Input.pendingPrefix}`);
  console.log('\nPress Ctrl+C to stop...\n');

  const s3Manager = new S3InputManager();

  // Ensure directories exist
  await fs.mkdir(config.outputDir, { recursive: true });
  await fs.mkdir(config.tempDir, { recursive: true });

  console.log('Running database migrations...');
  await runMigrations();

  let isProcessing = false;

  const poll = async () => {
    if (isProcessing) {
      console.log('[Polling] Still processing previous videos, skipping this cycle...');
      return;
    }

    try {
      isProcessing = true;

      const videos = await s3Manager.listPendingVideos();

      if (videos.length === 0) {
        console.log(`[${new Date().toISOString()}] No new videos found`);
        return;
      }

      console.log(`\n[${new Date().toISOString()}] Found ${videos.length} new video(s):`);
      videos.forEach((video, idx) => {
        console.log(`  ${idx + 1}. ${video.name}`);
      });

      // Process all videos
      for (const video of videos) {
        let localVideoPath = null;
        let processingKey = null;

        try {
          processingKey = await s3Manager.moveToProcessing(video.key);
          localVideoPath = await s3Manager.downloadVideo(processingKey, config.tempDir);
          await processVideo(localVideoPath);
          await s3Manager.moveToCompleted(processingKey);
          console.log(`✓ Successfully processed: ${video.name}`);
        } catch (error) {
          console.error(`✗ Failed to process ${video.name}:`, error.message);
          if (processingKey) {
            await s3Manager.moveToFailed(processingKey);
          }
        } finally {
          if (localVideoPath) {
            await fs.unlink(localVideoPath).catch(() => {});
          }
        }
      }

    } catch (error) {
      console.error('[Polling] Error:', error.message);
    } finally {
      isProcessing = false;
    }
  };

  // Initial poll
  await poll();

  // Set up interval
  const intervalId = setInterval(poll, config.s3Input.pollingIntervalSeconds * 1000);

  // Handle graceful shutdown
  process.on('SIGINT', async () => {
    console.log('\n\nShutting down gracefully...');
    clearInterval(intervalId);
    await closeConnection();
    process.exit(0);
  });
}

/**
 * Process videos from local input directory (backwards compatibility)
 */
async function runLocalPipeline() {
  console.log(`\n${'='.repeat(60)}`);
  console.log('VIDEO PROCESSING PIPELINE (LOCAL INPUT)');
  console.log('='.repeat(60));

  try {
    await fs.mkdir(config.inputDir, { recursive: true });
    await fs.mkdir(config.outputDir, { recursive: true });
    await fs.mkdir(config.tempDir, { recursive: true });

    console.log('\nRunning database migrations...');
    await runMigrations();

    const files = await fs.readdir(config.inputDir);
    const videoFiles = files.filter((file) => /\.(mp4|mov|avi|mkv|webm)$/i.test(file));

    if (videoFiles.length === 0) {
      console.log('\nNo video files found in input directory:');
      console.log(`  ${config.inputDir}`);
      console.log('\nPlease add video files to the input directory and run again.');
      return;
    }

    console.log(`\nFound ${videoFiles.length} video(s) to process:`);
    videoFiles.forEach((file, idx) => {
      console.log(`  ${idx + 1}. ${file}`);
    });

    const results = [];
    for (let i = 0; i < videoFiles.length; i++) {
      const currentPath = path.join(config.inputDir, videoFiles[i]);
      console.log(`\n\nProcessing ${i + 1}/${videoFiles.length}...`);
      const startedAt = Date.now();

      try {
        const result = await processVideo(currentPath);
        const durationSeconds = (Date.now() - startedAt) / 1000;
        results.push({ file: videoFiles[i], status: 'success', result, durationSeconds });
      } catch (error) {
        const durationSeconds = (Date.now() - startedAt) / 1000;
        results.push({ file: videoFiles[i], status: 'failed', error: error.message, durationSeconds });
      }
    }

    console.log(`\n\n${'='.repeat(60)}`);
    console.log('PROCESSING SUMMARY');
    console.log('='.repeat(60));

    const successful = results.filter((r) => r.status === 'success').length;
    const failed = results.length - successful;

    console.log(`\nTotal videos: ${results.length}`);
    console.log(`Successful: ${successful}`);
    console.log(`Failed: ${failed}`);

    if (failed > 0) {
      console.log('\nFailed videos:');
      results
        .filter((r) => r.status === 'failed')
        .forEach((r) => console.log(`  - ${r.file}: ${r.error} (time: ${r.durationSeconds.toFixed(2)}s)`));
    }

    console.log('\nPer-video processing times:');
    results.forEach((r) => {
      console.log(
        `  - ${r.file}: ${r.durationSeconds.toFixed(2)}s [${r.status}]`
      );
    });
  } catch (error) {
    console.error('\nPipeline error:', error);
    throw error;
  } finally {
    await closeConnection();
  }
}

if (require.main === module) {
  const args = process.argv.slice(2);

  // Check if S3 input is enabled
  const useS3 = config.s3Input.enabled;
  const enablePolling = config.s3Input.enablePolling && args.includes('--watch');

  let runner;

  if (useS3) {
    if (enablePolling) {
      runner = runS3PollingMode;
    } else {
      runner = runS3Pipeline;
    }
  } else {
    runner = runLocalPipeline;
  }

  const mode = useS3 ? (enablePolling ? 's3-polling' : 's3') : 'local';

  runner()
    .then(() => {
      if (mode !== 's3-polling') {
        console.log(`\nPipeline (${mode}) completed!`);
        process.exit(0);
      }
    })
    .catch((error) => {
      console.error(`\nPipeline (${mode}) failed:`, error);
      process.exit(1);
    });
}

module.exports = {
  processVideo,
  runS3Pipeline,
  runS3PollingMode,
  runLocalPipeline
};
