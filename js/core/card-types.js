/**
 * Card Types Module
 * 
 * Defines all supported card types compatible with Anki import format:
 * - Basic: Front/Back
 * - Basic (and reversed card): Creates two cards, front→back and back→front
 * - Basic (optional reversed card): Has "Add Reverse" field
 * - Basic (type in the answer): Text input on front
 * - Cloze: Cloze deletion format
 * - Image Occlusion: Cloze for images
 */

// Card type constants
export const CARD_TYPES = {
    BASIC: 'basic',
    BASIC_REVERSED: 'basic_reversed',
    BASIC_OPTIONAL_REVERSED: 'basic_optional_reversed',
    BASIC_TYPE_ANSWER: 'basic_type_answer',
    CLOZE: 'cloze',
    IMAGE_OCCLUSION: 'image_occlusion',
    // Legacy types for backward compatibility
    FLASHCARD: 'flashcard',
    MCQ: 'mcq',
    SEQUENCE: 'sequence'
};

// Map Anki-style names to internal types
export const ANKI_TYPE_MAP = {
    'basic': CARD_TYPES.BASIC,
    'basic (and reversed card)': CARD_TYPES.BASIC_REVERSED,
    'basic and reversed card': CARD_TYPES.BASIC_REVERSED,
    'basic-reversed': CARD_TYPES.BASIC_REVERSED,
    'basic_reversed': CARD_TYPES.BASIC_REVERSED,
    'basic (optional reversed card)': CARD_TYPES.BASIC_OPTIONAL_REVERSED,
    'basic optional reversed card': CARD_TYPES.BASIC_OPTIONAL_REVERSED,
    'basic-optional-reversed': CARD_TYPES.BASIC_OPTIONAL_REVERSED,
    'basic_optional_reversed': CARD_TYPES.BASIC_OPTIONAL_REVERSED,
    'basic (type in the answer)': CARD_TYPES.BASIC_TYPE_ANSWER,
    'basic type in the answer': CARD_TYPES.BASIC_TYPE_ANSWER,
    'basic-type-answer': CARD_TYPES.BASIC_TYPE_ANSWER,
    'basic_type_answer': CARD_TYPES.BASIC_TYPE_ANSWER,
    'type': CARD_TYPES.BASIC_TYPE_ANSWER,
    'cloze': CARD_TYPES.CLOZE,
    'image occlusion': CARD_TYPES.IMAGE_OCCLUSION,
    'image-occlusion': CARD_TYPES.IMAGE_OCCLUSION,
    'image_occlusion': CARD_TYPES.IMAGE_OCCLUSION,
    'occlusion': CARD_TYPES.IMAGE_OCCLUSION,
    // Legacy mappings
    'flashcard': CARD_TYPES.BASIC,
    'mcq': CARD_TYPES.MCQ,
    'multiplechoice': CARD_TYPES.MCQ,
    'multiple choice': CARD_TYPES.MCQ,
    'sequence': CARD_TYPES.SEQUENCE
};

// Display names for UI
export const CARD_TYPE_LABELS = {
    [CARD_TYPES.BASIC]: 'Basic',
    [CARD_TYPES.BASIC_REVERSED]: 'Basic (and reversed card)',
    [CARD_TYPES.BASIC_OPTIONAL_REVERSED]: 'Basic (optional reversed card)',
    [CARD_TYPES.BASIC_TYPE_ANSWER]: 'Basic (type in the answer)',
    [CARD_TYPES.CLOZE]: 'Cloze',
    [CARD_TYPES.IMAGE_OCCLUSION]: 'Image Occlusion',
    [CARD_TYPES.FLASHCARD]: 'Flashcard',
    [CARD_TYPES.MCQ]: 'Multiple Choice',
    [CARD_TYPES.SEQUENCE]: 'Sequence'
};

// Card type configurations
export const CARD_TYPE_CONFIG = {
    [CARD_TYPES.BASIC]: {
        fields: ['front', 'back'],
        requiredFields: ['front', 'back'],
        createsMultiple: false,
        supportsImages: true,
        inputMode: 'reveal'  // reveal answer
    },
    [CARD_TYPES.BASIC_REVERSED]: {
        fields: ['front', 'back'],
        requiredFields: ['front', 'back'],
        createsMultiple: true,  // Creates front→back AND back→front
        supportsImages: true,
        inputMode: 'reveal'
    },
    [CARD_TYPES.BASIC_OPTIONAL_REVERSED]: {
        fields: ['front', 'back', 'addReverse'],
        requiredFields: ['front', 'back'],
        createsMultiple: 'conditional',  // Only if addReverse is set
        supportsImages: true,
        inputMode: 'reveal'
    },
    [CARD_TYPES.BASIC_TYPE_ANSWER]: {
        fields: ['front', 'back'],
        requiredFields: ['front', 'back'],
        createsMultiple: false,
        supportsImages: true,
        inputMode: 'type'  // User types the answer
    },
    [CARD_TYPES.CLOZE]: {
        fields: ['text', 'clozes'],
        requiredFields: ['text'],
        createsMultiple: 'perCloze',  // One card per cloze deletion
        supportsImages: false,
        inputMode: 'type'
    },
    [CARD_TYPES.IMAGE_OCCLUSION]: {
        fields: ['image', 'occlusions'],
        requiredFields: ['image', 'occlusions'],
        createsMultiple: 'perOcclusion',
        supportsImages: true,
        inputMode: 'reveal'
    }
};

/**
 * Regex pattern to detect cloze deletions in text
 * Matches: {{c1::text}}, {{c2::text::hint}}, [...]
 */
const CLOZE_PATTERN = /\{\{c(\d+)::(.*?)(?:::(.*?))?\}\}|\[([^\]]+)\]/g;
const SIMPLE_CLOZE_PATTERN = /\[\.{3}\]|\[…\]/g;

/**
 * Normalizes a card type string to internal type
 * @param {string} typeString - Raw type string from import
 * @returns {string} - Internal card type constant
 */
export function normalizeCardType(typeString) {
    if (!typeString || typeof typeString !== 'string') {
        return CARD_TYPES.BASIC;
    }
    const normalized = typeString.trim().toLowerCase();
    return ANKI_TYPE_MAP[normalized] || CARD_TYPES.BASIC;
}

/**
 * Detects the card type from card content
 * @param {Object} card - Card object with fields
 * @returns {string} - Detected card type
 */
export function detectCardType(card) {
    if (!card || typeof card !== 'object') {
        return CARD_TYPES.BASIC;
    }

    // Explicit type takes precedence
    if (card.cardType && CARD_TYPE_CONFIG[card.cardType]) {
        return card.cardType;
    }
    if (card.type && ANKI_TYPE_MAP[card.type.toLowerCase()]) {
        return ANKI_TYPE_MAP[card.type.toLowerCase()];
    }

    // Detect Image Occlusion
    if (card.occlusions && Array.isArray(card.occlusions) && card.occlusions.length > 0) {
        return CARD_TYPES.IMAGE_OCCLUSION;
    }
    if (card.questionImage && card.occlusionData) {
        return CARD_TYPES.IMAGE_OCCLUSION;
    }

    // Detect Cloze
    const questionText = card.question || card.front || card.text || '';
    if (CLOZE_PATTERN.test(questionText) || SIMPLE_CLOZE_PATTERN.test(questionText)) {
        return CARD_TYPES.CLOZE;
    }
    if (card.clozes && Array.isArray(card.clozes)) {
        return CARD_TYPES.CLOZE;
    }

    // Detect Type-in-Answer
    if (card.inputMode === 'type' || card.typeAnswer === true) {
        return CARD_TYPES.BASIC_TYPE_ANSWER;
    }

    // Detect Optional Reversed
    if ('addReverse' in card || 'add_reverse' in card) {
        return CARD_TYPES.BASIC_OPTIONAL_REVERSED;
    }

    // Detect Reversed (explicit)
    if (card.reversed === true || card.createReverse === true) {
        return CARD_TYPES.BASIC_REVERSED;
    }

    // Detect Sequence
    if (card.sequenceId || card.order !== undefined) {
        return CARD_TYPES.SEQUENCE;
    }

    // Default to Basic
    return CARD_TYPES.BASIC;
}

/**
 * Parses cloze deletions from text
 * @param {string} text - Text containing cloze deletions
 * @returns {Object} - { text: normalized text, clozes: array of {index, text, hint} }
 */
export function parseClozeText(text) {
    if (!text || typeof text !== 'string') {
        return { text: '', clozes: [] };
    }

    const clozes = [];
    let clozeIndex = 1;

    // Reset regex lastIndex
    CLOZE_PATTERN.lastIndex = 0;

    // Parse Anki-style clozes: {{c1::text}} or {{c1::text::hint}}
    let processedText = text.replace(CLOZE_PATTERN, (match, index, clozeText, hint, bracketText) => {
        if (bracketText) {
            // Simple bracket format [text]
            clozes.push({
                index: clozeIndex,
                text: bracketText.trim(),
                hint: ''
            });
            clozeIndex++;
            return `{{c${clozeIndex - 1}::${bracketText.trim()}}}`;
        } else {
            // Anki format
            const idx = parseInt(index, 10);
            clozes.push({
                index: idx,
                text: clozeText.trim(),
                hint: hint ? hint.trim() : ''
            });
            return match;
        }
    });

    return { text: processedText, clozes };
}

/**
 * Renders cloze text for display, hiding specified cloze
 * @param {string} text - Text with cloze markers
 * @param {number} activeIndex - Which cloze to hide (1-indexed)
 * @param {Object} options - { showHint: boolean, placeholder: string }
 * @returns {string} - Rendered text with blanks
 */
export function renderClozeText(text, activeIndex = 1, options = {}) {
    const { showHint = true, placeholder = '[...]' } = options;
    if (!text) return '';

    CLOZE_PATTERN.lastIndex = 0;

    return text.replace(CLOZE_PATTERN, (match, index, clozeText, hint, bracketText) => {
        const idx = bracketText ? 1 : parseInt(index, 10);
        const actualText = bracketText || clozeText;
        const actualHint = hint || '';

        if (idx === activeIndex) {
            // This is the cloze to hide
            if (showHint && actualHint) {
                return `[${actualHint}]`;
            }
            return placeholder;
        } else {
            // Show the text for other clozes
            return actualText;
        }
    });
}

/**
 * Gets the answer for a specific cloze in a cloze card
 * @param {string} text - Text with cloze markers
 * @param {number} activeIndex - Which cloze to get answer for
 * @returns {string} - The cloze answer
 */
export function getClozeAnswer(text, activeIndex = 1) {
    if (!text) return '';

    const parsed = parseClozeText(text);
    const cloze = parsed.clozes.find(c => c.index === activeIndex);
    return cloze ? cloze.text : '';
}

/**
 * Counts the number of cloze deletions in text
 * @param {string} text - Text to analyze
 * @returns {number} - Number of clozes
 */
export function countClozes(text) {
    if (!text) return 0;
    const parsed = parseClozeText(text);
    return parsed.clozes.length;
}

/**
 * Expands a card into multiple cards based on its type
 * For reversed cards, creates both directions
 * For cloze cards, creates one per cloze
 * @param {Object} card - Original card
 * @returns {Array} - Array of expanded cards
 */
export function expandCard(card) {
    if (!card) return [];

    const cardType = card.cardType || detectCardType(card);
    const baseId = card.id || crypto.randomUUID();
    const front = card.front || card.question || '';
    const back = card.back || card.answer || '';

    switch (cardType) {
        case CARD_TYPES.BASIC_REVERSED: {
            // Create two cards: front→back and back→front
            return [
                {
                    ...card,
                    id: `${baseId}_fwd`,
                    question: front,
                    answer: back,
                    front: front,
                    back: back,
                    cardType: CARD_TYPES.BASIC,
                    direction: 'forward',
                    sourceCardId: baseId
                },
                {
                    ...card,
                    id: `${baseId}_rev`,
                    question: back,
                    answer: front,
                    front: back,
                    back: front,
                    cardType: CARD_TYPES.BASIC,
                    direction: 'reverse',
                    sourceCardId: baseId
                }
            ];
        }

        case CARD_TYPES.BASIC_OPTIONAL_REVERSED: {
            const addReverse = card.addReverse || card.add_reverse;
            const cards = [{
                ...card,
                id: `${baseId}_fwd`,
                question: front,
                answer: back,
                front: front,
                back: back,
                cardType: CARD_TYPES.BASIC,
                direction: 'forward',
                sourceCardId: baseId
            }];

            if (addReverse && String(addReverse).trim()) {
                cards.push({
                    ...card,
                    id: `${baseId}_rev`,
                    question: back,
                    answer: front,
                    front: back,
                    back: front,
                    cardType: CARD_TYPES.BASIC,
                    direction: 'reverse',
                    sourceCardId: baseId
                });
            }

            return cards;
        }

        case CARD_TYPES.CLOZE: {
            const text = card.text || card.question || front;
            const parsed = parseClozeText(text);
            
            if (parsed.clozes.length === 0) {
                // No clozes found, treat as basic
                return [{
                    ...card,
                    id: baseId,
                    cardType: CARD_TYPES.BASIC
                }];
            }

            // Create one card per unique cloze index
            const uniqueIndices = [...new Set(parsed.clozes.map(c => c.index))];
            return uniqueIndices.map(clozeIndex => {
                const cloze = parsed.clozes.find(c => c.index === clozeIndex);
                return {
                    ...card,
                    id: `${baseId}_c${clozeIndex}`,
                    question: renderClozeText(text, clozeIndex),
                    answer: cloze ? cloze.text : '',
                    front: renderClozeText(text, clozeIndex),
                    back: cloze ? cloze.text : '',
                    cardType: CARD_TYPES.CLOZE,
                    clozeIndex,
                    clozeText: text,
                    sourceCardId: baseId
                };
            });
        }

        case CARD_TYPES.IMAGE_OCCLUSION: {
            const occlusions = card.occlusions || [];
            if (occlusions.length === 0) {
                return [{
                    ...card,
                    id: baseId,
                    cardType: CARD_TYPES.IMAGE_OCCLUSION
                }];
            }

            // Create one card per occlusion
            return occlusions.map((occlusion, idx) => ({
                ...card,
                id: `${baseId}_occ${idx + 1}`,
                question: front || 'Identify the hidden area',
                answer: occlusion.label || `Area ${idx + 1}`,
                activeOcclusionIndex: idx,
                cardType: CARD_TYPES.IMAGE_OCCLUSION,
                sourceCardId: baseId
            }));
        }

        default:
            // BASIC, BASIC_TYPE_ANSWER, etc. - return as single card
            return [{
                ...card,
                id: baseId,
                question: front,
                answer: back,
                front: front,
                back: back,
                cardType: cardType
            }];
    }
}

/**
 * Normalizes a card from import data to internal format
 * @param {Object} rawCard - Raw card from import
 * @param {Object} options - { deckId, typeHint }
 * @returns {Object} - Normalized card
 */
export function normalizeCardFromImport(rawCard, options = {}) {
    if (!rawCard || typeof rawCard !== 'object') {
        return null;
    }

    const { deckId = null, typeHint = null, expandCards = false } = options;

    // Extract front/back with various field name support
    const front = rawCard.front || rawCard.Front || rawCard.question || rawCard.Question || 
                  rawCard.term || rawCard.Term || rawCard.prompt || '';
    const back = rawCard.back || rawCard.Back || rawCard.answer || rawCard.Answer || 
                 rawCard.definition || rawCard.Definition || rawCard.response || '';
    const addReverse = rawCard.addReverse || rawCard.add_reverse || rawCard['Add Reverse'] || 
                       rawCard.AddReverse || rawCard['add reverse'] || '';

    // Determine card type
    let cardType = typeHint ? normalizeCardType(typeHint) : null;
    if (rawCard.cardType || rawCard.card_type || rawCard.type || rawCard.Type) {
        const explicitType = rawCard.cardType || rawCard.card_type || rawCard.type || rawCard.Type;
        cardType = normalizeCardType(explicitType);
    }
    if (!cardType) {
        cardType = detectCardType({ ...rawCard, front, back, addReverse });
    }

    const normalized = {
        id: rawCard.id || crypto.randomUUID(),
        question: front.trim(),
        answer: back.trim(),
        front: front.trim(),
        back: back.trim(),
        cardType,
        isNew: true,
        deckId
    };

    // Add type-specific fields
    if (cardType === CARD_TYPES.BASIC_OPTIONAL_REVERSED) {
        normalized.addReverse = addReverse;
    }

    if (cardType === CARD_TYPES.CLOZE) {
        normalized.clozeText = front;
    }

    if (cardType === CARD_TYPES.IMAGE_OCCLUSION) {
        normalized.questionImage = rawCard.questionImage || rawCard.image || rawCard.Image || '';
        normalized.occlusions = rawCard.occlusions || [];
        normalized.occlusionData = rawCard.occlusionData || null;
    }

    // Preserve additional fields
    if (rawCard.distractors) normalized.distractors = rawCard.distractors;
    if (rawCard.questionImage) normalized.questionImage = rawCard.questionImage;
    if (rawCard.answerImage) normalized.answerImage = rawCard.answerImage;
    if (rawCard.tags) normalized.tags = rawCard.tags;
    if (rawCard.notes) normalized.notes = rawCard.notes;

    // Expand if requested
    if (expandCards) {
        return expandCard(normalized);
    }

    return normalized;
}

/**
 * Parses CSV/TSV text into cards with type detection
 * @param {string} text - Raw text content
 * @param {string} separator - Column separator
 * @param {Object} options - { typeHint, deckId, hasHeader }
 * @returns {Array} - Array of normalized cards
 */
export function parseTextToCards(text, separator = '\t', options = {}) {
    const { typeHint = null, deckId = null, hasHeader = true, expandCards = true } = options;

    if (!text || typeof text !== 'string') {
        return [];
    }

    const lines = text.split('\n').map(line => line.trim()).filter(Boolean);
    if (lines.length === 0) return [];

    // Detect header row
    let headers = null;
    let dataStartIndex = 0;

    if (hasHeader) {
        const firstLine = lines[0].toLowerCase();
        // Check if first line looks like a header
        if (firstLine.includes('front') || firstLine.includes('back') || 
            firstLine.includes('question') || firstLine.includes('answer') ||
            firstLine.includes('type') || firstLine.includes('cloze')) {
            headers = lines[0].split(separator).map(h => h.trim().toLowerCase());
            dataStartIndex = 1;
        }
    }

    const cards = [];
    let cardIndex = 0;

    for (let i = dataStartIndex; i < lines.length; i++) {
        const parts = lines[i].split(separator);
        if (parts.length < 2) continue;

        let rawCard = {};

        if (headers) {
            // Map by header names
            headers.forEach((header, idx) => {
                if (parts[idx] !== undefined) {
                    rawCard[header] = parts[idx].trim();
                }
            });
        } else {
            // Assume standard format: Front, Back, [Type], [AddReverse]
            rawCard.front = parts[0]?.trim() || '';
            rawCard.back = parts[1]?.trim() || '';
            if (parts[2]) rawCard.type = parts[2].trim();
            if (parts[3]) rawCard.addReverse = parts[3].trim();
        }

        if (!rawCard.front && !rawCard.back) continue;

        const normalized = normalizeCardFromImport(rawCard, { 
            deckId, 
            typeHint, 
            expandCards: false 
        });

        if (normalized) {
            if (expandCards) {
                const expanded = expandCard(normalized);
                cards.push(...expanded);
            } else {
                cards.push(normalized);
            }
        }
        cardIndex++;
    }

    return cards;
}

/**
 * Validates a card structure
 * @param {Object} card - Card to validate
 * @returns {Object} - { valid: boolean, errors: string[] }
 */
export function validateCard(card) {
    const errors = [];

    if (!card || typeof card !== 'object') {
        return { valid: false, errors: ['Card must be an object'] };
    }

    const cardType = card.cardType || detectCardType(card);
    const config = CARD_TYPE_CONFIG[cardType];

    if (!config) {
        // Unknown type, basic validation
        if (!(card.question || card.front)) {
            errors.push('Card must have a question or front field');
        }
        if (!(card.answer || card.back) && cardType !== CARD_TYPES.CLOZE) {
            errors.push('Card must have an answer or back field');
        }
    } else {
        // Type-specific validation
        switch (cardType) {
            case CARD_TYPES.CLOZE:
                if (!card.clozeText && !card.question && !card.text) {
                    errors.push('Cloze card must have text with cloze deletions');
                } else {
                    const text = card.clozeText || card.question || card.text;
                    if (countClozes(text) === 0) {
                        errors.push('Cloze card must contain at least one cloze deletion');
                    }
                }
                break;

            case CARD_TYPES.IMAGE_OCCLUSION:
                if (!card.questionImage && !card.image) {
                    errors.push('Image Occlusion card must have an image');
                }
                break;

            default:
                if (!(card.question || card.front)) {
                    errors.push('Card must have a question or front field');
                }
                if (!(card.answer || card.back)) {
                    errors.push('Card must have an answer or back field');
                }
        }
    }

    return { valid: errors.length === 0, errors };
}

/**
 * Gets the input mode for a card type
 * @param {string} cardType - Card type constant
 * @returns {string} - 'reveal', 'type', or 'select'
 */
export function getInputMode(cardType) {
    const config = CARD_TYPE_CONFIG[cardType];
    if (config) {
        return config.inputMode || 'reveal';
    }
    return 'reveal';
}

/**
 * Checks if a card type requires typed input
 * @param {string} cardType - Card type constant
 * @returns {boolean}
 */
export function requiresTypedInput(cardType) {
    return cardType === CARD_TYPES.BASIC_TYPE_ANSWER || cardType === CARD_TYPES.CLOZE;
}

/**
 * Grades a typed answer for a card
 * @param {Object} card - Card being answered
 * @param {string} userAnswer - User's typed answer
 * @param {Object} options - { caseSensitive, punctuation }
 * @returns {Object} - { correct: boolean, similarity: number, diff: string }
 */
export function gradeTypedAnswer(card, userAnswer, options = {}) {
    const { caseSensitive = false, punctuation = false } = options;

    const expectedAnswer = card.answer || card.back || '';
    
    let normalizedExpected = expectedAnswer;
    let normalizedUser = userAnswer;

    if (!caseSensitive) {
        normalizedExpected = normalizedExpected.toLowerCase();
        normalizedUser = normalizedUser.toLowerCase();
    }

    if (!punctuation) {
        // Remove punctuation for comparison
        normalizedExpected = normalizedExpected.replace(/[^\w\s]/g, '');
        normalizedUser = normalizedUser.replace(/[^\w\s]/g, '');
    }

    // Trim and normalize whitespace
    normalizedExpected = normalizedExpected.trim().replace(/\s+/g, ' ');
    normalizedUser = normalizedUser.trim().replace(/\s+/g, ' ');

    // Exact match
    if (normalizedExpected === normalizedUser) {
        return { correct: true, similarity: 1.0, diff: '' };
    }

    // Calculate Levenshtein similarity
    const distance = levenshteinDistance(normalizedExpected, normalizedUser);
    const maxLen = Math.max(normalizedExpected.length, normalizedUser.length);
    const similarity = maxLen > 0 ? 1 - (distance / maxLen) : 0;

    // Generate diff for display
    const diff = generateDiff(expectedAnswer, userAnswer);

    // Consider correct if very similar (typo tolerance)
    const correct = similarity >= 0.85;

    return { correct, similarity, diff };
}

/**
 * Levenshtein distance calculation
 */
function levenshteinDistance(a, b) {
    if (!a) return b ? b.length : 0;
    if (!b) return a.length;

    const aLen = a.length;
    const bLen = b.length;
    let prev = new Uint16Array(bLen + 1);
    let curr = new Uint16Array(bLen + 1);

    for (let j = 0; j <= bLen; j++) prev[j] = j;

    for (let i = 0; i < aLen; i++) {
        curr[0] = i + 1;
        const aCode = a.charCodeAt(i);
        for (let j = 0; j < bLen; j++) {
            const cost = aCode === b.charCodeAt(j) ? 0 : 1;
            curr[j + 1] = Math.min(
                prev[j + 1] + 1,
                curr[j] + 1,
                prev[j] + cost
            );
        }
        [prev, curr] = [curr, prev];
    }

    return prev[bLen];
}

/**
 * Generates a simple diff showing differences between expected and actual
 */
function generateDiff(expected, actual) {
    if (expected === actual) return '';
    
    let result = '';
    const expWords = expected.split(/\s+/);
    const actWords = actual.split(/\s+/);

    for (let i = 0; i < Math.max(expWords.length, actWords.length); i++) {
        const exp = expWords[i] || '';
        const act = actWords[i] || '';
        
        if (exp.toLowerCase() !== act.toLowerCase()) {
            if (act) result += `<del>${act}</del> `;
            if (exp) result += `<ins>${exp}</ins> `;
        } else {
            result += `${exp} `;
        }
    }

    return result.trim();
}

/**
 * Export utilities for testing and analytics
 */
export const cardTypeUtils = {
    CARD_TYPES,
    ANKI_TYPE_MAP,
    CARD_TYPE_LABELS,
    CARD_TYPE_CONFIG,
    normalizeCardType,
    detectCardType,
    parseClozeText,
    renderClozeText,
    getClozeAnswer,
    countClozes,
    expandCard,
    normalizeCardFromImport,
    parseTextToCards,
    validateCard,
    getInputMode,
    requiresTypedInput,
    gradeTypedAnswer
};

export default cardTypeUtils;
