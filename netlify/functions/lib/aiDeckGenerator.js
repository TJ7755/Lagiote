const GEMINI_MODEL = 'gemini-2.5-flash';
const GEMINI_ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;

// Card types compatible with Anki import format
const VALID_CARD_TYPES = [
    'flashcard',
    'sequence',
    'vocab',
    'basic',
    'basic_reversed',
    'basic_optional_reversed',
    'basic_type_answer',
    'cloze',
    'image_occlusion'
];

// Map common aliases to canonical type names
const TYPE_ALIASES = {
    'basic': 'basic',
    'basic (and reversed card)': 'basic_reversed',
    'basic_reversed': 'basic_reversed',
    'basicreversed': 'basic_reversed',
    'basic (optional reversed card)': 'basic_optional_reversed',
    'basic_optional_reversed': 'basic_optional_reversed',
    'basicoptionalreversed': 'basic_optional_reversed',
    'basic (type in the answer)': 'basic_type_answer',
    'basic_type_answer': 'basic_type_answer',
    'basictypeanswer': 'basic_type_answer',
    'type_answer': 'basic_type_answer',
    'cloze': 'cloze',
    'image occlusion': 'image_occlusion',
    'image_occlusion': 'image_occlusion',
    'imageocclusion': 'image_occlusion',
    'flashcard': 'flashcard',
    'sequence': 'sequence',
    'vocab': 'vocab'
};

const CARD_COUNT_LABELS = ['short', 'medium', 'long'];
const CARD_COUNT_MAP = {
    flashcard: { short: 10, medium: 20, long: 40 },
    vocab: { short: 10, medium: 20, long: 40 },
    sequence: { short: 2, medium: 4, long: 6 },
    basic: { short: 10, medium: 20, long: 40 },
    basic_reversed: { short: 8, medium: 16, long: 32 },
    basic_optional_reversed: { short: 10, medium: 20, long: 40 },
    basic_type_answer: { short: 8, medium: 15, long: 30 },
    cloze: { short: 8, medium: 15, long: 30 },
    image_occlusion: { short: 5, medium: 10, long: 20 }
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
    // Check aliases first
    const aliased = TYPE_ALIASES[normalized];
    if (aliased) return aliased;
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

    // Build type-specific instructions
    let typeInstruction;
    let cardStructure;

    if (desiredType === 'sequence') {
        typeInstruction = 'Set "type" to "sequence" and return a "sequences" array with title/description/steps.';
        cardStructure = 'Each sequence should include "title", "description", and an ordered "steps" array.';
    } else if (desiredType === 'cloze') {
        typeInstruction = 'Set "type" to "cloze" and return a "cards" array with cloze deletion format.';
        cardStructure = `Each cloze card should have:
- "text": The full text with cloze deletions marked using Anki syntax: {{c1::hidden text::optional hint}}
- Use multiple cloze numbers (c1, c2, c3) for different deletions in the same text
- Example: "The {{c1::mitochondria::powerhouse}} is the {{c2::powerhouse}} of the cell."
Each card becomes multiple review items, one per cloze number.`;
    } else if (desiredType === 'basic_type_answer') {
        typeInstruction = 'Set "type" to "basic_type_answer" and return a "cards" array where users must type their answers.';
        cardStructure = `Each card should have {"question":"", "answer":""}. 
- The answer should be a specific word, phrase, or short text that the user will type
- Avoid long answers; prefer single words, terms, dates, or short phrases
- Great for vocabulary, definitions, dates, formulas, spelling`;
    } else if (desiredType === 'basic_reversed') {
        typeInstruction = 'Set "type" to "basic_reversed" and return a "cards" array that will create two cards per entry.';
        cardStructure = `Each card should have {"question":"", "answer":""}. 
- Each entry creates TWO cards: question→answer AND answer→question
- Write Q/A pairs where both directions make sense (e.g., term↔definition, translation pairs)`;
    } else if (desiredType === 'basic_optional_reversed') {
        typeInstruction = 'Set "type" to "basic_optional_reversed" and return a "cards" array with optional reversal.';
        cardStructure = `Each card should have {"question":"", "answer":"", "addReverse": true/false}. 
- Set "addReverse" to true if the reverse direction also makes a good study card
- Creates one or two cards depending on addReverse value`;
    } else if (desiredType === 'image_occlusion') {
        typeInstruction = 'Set "type" to "image_occlusion" and return a "cards" array describing image regions to hide.';
        cardStructure = `Each card should have:
- "imageRef": Reference to which document image this relates to
- "label": The hidden label/text being tested
- "description": Context about what region is hidden
Note: Full image occlusion requires image processing; this creates text-based placeholders.`;
    } else if (desiredType) {
        // basic or other flashcard-like types
        typeInstruction = `Set "type" to "${desiredType}" and return a "cards" array with Q/A pairs.`;
        cardStructure = 'Each card should have {"question":"", "answer":""}. Create clear, atomic question-answer pairs.';
    } else {
        // Auto-detect best type
        typeInstruction = `Choose the best type based on the documents:
- "flashcard" or "basic": Simple Q/A pairs for facts and concepts
- "vocab": Term/definition pairs for vocabulary
- "sequence": Ordered steps for processes or procedures
- "cloze": Fill-in-the-blank for memorizing exact wording
- "basic_type_answer": Short typed answers for exact recall
- "basic_reversed": Bidirectional pairs (term↔definition, translations)
Set "type" accordingly and return the matching structure.`;
        cardStructure = `Depending on type chosen:
- flashcard/basic/vocab/basic_type_answer: "cards" array with {"question":"", "answer":""}
- basic_reversed: "cards" array with {"question":"", "answer":""} (will become 2 cards each)
- basic_optional_reversed: "cards" array with {"question":"", "answer":"", "addReverse": boolean}
- cloze: "cards" array with {"text":"Text with {{c1::cloze}} deletions"}
- sequence: "sequences" array with {"title":"", "description":"", "steps":[]}`;
    }

    const languageInstruction = languagePreference !== 'auto'
        ? `Write every piece of text (deckName, deckNotes, question, answer, descriptions, steps) in ${languagePreference}. Set "language" to that exact value.`
        : 'Infer the primary language of the documents and use that language for every output field, then report the resolved language in the "language" field.';

    const schemaExample = `{
  "type": "flashcard|sequence|cloze|basic|basic_reversed|basic_optional_reversed|basic_type_answer",
  "deckName": "string",
  "deckNotes": "string (summary or notes, optional but encouraged)",
  "language": "local language name",
  "cards": [
    { "question": "string", "answer": "string" }
  ]
}

For cloze type:
{
  "type": "cloze",
  "deckName": "string",
  "deckNotes": "string",
  "language": "string",
  "cards": [
    { "text": "The {{c1::answer::hint}} is hidden" }
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
    // Handle cloze cards specially
    if (type === 'cloze') {
        const text = (entry.text || entry.content || entry.cloze || '').toString().trim();
        // Validate cloze format
        if (text && /\{\{c\d+::/.test(text)) {
            return { text, cardType: 'cloze' };
        }
        // Try to convert from Q/A format to cloze
        const question = (entry.question || '').toString().trim();
        const answer = (entry.answer || '').toString().trim();
        if (question && answer) {
            // Create a simple cloze from the answer
            return { text: `${question}: {{c1::${answer}}}`, cardType: 'cloze' };
        }
        return null;
    }

    // Handle image occlusion
    if (type === 'image_occlusion') {
        return {
            imageRef: (entry.imageRef || entry.image || '').toString().trim(),
            label: (entry.label || entry.answer || '').toString().trim(),
            description: (entry.description || entry.question || '').toString().trim(),
            cardType: 'image_occlusion'
        };
    }

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

    const result = {
        question,
        answer,
        cardType: type
    };

    // Handle optional reversed flag
    if (type === 'basic_optional_reversed') {
        result.addReverse = entry.addReverse === true || entry.addReverse === 'true';
    }

    return result;
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
    
    // Normalise type through aliases
    const normalizedType = TYPE_ALIASES[reportedType] || reportedType;
    
    if (!VALID_CARD_TYPES.includes(normalizedType)) {
        throw new Error(`Response type "${reportedType}" is not valid. Must be one of: ${VALID_CARD_TYPES.join(', ')}`);
    }
    if (context.desiredType && normalizedType !== context.desiredType) {
        throw new Error(`Expected type "${context.desiredType}" but got "${normalizedType}".`);
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
        type: normalizedType,
        deckName,
        deckNotes,
        language
    };

    if (normalizedType === 'sequence') {
        const sequences = Array.isArray(parsed.sequences) ? parsed.sequences : [];
        const normalized = sequences.map(normalizeSequenceEntry).filter(seq => seq.steps.length > 0);
        if (!normalized.length) {
            throw new Error('Sequences array is missing or empty.');
        }
        result.sequences = normalized.slice(0, context.targetCount);
    } else if (normalizedType === 'cloze') {
        // Handle cloze cards
        const rawCards = Array.isArray(parsed.cards) ? parsed.cards : [];
        const normalized = rawCards
            .map(entry => normalizeCardEntry(entry, normalizedType, language))
            .filter(card => card && card.text);
        if (!normalized.length) {
            throw new Error('Cloze cards array is missing or empty.');
        }
        result.cards = normalized.slice(0, context.targetCount);
    } else if (normalizedType === 'image_occlusion') {
        // Handle image occlusion cards
        const rawCards = Array.isArray(parsed.cards) ? parsed.cards : [];
        const normalized = rawCards
            .map(entry => normalizeCardEntry(entry, normalizedType, language))
            .filter(card => card && (card.label || card.description));
        if (!normalized.length) {
            throw new Error('Image occlusion cards array is missing or empty.');
        }
        result.cards = normalized.slice(0, context.targetCount);
    } else {
        // Handle all flashcard-like types (flashcard, basic, basic_reversed, basic_optional_reversed, basic_type_answer, vocab)
        const rawCards = Array.isArray(parsed.cards)
            ? parsed.cards
            : Array.isArray(parsed.vocab)
                ? parsed.vocab
                : [];
        const normalized = rawCards
            .map(entry => normalizeCardEntry(entry, normalizedType, language))
            .filter(card => card && card.question && card.answer);
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
