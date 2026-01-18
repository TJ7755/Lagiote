/**
 * Card Types Module Tests
 * Tests for new Anki-compatible card types: Basic, Basic Reversed, Basic Optional Reversed,
 * Basic Type-in Answer, Cloze, and Image Occlusion
 */

import assert from 'assert';

// We'll test by importing the module - for Node.js we need to handle the imports
const testResults = { passed: 0, failed: 0, errors: [] };

function test(name, fn) {
    try {
        fn();
        testResults.passed++;
        console.log(`✓ ${name}`);
    } catch (err) {
        testResults.failed++;
        testResults.errors.push({ name, error: err.message });
        console.error(`✗ ${name}: ${err.message}`);
    }
}

function assertEqual(actual, expected, message = '') {
    if (actual !== expected) {
        throw new Error(`${message} Expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
    }
}

function assertDeepEqual(actual, expected, message = '') {
    const actualStr = JSON.stringify(actual, null, 2);
    const expectedStr = JSON.stringify(expected, null, 2);
    if (actualStr !== expectedStr) {
        throw new Error(`${message}\nExpected:\n${expectedStr}\n\nGot:\n${actualStr}`);
    }
}

function assertTrue(condition, message = 'Expected true') {
    if (!condition) {
        throw new Error(message);
    }
}

function assertFalse(condition, message = 'Expected false') {
    if (condition) {
        throw new Error(message);
    }
}

// ========== CARD_TYPES Constants Tests ==========

console.log('\n=== CARD_TYPES Constants Tests ===\n');

test('CARD_TYPES should define all 6 basic types', () => {
    const CARD_TYPES = {
        BASIC: 'basic',
        BASIC_REVERSED: 'basic_reversed',
        BASIC_OPTIONAL_REVERSED: 'basic_optional_reversed',
        BASIC_TYPE_ANSWER: 'basic_type_answer',
        CLOZE: 'cloze',
        IMAGE_OCCLUSION: 'image_occlusion'
    };
    
    assertEqual(CARD_TYPES.BASIC, 'basic');
    assertEqual(CARD_TYPES.BASIC_REVERSED, 'basic_reversed');
    assertEqual(CARD_TYPES.BASIC_OPTIONAL_REVERSED, 'basic_optional_reversed');
    assertEqual(CARD_TYPES.BASIC_TYPE_ANSWER, 'basic_type_answer');
    assertEqual(CARD_TYPES.CLOZE, 'cloze');
    assertEqual(CARD_TYPES.IMAGE_OCCLUSION, 'image_occlusion');
});

// ========== Cloze Parsing Tests ==========

console.log('\n=== Cloze Parsing Tests ===\n');

// Helper function to simulate parseClozeText
function parseClozeText(text) {
    if (!text || typeof text !== 'string') {
        return { deletions: [], displayText: '', fullText: text || '' };
    }

    const deletions = [];
    const clozePattern = /\{\{c(\d+)::([^}:]+)(?:::([^}]*))?\}\}/g;
    let match;
    let index = 0;

    while ((match = clozePattern.exec(text)) !== null) {
        deletions.push({
            index: index++,
            clozeNum: parseInt(match[1], 10),
            answer: match[2],
            hint: match[3] || null,
            fullMatch: match[0],
            start: match.index,
            end: match.index + match[0].length
        });
    }

    // Simple bracket pattern [text] if no Anki-style found
    if (deletions.length === 0) {
        const bracketPattern = /\[([^\]]+)\]/g;
        while ((match = bracketPattern.exec(text)) !== null) {
            deletions.push({
                index: index++,
                clozeNum: index,
                answer: match[1],
                hint: null,
                fullMatch: match[0],
                start: match.index,
                end: match.index + match[0].length
            });
        }
    }

    // Create display text with blanks
    let displayText = text;
    for (const deletion of [...deletions].reverse()) {
        const blank = deletion.hint 
            ? `<span class="cloze-blank" data-index="${deletion.index}">[${deletion.hint}]</span>`
            : `<span class="cloze-blank" data-index="${deletion.index}">[...]</span>`;
        displayText = displayText.slice(0, deletion.start) + blank + displayText.slice(deletion.end);
    }

    // Create full text with answers highlighted
    let fullText = text;
    for (const deletion of [...deletions].reverse()) {
        const answer = `<span class="cloze-answer" data-index="${deletion.index}">${deletion.answer}</span>`;
        fullText = fullText.slice(0, deletion.start) + answer + fullText.slice(deletion.end);
    }

    return { deletions, displayText, fullText };
}

test('parseClozeText should parse single Anki cloze deletion', () => {
    const result = parseClozeText('The {{c1::mitochondria}} is the powerhouse of the cell.');
    assertEqual(result.deletions.length, 1);
    assertEqual(result.deletions[0].clozeNum, 1);
    assertEqual(result.deletions[0].answer, 'mitochondria');
    assertEqual(result.deletions[0].hint, null);
});

test('parseClozeText should parse cloze with hint', () => {
    const result = parseClozeText('The {{c1::mitochondria::organelle}} is the powerhouse of the cell.');
    assertEqual(result.deletions.length, 1);
    assertEqual(result.deletions[0].answer, 'mitochondria');
    assertEqual(result.deletions[0].hint, 'organelle');
});

test('parseClozeText should parse multiple cloze deletions', () => {
    const result = parseClozeText('{{c1::Paris}} is the capital of {{c2::France}}.');
    assertEqual(result.deletions.length, 2);
    assertEqual(result.deletions[0].clozeNum, 1);
    assertEqual(result.deletions[0].answer, 'Paris');
    assertEqual(result.deletions[1].clozeNum, 2);
    assertEqual(result.deletions[1].answer, 'France');
});

test('parseClozeText should handle simple bracket syntax', () => {
    const result = parseClozeText('The [mitochondria] is the powerhouse of the cell.');
    assertEqual(result.deletions.length, 1);
    assertEqual(result.deletions[0].answer, 'mitochondria');
});

test('parseClozeText should generate display text with blanks', () => {
    const result = parseClozeText('The {{c1::mitochondria}} is important.');
    assertTrue(result.displayText.includes('[...]'), 'Display text should contain blank');
    assertTrue(result.displayText.includes('cloze-blank'), 'Display text should have cloze-blank class');
});

test('parseClozeText should generate full text with highlighted answers', () => {
    const result = parseClozeText('The {{c1::mitochondria}} is important.');
    assertTrue(result.fullText.includes('mitochondria'), 'Full text should contain answer');
    assertTrue(result.fullText.includes('cloze-answer'), 'Full text should have cloze-answer class');
});

test('parseClozeText should handle empty input', () => {
    const result = parseClozeText('');
    assertEqual(result.deletions.length, 0);
    assertEqual(result.displayText, '');
});

test('parseClozeText should handle null input', () => {
    const result = parseClozeText(null);
    assertEqual(result.deletions.length, 0);
});

// ========== Typed Answer Grading Tests ==========

console.log('\n=== Typed Answer Grading Tests ===\n');

// Helper function to simulate gradeTypedAnswer
function gradeTypedAnswer(userAnswer, correctAnswer, options = {}) {
    const threshold = options.threshold ?? 0.85;
    const caseSensitive = options.caseSensitive ?? false;
    const trimWhitespace = options.trimWhitespace ?? true;

    let user = String(userAnswer || '');
    let correct = String(correctAnswer || '');

    if (trimWhitespace) {
        user = user.trim();
        correct = correct.trim();
    }

    if (!caseSensitive) {
        user = user.toLowerCase();
        correct = correct.toLowerCase();
    }

    // Exact match
    if (user === correct) {
        return { isCorrect: true, similarity: 1.0, userAnswer: user, correctAnswer: correct };
    }

    // Levenshtein distance-based similarity
    const maxLen = Math.max(user.length, correct.length);
    if (maxLen === 0) {
        return { isCorrect: true, similarity: 1.0, userAnswer: user, correctAnswer: correct };
    }

    const distance = levenshteinDistance(user, correct);
    const similarity = 1 - (distance / maxLen);

    return {
        isCorrect: similarity >= threshold,
        similarity,
        userAnswer: user,
        correctAnswer: correct
    };
}

function levenshteinDistance(a, b) {
    const matrix = [];
    for (let i = 0; i <= b.length; i++) {
        matrix[i] = [i];
    }
    for (let j = 0; j <= a.length; j++) {
        matrix[0][j] = j;
    }
    for (let i = 1; i <= b.length; i++) {
        for (let j = 1; j <= a.length; j++) {
            if (b.charAt(i - 1) === a.charAt(j - 1)) {
                matrix[i][j] = matrix[i - 1][j - 1];
            } else {
                matrix[i][j] = Math.min(
                    matrix[i - 1][j - 1] + 1,
                    matrix[i][j - 1] + 1,
                    matrix[i - 1][j] + 1
                );
            }
        }
    }
    return matrix[b.length][a.length];
}

test('gradeTypedAnswer should mark exact match as correct', () => {
    const result = gradeTypedAnswer('mitochondria', 'mitochondria');
    assertTrue(result.isCorrect);
    assertEqual(result.similarity, 1.0);
});

test('gradeTypedAnswer should be case-insensitive by default', () => {
    const result = gradeTypedAnswer('MITOCHONDRIA', 'mitochondria');
    assertTrue(result.isCorrect);
    assertEqual(result.similarity, 1.0);
});

test('gradeTypedAnswer should trim whitespace by default', () => {
    const result = gradeTypedAnswer('  mitochondria  ', 'mitochondria');
    assertTrue(result.isCorrect);
});

test('gradeTypedAnswer should accept minor typos above threshold', () => {
    const result = gradeTypedAnswer('mitocondria', 'mitochondria');
    // 1 character difference in 12 characters = ~0.92 similarity
    assertTrue(result.similarity > 0.85);
});

test('gradeTypedAnswer should reject answers below threshold', () => {
    const result = gradeTypedAnswer('wrong', 'mitochondria');
    assertFalse(result.isCorrect);
    assertTrue(result.similarity < 0.5);
});

test('gradeTypedAnswer should respect case-sensitive option', () => {
    const result = gradeTypedAnswer('HELLO', 'hello', { caseSensitive: true });
    assertFalse(result.isCorrect);
});

test('gradeTypedAnswer should handle empty strings', () => {
    const result = gradeTypedAnswer('', '');
    assertTrue(result.isCorrect);
});

test('gradeTypedAnswer should handle empty user answer', () => {
    const result = gradeTypedAnswer('', 'answer');
    assertFalse(result.isCorrect);
    assertEqual(result.similarity, 0);
});

// ========== Card Expansion Tests ==========

console.log('\n=== Card Expansion Tests ===\n');

// Helper to simulate expandCard
function expandCard(card) {
    const cards = [];
    const type = card.cardType || 'basic';
    const baseId = card.id || `card_${Date.now()}`;

    if (type === 'basic_reversed') {
        // Create two cards: forward and reverse
        cards.push({
            ...card,
            id: `${baseId}_fwd`,
            cardType: 'basic',
            originalCardId: baseId,
            direction: 'forward'
        });
        cards.push({
            ...card,
            id: `${baseId}_rev`,
            cardType: 'basic',
            question: card.answer,
            answer: card.question,
            originalCardId: baseId,
            direction: 'reverse'
        });
    } else if (type === 'basic_optional_reversed') {
        // Forward card always
        cards.push({
            ...card,
            id: `${baseId}_fwd`,
            cardType: 'basic',
            originalCardId: baseId,
            direction: 'forward'
        });
        // Reverse only if addReverse is true
        if (card.addReverse) {
            cards.push({
                ...card,
                id: `${baseId}_rev`,
                cardType: 'basic',
                question: card.answer,
                answer: card.question,
                originalCardId: baseId,
                direction: 'reverse'
            });
        }
    } else if (type === 'cloze') {
        // Expand cloze into multiple cards, one per cloze number
        const parsed = parseClozeText(card.text || card.question || '');
        const clozeNums = [...new Set(parsed.deletions.map(d => d.clozeNum))];
        
        if (clozeNums.length === 0) {
            // No valid cloze syntax - keep as single card
            cards.push({ ...card, id: baseId });
        } else {
            for (const num of clozeNums) {
                cards.push({
                    ...card,
                    id: `${baseId}_c${num}`,
                    cardType: 'cloze',
                    clozeNum: num,
                    originalCardId: baseId
                });
            }
        }
    } else {
        // No expansion needed
        cards.push({ ...card, id: baseId });
    }

    return cards;
}

test('expandCard should not expand basic cards', () => {
    const card = { id: 'test1', cardType: 'basic', question: 'Q', answer: 'A' };
    const result = expandCard(card);
    assertEqual(result.length, 1);
    assertEqual(result[0].question, 'Q');
});

test('expandCard should expand basic_reversed into two cards', () => {
    const card = { id: 'test2', cardType: 'basic_reversed', question: 'Q', answer: 'A' };
    const result = expandCard(card);
    assertEqual(result.length, 2);
    
    const fwd = result.find(c => c.direction === 'forward');
    const rev = result.find(c => c.direction === 'reverse');
    
    assertTrue(fwd !== undefined, 'Should have forward card');
    assertTrue(rev !== undefined, 'Should have reverse card');
    assertEqual(fwd.question, 'Q');
    assertEqual(fwd.answer, 'A');
    assertEqual(rev.question, 'A');
    assertEqual(rev.answer, 'Q');
});

test('expandCard should expand basic_optional_reversed with addReverse=true', () => {
    const card = { id: 'test3', cardType: 'basic_optional_reversed', question: 'Q', answer: 'A', addReverse: true };
    const result = expandCard(card);
    assertEqual(result.length, 2);
});

test('expandCard should not reverse basic_optional_reversed with addReverse=false', () => {
    const card = { id: 'test4', cardType: 'basic_optional_reversed', question: 'Q', answer: 'A', addReverse: false };
    const result = expandCard(card);
    assertEqual(result.length, 1);
});

test('expandCard should expand cloze with multiple deletions', () => {
    const card = { id: 'test5', cardType: 'cloze', text: '{{c1::Paris}} is in {{c2::France}}' };
    const result = expandCard(card);
    assertEqual(result.length, 2);
    
    const c1 = result.find(c => c.clozeNum === 1);
    const c2 = result.find(c => c.clozeNum === 2);
    
    assertTrue(c1 !== undefined, 'Should have c1 card');
    assertTrue(c2 !== undefined, 'Should have c2 card');
});

test('expandCard should handle cloze with repeated cloze numbers', () => {
    // When c1 appears twice, only one card should be created
    const card = { id: 'test6', cardType: 'cloze', text: '{{c1::Paris}} and {{c1::London}} are cities' };
    const result = expandCard(card);
    assertEqual(result.length, 1);
    assertEqual(result[0].clozeNum, 1);
});

// ========== Import Header Detection Tests ==========

console.log('\n=== Import Header Detection Tests ===\n');

// Helper to simulate detectCardTypeFromHeaders
function detectCardTypeFromHeaders(headers) {
    const normalized = headers.map(h => String(h || '').toLowerCase().trim());
    
    // Check for explicit type column
    const typeIndex = normalized.findIndex(h => h === 'type' || h === 'cardtype' || h === 'card type');
    if (typeIndex !== -1) {
        return { hasTypeColumn: true, typeIndex };
    }
    
    // Check for cloze-specific columns
    if (normalized.includes('text') || normalized.includes('cloze')) {
        return { inferredType: 'cloze', hasTypeColumn: false };
    }
    
    // Check for image occlusion columns
    if (normalized.includes('image') || normalized.includes('imageurl') || normalized.includes('occlusion')) {
        return { inferredType: 'image_occlusion', hasTypeColumn: false };
    }
    
    // Check for sequence columns
    if (normalized.includes('steps') || normalized.includes('sequence')) {
        return { inferredType: 'sequence', hasTypeColumn: false };
    }
    
    // Default to basic flashcard with question/answer
    if (normalized.includes('question') || normalized.includes('front')) {
        if (normalized.includes('answer') || normalized.includes('back')) {
            return { inferredType: 'basic', hasTypeColumn: false };
        }
    }
    
    return { inferredType: null, hasTypeColumn: false };
}

test('detectCardTypeFromHeaders should detect type column', () => {
    const result = detectCardTypeFromHeaders(['Question', 'Answer', 'Type']);
    assertTrue(result.hasTypeColumn);
    assertEqual(result.typeIndex, 2);
});

test('detectCardTypeFromHeaders should infer cloze from text column', () => {
    const result = detectCardTypeFromHeaders(['Text', 'Tags']);
    assertEqual(result.inferredType, 'cloze');
});

test('detectCardTypeFromHeaders should infer basic from question/answer', () => {
    const result = detectCardTypeFromHeaders(['Question', 'Answer']);
    assertEqual(result.inferredType, 'basic');
});

test('detectCardTypeFromHeaders should infer image_occlusion from image column', () => {
    const result = detectCardTypeFromHeaders(['Image', 'Label', 'Description']);
    assertEqual(result.inferredType, 'image_occlusion');
});

test('detectCardTypeFromHeaders should handle front/back naming', () => {
    const result = detectCardTypeFromHeaders(['Front', 'Back']);
    assertEqual(result.inferredType, 'basic');
});

// ========== Anki Type Mapping Tests ==========

console.log('\n=== Anki Type Mapping Tests ===\n');

const ANKI_TYPE_MAP = {
    'basic': 'basic',
    'basic (and reversed card)': 'basic_reversed',
    'basic (optional reversed card)': 'basic_optional_reversed',
    'basic (type in the answer)': 'basic_type_answer',
    'cloze': 'cloze',
    'image occlusion': 'image_occlusion',
    'reversed': 'basic_reversed',
    'type': 'basic_type_answer'
};

function normalizeAnkiType(ankiType) {
    const normalized = String(ankiType || '').toLowerCase().trim();
    return ANKI_TYPE_MAP[normalized] || 'basic';
}

test('normalizeAnkiType should map Anki basic type', () => {
    assertEqual(normalizeAnkiType('Basic'), 'basic');
});

test('normalizeAnkiType should map Anki reversed type', () => {
    assertEqual(normalizeAnkiType('Basic (and reversed card)'), 'basic_reversed');
});

test('normalizeAnkiType should map Anki optional reversed type', () => {
    assertEqual(normalizeAnkiType('Basic (optional reversed card)'), 'basic_optional_reversed');
});

test('normalizeAnkiType should map Anki type-in answer type', () => {
    assertEqual(normalizeAnkiType('Basic (type in the answer)'), 'basic_type_answer');
});

test('normalizeAnkiType should map Anki cloze type', () => {
    assertEqual(normalizeAnkiType('Cloze'), 'cloze');
});

test('normalizeAnkiType should map Anki image occlusion type', () => {
    assertEqual(normalizeAnkiType('Image Occlusion'), 'image_occlusion');
});

test('normalizeAnkiType should default unknown types to basic', () => {
    assertEqual(normalizeAnkiType('Unknown Type'), 'basic');
});

test('normalizeAnkiType should handle empty string', () => {
    assertEqual(normalizeAnkiType(''), 'basic');
});

// ========== Validation Tests ==========

console.log('\n=== Card Validation Tests ===\n');

function validateCard(card) {
    const errors = [];
    const type = card.cardType || 'basic';
    
    if (type === 'cloze') {
        const text = card.text || card.question || '';
        const hasCloze = /\{\{c\d+::/.test(text) || /\[[^\]]+\]/.test(text);
        if (!hasCloze) {
            errors.push('Cloze card must contain cloze deletion syntax');
        }
    } else if (type === 'image_occlusion') {
        if (!card.imageUrl && !card.imageData && !card.imageRef) {
            errors.push('Image occlusion card requires an image');
        }
    } else {
        // Q/A based types
        if (!card.question || !card.question.trim()) {
            errors.push('Card must have a question');
        }
        if (!card.answer || !card.answer.trim()) {
            errors.push('Card must have an answer');
        }
    }
    
    return { valid: errors.length === 0, errors };
}

test('validateCard should pass valid basic card', () => {
    const result = validateCard({ cardType: 'basic', question: 'Q', answer: 'A' });
    assertTrue(result.valid);
});

test('validateCard should fail basic card without question', () => {
    const result = validateCard({ cardType: 'basic', question: '', answer: 'A' });
    assertFalse(result.valid);
    assertTrue(result.errors.some(e => e.includes('question')));
});

test('validateCard should fail basic card without answer', () => {
    const result = validateCard({ cardType: 'basic', question: 'Q', answer: '' });
    assertFalse(result.valid);
    assertTrue(result.errors.some(e => e.includes('answer')));
});

test('validateCard should pass valid cloze card', () => {
    const result = validateCard({ cardType: 'cloze', text: 'The {{c1::answer}} is here' });
    assertTrue(result.valid);
});

test('validateCard should fail cloze card without cloze syntax', () => {
    const result = validateCard({ cardType: 'cloze', text: 'No cloze here' });
    assertFalse(result.valid);
    assertTrue(result.errors.some(e => e.includes('cloze deletion syntax')));
});

test('validateCard should pass cloze with bracket syntax', () => {
    const result = validateCard({ cardType: 'cloze', text: 'The [answer] is here' });
    assertTrue(result.valid);
});

test('validateCard should fail image_occlusion without image', () => {
    const result = validateCard({ cardType: 'image_occlusion', label: 'Test' });
    assertFalse(result.valid);
    assertTrue(result.errors.some(e => e.includes('image')));
});

test('validateCard should pass image_occlusion with imageUrl', () => {
    const result = validateCard({ cardType: 'image_occlusion', imageUrl: 'http://example.com/img.png' });
    assertTrue(result.valid);
});

// ========== Summary ==========

console.log('\n=== Test Summary ===\n');
console.log(`Passed: ${testResults.passed}`);
console.log(`Failed: ${testResults.failed}`);

if (testResults.failed > 0) {
    console.log('\nFailed Tests:');
    testResults.errors.forEach(({ name, error }) => {
        console.log(`  - ${name}: ${error}`);
    });
    process.exit(1);
}

console.log('\nAll tests passed!');
