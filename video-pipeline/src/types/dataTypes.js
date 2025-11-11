const config = require('../../config/config');

const CEFR_LEVELS = config.cefrLevels;
const SPEECH_SPEEDS = ['slow', 'normal', 'fast'];
const GRAMMAR_COMPLEXITIES = ['simple', 'intermediate', 'complex'];
const VOCABULARY_COMPLEXITIES = ['basic', 'intermediate', 'advanced'];
const EXERCISE_TYPES = ['vocabulary', 'topic', 'statementCheck'];
const TOPIC_LOOKUP = config.videoTopics.reduce((acc, topic) => {
  acc[topic.toLowerCase()] = topic;
  return acc;
}, {});

const CYRILLIC_REGEX = /[А-Яа-яЁё]/;
const LATIN_REGEX = /[A-Za-z]/;

class ValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ValidationError';
  }
}

function assertString(value, name) {
  if (typeof value !== 'string') {
    throw new ValidationError(`${name} must be a string`);
  }
  return value.trim();
}

function assertNumber(value, name) {
  if (typeof value !== 'number' || Number.isNaN(value)) {
    throw new ValidationError(`${name} must be a number`);
  }
  return value;
}

function assertArray(value, name) {
  if (!Array.isArray(value)) {
    throw new ValidationError(`${name} must be an array`);
  }
  return value;
}

function assertBoolean(value, name) {
  if (typeof value !== 'boolean') {
    throw new ValidationError(`${name} must be a boolean`);
  }
  return value;
}

function normalizeTimestamp(timestamp, index) {
  const arr = assertArray(timestamp, `chunks[${index}].timestamp`);
  if (arr.length !== 2) {
    throw new ValidationError(`chunks[${index}].timestamp must have exactly 2 values`);
  }
  return [assertNumber(arr[0], `chunks[${index}].timestamp[0]`), assertNumber(arr[1], `chunks[${index}].timestamp[1]`)];
}

function validateTranscriptionStructure(transcription, label = 'transcription') {
  if (!transcription || typeof transcription !== 'object') {
    throw new ValidationError(`${label} must be an object`);
  }
  const fullText = assertString(transcription.fullText ?? transcription.text ?? '', `${label}.fullText`);
  const chunksRaw = transcription.chunks || [];
  const chunks = chunksRaw.map((chunk, index) => {
    if (!chunk || typeof chunk !== 'object') {
      throw new ValidationError(`${label}.chunks[${index}] must be an object`);
    }
    const text = assertString(chunk.text ?? '', `${label}.chunks[${index}].text`);
    const timestamp = normalizeTimestamp(chunk.timestamp ?? chunk.time ?? [0, 0], index);
    return { text, timestamp };
  });

  return { fullText, text: fullText, chunks };
}

function validateTranslationStructure(translation) {
  return validateTranscriptionStructure(translation, 'translation');
}

function validateTranscriptionVariantsStructure(transcriptionVariants, label = 'transcription') {
  if (!transcriptionVariants || typeof transcriptionVariants !== 'object') {
    throw new ValidationError(`${label} must be an object`);
  }

  const plain = validateTranscriptionStructure(transcriptionVariants.plain, `${label}.plain`);
  const phrases = validateTranscriptionStructure(transcriptionVariants.phrases, `${label}.phrases`);
  const words = validateTranscriptionStructure(transcriptionVariants.words, `${label}.words`);

  const baseText = plain.fullText;
  if (phrases.fullText !== baseText || words.fullText !== baseText) {
    throw new ValidationError(`${label} variants must share the same fullText`);
  }

  return {
    plain,
    phrases,
    words,
    fullText: baseText
  };
}

function validateAnalysisStructure(analysis) {
  if (!analysis || typeof analysis !== 'object') {
    throw new ValidationError('analysis must be an object');
  }

  const cefrLevel = assertString(analysis.cefrLevel, 'analysis.cefrLevel').toUpperCase();
  if (!CEFR_LEVELS.includes(cefrLevel)) {
    throw new ValidationError(`analysis.cefrLevel must be one of ${CEFR_LEVELS.join(', ')}`);
  }

  const speechSpeed = assertString(analysis.speechSpeed, 'analysis.speechSpeed').toLowerCase();
  if (!SPEECH_SPEEDS.includes(speechSpeed)) {
    throw new ValidationError(`analysis.speechSpeed must be one of ${SPEECH_SPEEDS.join(', ')}`);
  }

  const grammarComplexity = assertString(
    analysis.grammarComplexity,
    'analysis.grammarComplexity'
  ).toLowerCase();
  if (!GRAMMAR_COMPLEXITIES.includes(grammarComplexity)) {
    throw new ValidationError(`analysis.grammarComplexity must be one of ${GRAMMAR_COMPLEXITIES.join(', ')}`);
  }

  const vocabularyComplexity = assertString(
    analysis.vocabularyComplexity,
    'analysis.vocabularyComplexity'
  ).toLowerCase();
  if (!VOCABULARY_COMPLEXITIES.includes(vocabularyComplexity)) {
    throw new ValidationError(`analysis.vocabularyComplexity must be one of ${VOCABULARY_COMPLEXITIES.join(', ')}`);
  }

  const topicsRaw = assertArray(analysis.topics, 'analysis.topics');
  const topicsMapped = topicsRaw
    .map((topic, index) => {
      const value = assertString(topic, `analysis.topics[${index}]`).toLowerCase();
      return TOPIC_LOOKUP[value] || null;
    })
    .filter(Boolean);

  const topics = topicsMapped.length
    ? Array.from(new Set(topicsMapped)).slice(0, 3)
    : config.videoTopics.slice(0, 3);

  const isAdultContent =
    typeof analysis.isAdultContent === 'boolean'
      ? analysis.isAdultContent
      : false;

  return {
    cefrLevel,
    speechSpeed,
    grammarComplexity,
    vocabularyComplexity,
    topics,
    isAdultContent
  };
}

function validateVocabularyExercise(exercise, index) {
  const word = assertString(exercise.word ?? '', `exercise[${index}].word`);
  const options = assertArray(exercise.options, `exercise[${index}].options`);
  if (options.length < 3 || options.length > 4) {
    throw new ValidationError(`exercise[${index}].options must contain 3 or 4 items`);
  }

  const wordHasCyrillic = CYRILLIC_REGEX.test(word);
  const wordHasLatin = LATIN_REGEX.test(word);

  if (!wordHasCyrillic && !wordHasLatin) {
    throw new ValidationError(`exercise[${index}].word must contain either Cyrillic or Latin characters`);
  }

  const optionsAreCyrillic = options.every((option, optIdx) => {
    const optionValue = assertString(option, `exercise[${index}].options[${optIdx}]`);
    return CYRILLIC_REGEX.test(optionValue);
  });

  const optionsAreLatin = options.every((option, optIdx) => {
    const optionValue = assertString(option, `exercise[${index}].options[${optIdx}]`);
    return LATIN_REGEX.test(optionValue);
  });

  if (wordHasLatin && !optionsAreCyrillic) {
    throw new ValidationError(`exercise[${index}] options must be Russian when word is English`);
  }

  if (wordHasCyrillic && !optionsAreLatin) {
    throw new ValidationError(`exercise[${index}] options must be English when word is Russian`);
  }
}

function validateNonVocabularyOptions(exercise, index) {
  exercise.options.forEach((option, optIdx) => {
    assertString(option, `exercise[${index}].options[${optIdx}]`);
  });
}

function validateExercisesStructure(exercises) {
  const normalized = assertArray(exercises, 'exercises').map((exercise, index) => {
    if (!exercise || typeof exercise !== 'object') {
      throw new ValidationError(`exercise[${index}] must be an object`);
    }

    const type = assertString(exercise.type, `exercise[${index}].type`);
    if (!EXERCISE_TYPES.includes(type)) {
      throw new ValidationError(`exercise[${index}].type must be one of ${EXERCISE_TYPES.join(', ')}`);
    }

    const question = assertString(exercise.question, `exercise[${index}].question`);
    if (!CYRILLIC_REGEX.test(question)) {
      throw new ValidationError(`exercise[${index}].question must contain Russian text`);
    }

    const options = assertArray(exercise.options, `exercise[${index}].options`).map((opt, optIdx) =>
      assertString(opt, `exercise[${index}].options[${optIdx}]`)
    );

    const correctAnswer = exercise.correctAnswer;
    if (typeof correctAnswer !== 'number' || !Number.isInteger(correctAnswer)) {
      throw new ValidationError(`exercise[${index}].correctAnswer must be an integer index`);
    }
    if (correctAnswer < 0 || correctAnswer >= options.length) {
      throw new ValidationError(`exercise[${index}].correctAnswer out of range`);
    }

    if (type === 'vocabulary') {
      validateVocabularyExercise({ ...exercise, options }, index);
    } else {
      validateNonVocabularyOptions({ ...exercise, options }, index);
    }

    return { ...exercise, question, options, correctAnswer, type };
  });

  const vocabularyCount = normalized.filter((ex) => ex.type === 'vocabulary').length;
  const topicCount = normalized.filter((ex) => ex.type === 'topic').length;
  const statementCount = normalized.filter((ex) => ex.type === 'statementCheck').length;

  if (vocabularyCount < 3 || vocabularyCount > 4) {
    throw new ValidationError('Expected 3 or 4 vocabulary exercises');
  }
  if (topicCount !== 1) {
    throw new ValidationError('Expected exactly 1 topic exercise');
  }
  if (statementCount < 1) {
    throw new ValidationError('Expected at least 1 statementCheck exercise');
  }

  return normalized;
}

function validateProcessedVideo(videoData) {
  if (!videoData || typeof videoData !== 'object') {
    throw new ValidationError('videoData must be an object');
  }

  const videoName = assertString(videoData.videoName, 'videoData.videoName');
  const videoUrl = assertString(videoData.videoUrl, 'videoData.videoUrl');
  const durationSeconds =
    videoData.durationSeconds === null || videoData.durationSeconds === undefined
      ? null
      : assertNumber(videoData.durationSeconds, 'videoData.durationSeconds');

  const transcription = validateTranscriptionVariantsStructure(
    videoData.transcription,
    'videoData.transcription'
  );
  const translation = validateTranslationStructure(videoData.translation, 'videoData.translation');
  const analysis = validateAnalysisStructure(videoData.analysis);
  const exercises = validateExercisesStructure(videoData.exercises);
  const isAdultContent =
    videoData.isAdultContent === undefined
      ? analysis.isAdultContent
      : assertBoolean(videoData.isAdultContent, 'videoData.isAdultContent');

  return {
    videoName,
    videoUrl,
    durationSeconds,
    transcription,
    translation,
    analysis,
    exercises,
    isAdultContent
  };
}

module.exports = {
  CEFR_LEVELS,
  SPEECH_SPEEDS,
  GRAMMAR_COMPLEXITIES,
  VOCABULARY_COMPLEXITIES,
  EXERCISE_TYPES,
  ValidationError,
  validateTranscriptionStructure,
  validateTranscriptionVariantsStructure,
  validateTranslationStructure,
  validateAnalysisStructure,
  validateExercisesStructure,
  validateProcessedVideo
};
