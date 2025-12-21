import { strict as assert } from 'assert';
import { normaliseText, stableHash, computeCardFingerprint, checkAndUpdateFingerprint } from '../js/core/eval-integrity.js';

console.log('Running eval-integrity tests...');

// Mock store
const mockStore = new Map();
const mockLoadFingerprint = async (userID, cardId) => mockStore.get(`${userID}:${cardId}`);
const mockSaveFingerprint = async (userID, cardId, data) => mockStore.set(`${userID}:${cardId}`, data);

// Override imports in eval-integrity (not possible with ESM easily without dependency injection or mocking framework)
// So we will test the pure functions and the logic flow if possible.
// Since checkAndUpdateFingerprint imports from eval-store, we can't easily mock it in this environment without a bundler or loader hooks.
// However, we can test the pure functions.

// Test normaliseText
{
    assert.equal(normaliseText('  Hello   World!  '), 'hello world');
    assert.equal(normaliseText('UPPER case'), 'upper case');
    assert.equal(normaliseText('Punctuation... removed?'), 'punctuation removed');
    console.log('normaliseText passed');
}

// Test stableHash
{
    const h1 = stableHash('hello world');
    const h2 = stableHash('hello world');
    const h3 = stableHash('hello world 2');
    assert.equal(h1, h2);
    assert.notEqual(h1, h3);
    console.log('stableHash passed');
}

// Test computeCardFingerprint
{
    const card1 = { question: 'Q1', answer: 'A1', deckId: 'd1' };
    const card2 = { front: 'Q1', back: 'A1', deckId: 'd1' }; // Different prop names, handled?
    // The implementation uses front/back OR question/answer.
    
    const f1 = computeCardFingerprint(card1);
    const f2 = computeCardFingerprint(card2);
    assert.equal(f1, f2);
    
    const card3 = { question: 'Q1 ', answer: 'A1', deckId: 'd1' }; // Minor whitespace
    const f3 = computeCardFingerprint(card3);
    assert.equal(f1, f3);
    
    const card4 = { question: 'Q2', answer: 'A1', deckId: 'd1' }; // Different content
    const f4 = computeCardFingerprint(card4);
    assert.notEqual(f1, f4);
    
    console.log('computeCardFingerprint passed');
}

console.log('All eval-integrity tests passed!');
