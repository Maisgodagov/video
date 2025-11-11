const { pipeline } = require('@xenova/transformers');
const { WaveFile } = require('wavefile');
const fs = require('fs');
const fsp = fs.promises;
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const config = require('../../config/config');
const ffmpegInstaller = require('@ffmpeg-installer/ffmpeg');
const { validateTranscriptionStructure } = require('../types/dataTypes');

const transcriptionConfig = config.transcription || {};
const PROVIDER = (transcriptionConfig.provider || 'xenova').toLowerCase();
const MODEL_ID = transcriptionConfig.model || 'Xenova/whisper-small';
const USE_QUANTIZED = typeof transcriptionConfig.quantized === 'boolean'
  ? transcriptionConfig.quantized
  : true;
const CHUNK_LENGTH = transcriptionConfig.chunkLengthSeconds || 30;
const STRIDE_LENGTH = transcriptionConfig.strideLengthSeconds || 5;
const TEMPERATURE = transcriptionConfig.temperature ?? 0;
const COMPRESSION_RATIO_THRESHOLD = transcriptionConfig.compressionRatioThreshold ?? 2.4;
const LOGPROB_THRESHOLD = transcriptionConfig.logprobThreshold ?? -1.0;
const NO_SPEECH_THRESHOLD = transcriptionConfig.noSpeechThreshold ?? 0.6;
const PHRASE_MIN_WORDS = Math.max(1, transcriptionConfig.phraseMinWords ?? 5);
const PHRASE_MAX_WORDS = Math.max(
  PHRASE_MIN_WORDS,
  transcriptionConfig.phraseMaxWords ?? 9
);
const WORD_MIN_WORDS = Math.max(1, transcriptionConfig.wordMinWords ?? 1);
const WORD_MAX_WORDS = Math.max(
  WORD_MIN_WORDS,
  transcriptionConfig.wordMaxWords ?? 1
);
const PHRASE_MIN_DURATION = transcriptionConfig.phraseMinDurationSeconds ?? 1.0;
const PHRASE_MAX_DURATION = transcriptionConfig.phraseMaxDurationSeconds ?? 4.5;
const MAX_GAP_BETWEEN_WORD_CHUNKS =
  transcriptionConfig.maxGapBetweenWordChunksSeconds ?? 1.5;

const LANGUAGE_ALIASES = {
  english: 'en',
  russian: 'ru',
  spanish: 'es',
  german: 'de',
  french: 'fr',
  italian: 'it',
  portuguese: 'pt',
  chinese: 'zh',
  japanese: 'ja',
  korean: 'ko'
};

let transcriber = null;
let preparedFfmpegDir = null;

function getConfiguredLanguage() {
  const raw = transcriptionConfig.language || 'english';
  if (typeof raw !== 'string' || !raw.trim()) {
    return 'english';
  }
  return raw.trim();
}

async function initWhisper() {
  if (PROVIDER !== 'xenova') {
    return true;
  }

  if (!transcriber) {
    console.log(`Loading Whisper model "${MODEL_ID}" (quantized: ${USE_QUANTIZED})...`);
    transcriber = await pipeline(
      'automatic-speech-recognition',
      MODEL_ID,
      { quantized: USE_QUANTIZED }
    );
    console.log('Whisper model loaded successfully');
  }
  return transcriber;
}

function readAudioFile(audioPath) {
  const buffer = fs.readFileSync(audioPath);
  const wav = new WaveFile(buffer);

  wav.toSampleRate(16000);
  wav.toBitDepth('16');

  let audioData = wav.getSamples();
  const normalize = (samples) => {
    if (samples instanceof Float32Array) {
      return samples;
    }
    const floatSamples = new Float32Array(samples.length);
    if (samples instanceof Int16Array) {
      const denom = 32768;
      for (let i = 0; i < samples.length; i++) {
        const value = samples[i] / denom;
        floatSamples[i] = Math.max(-1, Math.min(1, value));
      }
    } else if (samples instanceof Int32Array) {
      const denom = 2147483648;
      for (let i = 0; i < samples.length; i++) {
        const value = samples[i] / denom;
        floatSamples[i] = Math.max(-1, Math.min(1, value));
      }
    } else if (samples instanceof Uint8Array) {
      const denom = 128;
      for (let i = 0; i < samples.length; i++) {
        const value = (samples[i] - denom) / denom;
        floatSamples[i] = Math.max(-1, Math.min(1, value));
      }
    } else {
      for (let i = 0; i < samples.length; i++) {
        floatSamples[i] = samples[i];
      }
    }
    return floatSamples;
  };

  if (Array.isArray(audioData)) {
    const normalizedChannels = audioData.map((channel) => normalize(channel));
    const mono = new Float32Array(normalizedChannels[0].length);
    for (let i = 0; i < mono.length; i++) {
      let sample = 0;
      for (let c = 0; c < normalizedChannels.length; c++) {
        sample += normalizedChannels[c][i];
      }
      mono[i] = sample / normalizedChannels.length;
    }
    audioData = mono;
  } else {
    audioData = normalize(audioData);
  }

  return {
    data: audioData,
    sampling_rate: 16000
  };
}

function toNumber(value, fallback = null) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string' && value.trim().length > 0) {
    const parsed = Number.parseFloat(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return fallback;
}

function composeChunkText(words) {
  const raw = words.reduce((acc, word) => {
    const source = typeof word.originalText === 'string' && word.originalText.length > 0
      ? word.originalText
      : word.text || '';
    const trimmed = source.trim();
    if (!trimmed) {
      return acc;
    }

    if (acc.length === 0) {
      return trimmed;
    }

    if (/^[.,!?;:)\]»”]/.test(trimmed) || /^['’]/.test(trimmed)) {
      return acc + trimmed;
    }

    if (/\($/.test(acc) || /[\-–—]$/.test(acc)) {
      return `${acc}${trimmed}`;
    }

    return `${acc} ${trimmed}`;
  }, '');

  return raw.replace(/\s+([.,!?;:)\]»”])/g, '$1').replace(/\(\s+/g, '(').trim();
}

function normalizeWordEntries(entries) {
  if (!Array.isArray(entries)) {
    return [];
  }

  return entries
    .map((entry) => {
      if (!entry || typeof entry !== 'object') {
        return null;
      }

      const rawText =
        typeof entry.originalText === 'string'
          ? entry.originalText
          : entry.text;
      const text = (rawText || '').trim();
      if (!text) {
        return null;
      }

      const start =
        toNumber(entry.start, null) ??
        toNumber(entry.startTime, null) ??
        0;
      const end =
        toNumber(entry.end, null) ??
        toNumber(entry.endTime, null) ??
        start;

      const safeStart = Number.isFinite(start) ? start : 0;
      const safeEndCandidate = Number.isFinite(end) ? end : safeStart;
      const safeEnd = safeEndCandidate >= safeStart ? safeEndCandidate : safeStart;

      return {
        originalText: rawText ?? '',
        text,
        start: safeStart,
        end: safeEnd
      };
    })
    .filter((entry) => entry && entry.text)
    .sort((a, b) => a.start - b.start);
}

function groupWordEntries(entries, overrides = {}) {
  const normalized = normalizeWordEntries(entries);
  if (!normalized.length) {
    return [];
  }

  const minWords = Math.max(1, overrides.minWords ?? PHRASE_MIN_WORDS);
  const maxWords = Math.max(minWords, overrides.maxWords ?? PHRASE_MAX_WORDS);
  const maxGapSeconds = overrides.maxGapSeconds ?? MAX_GAP_BETWEEN_WORD_CHUNKS;
  const minDuration = overrides.minDuration ?? PHRASE_MIN_DURATION;
  const maxDuration = overrides.maxDuration ?? PHRASE_MAX_DURATION;

  const groups = [];
  let buffer = [];

  const flush = () => {
    if (!buffer.length) {
      return;
    }
    const start = buffer[0].start;
    const end = buffer.reduce(
      (acc, item) => (Number.isFinite(item.end) ? Math.max(acc, item.end) : acc),
      start
    );
    const text = composeChunkText(buffer);
    if (text) {
      groups.push({
        text,
        timestamp: [start, Number.isFinite(end) ? end : start]
      });
    }
    buffer = [];
  };

  normalized.forEach((entry, index) => {
    buffer.push(entry);
    const next = normalized[index + 1];

    const bufferStart = buffer[0].start;
    const bufferEnd = buffer.reduce(
      (acc, item) => (Number.isFinite(item.end) ? Math.max(acc, item.end) : acc),
      bufferStart
    );
    const duration = Math.max(0, bufferEnd - bufferStart);

    const nextStart = next
      ? (Number.isFinite(next.start)
          ? next.start
          : Number.isFinite(next.end)
            ? next.end
            : bufferEnd)
      : null;
    const gap = nextStart !== null ? Math.max(0, nextStart - bufferEnd) : null;

    const reachedMaxWords = buffer.length >= maxWords;
    const endsSentence = /[.!?…]+$/.test(entry.text);
    const enoughWords = buffer.length >= minWords;
    const reachedMinDuration = !minDuration || duration >= minDuration;
    const reachedMaxDuration = maxDuration && duration >= maxDuration;
    const nextWouldExceedDuration = Boolean(
      next &&
      maxDuration &&
      (() => {
        const nextEnd = Number.isFinite(next && next.end)
          ? next.end
          : Number.isFinite(next && next.start)
            ? next.start
            : bufferEnd;
        const projected = Math.max(bufferEnd, nextEnd) - bufferStart;
        return projected > maxDuration;
      })()
    );
    const breakOnGap = gap !== null && gap > maxGapSeconds;
    const isLast = index === normalized.length - 1;

    if (breakOnGap) {
      flush();
      return;
    }

    if (
      reachedMaxWords ||
      reachedMaxDuration ||
      (nextWouldExceedDuration && reachedMinDuration) ||
      (reachedMinDuration && enoughWords && endsSentence) ||
      isLast
    ) {
      flush();
    }
  });

  flush();

  if (!groups.length) {
    return normalized.map((entry) => ({
      text: entry.text,
      timestamp: [
        entry.start,
        Number.isFinite(entry.end) ? entry.end : entry.start
      ]
    }));
  }

  return groups;
}

function normalizeChunksForValidation(chunks) {
  if (!Array.isArray(chunks)) {
    return [];
  }

  return chunks
    .map((chunk) => {
      if (!chunk || typeof chunk !== 'object') {
        return null;
      }
      const text = typeof chunk.text === 'string' ? chunk.text.trim() : '';
      if (!text) {
        return null;
      }

      const timestamp = Array.isArray(chunk.timestamp)
        ? chunk.timestamp
        : Array.isArray(chunk.time)
          ? chunk.time
          : null;
      const start = toNumber(timestamp ? timestamp[0] : chunk.start, 0) ?? 0;
      const end = toNumber(timestamp ? timestamp[1] : chunk.end, start) ?? start;
      return {
        text,
        timestamp: [start, end]
      };
    })
    .filter(Boolean);
}

function buildTranscriptionVariants(fullText, wordEntries, fallbackChunks = []) {
  const safeText = typeof fullText === 'string' ? fullText.trim() : '';
  const normalizedFallback = normalizeChunksForValidation(fallbackChunks);
  const normalizedWordEntries = normalizeWordEntries(wordEntries);

  const phraseChunks = normalizedWordEntries.length
    ? groupWordEntries(normalizedWordEntries, {
        minWords: PHRASE_MIN_WORDS,
        maxWords: PHRASE_MAX_WORDS,
        maxGapSeconds: MAX_GAP_BETWEEN_WORD_CHUNKS,
        minDuration: PHRASE_MIN_DURATION,
        maxDuration: PHRASE_MAX_DURATION
      })
    : normalizedFallback;

  const wordChunks = normalizedWordEntries.length
    ? groupWordEntries(normalizedWordEntries, {
        minWords: WORD_MIN_WORDS,
        maxWords: WORD_MAX_WORDS,
        maxGapSeconds: MAX_GAP_BETWEEN_WORD_CHUNKS,
        minDuration: 0,
        maxDuration: null
      })
    : normalizedFallback;

  const plain = validateTranscriptionStructure({
    fullText: safeText,
    text: safeText,
    chunks: []
  });
  const phrases = validateTranscriptionStructure({
    fullText: safeText,
    text: safeText,
    chunks: phraseChunks
  });
  const words = validateTranscriptionStructure({
    fullText: safeText,
    text: safeText,
    chunks: wordChunks
  });

  return { plain, phrases, words };
}

async function ensureFfmpegInPath(env) {
  if (!ffmpegInstaller || !ffmpegInstaller.path) {
    return env;
  }

  if (!preparedFfmpegDir) {
    const tmpDir = path.join(os.tmpdir(), 'video-pipeline-ffmpeg');
    const target = path.join(tmpDir, 'ffmpeg.exe');
    await fsp.mkdir(tmpDir, { recursive: true });
    try {
      await fsp.access(target);
    } catch {
      await fsp.copyFile(ffmpegInstaller.path, target);
    }
    preparedFfmpegDir = tmpDir;
  }

  const updatedEnv = { ...env };
  if (preparedFfmpegDir) {
    const existing =
      updatedEnv.PATH || updatedEnv.Path || updatedEnv.path || '';
    const merged = existing
      ? `${preparedFfmpegDir}${path.delimiter}${existing}`
      : preparedFfmpegDir;
    updatedEnv.PATH = merged;
    updatedEnv.Path = merged;
  }

  if (ffmpegInstaller.path) {
    updatedEnv.FFMPEG_BINARY = preparedFfmpegDir
      ? path.join(preparedFfmpegDir, path.basename(ffmpegInstaller.path))
      : ffmpegInstaller.path;
  }

  return updatedEnv;
}

async function transcribeWithXenova(audioPath) {
  const model = await initWhisper();
  const audio = readAudioFile(audioPath);
  const options = {
    return_timestamps: 'word',
    chunk_length_s: CHUNK_LENGTH,
    stride_length_s: STRIDE_LENGTH,
    task: 'transcribe',
    temperature: TEMPERATURE,
    compression_ratio_threshold: COMPRESSION_RATIO_THRESHOLD,
    logprob_threshold: LOGPROB_THRESHOLD,
    no_speech_threshold: NO_SPEECH_THRESHOLD,
    condition_on_previous_text: false
  };

  const languageSetting = getConfiguredLanguage();
  if (languageSetting && languageSetting.toLowerCase() !== 'auto') {
    const lower = languageSetting.toLowerCase();
    const mapped = LANGUAGE_ALIASES[lower] || lower;
    options.language = mapped;
  }

  if (transcriptionConfig.disableDefaultSuppressTokens === true) {
    options.suppress_tokens = [];
  }

  const result = await model(audio.data, options);
  console.log('Transcription completed via Xenova pipeline');

  const wordEntries = normalizeWordEntries(
    (result.chunks || []).flatMap((chunk) => chunk.words || [])
  );

  const fallbackChunks = (result.chunks || [])
    .map((chunk) => ({
      text: typeof chunk.text === 'string' ? chunk.text.trim() : '',
      timestamp: Array.isArray(chunk.timestamp) ? chunk.timestamp : [0, 0]
    }))
    .filter((chunk) => chunk.text);

  const variants = buildTranscriptionVariants(
    result.text || '',
    wordEntries,
    fallbackChunks
  );

  return {
    fullText: variants.plain.fullText,
    plain: variants.plain,
    phrases: variants.phrases,
    words: variants.words
  };
}

async function transcribeWithOpenAI(audioPath) {
  const configuredExecutable = transcriptionConfig.pythonExecutable || 'python';
  const modelName = transcriptionConfig.openaiModel || 'medium.en';
  const device = transcriptionConfig.openaiDevice || 'cpu';
  const beamSize = transcriptionConfig.beamSize || 5;
  const bestOf = transcriptionConfig.bestOf || 5;
  const fp16 = transcriptionConfig.fp16 !== undefined ? transcriptionConfig.fp16 : false;

  console.log(`Running OpenAI Whisper CLI with model "${modelName}" on ${device}...`);

  const buildArgs = (outputDir) => {
    const args = [
      '-m',
      'whisper',
      audioPath,
      '--model',
      modelName,
      '--task',
      'transcribe',
      '--output_format',
      'json',
      '--output_dir',
      outputDir,
      '--beam_size',
      String(beamSize),
      '--best_of',
      String(bestOf),
      '--temperature',
      String(TEMPERATURE),
      '--device',
      device
    ];

    const languageSetting = getConfiguredLanguage();
    if (languageSetting && languageSetting.toLowerCase() !== 'auto') {
      const lower = languageSetting.toLowerCase();
      const mapped = LANGUAGE_ALIASES[lower] || lower;
      args.push('--language', mapped);
    }

    if (fp16 === false) {
      args.push('--fp16', 'False');
    }

    if (transcriptionConfig.disableDefaultSuppressTokens === true) {
      args.push('--suppress_tokens', '-1');
    }

    args.push('--word_timestamps', 'True');
    return args;
  };

  const spawnEnv = await ensureFfmpegInPath(process.env);
  spawnEnv.PYTHONIOENCODING = 'utf-8';
  spawnEnv.LANG = spawnEnv.LANG || 'en_US.UTF-8';
  spawnEnv.LC_ALL = spawnEnv.LC_ALL || 'en_US.UTF-8';

  const windowsDir = process.env.WINDIR || 'C:\\Windows';
  const candidateExecutables = Array.from(
    new Set(
      [
        configuredExecutable,
        configuredExecutable === 'py' ? 'py.exe' : null,
        configuredExecutable === 'python' ? 'python.exe' : null,
        configuredExecutable === 'python3' ? 'python3.exe' : null,
        'py',
        'py.exe',
        'python',
        'python.exe',
        'python3',
        'python3.exe',
        path.join(windowsDir, 'py.exe')
      ].filter(Boolean)
    )
  );

  const errors = [];

  for (const pythonExec of candidateExecutables) {
    const tempDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'whisper-cli-'));
    const args = buildArgs(tempDir);
    const commandLine = `${pythonExec} ${args.join(' ')}`;
    console.log(`Executing: ${commandLine}`);

    try {
      const transcription = await new Promise((resolve, reject) => {
        const subprocess = spawn(pythonExec, args, {
          stdio: ['ignore', 'pipe', 'pipe'],
          env: spawnEnv
        });
        let stderr = '';

        subprocess.stdout.on('data', (data) => {
          process.stdout.write(`[whisper-cli] ${data}`);
        });

        subprocess.stderr.on('data', (data) => {
          stderr += data.toString();
          process.stderr.write(`[whisper-cli] ${data}`);
        });

        subprocess.on('error', (error) => {
          error.commandLine = commandLine;
          error.stderr = stderr;
          reject(error);
        });

        subprocess.on('close', async (code) => {
          try {
            if (code !== 0) {
              throw new Error(`Whisper CLI exited with code ${code}: ${stderr}`);
            }

            const audioBase = path.basename(audioPath, path.extname(audioPath));
            const candidateNames = [
              `${audioBase}.json`,
              `${audioBase}.wav.json`,
              `${audioBase.replace(/\W+/g, '_')}.json`
            ];

            let jsonPath = null;
            for (const name of candidateNames) {
              const fullPath = path.join(tempDir, name);
              // eslint-disable-next-line no-await-in-loop
              const exists = await fsp
                .access(fullPath)
                .then(() => true)
                .catch(() => false);
              if (exists) {
                jsonPath = fullPath;
                break;
              }
            }

            if (!jsonPath) {
              throw new Error(`Whisper CLI did not produce expected output file in ${tempDir}`);
            }

            const raw = await fsp.readFile(jsonPath, 'utf8');
            const data = JSON.parse(raw);
            const segments = data.segments || [];

            const words = segments.flatMap((segment) =>
              (segment.words || []).map((word) => ({
                originalText: word.word,
                text: (word.word || '').trim(),
                start: toNumber(word.start, segment.start) ?? segment.start ?? 0,
                end: toNumber(word.end, segment.end) ?? segment.end ?? segment.start ?? 0
              }))
            );

            const fallbackChunks = segments
              .map((segment) => ({
                text: (segment.text || '').trim(),
                timestamp: [segment.start ?? 0, segment.end ?? segment.start ?? 0]
              }))
              .filter((segment) => segment.text);

            const variants = buildTranscriptionVariants(
              data.text || '',
              words,
              fallbackChunks
            );

            resolve({
              fullText: variants.plain.fullText,
              plain: variants.plain,
              phrases: variants.phrases,
              words: variants.words
            });
          } catch (err) {
            reject(err);
          } finally {
            await fsp.rm(tempDir, { recursive: true, force: true }).catch(() => {});
          }
        });
      });

      console.log('Transcription completed via OpenAI whisper CLI');
      return transcription;
    } catch (error) {
      await fsp.rm(tempDir, { recursive: true, force: true }).catch(() => {});
      errors.push({ exec: pythonExec, error });

      if (error.code === 'ENOENT' || /spawn/i.test(error.message)) {
        console.warn(`Failed to execute "${pythonExec}" (${error.message}). Trying next candidate...`);
        continue;
      }

      throw new Error(`Whisper CLI failed using ${pythonExec}: ${error.message}`);
    }
  }

  const tried = errors.map((entry) => entry.exec).join(', ');
  const details = errors.map((entry) => `${entry.exec}: ${entry.error.message}`).join(' | ');
  throw new Error(`Unable to execute whisper CLI. Tried: ${tried}. Details: ${details}`);
}

async function transcribeAudio(audioPath) {
  console.log(`Transcribing audio (${PROVIDER}): ${audioPath}`);

  if (PROVIDER === 'openai') {
    return transcribeWithOpenAI(audioPath);
  }

  return transcribeWithXenova(audioPath);
}

module.exports = { transcribeAudio, initWhisper };

