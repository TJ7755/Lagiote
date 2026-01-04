import { describe, it, expect } from 'vitest';
import { buildPracticeTestBlueprint, getPracticeTestModeFlags, flattenTestForm, appendPracticeTestAttempt } from '../../js/core/practice-test-runtime.js';
import { generateTestForm } from '../../js/core/test-form.js';

const decks = {
    deckA: {
        id: 'deckA',
        name: 'Deck A',
        cards: [
            { id: 'a1', question: 'Q1', answer: 'A1', options: ['X', 'Y', 'Z'] },
            { id: 'a2', question: 'Q2', answer: 'A2', options: ['X', 'Y', 'Z'] },
            { id: 'a3', question: 'Q3', answer: 'A3', options: ['X', 'Y', 'Z'] },
            { id: 'a4', question: 'Q4', answer: 'A4', options: ['X', 'Y', 'Z'] },
            { id: 'a5', question: 'Q5', answer: 'A5', options: ['X', 'Y', 'Z'] },
            { id: 'a6', question: 'Q6', answer: 'A6', options: ['X', 'Y', 'Z'] }
        ]
    },
    deckB: {
        id: 'deckB',
        name: 'Deck B',
        cards: [
            { id: 'b1', question: 'Q7', answer: 'A7', options: ['X', 'Y', 'Z'] },
            { id: 'b2', question: 'Q8', answer: 'A8', options: ['X', 'Y', 'Z'] },
            { id: 'b3', question: 'Q9', answer: 'A9', options: ['X', 'Y', 'Z'] },
            { id: 'b4', question: 'Q10', answer: 'A10', options: ['X', 'Y', 'Z'] }
        ]
    }
};

describe('practice test invariants', () => {
    it('builds a deterministic blueprint and form', async () => {
        const blueprint = buildPracticeTestBlueprint({ deckId: 'deckA', questionCount: 6, durationMinutes: 30 });
        const form = await generateTestForm(blueprint, decks, {}, 'user');
        expect(form.sections.length).toBeGreaterThan(0);
        expect(form.totalMarks).toBeGreaterThan(0);

        const flat = flattenTestForm(form);
        expect(flat.length).toBeGreaterThan(0);
        expect(flat.length).toBe(6);
        const ids = new Set(flat.map(item => item.cardId));
        expect(ids.size).toBe(flat.length);
    });

    it('respects mode flags for practice test presets', () => {
        const examFlags = getPracticeTestModeFlags('exam_indicative');
        const freeFlags = getPracticeTestModeFlags('free_practice');
        expect(examFlags.allowFeedback).toBe(false);
        expect(examFlags.submitOnSelect).toBe(true);
        expect(examFlags.submitLabel).toBe('Submit Answer');
        expect(freeFlags.allowFeedback).toBe(true);
        expect(freeFlags.submitOnSelect).toBe(false);
        expect(freeFlags.submitLabel).toBe('Check Answer');
    });

    it('caps stored attempts without losing newest entries', () => {
        const attempts = Array.from({ length: 55 }, (_, idx) => ({
            id: `attempt-${idx}`,
            form: { sections: [] }
        }));
        const updated = appendPracticeTestAttempt({ key: 'practiceTestAttempts', attempts: [] }, {
            id: 'latest',
            form: { sections: [] }
        }, 50);
        const merged = appendPracticeTestAttempt({ key: updated.key, attempts: attempts }, {
            id: 'newest',
            form: { sections: [] }
        }, 50);
        expect(merged.attempts.length).toBe(50);
        expect(merged.attempts[0].id).toBe('newest');
    });
});
