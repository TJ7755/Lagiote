import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach, afterEach, afterAll } from 'vitest';
import { initDB, closeDB, saveDataToDB, getDataFromDB } from '../../js/core/db.js';
import { gradeQuestion, gradeAndStoreQuestion } from '../../js/core/exam/marking.js';

const DB_NAME = 'LagioteDB';

function deleteDatabase() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.deleteDatabase(DB_NAME);
        request.onsuccess = () => resolve();
        request.onerror = event => reject(event.target.error || new Error('Failed to delete database'));
        request.onblocked = () => resolve();
    });
}

let sampleResult = null;

beforeEach(async () => {
    closeDB();
    await deleteDatabase();
});

afterEach(async () => {
    closeDB();
    await deleteDatabase();
});

describe('exam engine mark scheme grading', () => {
    it('grades mcq_single deterministically', () => {
        const question = { id: 'q_mcq_single', type: 'mcq_single', options: ['A', 'B', 'C'] };
        const markScheme = {
            schemeType: 'points',
            points: [
                {
                    id: 'A1',
                    marks: 1,
                    grading: { kind: 'mcq_single', correctIndices: [1] }
                }
            ]
        };
        const correct = gradeQuestion({ question, markScheme, response: { selectedIndex: 1 } });
        expect(correct.totalAwardedMarks).toBe(1);
        expect(correct.awardedPoints[0].awardedMarks).toBe(1);
        expect(correct.confidence).toBe('high');

        const incorrect = gradeQuestion({ question, markScheme, response: { selectedIndex: 0 } });
        expect(incorrect.totalAwardedMarks).toBe(0);

        sampleResult = correct;
    });

    it('grades mcq_multi all-or-nothing', () => {
        const question = { id: 'q_mcq_multi', type: 'mcq_multi', options: ['A', 'B', 'C', 'D'] };
        const markScheme = {
            schemeType: 'points',
            points: [
                {
                    id: 'A1',
                    marks: 2,
                    grading: { kind: 'mcq_multi', correctIndices: [1, 3] }
                }
            ]
        };
        const correct = gradeQuestion({ question, markScheme, response: { selectedIndices: [1, 3] } });
        expect(correct.totalAwardedMarks).toBe(2);

        const incorrect = gradeQuestion({ question, markScheme, response: { selectedIndices: [1] } });
        expect(incorrect.totalAwardedMarks).toBe(0);
    });

    it('grades mcq_multi with partial credit', () => {
        const question = { id: 'q_mcq_partial', type: 'mcq_multi', options: ['A', 'B', 'C', 'D'] };
        const markScheme = {
            schemeType: 'points',
            points: [
                {
                    id: 'A1',
                    marks: 2,
                    grading: {
                        kind: 'mcq_multi',
                        correctIndices: [1, 3],
                        mode: 'partial',
                        partialCredit: {
                            perCorrect: 1,
                            perIncorrect: 1,
                            min: 0,
                            max: 2
                        }
                    }
                }
            ]
        };
        const partial = gradeQuestion({ question, markScheme, response: { selectedIndices: [1] } });
        expect(partial.totalAwardedMarks).toBe(1);

        const penalized = gradeQuestion({ question, markScheme, response: { selectedIndices: [1, 2] } });
        expect(penalized.totalAwardedMarks).toBe(0);
    });

    it('grades numeric questions with tolerance', () => {
        const question = { id: 'q_numeric', type: 'numeric' };
        const markScheme = {
            schemeType: 'points',
            points: [
                {
                    id: 'N1',
                    marks: 1,
                    grading: { kind: 'numeric', value: 10, toleranceAbs: 0.5 }
                }
            ]
        };
        const correct = gradeQuestion({ question, markScheme, response: { value: 10.4 } });
        expect(correct.totalAwardedMarks).toBe(1);

        const incorrect = gradeQuestion({ question, markScheme, response: { value: 10.6 } });
        expect(incorrect.totalAwardedMarks).toBe(0);
    });

    it('grades short_text questions with normalisation', () => {
        const question = { id: 'q_short_text', type: 'short_text' };
        const markScheme = {
            schemeType: 'points',
            points: [
                {
                    id: 'S1',
                    marks: 1,
                    grading: { kind: 'short_text', accepted: ['photosynthesis'] }
                }
            ]
        };
        const correct = gradeQuestion({ question, markScheme, response: { text: '  PhotoSynthesIs ' } });
        expect(correct.totalAwardedMarks).toBe(1);
    });

    it('gates points using requires[]', () => {
        const question = { id: 'q_requires', type: 'mcq_single', options: ['A', 'B'] };
        const markScheme = {
            schemeType: 'points',
            points: [
                {
                    id: 'M1',
                    marks: 1,
                    grading: { kind: 'mcq_single', correctIndices: [0] }
                },
                {
                    id: 'A1',
                    marks: 1,
                    requires: ['M1'],
                    grading: { kind: 'mcq_single', correctIndices: [1] }
                }
            ]
        };
        const result = gradeQuestion({ question, markScheme, response: { selectedIndex: 1 } });
        const m1 = result.awardedPoints.find(point => point.pointId === 'M1');
        const a1 = result.awardedPoints.find(point => point.pointId === 'A1');
        expect(m1.awardedMarks).toBe(0);
        expect(a1.awardedMarks).toBe(0);
    });

    it('stores marking records in IndexedDB', async () => {
        await initDB();
        await saveDataToDB('questions', {
            id: 'q_db',
            type: 'mcq_single',
            options: ['A', 'B'],
            markSchemeId: 'ms_db'
        });
        await saveDataToDB('markSchemes', {
            id: 'ms_db',
            schemeType: 'points',
            points: [
                {
                    id: 'A1',
                    marks: 1,
                    grading: { kind: 'mcq_single', correctIndices: [1] }
                }
            ]
        });

        const record = await gradeAndStoreQuestion({
            examSittingId: 'sitting_1',
            questionId: 'q_db',
            response: { selectedIndex: 1 }
        });
        const stored = await getDataFromDB('markingRecords', record.id);
        expect(stored).toBeTruthy();
        expect(stored.totalAwardedMarks).toBe(1);
        expect(stored.version).toBe(1);
        expect(typeof stored.createdAt).toBe('string');
        expect(typeof stored.updatedAt).toBe('string');
    });

    it('does not affect legacy exam decks', async () => {
        await initDB();
        await saveDataToDB('decks', { id: 'deck_legacy', name: 'Legacy Deck', cards: [] });
        await saveDataToDB('questions', {
            id: 'q_deck',
            type: 'mcq_single',
            options: ['A', 'B'],
            markSchemeId: 'ms_deck'
        });
        await saveDataToDB('markSchemes', {
            id: 'ms_deck',
            schemeType: 'points',
            points: [
                {
                    id: 'A1',
                    marks: 1,
                    grading: { kind: 'mcq_single', correctIndices: [0] }
                }
            ]
        });

        await gradeAndStoreQuestion({
            examSittingId: 'sitting_legacy',
            questionId: 'q_deck',
            response: { selectedIndex: 0 }
        });

        const deck = await getDataFromDB('decks', 'deck_legacy');
        expect(deck).toBeTruthy();
        expect(deck.name).toBe('Legacy Deck');
    });
});

afterAll(async () => {
    if (!sampleResult) {
        sampleResult = gradeQuestion({
            question: { id: 'q_sample', type: 'mcq_single', options: ['A', 'B'] },
            markScheme: {
                schemeType: 'points',
                points: [
                    {
                        id: 'A1',
                        marks: 1,
                        grading: { kind: 'mcq_single', correctIndices: [0] }
                    }
                ]
            },
            response: { selectedIndex: 0 }
        });
    }
    console.log(`[Exam Marking] awardedPoints=${sampleResult.awardedPoints.length}`);
    console.log(`[Exam Marking] confidence=${sampleResult.confidence}`);

    closeDB();
    await deleteDatabase();
});
