const { jsonrepair } = require('jsonrepair');
const config = require('../../config/config');
const { getGeminiModel } = require('../utils/gemini');
const {
  ValidationError,
  validateExercisesStructure
} = require('../types/dataTypes');

const EXERCISE_ATTEMPTS = 2;

function buildPrompt(transcript, analysis, attempt) {
  const reinforcement =
    attempt > 1
      ? '\n\nEnsure the output is valid JSON array without comments or markdown.'
      : '';

  return `You are an English teacher creating interactive exercises for learners.

Generate exactly 6 exercises in JSON array format. Follow this structure for each exercise:
{
  "type": "vocabulary" | "topic" | "statementCheck",
  "question": "string in Russian",
  "options": ["string", "string", "string", "string"],
  "correctAnswer": 0..3,
  "word": "string" (only for vocabulary type)
}

Requirements:
- Create 4 vocabulary exercises targeting key words or phrases from the transcript.
- Create 1 topic exercise to identify the main theme.
- Create 1 statementCheck exercise to verify comprehension.
- Vocabulary exercises must include the English word in "word" and Russian translation options.
- Topic and statementCheck questions must be in Russian with Russian options.
- Do not include explanations or markdown, output JSON array only.

Transcript:
"""
${transcript}
"""

Analysis context:
${JSON.stringify(analysis)}
${reinforcement}`;
}

function extractJsonArray(text) {
  if (typeof text !== 'string') {
    throw new ValidationError('Model returned non-string response');
  }

  const match = text.match(/\[[\s\S]*\]/);
  if (!match) {
    throw new ValidationError('No JSON array found in exercise response');
  }

  return match[0];
}

async function generateExercises(transcript, analysis) {
  console.log('Generating exercises with Gemini...');
  const geminiModel = getGeminiModel();

  let lastError = null;

  for (let attempt = 1; attempt <= EXERCISE_ATTEMPTS; attempt++) {
    try {
      const prompt = buildPrompt(transcript, analysis, attempt);
      const result = await geminiModel.generateContent({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0.4,
          topP: 0.85
        }
      });

      const response = result?.response?.text();
      console.log(`Raw exercises response (attempt ${attempt}):`, response);

      const rawJson = extractJsonArray(response);
      const repaired = jsonrepair(rawJson);
      const parsed = JSON.parse(repaired);
      const normalized = validateExercisesStructure(parsed);

      console.log(`Generated ${normalized.length} exercises`);
      return normalized;
    } catch (error) {
      lastError = error;
      console.warn(`Exercise generation attempt ${attempt} failed: ${error.message}`);
    }
  }

  console.error('Error generating exercises with Gemini:', lastError);
  throw lastError || new Error('Failed to generate exercises');
}

module.exports = { generateExercises };
