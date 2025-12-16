const GEMINI_MODEL = 'gemini-2.5-flash';
const GEMINI_ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;
const VALID_CARD_TYPES = ['flashcard', 'sequence', 'vocab'];
const CARD_COUNT_LABELS = ['short', 'medium', 'long'];
const CARD_COUNT_MAP = {
  flashcard: { short: 10, medium: 20, long: 40 },
  vocab: { short: 10, medium: 20, long: 40 },
  sequence: { short: 2, medium: 4, long: 6 }
};

function sanitizeDocuments(input = []) {
  if (!Array.isArray(input)) return [];
  return input.map((doc, index) => {
    const name = typeof doc?.name === 'string' && doc.name.trim()
      ? doc.name.trim()
      : `Document ${index + 1}`;
    return {
      id: doc?.id || `document-${index + 1}`,
      name,
      type: typeof doc?.type === 'string' ? doc.type : 'text/plain',
      content: typeof doc?.content === 'string'
        ? doc.content.trim()
        : ''
    };
  }).filter(result => result.content || result.type.startsWith('image/') || result.name);
}

function summarizeDocument(document, index) {
  const header = `Document ${index + 1} (${document.name})`;
  if (document.type.startsWith('image/')) {
    return `${header}\n[Image placeholder for ${document.name}]`;
  }
  const preview = document.content.length > 2000
    ? `${document.content.slice(0, 2000)}...`
    : document.content;
  if (!preview.trim()) {
    return `${header}\n[Text content is minimal or empty.]`;
  }
  return `${header}\n${preview}`;
}

function resolveCardType(value) {
  if (!value || typeof value !== 'string') return null;
  const normalized = value.trim().toLowerCase();
  if (normalized === 'auto') return null;
  return VALID_CARD_TYPES.includes(normalized) ? normalized : null;
}

function inferCardCountLabel(documents) {
  const totalWords = documents.reduce((sum, doc) => {
    const words = doc.content ? doc.content.split(/\s+/).length : 0;
    return sum + words;
  }, 0);
  if (totalWords < 200) return 'short';
  if (totalWords < 600) return 'medium';
  return 'long';
}

function resolveCardCountLabel(value, documents) {
  if (!value || typeof value !== 'string') return inferCardCountLabel(documents);
  const normalized = value.trim().toLowerCase();
  if (CARD_COUNT_LABELS.includes(normalized)) return normalized;
  if (normalized === 'auto') return inferCardCountLabel(documents);
  return 'medium';
}

function detectLanguageFromDocuments(documents) {
  const combined = documents.map(doc => doc.content).join(' ').toLowerCase();
  if (!combined) return 'English';
  if (/[¿¡]/.test(combined) || /\b(el|la|que|de|y|los|las)\b/.test(combined)) return 'Spanish';
  if (/[çéàèùâêîôûœ]/.test(combined)) return 'French';
  if (/[ßäöü]/.test(combined)) return 'German';
  if (/[áéíóú]/.test(combined) && combined.includes('ital')) return 'Italian';
  if (/[\u4e00-\u9fff]/.test(combined)) return 'Mandarin';
  if (/[\u3040-\u30ff]/.test(combined)) return 'Japanese';
  if (/[\uac00-\ud7af]/.test(combined)) return 'Korean';
  return 'English';
}

function buildContext(payload, documents) {
  const sanitizedLanguage = typeof payload.language === 'string' ? payload.language.trim() : 'auto';
  const desiredType = resolveCardType(payload.cardType);
  const cardIndexLabel = resolveCardCountLabel(payload.cardCount, documents);
  const countReferenceType = desiredType || 'flashcard';
  const targetCount = CARD_COUNT_MAP[countReferenceType]?.[cardIndexLabel] || CARD_COUNT_MAP.flashcard.medium;
  const deckNameSuggestion = documents[0]?.name?.replace(/\.[^.]+$/, '') || 'AI Generated Deck';
  const deckNotesFallback = `Generated from ${documents.length} document${documents.length === 1 ? '' : 's'}.`;
  const documentSummaries = documents.map(summarizeDocument).join('\n\n');
  return {
    documents,
    documentSummaries,
    desiredType,
    cardCountLabel: cardIndexLabel,
    targetCount,
    deckNameSuggestion,
    deckNotesFallback,
    languagePreference: sanitizedLanguage,
    fallbackLanguage: sanitizedLanguage !== 'auto' ? sanitizedLanguage : undefined
  };
}

function buildPrompt(context, { isRepair = false, previousResponse = '' } = {}) {
  const {
    documentSummaries,
    desiredType,
    cardCountLabel,
    targetCount,
    deckNameSuggestion,
    languagePreference
  } = context;

  const typeInstruction = desiredType
    ? `Always set "type" to "${desiredType}" and return the matching structure (${desiredType === 'sequence' ? 'a "sequences" array with title/description/steps' : 'a "cards" array with atomic Q/A pairs'}).`
    : 'Choose the best type (flashcard, sequence, or vocab) based on the documents, then set "type" accordingly and return the matching structure.';

  const cardStructure = desiredType === 'sequence'
    ? 'Each sequence should include "title", "description", and an ordered "steps" array.'
    : 'Each flashcard or vocab entry should live in the "cards" array with {"question":"", "answer":""}. When the type is "vocab", questions should mention or prompt the term (e.g., "Define: <term>") and answers should be the definition.';

  const languageInstruction = languagePreference !== 'auto'
    ? `Write every piece of text (deckName, deckNotes, question, answer, descriptions, steps) in ${languagePreference}. Set "language" to that exact value.`
    : 'Infer the primary language of the documents and use that language for every output field, then report the resolved language in the "language" field.';

  const schemaExample = `{
  "type": "flashcard",
  "deckName": "string",
  "deckNotes": "string (summary or notes, optional but encouraged)",
  "language": "local language name",
  "cards": [
    { "question": "string", "answer": "string" }
  ]
}`;

  const instructions = [
    'You are an expert cognitive science tutor creating high-quality study decks.',
    `Documents (${context.documents.length}):\n${documentSummaries}`,
    'Instructions:',
    `• ${typeInstruction}`,
    `• ${cardStructure}`,
    `• Target length: ${cardCountLabel} (~${targetCount} item${targetCount === 1 ? '' : 's'}). Deliver exactly that count if possible; if you cannot, explain the limitation in "deckNotes" and proceed with the best set of items.`,
    `• Metadata: set "deckName" to a concise title (you can lean on this suggestion: "${deckNameSuggestion}") and use "deckNotes" to summarise the core ideas or mention any deviations.`,
    `• ${languageInstruction}`,
    `• Do not include markdown, explanations, or any text outside the JSON object. Return only the JSON object with the keys shown in the schema. If "type" is "sequence", include "sequences" instead of "cards". ${isRepair ? 'Previous response failed to match this schema. Repair it exactly.' : ''}`,
    `Schema reference:\n${schemaExample}`
  ];

  if (isRepair && previousResponse) {
    const clipped = previousResponse.length > 2000 ? `${previousResponse.slice(0, 2000)}...` : previousResponse;
    instructions.push(`Previous attempt (repair me):\n${clipped}`);
  }

  return instructions.join('\n\n');
}

async function callGemini(prompt) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error('Gemini API key is not configured.');
  }
  const response = await fetch(`${GEMINI_ENDPOINT}?key=${apiKey}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }]
    })
  });

  if (!response.ok) {
    const bodyText = await response.text();
    console.error('Gemini response error:', response.status, bodyText);
    throw new Error(`Gemini API error ${response.status}`);
  }

  const data = await response.json();
  const partList = data?.candidates?.[0]?.content?.parts;
  if (!partList || !partList.length) {
    throw new Error('Gemini returned no content.');
  }
  return partList.map(part => part.text).join(' ').trim();
}

function cleanResponseText(text) {
  if (!text) return '';
  let cleaned = text.replace(/```(?:json)?/gi, '');
  const firstBrace = cleaned.indexOf('{');
  const lastBrace = cleaned.lastIndexOf('}');
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    cleaned = cleaned.slice(firstBrace, lastBrace + 1);
  }
  return cleaned.trim();
}

function normalizeCardEntry(entry, type, language) {
  const questionFromEntry = (entry.question || entry.term || entry.prompt || '').toString().trim();
  const answerFromEntry = (entry.answer || entry.definition || entry.response || '').toString().trim();
  let question = questionFromEntry;
  if (type === 'vocab') {
    const term = entry.term || questionFromEntry || '';
    if (!question && term) {
      question = `Define: ${term}`;
    }
  }
  const answer = answerFromEntry;
  return {
    question,
    answer
  };
}

function normalizeSequenceEntry(entry) {
  const title = (entry.title || entry.name || entry.term || 'Sequence').toString().trim();
  const description = (entry.description || entry.desc || entry.note || '').toString().trim();
  const stepsSource = Array.isArray(entry.steps) ? entry.steps : entry.sequence || [];
  const steps = stepsSource
    .map(step => (typeof step === 'string' ? step : String(step)))
    .map(step => step.trim())
    .filter(step => step);
  return { title: title || 'Sequence', description, steps };
}

function normalizeDeckStructure(parsed, context) {
  if (!parsed || typeof parsed !== 'object') {
    throw new Error('AI output is not an object.');
  }
  const reportedType = typeof parsed.type === 'string' ? parsed.type.trim().toLowerCase() : '';
  if (!VALID_CARD_TYPES.includes(reportedType)) {
    throw new Error('Response type must be flashcard, sequence, or vocab.');
  }
  if (context.desiredType && reportedType !== context.desiredType) {
    throw new Error(`Expected type "${context.desiredType}" but got "${reportedType}".`);
  }
  const deckName = (parsed.deckName || context.deckNameSuggestion).toString().trim();
  if (!deckName) {
    throw new Error('deckName is required.');
  }
  const deckNotes = typeof parsed.deckNotes === 'string' && parsed.deckNotes.trim()
    ? parsed.deckNotes.trim()
    : context.deckNotesFallback;
  let language = (typeof parsed.language === 'string' ? parsed.language.trim() : '') || context.fallbackLanguage;
  if (!language) {
    language = detectLanguageFromDocuments(context.documents);
  }
  const result = {
    type: reportedType,
    deckName,
    deckNotes,
    language
  };

  if (reportedType === 'sequence') {
    const sequences = Array.isArray(parsed.sequences) ? parsed.sequences : [];
    const normalized = sequences.map(normalizeSequenceEntry).filter(seq => seq.steps.length > 0);
    if (!normalized.length) {
      throw new Error('Sequences array is missing or empty.');
    }
    result.sequences = normalized.slice(0, context.targetCount);
  } else {
    const rawCards = Array.isArray(parsed.cards)
      ? parsed.cards
      : Array.isArray(parsed.vocab)
        ? parsed.vocab
        : [];
    const normalized = rawCards
      .map(entry => normalizeCardEntry(entry, reportedType, language))
      .map(card => ({ question: card.question || '', answer: card.answer || '' }))
      .filter(card => card.question && card.answer);
    if (!normalized.length) {
      throw new Error('Cards array is missing or empty.');
    }
    result.cards = normalized.slice(0, context.targetCount);
  }

  return result;
}

function attemptParseDeck(rawText, context) {
  const cleaned = cleanResponseText(rawText);
  if (!cleaned) {
    return { success: false, error: 'Cleaned response was empty.' };
  }
  let parsed;
  try {
    parsed = JSON.parse(cleaned);
  } catch (error) {
    return { success: false, error: `JSON parse error: ${error.message}` };
  }
  try {
    const deck = normalizeDeckStructure(parsed, context);
    return { success: true, deck };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

async function generateDeckWithRetries(context) {
  let lastRaw = '';
  let lastError = '';
  for (let attempt = 0; attempt < 2; attempt++) {
    const prompt = buildPrompt(context, {
      isRepair: attempt === 1,
      previousResponse: attempt === 1 ? cleanResponseText(lastRaw) : ''
    });
    const rawResponse = await callGemini(prompt);
    lastRaw = rawResponse;
    const result = attemptParseDeck(rawResponse, context);
    if (result.success) {
      return result.deck;
    }
    lastError = result.error;
  }
  throw new Error(lastError || 'Unable to parse AI output.');
}

async function handleAiDeckRequest(event) {
  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      body: 'Method Not Allowed'
    };
  }
  let parsedBody = {};
  let documents = [];
  let context;
  try {
    parsedBody = event.body ? JSON.parse(event.body) : {};
    documents = sanitizeDocuments(parsedBody.documents);
    if (!documents.length) {
      throw new Error('At least one document is required for AI generation.');
    }
    context = buildContext(parsedBody, documents);
    const deck = await generateDeckWithRetries(context);
    return {
      statusCode: 200,
      body: JSON.stringify(deck)
    };
  } catch (error) {
    console.error('AI deck generation error:', error);
    if (documents.length && context) {
      const fallbackDeck = buildFallbackDeck(documents, context, error?.message);
      if (fallbackDeck?.cards?.length) {
        return {
          statusCode: 200,
          body: JSON.stringify({
            ...fallbackDeck,
            aiFallback: true,
            fallbackReason: error?.message || 'AI service unavailable.'
          })
        };
      }
    }
    return {
      statusCode: 500,
      body: JSON.stringify({
        error: 'bad_output',
        message: error.message || 'Invalid AI response.'
      })
    };
  }
}

const SENTENCE_SPLIT_PATTERN = /(?<=[.!?])\s+|[\r\n]+/;

function splitIntoSentences(text = '') {
  const normalized = text.replace(/\s+/g, ' ').trim();
  if (!normalized) {
    return [];
  }
  return normalized
    .split(SENTENCE_SPLIT_PATTERN)
    .map(sentence => sentence.trim())
    .filter(Boolean);
}

function createFallbackQuestion(sentence, index) {
  const preview = sentence
    .split(/\s+/)
    .slice(0, 12)
    .join(' ')
    .trim();
  if (preview) {
    const ellipsis = preview.endsWith('.') ? '' : '...';
    return `Explain this idea: "${preview}${ellipsis}"`;
  }
  return `Describe the key concept #${index + 1}.`;
}

function buildFallbackDeck(documents, context, reason = '') {
  const fallbackCount = Math.max(1, context.targetCount || CARD_COUNT_MAP.flashcard.medium);
  const sentences = documents
    .flatMap(doc => splitIntoSentences(doc.content))
    .filter(Boolean);
  const uniqueSentences = [...new Set(sentences)];
  const selectedSentences = uniqueSentences.slice(0, fallbackCount);
  if (!selectedSentences.length) {
    return null;
  }
  const cards = selectedSentences.map((sentence, index) => ({
    question: createFallbackQuestion(sentence, index),
    answer: sentence
  }));
  const deckName = context.deckNameSuggestion
    ? `${context.deckNameSuggestion} (Fallback)`
    : 'Fallback Flashcards';
  const reasonSnippet = reason ? ` Reason: ${reason}` : '';
  return {
    type: 'flashcard',
    deckName,
    deckNotes: `A simplified fallback deck generated from your documents because the AI service was unavailable.${reasonSnippet}`,
    language: context.languagePreference !== 'auto'
      ? context.languagePreference
      : detectLanguageFromDocuments(documents),
    cards
  };
}

module.exports = {
  handleAiDeckRequest
};
