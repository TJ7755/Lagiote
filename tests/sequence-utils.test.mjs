import assert from 'assert';

globalThis.window = {};
await import('../js/core/sequence-utils.js');

const utils = globalThis.window.sequenceStepUtils || {};
const { adaptLegacySequenceDeck } = utils;

function testLegacySequenceStepText() {
    assert.strictEqual(typeof adaptLegacySequenceDeck, 'function');
    const deck = {
        id: 'legacy-sequence',
        sequenceSteps: ['Stage One', 'Stage Two', 'Stage Three'],
        cards: []
    };
    const result = adaptLegacySequenceDeck(deck);
    assert.strictEqual(result.cards.length, 3);
    result.cards.forEach((card, idx) => {
        const expected = deck.sequenceSteps[idx];
        assert.ok(card.question && card.question.trim().length > 0);
        assert.strictEqual(card.question, expected);
    });
    console.log('legacy sequence step text passed');
}

function run() {
    testLegacySequenceStepText();
    console.log('All sequence utils tests passed.');
}

run();
