import assert from 'assert';
import { levenshteinDistance, shuffleArray, getQueryParam, calculateIQS } from '../js/core/utils.js';

function testLevenshtein() {
    assert.strictEqual(levenshteinDistance('kitten', 'sitting'), 3);
    assert.strictEqual(levenshteinDistance('flaw', 'lawn'), 2);
    assert.strictEqual(levenshteinDistance('', ''), 0);
    console.log('levenshteinDistance passed');
}

function testShuffle() {
    const arr = [1, 2, 3, 4, 5];
    const shuffled = shuffleArray(arr);
    assert.strictEqual(arr.length, shuffled.length);
    assert.deepStrictEqual(arr.sort(), [...shuffled].sort());
    console.log('shuffleArray passed');
}

function testGetQueryParam() {
    const val = getQueryParam('deckId', '?deckId=abc123&mode=review');
    assert.strictEqual(val, 'abc123');
    console.log('getQueryParam passed');
}

function testIQS() {
    const score = calculateIQS({ recallLatency: 1000, answerFluency: 12, totalCorrections: 0, attemptCount: 1 });
    assert.ok(score >= 0 && score <= 1);
    console.log('calculateIQS passed');
}

function run() {
    testLevenshtein();
    testShuffle();
    testGetQueryParam();
    testIQS();
    console.log('All utils tests passed.');
}

run();
