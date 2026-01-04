import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { initDB, closeDB, saveDataToDB, getDataFromDB } from '../../js/core/db.js';
import { applyMarkingRecordToAtoms } from '../../js/core/exam/atom-updates.js';

const DB_NAME = 'LagioteDB';

function deleteDatabase() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.deleteDatabase(DB_NAME);
        request.onsuccess = () => resolve();
        request.onerror = event => reject(event.target.error || new Error('Failed to delete database'));
        request.onblocked = () => resolve();
    });
}

beforeEach(async () => {
    closeDB();
    await deleteDatabase();
    await initDB();
});

afterEach(async () => {
    closeDB();
    await deleteDatabase();
});

function baseQuestion() {
    return {
        id: 'q1',
        difficulty: 0.5,
        depth: 0.5,
        timeProfile: { pressure: 0 },
        variationProfile: {
            numbers: true,
            context: true,
            representation: true,
            wording: true
        },
        markSchemeId: 'ms1'
    };
}

function baseMarkScheme() {
    return {
        id: 'ms1',
        schemeType: 'points',
        points: [
            {
                id: 'P1',
                marks: 1,
                atomLinks: [{ atomId: 'A', weight: 1 }]
            }
        ]
    };
}

describe('exam engine atom updates', () => {
    it('increases mastery and stability on awarded points', async () => {
        await saveDataToDB('atoms', { id: 'A', mastery: 0.2, stabilityDays: 1, fragility: 0.8 });
        await saveDataToDB('questions', baseQuestion());
        await saveDataToDB('markSchemes', baseMarkScheme());
        await saveDataToDB('markingRecords', {
            id: 'MR1',
            questionId: 'q1',
            totalAwardedMarks: 1,
            confidence: 'high',
            awardedPoints: [{ pointId: 'P1', awardedMarks: 1 }]
        });

        const result = await applyMarkingRecordToAtoms({ markingRecordId: 'MR1' });
        const updated = await getDataFromDB('atoms', 'A');

        expect(updated.mastery).toBeGreaterThan(0.2);
        expect(updated.stabilityDays).toBeGreaterThan(1);
        expect(updated.fragility).toBeLessThan(0.8);
        console.log('atom-updates', result.deltasSummary, 'skipped', result.skipped);
    });

    it('decreases mastery and increases fragility on missed points', async () => {
        await saveDataToDB('atoms', { id: 'A', mastery: 0.6, stabilityDays: 3, fragility: 0.4 });
        await saveDataToDB('questions', baseQuestion());
        await saveDataToDB('markSchemes', baseMarkScheme());
        await saveDataToDB('markingRecords', {
            id: 'MR2',
            questionId: 'q1',
            totalAwardedMarks: 0,
            confidence: 'high',
            awardedPoints: [{ pointId: 'P1', awardedMarks: 0 }]
        });

        await applyMarkingRecordToAtoms({ markingRecordId: 'MR2' });
        const updated = await getDataFromDB('atoms', 'A');

        expect(updated.mastery).toBeLessThan(0.6);
        expect(updated.fragility).toBeGreaterThan(0.4);
        expect(updated.fragility).toBeLessThanOrEqual(1);
    });

    it('does not apply marking records twice', async () => {
        await saveDataToDB('atoms', { id: 'A', mastery: 0.3, stabilityDays: 2, fragility: 0.5 });
        await saveDataToDB('questions', baseQuestion());
        await saveDataToDB('markSchemes', baseMarkScheme());
        await saveDataToDB('markingRecords', {
            id: 'MR3',
            questionId: 'q1',
            totalAwardedMarks: 1,
            confidence: 'high',
            awardedPoints: [{ pointId: 'P1', awardedMarks: 1 }]
        });

        await applyMarkingRecordToAtoms({ markingRecordId: 'MR3' });
        const once = await getDataFromDB('atoms', 'A');
        const second = await applyMarkingRecordToAtoms({ markingRecordId: 'MR3' });
        const twice = await getDataFromDB('atoms', 'A');

        expect(second.skipped).toBe(true);
        expect(twice.mastery).toBeCloseTo(once.mastery, 6);
        expect(twice.stabilityDays).toBeCloseTo(once.stabilityDays, 6);
        expect(twice.fragility).toBeCloseTo(once.fragility, 6);
    });

    it('increases error atom risk when detected', async () => {
        await saveDataToDB('atoms', { id: 'A', mastery: 0.2, stabilityDays: 1, fragility: 0.8 });
        await saveDataToDB('questions', {
            ...baseQuestion(),
            timeProfile: { pressure: 0.4 }
        });
        await saveDataToDB('markSchemes', baseMarkScheme());
        await saveDataToDB('errorAtoms', { id: 'E1', risk: 0.2 });
        await saveDataToDB('markingRecords', {
            id: 'MR4',
            questionId: 'q1',
            totalAwardedMarks: 1,
            confidence: 'high',
            awardedPoints: [{ pointId: 'P1', awardedMarks: 1 }],
            detectedErrorAtomIds: ['E1']
        });

        await applyMarkingRecordToAtoms({ markingRecordId: 'MR4' });
        const updated = await getDataFromDB('errorAtoms', 'E1');

        expect(updated.risk).toBeGreaterThan(0.2);
    });

    it('leaves legacy decks untouched', async () => {
        const deck = { id: 'deck_legacy', name: 'Legacy Deck', cards: [] };
        await saveDataToDB('decks', deck);
        await saveDataToDB('atoms', { id: 'A', mastery: 0.2, stabilityDays: 1, fragility: 0.8 });
        await saveDataToDB('questions', baseQuestion());
        await saveDataToDB('markSchemes', baseMarkScheme());
        await saveDataToDB('markingRecords', {
            id: 'MR5',
            questionId: 'q1',
            totalAwardedMarks: 1,
            confidence: 'high',
            awardedPoints: [{ pointId: 'P1', awardedMarks: 1 }]
        });

        await applyMarkingRecordToAtoms({ markingRecordId: 'MR5' });
        const stored = await getDataFromDB('decks', 'deck_legacy');

        expect(stored).toEqual(deck);
    });
});
