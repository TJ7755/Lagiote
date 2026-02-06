import { describe, it, expect, vi } from 'vitest';
import { pickNextCard } from '../../js/core/cortex.js';

describe('cortex picker invariants', () => {
    it('returns queued cards with intent when present', async () => {
        const candidates = [
            { id: 'a', question: 'A', deckId: 'deck' },
            { id: 'b', question: 'B', deckId: 'deck' }
        ];
        const deck = { settings: {} };
        const sessionState = {
            queue: [{ id: 'b', intent: 'session-queue' }]
        };
        const knowledgeStates = new Map();

        const picked = await pickNextCard(candidates, sessionState, deck, knowledgeStates);
        expect(picked.id).toBe('b');
        expect(picked._sessionIntent).toBe('session-queue');
    });

    it('falls back to scoring when queue has no valid card', async () => {
        const candidates = [
            { id: 'a', question: 'A', deckId: 'deck' },
            { id: 'b', question: 'B', deckId: 'deck' }
        ];
        const deck = { settings: {} };
        const sessionState = {
            queue: ['missing-id'],
            sessionAccuracyRecent: 0.5,
            sessionMeanLatency: 2500,
            sessionMeanCorrections: 1,
            sessionMeanFluency: 3,
            sessionCardsSeen: 0,
            sessionUniqueCardsSeen: 0,
            recentCards: [],
            recentOutcomes: [],
            cardMetrics: new Map(),
            uniqueCardIds: new Set()
        };
        const knowledgeStates = new Map();

        const picked = await pickNextCard(candidates, sessionState, deck, knowledgeStates);
        expect(picked).toBeTruthy();
        expect(candidates.map(card => card.id)).toContain(picked.id);
        expect(picked._sessionIntent).toBe('scheduler-auto');
    });

    it('skips cards on cooldown when other candidates are ready', async () => {
        const candidates = [
            { id: 'a', question: 'A', deckId: 'deck' },
            { id: 'b', question: 'B', deckId: 'deck' }
        ];
        const deck = { settings: {} };
        const sessionState = {
            sessionAccuracyRecent: 0.5,
            sessionMeanLatency: 2500,
            sessionMeanCorrections: 1,
            sessionMeanFluency: 3,
            sessionCardsSeen: 0,
            sessionUniqueCardsSeen: 0,
            recentCards: [],
            recentOutcomes: [],
            cardMetrics: new Map([
                ['a', { cooldownRemaining: 2 }],
                ['b', { cooldownRemaining: 0 }]
            ]),
            uniqueCardIds: new Set()
        };
        const knowledgeStates = new Map();

        const picked = await pickNextCard(candidates, sessionState, deck, knowledgeStates);
        expect(picked.id).toBe('b');
    });

    it('randomizes ties when scores match', async () => {
        const candidates = [
            { id: 'a', question: 'A', deckId: 'deck' },
            { id: 'b', question: 'B', deckId: 'deck' }
        ];
        const deck = { settings: {} };
        const sessionState = {
            sessionAccuracyRecent: 0.5,
            sessionMeanLatency: 2500,
            sessionMeanCorrections: 1,
            sessionMeanFluency: 3,
            sessionCardsSeen: 0,
            sessionUniqueCardsSeen: 0,
            recentCards: [],
            recentOutcomes: [],
            cardMetrics: new Map(),
            uniqueCardIds: new Set()
        };
        const knowledgeStates = new Map();

        const randomSpy = vi.spyOn(Math, 'random').mockReturnValue(0.1);
        const picked = await pickNextCard(candidates, sessionState, deck, knowledgeStates);
        randomSpy.mockRestore();

        expect(picked.id).toBe('b');
    });
});
