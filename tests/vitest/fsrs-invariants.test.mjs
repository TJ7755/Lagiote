import { describe, it, expect } from 'vitest';
import { FSRSAlgorithm } from '../../js/core/fsrs.js';

describe('fsrs invariants', () => {
    it('stability and interval increase with stronger ratings', async () => {
        const fsrs = new FSRSAlgorithm();
        const now = new Date('2024-01-01T00:00:00Z');
        const base = fsrs.prepareCard({ fsrs: { state: 0, stability: 1, difficulty: 5, reps: 0, lapses: 0 } });
        const result = await fsrs.repeat(base, now);
        const ratings = fsrs.getRatings();
        const again = result[ratings.Again].card;
        const good = result[ratings.Good].card;
        const easy = result[ratings.Easy].card;

        expect(good.stability).toBeGreaterThanOrEqual(again.stability);
        expect(easy.stability).toBeGreaterThanOrEqual(good.stability);
        expect(good.scheduled_days).toBeGreaterThanOrEqual(again.scheduled_days);
        expect(easy.scheduled_days).toBeGreaterThanOrEqual(good.scheduled_days);
    });

    it('difficulty trends down for successful reviews', async () => {
        const fsrs = new FSRSAlgorithm();
        const now = new Date('2024-01-01T00:00:00Z');
        const base = fsrs.prepareCard({ fsrs: { state: 1, stability: 2, difficulty: 8, reps: 3, lapses: 0 } });
        const result = await fsrs.repeat(base, now);
        const ratings = fsrs.getRatings();
        const again = result[ratings.Again].card;
        const good = result[ratings.Good].card;
        const easy = result[ratings.Easy].card;

        expect(good.difficulty).toBeLessThanOrEqual(again.difficulty);
        expect(easy.difficulty).toBeLessThanOrEqual(good.difficulty);
    });

    it('never produces negative intervals in random review sequences', async () => {
        const fsrs = new FSRSAlgorithm();
        let card = fsrs.prepareCard({ fsrs: { state: 0, stability: 1, difficulty: 5, reps: 0, lapses: 0 } });
        let now = new Date('2024-01-01T00:00:00Z');
        const ratings = Object.values(fsrs.getRatings());

        for (let i = 0; i < 20; i += 1) {
            const rating = ratings[i % ratings.length];
            const result = await fsrs.repeat(card, now);
            const next = result[rating]?.card || result.Good.card;
            const due = new Date(next.due);
            expect(next.scheduled_days).toBeGreaterThanOrEqual(0);
            expect(next.stability).toBeGreaterThan(0);
            expect(Number.isNaN(due.getTime())).toBe(false);
            card = next;
            now = new Date(next.due || now);
        }
    });

    it('advances due dates on successive good reviews', async () => {
        const fsrs = new FSRSAlgorithm();
        let now = new Date('2024-01-01T00:00:00Z');
        let card = fsrs.prepareCard({ fsrs: { state: 1, stability: 2, difficulty: 5, reps: 1, lapses: 0, last_review: now, due: now } });
        const ratings = fsrs.getRatings();

        for (let i = 0; i < 3; i += 1) {
            const result = await fsrs.repeat(card, now);
            const next = result[ratings.Good].card;
            const nextDue = new Date(next.due);
            expect(Number.isNaN(nextDue.getTime())).toBe(false);
            expect(nextDue.getTime()).toBeGreaterThanOrEqual(now.getTime());
            card = next;
            now = nextDue;
        }
    });
});
