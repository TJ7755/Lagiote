import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach, afterEach, afterAll } from 'vitest';
import { initDB, getDB, closeDB } from '../../js/core/db.js';

const DB_NAME = 'LagioteDB';

const expectedStores = [
    'decks',
    'appData',
    'interactionLogs',
    'analyticsQueue',
    'concepts',
    'examPlans',
    'cortexTrainingData',
    'userKnowledgeState',
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

function openLegacyV12Database() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, 12);
        request.onupgradeneeded = event => {
            const db = event.target.result;
            const deckStore = db.createObjectStore('decks', { keyPath: 'id' });
            deckStore.createIndex('by_user', 'userID', { unique: false });
            db.createObjectStore('appData', { keyPath: 'key' });
            const logStore = db.createObjectStore('interactionLogs', { keyPath: 'id', autoIncrement: true });
            logStore.createIndex('by_cardID', 'cardID', { unique: false });
            logStore.createIndex('by_timestamp', 'timestamp', { unique: false });
            db.createObjectStore('analyticsQueue', { keyPath: 'id' });
            db.createObjectStore('concepts', { keyPath: 'conceptID' });
            db.createObjectStore('examPlans', { keyPath: 'id' });
            const trainingStore = db.createObjectStore('cortexTrainingData', { keyPath: 'id', autoIncrement: true });
            trainingStore.createIndex('by_timestamp', 'timestamp', { unique: false });
            db.createObjectStore('userKnowledgeState', { keyPath: 'id' });
        };
        request.onsuccess = event => resolve(event.target.result);
        request.onerror = event => reject(event.target.error || new Error('Failed to open legacy database'));
    });
}

function readRecord(db, storeName, key) {
    return new Promise((resolve, reject) => {
        const request = db.transaction([storeName], 'readonly').objectStore(storeName).get(key);
        request.onsuccess = event => resolve(event.target.result);
        request.onerror = event => reject(event.target.error || new Error('Failed to read record'));
    });
}

beforeEach(async () => {
    closeDB();
    await deleteDatabase();
});

afterEach(async () => {
    closeDB();
    await deleteDatabase();
});

describe('exam mode db schema', () => {
    it('creates all stores and indexes on a fresh database', async () => {
        await initDB();
        const db = getDB();
        const storeNames = Array.from(db.objectStoreNames);

        expectedStores.forEach(storeName => {
            expect(storeNames).toContain(storeName);
        });

        expect(db.transaction(['decks'], 'readonly').objectStore('decks').keyPath).toBe('id');
        expect(db.transaction(['appData'], 'readonly').objectStore('appData').keyPath).toBe('key');
        expect(db.transaction(['concepts'], 'readonly').objectStore('concepts').keyPath).toBe('conceptID');

        const atomsStore = db.transaction(['atoms'], 'readonly').objectStore('atoms');
        expect(atomsStore.keyPath).toBe('id');
        expect(atomsStore.indexNames.contains('by_type')).toBe(true);
        expect(atomsStore.indexNames.contains('by_updatedAt')).toBe(true);
        expect(atomsStore.indexNames.contains('by_tag')).toBe(true);

        const errorAtomsStore = db.transaction(['errorAtoms'], 'readonly').objectStore('errorAtoms');
        expect(errorAtomsStore.keyPath).toBe('id');
        expect(errorAtomsStore.indexNames.contains('by_risk')).toBe(true);
        expect(errorAtomsStore.indexNames.contains('by_updatedAt')).toBe(true);
        expect(errorAtomsStore.indexNames.contains('by_tag')).toBe(true);

        const questionsStore = db.transaction(['questions'], 'readonly').objectStore('questions');
        expect(questionsStore.keyPath).toBe('id');
        expect(questionsStore.indexNames.contains('by_type')).toBe(true);
        expect(questionsStore.indexNames.contains('by_difficulty')).toBe(true);
        expect(questionsStore.indexNames.contains('by_atomId')).toBe(true);

        const markSchemesStore = db.transaction(['markSchemes'], 'readonly').objectStore('markSchemes');
        expect(markSchemesStore.keyPath).toBe('id');
        expect(markSchemesStore.indexNames.contains('by_schemeType')).toBe(true);
        expect(markSchemesStore.indexNames.contains('by_updatedAt')).toBe(true);

        const examSpecsStore = db.transaction(['examSpecs'], 'readonly').objectStore('examSpecs');
        expect(examSpecsStore.keyPath).toBe('id');
        expect(examSpecsStore.indexNames.contains('by_subject')).toBe(true);
        expect(examSpecsStore.indexNames.contains('by_updatedAt')).toBe(true);

        const examPapersStore = db.transaction(['examPapers'], 'readonly').objectStore('examPapers');
        expect(examPapersStore.keyPath).toBe('id');
        expect(examPapersStore.indexNames.contains('by_examSpecId')).toBe(true);
        expect(examPapersStore.indexNames.contains('by_createdAt')).toBe(true);

        const examSittingsStore = db.transaction(['examSittings'], 'readonly').objectStore('examSittings');
        expect(examSittingsStore.keyPath).toBe('id');
        expect(examSittingsStore.indexNames.contains('by_examPaperId')).toBe(true);
        expect(examSittingsStore.indexNames.contains('by_status')).toBe(true);
        expect(examSittingsStore.indexNames.contains('by_updatedAt')).toBe(true);

        const markingRecordsStore = db.transaction(['markingRecords'], 'readonly').objectStore('markingRecords');
        expect(markingRecordsStore.keyPath).toBe('id');
        expect(markingRecordsStore.indexNames.contains('by_examSittingId')).toBe(true);
        expect(markingRecordsStore.indexNames.contains('by_questionId')).toBe(true);
        expect(markingRecordsStore.indexNames.contains('by_createdAt')).toBe(true);

        const contentRevisionsStore = db.transaction(['contentRevisions'], 'readonly').objectStore('contentRevisions');
        expect(contentRevisionsStore.keyPath).toBe('id');
        expect(contentRevisionsStore.indexNames.contains('by_entity')).toBe(true);
        expect(contentRevisionsStore.indexNames.contains('by_timestamp')).toBe(true);
    });

    it('upgrades from v12 to v13 without losing data', async () => {
        const legacyDb = await openLegacyV12Database();
        await new Promise((resolve, reject) => {
            const transaction = legacyDb.transaction(['decks', 'userKnowledgeState'], 'readwrite');
            transaction.objectStore('decks').put({ id: 'deck_test', userID: 'default_user' });
            transaction.objectStore('userKnowledgeState').put({
                id: 'default_user:card_test',
                userID: 'default_user',
                cardID: 'card_test'
            });
            transaction.oncomplete = () => resolve();
            transaction.onerror = event => reject(event.target.error || new Error('Failed to insert legacy data'));
        });
        legacyDb.close();

        await initDB();
        const db = getDB();
        const upgradedDeck = await readRecord(db, 'decks', 'deck_test');
        const upgradedKnowledge = await readRecord(db, 'userKnowledgeState', 'default_user:card_test');

        expect(upgradedDeck).toBeTruthy();
        expect(upgradedKnowledge).toBeTruthy();

        const storeNames = Array.from(db.objectStoreNames);
        expect(storeNames).toContain('atoms');
        expect(storeNames).toContain('questions');
        expect(storeNames).toContain('contentRevisions');
    });
});

afterAll(async () => {
    closeDB();
    await deleteDatabase();
    await initDB();
    const db = getDB();
    const storeNames = Array.from(db.objectStoreNames);
    const atomsIndexes = Array.from(db.transaction(['atoms'], 'readonly').objectStore('atoms').indexNames);

    console.log(`[Exam DB] DB_VERSION=${db.version}`);
    console.log(`[Exam DB] stores (${storeNames.length}): ${storeNames.join(', ')}`);
    console.log(`[Exam DB] atoms indexes: ${atomsIndexes.join(', ')}`);

    closeDB();
    await deleteDatabase();
});
