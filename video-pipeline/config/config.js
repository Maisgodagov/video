require("dotenv").config();
const path = require("path");

module.exports = {
  // Paths
  inputDir: path.join(__dirname, "../../video-pipeline/input"),
  outputDir: path.join(__dirname, "../../video-pipeline/output"),
  tempDir: path.join(__dirname, "../../video-pipeline/temp"),

  // Database
  database: {
    host: "abenirsekuth.beget.app",
    port: 3306,
    user: "mgodag3j_english",
    password: "Gmr19970619.!",
    database: "mgodag3j_english",
  },

  // S3 storage settings
  storage: {
    endpoint: "https://s3.ru1.storage.beget.cloud",
    region: "ru-1",
    bucket: "2df681f7f03c-mais-eglish",
    accessKeyId: "3GMH0JAWVGIFOYW9ONVA",
    secretAccessKey: "h5DDOB7oR7TIIRbT9SDyfywEGOIDinAjbzwyaOt7",
    cdnDomain: "gagehegororik.begetcdn.cloud",
  },

  // Google APIs
  google: {
    translateApiKey:
      process.env.GOOGLE_TRANSLATE_API_KEY || process.env.GOOGLE_API_KEY || "",
    geminiApiKey:
      process.env.GOOGLE_GEMINI_API_KEY || process.env.GOOGLE_API_KEY || "",
    geminiModel: process.env.GOOGLE_GEMINI_MODEL || "gemini-2.0-flash-001",
    translationChunkSize: (() => {
      const parsed = Number.parseInt(
        process.env.GOOGLE_TRANSLATION_CHUNK_SIZE || "",
        10
      );
      return Number.isNaN(parsed) ? 40 : Math.max(1, parsed);
    })(),
    translationAttempts: (() => {
      const parsed = Number.parseInt(
        process.env.GOOGLE_TRANSLATION_ATTEMPTS || "",
        10
      );
      return Number.isNaN(parsed) ? 3 : Math.max(1, parsed);
    })(),
  },

  googleSpeech: {
    apiKey:
      process.env.GOOGLE_SPEECH_API_KEY || process.env.GOOGLE_API_KEY || "",
    endpoint:
      process.env.GOOGLE_SPEECH_ENDPOINT ||
      "https://speech.googleapis.com/v1p1beta1",
    languageCode: process.env.GOOGLE_SPEECH_LANGUAGE || "en-US",
    model: process.env.GOOGLE_SPEECH_MODEL || "latest_long",
    encoding: process.env.GOOGLE_SPEECH_ENCODING || "LINEAR16",
    sampleRateHertz: Number.parseInt(
      process.env.GOOGLE_SPEECH_SAMPLE_RATE || "16000",
      10
    ),
    enableAutomaticPunctuation:
      process.env.GOOGLE_SPEECH_ENABLE_PUNCTUATION !== "false",
    useEnhanced: process.env.GOOGLE_SPEECH_USE_ENHANCED === "true",
    alternativeLanguageCodes: process.env.GOOGLE_SPEECH_ALT_LANGS
      ? process.env.GOOGLE_SPEECH_ALT_LANGS.split(",")
          .map((code) => code.trim())
          .filter(Boolean)
      : [],
    maxPollingAttempts: Number.parseInt(
      process.env.GOOGLE_SPEECH_MAX_ATTEMPTS || "60",
      10
    ),
    pollingIntervalMs: Number.parseInt(
      process.env.GOOGLE_SPEECH_POLL_INTERVAL_MS || "2000",
      10
    ),
    segmentDurationSeconds: Number.parseInt(
      process.env.GOOGLE_SPEECH_SEGMENT_SECONDS || "55",
      10
    ),
  },

  // Audio normalization (two-pass loudnorm for professional quality)
  audioNormalization: {
    apply: true,
    // Target integrated loudness (LUFS)
    // -23 LUFS: Broadcasting standard (EBU R128)
    // -16 LUFS: YouTube/streaming (recommended for consistent levels)
    // -14 LUFS: Apple Music, Spotify
    targetLufs: -16,
    // Loudness Range (LU) - smaller = more consistent volume
    // 7-11: Good for educational content (consistent, easy to listen)
    // 11-15: More dynamic, natural sound
    loudnessRange: 7,
    // True peak limit (dBTP) - prevents clipping
    // -1.5 to -2.0 dBTP is safe for all platforms
    truePeak: -1.5,
    // Audio codec and quality
    audioCodec: "aac",
    audioBitrate: "192k", // 128k, 192k, or 256k
  },

  // Video compression settings
  videoCompression: {
    apply: false,
    codec: "libx264",
    preset: "slow",
    crf: 21,
    maxWidth: 1280,
    maxHeight: 720,
    pixelFormat: "yuv420p",
    maxBitrate: null,
    bufSize: null,
    tune: null, // e.g., 'film', 'animation'
    additionalOptions: [], // extra ffmpeg options if needed
  },

  // HTTP Live Streaming (HLS) output settings
  hls: {
    enabled: true,
    includeMp4Fallback: false,
    segmentDuration: 4, // seconds
    playlistType: "vod",
    masterPlaylistName: "master.m3u8",
    videoCodec: "libx264",
    audioCodec: "aac",
    preset: "slow",
    keyframeInterval: 48,
    targetFrameRate: 30,
    additionalVideoOptions: [], // extra ffmpeg args for video encoding
    renditions: [
      {
        name: "720p",
        height: 1280,
        videoBitrate: "950k",
        audioBitrate: "128k",
      }
    ],
  },

  // Whisper transcription settings
  transcription: {
    provider: "openai", // 'xenova' or 'openai'
    model: "Xenova/whisper-medium",
    quantized: false,
    chunkLengthSeconds: 30,
    strideLengthSeconds: 5,
    language: "english",
    temperature: 0,
    compressionRatioThreshold: 2.4,
    logprobThreshold: -1.0,
    noSpeechThreshold: 0.6,
    disableDefaultSuppressTokens: false,
    phraseMinWords: 5,
    phraseMaxWords: 9,
    phraseMinDurationSeconds: 0.6,
    phraseMaxDurationSeconds: 3.2,
    wordMinWords: 1,
    wordMaxWords: 1,
    maxGapBetweenWordChunksSeconds: 0.7,
    pythonExecutable:
      "C:/Users/mgoda/AppData/Local/Programs/Python/Python312/python.exe",
    openaiModel: "small.en",
    openaiDevice: "cuda",
    beamSize: 5,
    bestOf: 5,
    fp16: true,
  },

  videoTopics: [
    "Business",
    "Technology",
    "Science",
    "Health",
    "Education",
    "Entertainment",
    "Sports",
    "Travel",
    "Food",
    "Fashion",
    "Art",
    "Music",
    "Movies",
    "Gaming",
    "News",
    "Politics",
    "History",
    "Nature",
    "Animals",
    "Space",
    "Environment",
    "Social Issues",
    "Psychology",
    "Philosophy",
    "Lifestyle",
    "Relationships",
    "Career",
    "Finance",
    "Motivation",
    "Comedy",
    "Drama",
    "Documentary",
    "Tutorial",
    "Review",
    "Interview",
    "Vlog",
    "Challenge",
    "Story",
    "Daily Life",
    "Cooking",
    "DIY",
    "Beauty",
    "Fitness",
    "Product",
    "Unboxing",
    "Comparison",
    "Culture",
    "Language",
    "How-to",
    "Tips",
    "Reaction",
    "Prank",
    "Experiment",
    "Behind the Scenes",
  ],

  // CEFR levels
  cefrLevels: ["A1", "A2", "B1", "B2", "C1", "C2"],
};
