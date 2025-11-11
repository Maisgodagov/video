const config = require('../../config/config');
const { getGeminiModel } = require('../utils/gemini');
const {
  ValidationError,
  validateAnalysisStructure
} = require('../types/dataTypes');

const ANALYSIS_ATTEMPTS = 2;

function buildPrompt(transcript, attempt) {
  const topicsList = config.videoTopics.join(', ');
  const reinforcement =
    attempt > 1
      ? '\n\nPlease ensure the output is valid JSON without comments or markdown fences.'
      : '';

  return `You are an expert linguist. Analyze the following English transcript and produce a JSON object describing the language properties.

Respond with JSON matching this schema:
{
  "cefrLevel": "A1|A2|B1|B2|C1|C2",
  "speechSpeed": "slow|normal|fast",
  "grammarComplexity": "simple|intermediate|complex",
  "vocabularyComplexity": "basic|intermediate|advanced",
  "topics": ["Topic1", "Topic2", "Topic3"],
  "isAdultContent": true|false
}

Rules:
- Pick the most appropriate CEFR level.
- Choose topics from this predefined list only: ${topicsList}.
- Provide up to three distinct topics.
- Set "isAdultContent" to true if the transcript includes explicit references to sex, pornography, graphic violence, or illegal drug use. Otherwise set it to false.
- Output JSON only. Do not include markdown.

Transcript:
"""
${transcript}
"""${reinforcement}`;
}

function extractJson(text) {
  if (typeof text !== 'string') {
    throw new ValidationError('Model returned non-string response');
  }

  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new ValidationError('No JSON object found in analysis response');
  }

  return jsonMatch[0];
}

async function analyzeText(text) {
  console.log('Analyzing text with Gemini (analysis)...');
  const geminiModel = getGeminiModel();

  let lastError = null;

  for (let attempt = 1; attempt <= ANALYSIS_ATTEMPTS; attempt += 1) {
    try {
      const prompt = buildPrompt(text, attempt);
      const result = await geminiModel.generateContent({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0.1,
          topP: 0.9
        }
      });

      const response = result?.response?.text();
      console.log(`Raw analysis response (attempt ${attempt}):`, response);

      const json = extractJson(response);
      const parsed = JSON.parse(json);
      if (!Array.isArray(parsed.topics) || parsed.topics.length === 0) {
        parsed.topics = config.videoTopics.slice(0, 3);
      }
      if (typeof parsed.isAdultContent !== 'boolean') {
        parsed.isAdultContent = false;
      }

      const normalized = validateAnalysisStructure(parsed);

      console.log('Text analysis completed:', normalized);
      return normalized;
    } catch (error) {
      lastError = error;
      console.warn(`Analysis attempt ${attempt} failed: ${error.message}`);
    }
  }

  console.error('Error analyzing text with Gemini:', lastError);
  throw lastError || new Error('Failed to analyze text');
}

module.exports = { analyzeText };
