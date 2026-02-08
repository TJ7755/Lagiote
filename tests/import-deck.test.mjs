import assert from 'assert';
import { parseImportText, detectDelimiter, parseMarkdownTable, parseSimpleQA } from '../js/core/import-utils.js';
import { CARD_TYPES } from '../js/core/card-types.js';

// Polyfill for crypto.randomUUID for Node environments
if (typeof crypto === 'undefined') {
    global.crypto = {
        randomUUID: () => 'test-uuid-' + Math.random().toString(36).substring(2, 9)
    };
} else if (!crypto.randomUUID) {
    crypto.randomUUID = () => 'test-uuid-' + Math.random().toString(36).substring(2, 9);
}

const testResults = { passed: 0, failed: 0, errors: [] };

function test(name, fn) {
    try {
        fn();
        testResults.passed++;
        console.log(`PASS ${name}`);
    } catch (err) {
        testResults.failed++;
        testResults.errors.push({ name, error: err.message });
        console.error(`FAIL ${name}: ${err.message}`);
        console.error(err.stack);
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

// ========== DELIMITER DETECTION TESTS ==========

test('detectDelimiter should detect Tab', () => {
    const text = 'Front\tBack\nQ1\tA1\nQ2\tA2';
    assertEqual(detectDelimiter(text), '\t');
});

test('detectDelimiter should detect Comma', () => {
    const text = 'Front,Back\nQ1,A1\nQ2,A2';
    assertEqual(detectDelimiter(text), ',');
});

test('detectDelimiter should detect Semicolon', () => {
    const text = 'Front;Back\nQ1;A1\nQ2;A2';
    assertEqual(detectDelimiter(text), ';');
});

test('detectDelimiter should detect Pipe', () => {
    const text = 'Front|Back\nQ1|A1\nQ2|A2';
    assertEqual(detectDelimiter(text), '|');
});

// ========== MARKDOWN TABLE TESTS ==========

test('parseMarkdownTable should parse a standard table', () => {
    const text = `
| Front | Back |
|-------|------|
| Red   | Rojo |
| Blue  | Azul |
`;
    const result = parseMarkdownTable(text);
    assert(result.length === 2);
    assertEqual(result[0].front, 'Red');
    assertEqual(result[0].back, 'Rojo');
});

// ========== SIMPLE Q&A TESTS ==========

test('parseSimpleQA should parse Q: A: format', () => {
    const text = `
Q: What is the capital of France?
A: Paris

Question: What is 2+2?
Answer: 4
`;
    const result = parseSimpleQA(text);
    assert(result.length === 2);
    assertEqual(result[0].front, 'What is the capital of France?');
    assertEqual(result[0].back, 'Paris');
});

test('parseSimpleQA should parse alternating lines', () => {
    const text = `
Apple
Manzana

Banana
Platano
`;
    const result = parseSimpleQA(text);
    assert(result.length === 2);
    assertEqual(result[0].front, 'Apple');
    assertEqual(result[0].back, 'Manzana');
});

// ========== MAIN PARSER TESTS ==========

test('parseImportText should handle CSV with basic cards', () => {
    const text = 'Question,Answer\nWhat is 1+1,2\nWhat is 2+2,4';
    const { cards } = parseImportText(text);
    assertEqual(cards.length, 2);
    assertEqual(cards[0].question, 'What is 1+1');
    assertEqual(cards[0].answer, '2');
});

test('parseImportText should handle TSV with basic cards', () => {
    const text = 'Front\tBack\nApple\tManzana';
    const { cards } = parseImportText(text);
    assertEqual(cards.length, 1);
    assertEqual(cards[0].question, 'Apple');
});

test('parseImportText should handle Cloze typeHint', () => {
    const text = 'The capital of France is {{c1::Paris}}.';
    const { cards } = parseImportText(text, { typeHint: 'Cloze' });
    assertEqual(cards.length, 1);
    assertEqual(cards[0].cardType, CARD_TYPES.CLOZE);
    assertEqual(cards[0].answer, 'Paris');
});

test('parseImportText should detect Cloze automatically', () => {
    const text = 'Front,Back\n"The {{c1::cat}} sat on the mat.",animal';
    const { cards } = parseImportText(text);
    assertEqual(cards.length, 1);
    assertEqual(cards[0].cardType, CARD_TYPES.CLOZE);
});

test('parseImportText should handle Basic Reversed', () => {
    const text = 'Front,Back,Type\nHello,Bonjour,basic_reversed';
    const { cards } = parseImportText(text);
    assertEqual(cards.length, 2);
    assertEqual(cards[0].question, 'Hello');
    assertEqual(cards[0].answer, 'Bonjour');
    assertEqual(cards[1].question, 'Bonjour');
    assertEqual(cards[1].answer, 'Hello');
});

test('parseImportText should handle Optional Reversed', () => {
    const text = 'Front,Back,Type,AddReverse\nTable,Mesa,basic_optional_reversed,y\nChair,Silla,basic_optional_reversed,';
    const { cards } = parseImportText(text);
    assertEqual(cards.length, 3); // 2 for Table (fwd+rev), 1 for Chair (fwd)
});

test('parseImportText should handle Basic Type-in-Answer', () => {
    const text = 'Front,Back,Type\nTypeThis,Answer,basic_type_answer';
    const { cards } = parseImportText(text);
    assertEqual(cards.length, 1);
    assertEqual(cards[0].cardType, CARD_TYPES.BASIC_TYPE_ANSWER);
});

test('parseImportText should handle Sequence typeHint', () => {
    const text = 'My Sequence\tStep 1\tNote 1\nMy Sequence\tStep 2\tNote 2';
    const { cards, sequenceMeta } = parseImportText(text, { typeHint: 'Sequence' });
    assertEqual(cards.length, 2);
    const metaIds = Object.keys(sequenceMeta);
    assertEqual(metaIds.length, 1);
    assertEqual(sequenceMeta[metaIds[0]].title, 'My Sequence');
    assertEqual(cards[0].sequenceId, metaIds[0]);
    assertEqual(cards[0].stepIndex, 0);
});

test('parseImportText should handle JSON input', () => {
    const deck = {
        cards: [
            { front: 'J1', back: 'A1' },
            { front: 'J2', back: 'A2' }
        ]
    };
    const { cards } = parseImportText(JSON.stringify(deck));
    assertEqual(cards.length, 2);
    assertEqual(cards[0].question, 'J1');
});

test('parseImportText should handle every conceivable separator if prompted', () => {
    const separators = [',', ';', '|', '\t'];
    separators.forEach(sep => {
        const text = `Front${sep}Back\nQ1${sep}A1`;
        const { cards } = parseImportText(text);
        assertEqual(cards.length, 1, `Failed for separator [${sep}]`);
        assertEqual(cards[0].question, 'Q1');
    });
});

console.log(`\nTests completed: ${testResults.passed} passed, ${testResults.failed} failed.`);
if (testResults.failed > 0) {
    process.exit(1);
}
