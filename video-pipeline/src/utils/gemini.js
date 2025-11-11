const { GoogleGenerativeAI } = require('@google/generative-ai');
const config = require('../../config/config');

let geminiModel = null;

function getGeminiModel() {
  if (geminiModel) {
    return geminiModel;
  }

  const apiKey = config.google.geminiApiKey;
  if (!apiKey) {
    throw new Error('Google Gemini API key is not configured.');
  }

  const client = new GoogleGenerativeAI(apiKey);
  geminiModel = client.getGenerativeModel({
    model: config.google.geminiModel || 'gemini-1.5-flash'
  });

  return geminiModel;
}

module.exports = { getGeminiModel };
