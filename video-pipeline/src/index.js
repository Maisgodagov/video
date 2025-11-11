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

const RUS_BATCH_OUTPUT_FILE = 'russian_audio_transcripts.txt';

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

async function processVideoWithoutExercises(videoPath) {
  const originalVideoName = path.basename(videoPath);
  const { safeBaseName, safeVideoFileName, safeJsonFileName } = createSafeFileNames(videoPath);
  console.log(`\n${'='.repeat(60)}`);
  console.log(`Processing video (no-exercises): ${originalVideoName}`);
  console.log('='.repeat(60));
  const startedAt = Date.now();

  let audioPath;
  let normalizedVideoPath;
  let success = false;

  try {
    console.log('\n[Step 1/7] Extracting audio and metadata...');
    const extraction = await extractAudio(videoPath, config.tempDir);
    audioPath = extraction.audioPath;
    const durationSeconds = extraction.durationSeconds;

    console.log('\n[Step 2/7] Transcribing with Whisper...');
    const transcriptionRaw = await transcribeAudio(audioPath);
    const transcription = validateTranscriptionVariantsStructure(transcriptionRaw, 'transcription');

    console.log('\n[Step 3/7] Translating subtitles with Gemini...');
    const translation = await translateTranscription(transcription.phrases);
    const validatedTranslation = validateTranslationStructure(translation);

    console.log('\n[Step 4/7] Analyzing text with Gemini...');
    const analysis = await analyzeText(transcription.plain.fullText);
    const validatedAnalysis = validateAnalysisStructure(analysis);

    console.log('\n[Step 5/7] Normalizing audio loudness...');
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

    console.log('\n[Step 6/7] Preparing video outputs...');
    const { videoUrl } = await prepareVideoOutputs({
      normalizedVideoPath,
      safeBaseName,
      safeVideoFileName,
      uploadPrefix: 'videos'
    });

    console.log('\n[Step 7/7] Saving to database (no exercises)...');
    const videoData = {
      videoName: safeVideoFileName,
      transcription,
      translation: validatedTranslation,
      analysis: validatedAnalysis,
      exercises: [],
      durationSeconds,
      videoUrl,
      isAdultContent: validatedAnalysis.isAdultContent
    };

    const videoId = await saveVideoData(videoData);

    const outputPath = path.join(
      config.outputDir,
      safeJsonFileName
    );
    await fs.writeFile(outputPath, JSON.stringify(videoData, null, 2));

    console.log('\nVideo processed (no-exercises) successfully!');
    console.log(`  - Database ID: ${videoId}`);
    console.log(`  - Output JSON: ${outputPath}`);
    console.log(`  - CEFR Level: ${videoData.analysis.cefrLevel}`);
    console.log(`  - Topics: ${videoData.analysis.topics.join(', ')}`);
    console.log('  - Exercises: 0 (skipped by design)');
    if (typeof videoData.durationSeconds === 'number') {
      console.log(`  - Duration (s): ${videoData.durationSeconds}`);
    }
    console.log(`  - Video CDN URL: ${videoData.videoUrl}`);
    console.log(`  - Processing time: ${((Date.now() - startedAt) / 1000).toFixed(2)}s`);

    success = true;
    return videoData;
  } catch (error) {
    console.error(`\nCore processing error for ${originalVideoName}:`, error);
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

async function processVideoTranscriptionOnly(videoPath) {
  const originalVideoName = path.basename(videoPath);
  const { safeBaseName, safeVideoFileName, transcriptionJsonFileName } = createSafeFileNames(videoPath);
  console.log(`\n${'='.repeat(60)}`);
  console.log(`Processing video (transcription-only): ${originalVideoName}`);
  console.log('='.repeat(60));
  const startedAt = Date.now();

  let audioPath;
  let normalizedVideoPath;
  let success = false;

  try {
    console.log('\n[Step 1/5] Extracting audio and metadata...');
    const extraction = await extractAudio(videoPath, config.tempDir);
    audioPath = extraction.audioPath;
    const durationSeconds = extraction.durationSeconds;

    console.log('\n[Step 2/5] Transcribing with Whisper...');
    const transcriptionRaw = await transcribeAudio(audioPath);
    const transcription = validateTranscriptionVariantsStructure(transcriptionRaw, 'transcription');

    console.log('\n[Step 3/5] Normalizing audio loudness...');
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

    console.log('\n[Step 4/5] Preparing video outputs...');
    const { videoUrl } = await prepareVideoOutputs({
      normalizedVideoPath,
      safeBaseName,
      safeVideoFileName,
      uploadPrefix: 'videos/transcriptions'
    });

    console.log('\n[Step 5/5] Saving transcription output...');
    const outputPath = path.join(
      config.outputDir,
      transcriptionJsonFileName
    );
    await fs.writeFile(
      outputPath,
      JSON.stringify(
        {
          videoName: safeVideoFileName,
          videoUrl,
          durationSeconds,
          transcription
        },
        null,
        2
      )
    );

    console.log('\nTranscription processed successfully!');
    console.log(`  - Output JSON: ${outputPath}`);
    if (typeof durationSeconds === 'number') {
      console.log(`  - Duration (s): ${durationSeconds}`);
    }
    console.log(`  - Video CDN URL: ${videoUrl}`);
    console.log(`  - Processing time: ${((Date.now() - startedAt) / 1000).toFixed(2)}s`);

    success = true;
    return {

      videoName: safeVideoFileName,
      videoUrl,
      durationSeconds,
      transcription
    };
  } catch (error) {
    console.error(`\nError processing transcription for ${originalVideoName}:`, error);
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

async function runPipeline() {
  console.log(`\n${'='.repeat(60)}`);
  console.log('VIDEO PROCESSING PIPELINE');
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

async function runNoExercisesPipeline() {
  console.log(`\n${'='.repeat(60)}`);
  console.log('VIDEO PIPELINE (NO EXERCISES)');
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
      console.log(`\n\nProcessing ${i + 1}/${videoFiles.length} (no-exercises)...`);
      const startedAt = Date.now();

      try {
        const result = await processVideoWithoutExercises(currentPath);
        const durationSeconds = (Date.now() - startedAt) / 1000;
        results.push({ file: videoFiles[i], status: 'success', result, durationSeconds });
      } catch (error) {
        const durationSeconds = (Date.now() - startedAt) / 1000;
        results.push({ file: videoFiles[i], status: 'failed', error: error.message, durationSeconds });
      }
    }

    console.log(`\n\n${'='.repeat(60)}`);
    console.log('NO-EXERCISES SUMMARY');
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
      console.log(`  - ${r.file}: ${r.durationSeconds.toFixed(2)}s [${r.status}]`);
    });
  } catch (error) {
    console.error('\nNo-exercises pipeline error:', error);
    throw error;
  } finally {
    await closeConnection();
  }
}

async function runTranscriptionOnlyPipeline() {
  console.log(`\n${'='.repeat(60)}`);
  console.log('VIDEO TRANSCRIPTION-ONLY PIPELINE');
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
      console.log(`\n\nProcessing ${i + 1}/${videoFiles.length} (transcription-only)...`);
      const startedAt = Date.now();

      try {
        const result = await processVideoTranscriptionOnly(currentPath);
        const durationSeconds = (Date.now() - startedAt) / 1000;
        results.push({ file: videoFiles[i], status: 'success', result, durationSeconds });
      } catch (error) {
        const durationSeconds = (Date.now() - startedAt) / 1000;
        results.push({ file: videoFiles[i], status: 'failed', error: error.message, durationSeconds });
      }
    }

    console.log(`\n\n${'='.repeat(60)}`);
    console.log('TRANSCRIPTION-ONLY SUMMARY');
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
      console.log(`  - ${r.file}: ${r.durationSeconds.toFixed(2)}s [${r.status}]`);
    });
  } catch (error) {
    console.error('\nTranscription-only pipeline error:', error);
    throw error;
  } finally {
    await closeConnection();
  }
}

async function runRussianAudioBatchTranscription() {
  console.log(`\n${'='.repeat(60)}`);
  console.log('RUSSIAN AUDIO BATCH TRANSCRIPTION');
  console.log('='.repeat(60));

  const audioDir = path.join(__dirname, '..', 'www');
  const outputFilePath = path.join(config.outputDir, RUS_BATCH_OUTPUT_FILE);

  await fs.mkdir(config.outputDir, { recursive: true });

  let audioFiles = [];
  try {
    audioFiles = (await fs.readdir(audioDir)).filter((file) => /\.mp3$/i.test(file));
  } catch (error) {
    console.error(`Unable to read audio directory (${audioDir}):`, error.message);
    throw error;
  }

  if (!audioFiles.length) {
    console.log('\nNo MP3 files found in directory:');
    console.log(`  ${audioDir}`);
    console.log('\nAdd Russian audio files and rerun the command.');
    return;
  }

  const originalLanguage = config.transcription.language;
  const originalModel = config.transcription.openaiModel;

  config.transcription.language = 'russian';
  if (typeof originalModel === 'string' && originalModel.endsWith('.en')) {
    config.transcription.openaiModel = originalModel.replace(/\.en$/i, '') || 'small';
  } else if (!config.transcription.openaiModel) {
    config.transcription.openaiModel = 'small';
  }

  const transcriptBlocks = [];

  try {
    for (let i = 0; i < audioFiles.length; i += 1) {
      const fileName = audioFiles[i];
      const audioPath = path.join(audioDir, fileName);
      console.log(`\nProcessing ${i + 1}/${audioFiles.length}: ${fileName}`);

      try {
        const transcriptionRaw = await transcribeAudio(audioPath);
        const transcription = validateTranscriptionVariantsStructure(transcriptionRaw, 'transcription');
        const text =
          transcription.plain?.fullText?.trim() ||
          transcription.phrases?.fullText?.trim() ||
          transcription.words?.fullText?.trim() ||
          '';

        transcriptBlocks.push([
          `### ${fileName}`,
          text || '[Пустая транскрипция]'
        ].join('\n'));
      } catch (error) {
        console.error(`  -> Error transcribing ${fileName}: ${error.message}`);
        transcriptBlocks.push([
          `### ${fileName}`,
          `[Ошибка транскрипции: ${error.message}]`
        ].join('\n'));
      }
    }
  } finally {
    config.transcription.language = originalLanguage;
    config.transcription.openaiModel = originalModel;
  }

  const combinedTranscript = `${transcriptBlocks.join('\n\n')}\n`;
  await fs.writeFile(outputFilePath, combinedTranscript, 'utf8');

  console.log('\nAll transcripts saved to:');
  console.log(`  ${outputFilePath}`);
}

if (require.main === module) {
  const modeArg = process.argv.find((arg) => arg.startsWith('--mode='));
  const mode = modeArg ? modeArg.split('=')[1].trim().toLowerCase() : 'full';

  const modeRunners = {
    full: runPipeline,
    'no-exercises': runNoExercisesPipeline,
    'transcription-only': runTranscriptionOnlyPipeline,
    'ru-audio-batch': runRussianAudioBatchTranscription
  };

  const runner = modeRunners[mode] || runPipeline;

  runner()
    .then(() => {
      console.log(`\nPipeline (${mode}) completed!`);
      process.exit(0);
    })
    .catch((error) => {
      console.error(`\nPipeline (${mode}) failed:`, error);
      process.exit(1);
    });
}

module.exports = {
  processVideo,
  processVideoWithoutExercises,
  runPipeline,
  runNoExercisesPipeline,
  processVideoTranscriptionOnly,
  runTranscriptionOnlyPipeline,
  runRussianAudioBatchTranscription
};
