const config = require("../../config/config");
const { getGeminiModel } = require("../utils/gemini");
const { jsonrepair } = require("jsonrepair");
const {
  ValidationError,
  validateTranscriptionStructure,
  validateTranslationStructure,
} = require("../types/dataTypes");

const DEFAULT_CHUNK_SIZE = config.google.translationChunkSize || 60;
const MAX_ATTEMPTS = config.google.translationAttempts || 3;
const CONTEXT_CHAR_LIMIT = 4000;
const NEIGHBOR_LINES = 4;
const CYRILLIC_REGEX = /[А-Яа-яЁё]/;
const STRIP_WRAPPING_QUOTES = /^["“”](.*)["“”]$/;

function chunkArray(items, chunkSize) {
  if (items.length <= chunkSize) {
    return [items];
  }
  const chunks = [];
  for (let i = 0; i < items.length; i += chunkSize) {
    chunks.push(items.slice(i, i + chunkSize));
  }
  return chunks;
}

function truncateForContext(text, maxLength = CONTEXT_CHAR_LIMIT) {
  if (!text || typeof text !== "string") {
    return "";
  }
  if (text.length <= maxLength) {
    return text;
  }
  const half = Math.floor(maxLength / 2);
  return `${text.slice(0, half)}\n...\n${text.slice(text.length - half)}`;
}

function buildPrompt(entries, context = {}) {
  const { fullText, previousLines = [], nextLines = [] } = context;
  const contextParts = [];

  if (fullText) {
    contextParts.push(
      `Global transcript context (may include lines outside this batch):\n"""${truncateForContext(
        fullText
      )}"""`
    );
  }
  if (previousLines.length) {
    contextParts.push(
      `Previous subtitle lines:\n${JSON.stringify(previousLines, null, 2)}`
    );
  }
  if (nextLines.length) {
    contextParts.push(
      `Upcoming subtitle lines:\n${JSON.stringify(nextLines, null, 2)}`
    );
  }

  return `You are a professional English-to-Russian subtitle translator.
Follow ALL requirements exactly:
1. Translate each subtitle line individually. DO NOT merge or split lines or move content across lines.
2. Preserve meaning, tone, humor, punctuation, numbers, and speaker emphasis.
3. Use concise, natural Russian suitable for subtitles (avoid overly long sentences).
4. If the English line is filler (e.g. "uh", "hmm"), use a natural Russian filler.
5. Transliterate proper names and character names into Russian letters when commonly localized (e.g. "Howard" → "Говард"). Keep technical acronyms or brand names in English only when there is no established Russian form.
6. Work with the context to keep meaning coherent, but never borrow content from neighboring lines.
7. Output MUST be a JSON array of the same length as the input.
8. EACH array element MUST be an object: {"index": number, "text": "Russian translation of the exact line"}.
9. Do NOT add commentary, explanations, markdown, or surrounding text.
10. Ensure the JSON is valid and parseable UTF-8.
11. Keep the order identical to the input and keep each translation aligned with its provided index.

${contextParts.length ? `${contextParts.join("\n\n")}\n\n` : ""}
Input subtitles (array of objects with index and text):
${JSON.stringify(entries, null, 2)}

Return JSON array only:`;
}

function previewText(text, maxLength = 240) {
  if (!text) {
    return "";
  }
  const sanitized = text.replace(/\s+/g, " ").trim();
  return sanitized.length > maxLength
    ? `${sanitized.slice(0, maxLength)}…`
    : sanitized;
}

async function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function translateChunkWithGemini(model, chunk, options) {
  const { offset, maxAttempts, context } = options;
  const payload = chunk.map((entry, index) => ({
    index: offset + index,
    text: entry.text,
  }));

  const prompt = buildPrompt(payload, context);
  let lastError = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const startedAt = Date.now();
      const result = await model.generateContent({
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0.3,
          topP: 0.8,
          maxOutputTokens: 4096,
        },
      });

      const responseText = result?.response?.text() || "";
      const duration = ((Date.now() - startedAt) / 1000).toFixed(2);
      console.log(
        `[Gemini translation] chunk ${offset}-${
          offset + chunk.length - 1
        }, attempt ${attempt}/${maxAttempts}, time ${duration}s`
      );
      console.log(
        `[Gemini translation] response preview: ${previewText(responseText)}`
      );

      if (!responseText) {
        const error = new ValidationError(
          "Gemini translation returned empty response"
        );
        error.responseText = responseText;
        throw error;
      }

      const jsonMatch = responseText.match(/\[[\s\S]*\]/);
      if (!jsonMatch) {
        const error = new ValidationError(
          "Gemini translation did not contain JSON array"
        );
        error.responseText = responseText;
        throw error;
      }

      const repaired = jsonrepair(jsonMatch[0]);
      const parsed = JSON.parse(repaired);

      if (!Array.isArray(parsed)) {
        const error = new ValidationError(
          "Gemini translation did not return an array"
        );
        error.responseText = responseText;
        throw error;
      }

      let normalized = parsed.map((item, index) => {
        if (!item || typeof item !== "object") {
          const error = new ValidationError(
            `Gemini translation item ${offset + index} must be an object`
          );
          error.responseText = responseText;
          throw error;
        }
        const rawText = typeof item.text === "string" ? item.text.trim() : "";
        const text = rawText.replace(STRIP_WRAPPING_QUOTES, "$1").trim();
        const indexValue = Number.isFinite(item.index)
          ? item.index
          : payload[index].index;
        return {
          text: text || chunk[index]?.text || "",
          index: indexValue,
        };
      });

      if (normalized.length < chunk.length) {
        for (let idx = normalized.length; idx < chunk.length; idx += 1) {
          normalized.push({
            text: chunk[idx].text,
            index: payload[idx].index,
          });
        }
      } else if (normalized.length > chunk.length) {
        normalized = normalized.slice(0, chunk.length);
      }

      normalized.forEach((entry, index) => {
        if (!entry.text || !entry.text.trim()) {
          entry.text = chunk[index]?.text || "";
        }
        if (!Number.isFinite(entry.index)) {
          entry.index = payload[index].index;
        }
      });

      const expectedIndices = payload.map((item) => item.index);
      const byIndex = new Map();

      normalized.forEach((entry) => {
        const key = Number.isFinite(entry.index) ? entry.index : null;
        if (key === null) {
          return;
        }
        if (!byIndex.has(key)) {
          byIndex.set(key, { ...entry, index: key });
        } else {
          const existing = byIndex.get(key);
          if (
            existing &&
            (!existing.text || existing.text.trim().length === 0) &&
            entry.text &&
            entry.text.trim().length > 0
          ) {
            byIndex.set(key, { ...entry, index: key });
          }
        }
      });

      const extras = normalized.filter(
        (entry) => !expectedIndices.includes(entry.index)
      );
      if (extras.length) {
        console.warn(
          `[Gemini translation] received ${
            extras.length
          } item(s) with unexpected indices: ${extras
            .map((entry) => entry.index)
            .join(", ")}`
        );
      }

      const aligned = expectedIndices.map((expectedIndex, localIdx) => {
        const fromMap = byIndex.get(expectedIndex);
        const fallbackText = chunk[localIdx]?.text || "";
        const text =
          fromMap?.text && fromMap.text.trim()
            ? fromMap.text.trim()
            : fallbackText;
        if (!fromMap) {
          console.warn(
            `[Gemini translation] missing translation for index ${expectedIndex}, using source text fallback`
          );
        }
        return {
          text,
          index: expectedIndex,
        };
      });

      for (let i = 0; i < aligned.length; i += 1) {
        const current = aligned[i];
        const source = chunk[i]?.text || "";
        if (!current.text) {
          current.text = source;
        }
        if (!CYRILLIC_REGEX.test(current.text)) {
          const retry = await translateSingleLineWithGemini(model, source, {
            index: aligned[i].index,
            previous:
              i > 0
                ? chunk[i - 1]?.text
                : context?.previousLines?.slice(-1)[0]?.text,
            next:
              i < aligned.length - 1
                ? chunk[i + 1]?.text
                : context?.nextLines?.[0]?.text,
          });
          if (retry && CYRILLIC_REGEX.test(retry)) {
            current.text = retry;
          } else {
            console.warn(
              `[Gemini translation] index ${current.index} still lacks Cyrillic text after retry; using fallback`
            );
            current.text = current.text || source;
          }
        }
        current.text = normalizeWhitespace(current.text);
      }

      return aligned;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      console.warn(
        `[Gemini translation] attempt ${attempt}/${maxAttempts} failed for chunk ${offset}-${
          offset + chunk.length - 1
        }: ${lastError.message}`
      );

      if (lastError.responseText) {
        console.warn(
          `[Gemini translation] raw response: ${previewText(
            lastError.responseText,
            1000
          )}`
        );
      }

      if (attempt < maxAttempts) {
        const message = String(lastError?.message || lastError);
        if (message.includes("429") || message.includes("Resource exhausted")) {
          console.warn(
            "[Gemini translation] 429 detected, waiting 20s before retry…"
          );
          await delay(30000);
        } else {
          await delay(300 * attempt);
          console.log("[Gemini translation] retrying…");
        }
      }
    }
  }

  throw lastError || new Error("Gemini translation failed for unknown reasons");
}

function normalizeWhitespace(text) {
  if (!text) {
    return "";
  }
  return text.replace(/\s+/g, " ").trim();
}

async function translateSingleLineWithGemini(model, text, options = {}) {
  const { index, previous, next } = options;
  if (!text || typeof text !== "string") {
    return "";
  }
  const contextParts = [];
  if (previous && typeof previous === "string") {
    contextParts.push(`Previous line: "${previous}"`);
  }
  if (next && typeof next === "string") {
    contextParts.push(`Next line: "${next}"`);
  }

  const prompt = `Translate the following English subtitle line into natural Russian.
Keep the translation aligned strictly with the original meaning and timing.
Transliterate character names into Russian letters when they have a known form (e.g., "Howard" → "Говард").
Avoid adding new information or omitting content. Output only the Russian text without quotes.
${contextParts.length ? `${contextParts.join("\n")}\n` : ""}Line (${
    Number.isFinite(index) ? index : "n/a"
  }):
"${text}"`;

  try {
    const result = await model.generateContent({
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: 0.2,
        topP: 0.8,
        maxOutputTokens: 512,
      },
    });

    const responseText = (result?.response?.text() || "").trim();
    if (!responseText) {
      return "";
    }
    const stripped = responseText.replace(STRIP_WRAPPING_QUOTES, "$1").trim();
    return normalizeWhitespace(stripped);
  } catch (error) {
    console.warn(
      `[Gemini translation] single-line retry failed: ${error.message}`
    );
    return "";
  }
}

async function translateTranscription(transcription) {
  const normalizedTranscription = validateTranscriptionStructure(
    transcription,
    "transcription"
  );
  const chunks = normalizedTranscription.chunks;

  if (!chunks.length) {
    return validateTranslationStructure({ fullText: "", chunks: [] });
  }

  const geminiModel = getGeminiModel();
  const fullTextContext = truncateForContext(normalizedTranscription.fullText);
  const chunked = chunkArray(chunks, DEFAULT_CHUNK_SIZE);
  const translations = [];

  for (let i = 0; i < chunked.length; i += 1) {
    const segment = chunked[i];
    const offset = translations.length;
    const previousLines =
      i > 0
        ? chunked[i - 1].slice(-NEIGHBOR_LINES).map((entry, idx, arr) => ({
            index: offset - arr.length + idx,
            text: entry.text,
          }))
        : [];
    const nextLines =
      i < chunked.length - 1
        ? chunked[i + 1].slice(0, NEIGHBOR_LINES).map((entry, idx) => ({
            index: offset + segment.length + idx,
            text: entry.text,
          }))
        : [];

    const translatedTexts = await translateChunkWithGemini(
      geminiModel,
      segment,
      {
        offset,
        maxAttempts: MAX_ATTEMPTS,
        context: {
          fullText: fullTextContext,
          previousLines,
          nextLines,
        },
      }
    );

    translatedTexts.forEach((item, index) => {
      const sourceChunk = segment[index];
      translations.push({
        text: normalizeWhitespace(item.text),
        timestamp: sourceChunk.timestamp,
        sourceText: sourceChunk.text,
      });
    });
  }

  const fullText = translations
    .map((chunk) => chunk.text)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();

  return validateTranslationStructure({
    fullText,
    chunks: translations,
  });
}

module.exports = { translateTranscription };
