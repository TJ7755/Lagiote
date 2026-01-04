import { describe, it, expect } from 'vitest';
import { predictMastery, effectiveMastery } from '../../js/core/exam/atom-dynamics.js';

const MS_PER_DAY = 24 * 60 * 60 * 1000;

describe('exam engine atom dynamics', () => {
    it('decays mastery monotonically over time', () => {
        const now = new Date(Date.UTC(2025, 0, 1));
        const atom = { mastery: 0.8, stabilityDays: 10 };

        const sameDay = predictMastery(atom, now, now);
        const day10 = predictMastery(atom, now, new Date(now.getTime() + 10 * MS_PER_DAY));
        const day20 = predictMastery(atom, now, new Date(now.getTime() + 20 * MS_PER_DAY));

        expect(sameDay).toBeCloseTo(0.8, 5);
        expect(day10).toBeLessThan(0.8);
        expect(day20).toBeLessThan(day10);
    });

    it('handles stability edge cases', () => {
        const now = new Date(Date.UTC(2025, 0, 1));
        const nextDay = new Date(now.getTime() + MS_PER_DAY);

        const zeroStability = predictMastery({ mastery: 0.7, stabilityDays: 0 }, now, nextDay);
        expect(zeroStability).toBe(0);

        const hugeStability = predictMastery({ mastery: 0.7, stabilityDays: 10000 }, now, nextDay);
        expect(hugeStability).toBeCloseTo(0.7, 3);
    });

    it('gates effective mastery using prerequisite caps', () => {
        const now = new Date(Date.UTC(2025, 0, 1));
        const atoms = {
            A: {
                id: 'A',
                mastery: 0.9,
                stabilityDays: 100,
                prerequisites: [{ atomId: 'B', weight: 1 }]
            },
            B: { id: 'B', mastery: 0.1, stabilityDays: 100 }
        };

        const result = effectiveMastery('A', atoms, now, now);
        expect(result.predicted).toBeCloseTo(0.9, 3);
        expect(result.cap).toBeCloseTo(0.28, 2);
        expect(result.effective).toBeCloseTo(Math.min(result.predicted, result.cap), 5);
        expect(result.effective).toBeLessThanOrEqual(result.cap);
    });

    it('uses weighted prerequisite means for caps', () => {
        const now = new Date(Date.UTC(2025, 0, 1));
        const atoms = {
            A: {
                id: 'A',
                mastery: 0.9,
                stabilityDays: 100,
                prerequisites: [
                    { atomId: 'B', weight: 0.75 },
                    { atomId: 'C', weight: 0.25 }
                ]
            },
            B: { id: 'B', mastery: 0.2, stabilityDays: 100 },
            C: { id: 'C', mastery: 0.8, stabilityDays: 100 }
        };

        const result = effectiveMastery('A', atoms, now, now);
        expect(result.prereqScore).toBeCloseTo(0.35, 2);
        expect(result.cap).toBeCloseTo(0.48, 2);
        expect(result.effective).toBeCloseTo(0.48, 2);
    });

    it('avoids infinite recursion with cyclic prerequisites', () => {
        const now = new Date(Date.UTC(2025, 0, 1));
        const atoms = {
            A: {
                id: 'A',
                mastery: 0.6,
                stabilityDays: 100,
                prerequisites: [{ atomId: 'B', weight: 1 }]
            },
            B: {
                id: 'B',
                mastery: 0.4,
                stabilityDays: 100,
                prerequisites: [{ atomId: 'A', weight: 1 }]
            }
        };

        const result = effectiveMastery('A', atoms, now, now);
        expect(Number.isFinite(result.effective)).toBe(true);
        expect(result.effective).toBeGreaterThanOrEqual(0);
        expect(result.effective).toBeLessThanOrEqual(1);
        console.log('atom-dynamics sample', result);
    });
});
