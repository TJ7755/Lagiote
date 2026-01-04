import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach, afterEach, afterAll } from 'vitest';
import {
    initDB,
    getDB,
    closeDB,
    saveDataToDB,
    getDataFromDB,
    softDeleteRecord,
    exportFullData,
    importFullData
} from '../../js/core/db.js';

const DB_NAME = 'LagioteDB';
const EXAM_ENGINE_STORES = [
    'atoms',
    'errorAtoms',
    'questions',
    'markSchemes',
    'examSpecs',
    'examPapers',
    'examSittings',
    'markingRecords',
    'contentRevisions'
];

function deleteDatabase() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.deleteDatabase(DB_NAME);
        request.onsuccess = () => resolve();
        request.onerror = event => reject(event.target.error || new Error('Failed to delete database'));
        request.onblocked = () => resolve();
    });
}

function isIsoString(value) {
    return typeof value === 'string' && Number.isFinite(Date.parse(value));
}

const baseAtom = {
    id: 'atom_test',
    title: 'x',
    type: 'knowledge',
    mastery: 0.2,
    stabilityDays: 1,
    difficulty: 0.5,
    depth: 0.2,
    fragility: 0.5,
    transferability: 0.5,
    timeSensitivity: 0.5,
    prerequisites: [],
    tags: []
};

beforeEach(async () => {
    closeDB();
    await deleteDatabase();
});

afterEach(async () => {
    closeDB();
    await deleteDatabase();
});

describe('exam engine versioning and backup compatibility', () => {
    it('adds metadata and increments version on writes', async () => {
        await initDB();
        await saveDataToDB('atoms', baseAtom);

        const first = await getDataFromDB('atoms', baseAtom.id);
        expect(first.version).toBe(1);
        expect(isIsoString(first.createdAt)).toBe(true);
        expect(isIsoString(first.updatedAt)).toBe(true);
        expect(first.isDeleted).toBe(false);
        expect(first.deletedAt).toBe(null);

        const createdAt = first.createdAt;
        const updatedAt = first.updatedAt;

        await saveDataToDB('atoms', { ...baseAtom, title: 'x2' });

        const second = await getDataFromDB('atoms', baseAtom.id);
        expect(second.version).toBe(2);
        expect(second.createdAt).toBe(createdAt);
        expect(new Date(second.updatedAt).getTime()).toBeGreaterThanOrEqual(new Date(updatedAt).getTime());
    });

    it('soft deletes records with tombstones', async () => {
        await initDB();
        await saveDataToDB('atoms', baseAtom);
        await saveDataToDB('atoms', { ...baseAtom, title: 'x2' });

        await softDeleteRecord('atoms', baseAtom.id);
        const deleted = await getDataFromDB('atoms', baseAtom.id);
        expect(deleted).toBeTruthy();
        expect(deleted.isDeleted).toBe(true);
        expect(isIsoString(deleted.deletedAt)).toBe(true);
        expect(deleted.version).toBe(3);
    });

    it('normalizes question atomIds for indexing', async () => {
        await initDB();
        await saveDataToDB('questions', {
            id: 'question_1',
            atomMap: [{ atomId: 'a', weight: 1 }]
        });
        const question = await getDataFromDB('questions', 'question_1');
        expect(Array.isArray(question.atomIds)).toBe(true);
        expect(question.atomIds.length).toBe(1);
        expect(question.atomIds[0]).toBe('a');
    });

    it('exports exam engine data with metadata', async () => {
        await initDB();
        await saveDataToDB('atoms', baseAtom);

        const exportData = await exportFullData();
        expect(typeof exportData.exportSchemaVersion).toBe('number');
        expect(isIsoString(exportData.exportedAt)).toBe(true);
        expect(exportData.examEngine).toBeTruthy();

        EXAM_ENGINE_STORES.forEach(storeName => {
            expect(Array.isArray(exportData.examEngine[storeName])).toBe(true);
        });
    });

    it('imports legacy backups without exam engine data', async () => {
        await initDB();
        await saveDataToDB('decks', { id: 'deck_legacy', name: 'Legacy Deck', cards: [] });
        const exportData = await exportFullData();
        const legacyBackup = {
            decks: exportData.decks,
            knowledgeStates: exportData.knowledgeStates,
            interactionLogs: exportData.interactionLogs,
            examPlans: exportData.examPlans,
            settings: exportData.settings,
            analytics: exportData.analytics
        };

        closeDB();
        await deleteDatabase();
        await initDB();
        await importFullData(legacyBackup);

        const restored = await getDataFromDB('decks', 'deck_legacy');
        expect(restored).toBeTruthy();
        expect(restored.name).toBe('Legacy Deck');
    });

    it('normalizes imported exam engine records without metadata', async () => {
        await initDB();
        const backup = {
            examEngine: {
                atoms: [
                    {
                        id: 'atom_import',
                        title: 'Imported Atom',
                        type: 'knowledge',
                        mastery: 0.1,
                        stabilityDays: 1,
                        difficulty: 0.4,
                        depth: 0.2,
                        fragility: 0.6,
                        transferability: 0.5,
                        timeSensitivity: 0.5,
                        prerequisites: [],
                        tags: []
                    }
                ],
                errorAtoms: [],
                questions: [],
                markSchemes: [],
                examSpecs: [],
                examPapers: [],
                examSittings: [],
                markingRecords: [],
                contentRevisions: []
            }
        };

        await importFullData(backup);
        const imported = await getDataFromDB('atoms', 'atom_import');
        expect(imported).toBeTruthy();
        expect(imported.version).toBe(1);
        expect(isIsoString(imported.createdAt)).toBe(true);
        expect(isIsoString(imported.updatedAt)).toBe(true);
        expect(imported.isDeleted).toBe(false);
        expect(imported.deletedAt).toBe(null);
    });

    it('resolves import conflicts using version precedence', async () => {
        await initDB();
        await saveDataToDB('atoms', {
            ...baseAtom,
            id: 'atom_conflict',
            title: 'Local Atom',
            version: 5,
            createdAt: '2024-01-01T00:00:00.000Z',
            updatedAt: '2024-01-01T00:00:00.000Z',
            isDeleted: false,
            deletedAt: null
        });

        await importFullData({
            examEngine: {
                atoms: [{ id: 'atom_conflict', title: 'Incoming Low', version: 3 }],
                errorAtoms: [],
                questions: [],
                markSchemes: [],
                examSpecs: [],
                examPapers: [],
                examSittings: [],
                markingRecords: [],
                contentRevisions: []
            }
        });

        const afterLow = await getDataFromDB('atoms', 'atom_conflict');
        expect(afterLow.title).toBe('Local Atom');
        expect(afterLow.version).toBe(5);

        await importFullData({
            examEngine: {
                atoms: [{ id: 'atom_conflict', title: 'Incoming High', version: 6 }],
                errorAtoms: [],
                questions: [],
                markSchemes: [],
                examSpecs: [],
                examPapers: [],
                examSittings: [],
                markingRecords: [],
                contentRevisions: []
            }
        });

        const afterHigh = await getDataFromDB('atoms', 'atom_conflict');
        expect(afterHigh.title).toBe('Incoming High');
        expect(afterHigh.version).toBe(6);
    });
});

afterAll(async () => {
    closeDB();
    await deleteDatabase();
    await initDB();
    await saveDataToDB('atoms', { ...baseAtom, id: 'atom_summary' });

    const db = getDB();
    const atom = await getDataFromDB('atoms', 'atom_summary');
    const storeNames = Array.from(db.objectStoreNames).filter(name => EXAM_ENGINE_STORES.includes(name));

    console.log(`[Exam M1.2] exam-engine stores: ${storeNames.join(', ')}`);
    console.log(`[Exam M1.2] atom version=${atom.version} isDeleted=${atom.isDeleted}`);

    closeDB();
    await deleteDatabase();
});
