import { describe, it, expect, beforeAll } from 'vitest';
import { hashSequenceSteps } from '../../js/core/sequence-graph.js';

beforeAll(async () => {
    globalThis.window = {};
    await import('../../js/core/sequence-utils.js');
});

describe('sequence legacy adaptation', () => {
    it('adapts legacy sequence decks without metadata', () => {
        const legacy = {
            name: 'Legacy Sequence',
            sequenceSteps: ['Step One', 'Step Two', 'Step Three'],
            cards: []
        };
        const { deck, cards, migrated } = window.sequenceStepUtils.adaptLegacySequenceDeck(legacy);
        expect(migrated).toBe(true);
        expect(deck.typeHint).toBe('Sequence');
        expect(cards.length).toBe(3);
        expect(cards[0].order).toBe(1);
        expect(cards[1].order).toBe(2);
        expect(cards[2].order).toBe(3);
    });

    it('hash remains stable for identical step ordering', () => {
        const steps = [
            { question: 'A', answer: 'A' },
            { question: 'B', answer: 'B' },
            { question: 'C', answer: 'C' }
        ];
        const first = hashSequenceSteps(steps);
        const second = hashSequenceSteps(steps);
        expect(second).toBe(first);
    });
});
