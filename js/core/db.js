import {
    normalizeFsrsState,
    parseFsrsDate,
    isFsrsReviewedState
} from './fsrs-utils.js';

const DB_NAME = 'LagioteDB';
const DB_VERSION = 14;
let db;

const EXAM_ENGINE_STORES = new Set([
    'atoms',
    'errorAtoms',
    'questions',
    'markSchemes',
    'examSpecs',
    'examPapers',
    'examSittings',
    'markingRecords',
    'contentRevisions'
]);

export function getDB() {
    return db;
}

export function closeDB() {
    if (db) {
        db.close();
        db = null;
    }
}

export const DEFAULT_USER_ID = 'default_user';

const normalizeKey = key => (Array.isArray(key) ? key.join('::') : key);
const hasValue = value => value !== undefined && value !== null && value !== '';

function resolveKnowledgeKey(key) {
    if (typeof key === 'string') return key;
    if (Array.isArray(key)) {
        const [userID, cardID] = key;
        if (userID && cardID) return `${userID}:${cardID}`;
    }
    if (key && typeof key === 'object' && (key.userID || key.userId) && (key.cardID || key.cardId)) {
        const userID = key.userID || key.userId;
        const cardID = key.cardID || key.cardId;
        return `${userID}:${cardID}`;
    }
    return null;
}

function nowIso() {
    return new Date().toISOString();
}

function isExamEngineStore(storeName) {
    return EXAM_ENGINE_STORES.has(storeName);
}

function ensureFsrsShape(record) {
    const sanitized = normalizeFsrsState(record?.fsrs);
    const now = new Date();
    const state = sanitized || {};
    return {
        state: state.state ?? 0,
        stability: state.stability ?? 0,
        difficulty: state.difficulty ?? 0,
        reps: state.reps ?? 0,
        lapses: state.lapses ?? 0,
        due: state.due || now,
        last_review: state.last_review || null
    };
}

function prepareKnowledgeRecord(data) {
    if (!data) throw new Error('No knowledge record provided');
    const idValue = typeof data.id === 'string' ? data.id : '';
    const parsedId = idValue.includes(':') ? idValue.split(':') : null;
    const userFromId = parsedId && parsedId.length > 1 ? parsedId[0] : null;
    const cardFromId = parsedId && parsedId.length > 1 ? parsedId[1] : null;
    const userID = data.userID || data.userId || userFromId || DEFAULT_USER_ID;
    const cardID = data.cardID || data.cardId || cardFromId || data.id;
    const deckID = data.deckID || data.deckId || data.deck || null;
    const id = data.id && typeof data.id === 'string' && data.id.includes(':') ? data.id : `${userID}:${cardID}`;
    const fsrs = ensureFsrsShape(data);
    const reviewed = isFsrsReviewedState(fsrs);
    if (!reviewed) {
        fsrs.last_review = null;
    }

    const candidateLastReview = data.lastReviewed || data.last_review || data.lastReview || fsrs.last_review;
    const lastReviewedDate = reviewed ? parseFsrsDate(candidateLastReview) : null;
    const lastReviewed = lastReviewedDate ? lastReviewedDate.toISOString() : null;
    const interferenceFragilityEma = Number.isFinite(data.interferenceFragilityEma)
        ? Math.min(1, Math.max(0, Number(data.interferenceFragilityEma)))
        : 0;
    const sequenceGraph = (data.sequenceGraph && typeof data.sequenceGraph === 'object') ? data.sequenceGraph : undefined;
    const sequenceId = typeof data.sequenceId === 'string'
        ? data.sequenceId
        : (typeof data.sequenceID === 'string' ? data.sequenceID : undefined);
    const knowledgeKind = typeof data.kind === 'string'
        ? data.kind
        : (typeof data.type === 'string' ? data.type : undefined);

    return {
        id,
        userID,
        cardID,
        deckID,
        fsrs,
        lastReviewed,
        lastModified: data.lastModified || new Date().toISOString(),
        recallHistory: Array.isArray(data.recallHistory) ? data.recallHistory : [],
        masteryScore: data.masteryScore,
        interferenceFragilityEma,
        stability: data.stability,
        difficulty: data.difficulty,
        reps: data.reps,
        lapses: data.lapses,
        ...(sequenceGraph ? { sequenceGraph } : {}),
        ...(sequenceId ? { sequenceId } : {}),
        ...(knowledgeKind ? { kind: knowledgeKind } : {})
    };
}

function normalizeQuestionRecord(record) {
    if (!record || typeof record !== 'object') return record;
    let atomIds = [];
    if (Array.isArray(record.atomMap)) {
        atomIds = Array.from(new Set(record.atomMap
            .map(entry => entry?.atomId)
            .filter(id => id !== undefined && id !== null)
            .map(id => (typeof id === 'string' ? id : String(id)))
        ));
    } else if (Array.isArray(record.atomIds)) {
        atomIds = record.atomIds;
    }
    return { ...record, atomIds };
}

function parseExamVersion(value) {
    if (!Number.isFinite(value)) return null;
    const normalized = Math.trunc(value);
    return normalized >= 1 ? normalized : null;
}

function normalizeExamEngineRecord(storeName, record, existingRecord = null) {
    if (!record || typeof record !== 'object') return record;
    const working = storeName === 'questions' ? normalizeQuestionRecord(record) : record;
    const existing = existingRecord && typeof existingRecord === 'object' ? existingRecord : null;
    const now = nowIso();
    const createdAt = hasValue(working.createdAt)
        ? working.createdAt
        : (hasValue(existing?.createdAt) ? existing.createdAt : now);
    const incomingVersion = parseExamVersion(working.version);
    const existingVersion = parseExamVersion(existing?.version);
    let version = incomingVersion;
    if (!incomingVersion) {
        if (existing) {
            version = existingVersion ? existingVersion + 1 : 1;
        } else {
            version = 1;
        }
    }
    const hasIsDeleted = typeof working.isDeleted === 'boolean';
    const isDeleted = hasIsDeleted ? working.isDeleted : (typeof existing?.isDeleted === 'boolean' ? existing.isDeleted : false);
    const deletedAt = hasValue(working.deletedAt)
        ? working.deletedAt
        : (hasValue(existing?.deletedAt) ? existing.deletedAt : null);

    return {
        ...working,
        version,
        createdAt,
        updatedAt: now,
        isDeleted,
        deletedAt
    };
}

function ensureKnowledgeIndexes(store) {
    if (!store.indexNames.contains('by_user')) store.createIndex('by_user', 'userID', { unique: false });
    if (!store.indexNames.contains('by_card')) store.createIndex('by_card', 'cardID', { unique: false });
    if (!store.indexNames.contains('by_user_card')) store.createIndex('by_user_card', ['userID', 'cardID'], { unique: false });
    if (!store.indexNames.contains('by_user_deck')) store.createIndex('by_user_deck', ['userID', 'deckID'], { unique: false });
    if (!store.indexNames.contains('by_deck')) store.createIndex('by_deck', 'deckID', { unique: false });
    if (!store.indexNames.contains('idx_user_card')) store.createIndex('idx_user_card', ['userID', 'cardID'], { unique: false });
    if (!store.indexNames.contains('idx_user_deck')) store.createIndex('idx_user_deck', ['userID', 'deckID'], { unique: false });
    if (!store.indexNames.contains('idx_deck')) store.createIndex('idx_deck', 'deckID', { unique: false });
    if (!store.indexNames.contains('idx_user')) store.createIndex('idx_user', 'userID', { unique: false });
}

function ensureAtomsIndexes(store) {
    if (!store.indexNames.contains('by_type')) store.createIndex('by_type', 'type', { unique: false });
    if (!store.indexNames.contains('by_updatedAt')) store.createIndex('by_updatedAt', 'updatedAt', { unique: false });
    if (!store.indexNames.contains('by_tag')) store.createIndex('by_tag', 'tags', { unique: false, multiEntry: true });
}

function ensureErrorAtomsIndexes(store) {
    if (!store.indexNames.contains('by_risk')) store.createIndex('by_risk', 'risk', { unique: false });
    if (!store.indexNames.contains('by_updatedAt')) store.createIndex('by_updatedAt', 'updatedAt', { unique: false });
    if (!store.indexNames.contains('by_tag')) store.createIndex('by_tag', 'tags', { unique: false, multiEntry: true });
}

function ensureQuestionsIndexes(store) {
    if (!store.indexNames.contains('by_type')) store.createIndex('by_type', 'type', { unique: false });
    if (!store.indexNames.contains('by_difficulty')) store.createIndex('by_difficulty', 'difficulty', { unique: false });
    if (!store.indexNames.contains('by_depth')) store.createIndex('by_depth', 'depth', { unique: false });
    if (!store.indexNames.contains('by_markScheme')) store.createIndex('by_markScheme', 'markSchemeId', { unique: false });
    if (!store.indexNames.contains('by_tag')) store.createIndex('by_tag', 'tags', { unique: false, multiEntry: true });
    if (!store.indexNames.contains('by_atomId')) store.createIndex('by_atomId', 'atomIds', { unique: false, multiEntry: true });
}

function ensureMarkSchemesIndexes(store) {
    if (!store.indexNames.contains('by_schemeType')) store.createIndex('by_schemeType', 'schemeType', { unique: false });
    if (!store.indexNames.contains('by_updatedAt')) store.createIndex('by_updatedAt', 'updatedAt', { unique: false });
}

function ensureExamSpecsIndexes(store) {
    if (!store.indexNames.contains('by_subject')) store.createIndex('by_subject', 'subject', { unique: false });
    if (!store.indexNames.contains('by_updatedAt')) store.createIndex('by_updatedAt', 'updatedAt', { unique: false });
}

function ensureExamPapersIndexes(store) {
    if (!store.indexNames.contains('by_examSpecId')) store.createIndex('by_examSpecId', 'examSpecId', { unique: false });
    if (!store.indexNames.contains('by_createdAt')) store.createIndex('by_createdAt', 'createdAt', { unique: false });
}

function ensureExamSittingsIndexes(store) {
    if (!store.indexNames.contains('by_examPaperId')) store.createIndex('by_examPaperId', 'examPaperId', { unique: false });
    if (!store.indexNames.contains('by_status')) store.createIndex('by_status', 'status', { unique: false });
    if (!store.indexNames.contains('by_startedAt')) store.createIndex('by_startedAt', 'startedAt', { unique: false });
    if (!store.indexNames.contains('by_updatedAt')) store.createIndex('by_updatedAt', 'updatedAt', { unique: false });
}

function ensureMarkingRecordsIndexes(store) {
    if (!store.indexNames.contains('by_examSittingId')) {
        store.createIndex('by_examSittingId', 'examSittingId', { unique: false });
    }
    if (!store.indexNames.contains('by_questionId')) {
        store.createIndex('by_questionId', 'questionId', { unique: false });
    }
    if (!store.indexNames.contains('by_createdAt')) store.createIndex('by_createdAt', 'createdAt', { unique: false });
}

function ensureContentRevisionsIndexes(store) {
    if (!store.indexNames.contains('by_entity')) store.createIndex('by_entity', ['entityType', 'entityId'], { unique: false });
    if (!store.indexNames.contains('by_timestamp')) store.createIndex('by_timestamp', 'timestamp', { unique: false });
}

function migrateStores(transaction, oldVersion) {
    // Ensure core stores exist regardless of version (idempotent checks)
    if (!db.objectStoreNames.contains('decks')) {
         const deckStore = db.createObjectStore('decks', { keyPath: 'id' });
         deckStore.createIndex('by_user', 'userID', { unique: false });
    }
    if (!db.objectStoreNames.contains('appData')) {
        db.createObjectStore('appData', { keyPath: 'key' });
    }
    if (!db.objectStoreNames.contains('interactionLogs')) {
        const logStore = db.createObjectStore('interactionLogs', { keyPath: 'id', autoIncrement: true });
        logStore.createIndex('by_cardID', 'cardID', { unique: false });
        logStore.createIndex('by_timestamp', 'timestamp', { unique: false });
    }
    if (!db.objectStoreNames.contains('analyticsQueue')) {
        db.createObjectStore('analyticsQueue', { keyPath: 'id' });
    }
    if (!db.objectStoreNames.contains('concepts')) {
        db.createObjectStore('concepts', { keyPath: 'conceptID' });
    }
    if (!db.objectStoreNames.contains('examPlans')) {
        db.createObjectStore('examPlans', { keyPath: 'id' });
    }
    if (!db.objectStoreNames.contains('cortexTrainingData')) {
        const trainingStore = db.createObjectStore('cortexTrainingData', { keyPath: 'id', autoIncrement: true });
        trainingStore.createIndex('by_timestamp', 'timestamp', { unique: false });
    }

    if (!db.objectStoreNames.contains('atoms')) {
        const atomStore = db.createObjectStore('atoms', { keyPath: 'id' });
        ensureAtomsIndexes(atomStore);
    } else {
        ensureAtomsIndexes(transaction.objectStore('atoms'));
    }
    if (!db.objectStoreNames.contains('errorAtoms')) {
        const errorAtomStore = db.createObjectStore('errorAtoms', { keyPath: 'id' });
        ensureErrorAtomsIndexes(errorAtomStore);
    } else {
        ensureErrorAtomsIndexes(transaction.objectStore('errorAtoms'));
    }
    if (!db.objectStoreNames.contains('questions')) {
        const questionStore = db.createObjectStore('questions', { keyPath: 'id' });
        ensureQuestionsIndexes(questionStore);
    } else {
        ensureQuestionsIndexes(transaction.objectStore('questions'));
    }
    if (!db.objectStoreNames.contains('markSchemes')) {
        const markSchemeStore = db.createObjectStore('markSchemes', { keyPath: 'id' });
        ensureMarkSchemesIndexes(markSchemeStore);
    } else {
        ensureMarkSchemesIndexes(transaction.objectStore('markSchemes'));
    }
    if (!db.objectStoreNames.contains('examSpecs')) {
        const examSpecStore = db.createObjectStore('examSpecs', { keyPath: 'id' });
        ensureExamSpecsIndexes(examSpecStore);
    } else {
        ensureExamSpecsIndexes(transaction.objectStore('examSpecs'));
    }
    if (!db.objectStoreNames.contains('examPapers')) {
        const examPaperStore = db.createObjectStore('examPapers', { keyPath: 'id' });
        ensureExamPapersIndexes(examPaperStore);
    } else {
        ensureExamPapersIndexes(transaction.objectStore('examPapers'));
    }
    if (!db.objectStoreNames.contains('examSittings')) {
        const examSittingStore = db.createObjectStore('examSittings', { keyPath: 'id' });
        ensureExamSittingsIndexes(examSittingStore);
    } else {
        ensureExamSittingsIndexes(transaction.objectStore('examSittings'));
    }
    if (!db.objectStoreNames.contains('markingRecords')) {
        const markingRecordStore = db.createObjectStore('markingRecords', { keyPath: 'id' });
        ensureMarkingRecordsIndexes(markingRecordStore);
    } else {
        ensureMarkingRecordsIndexes(transaction.objectStore('markingRecords'));
    }
    if (!db.objectStoreNames.contains('contentRevisions')) {
        const contentRevisionStore = db.createObjectStore('contentRevisions', { keyPath: 'id' });
        ensureContentRevisionsIndexes(contentRevisionStore);
    } else {
        ensureContentRevisionsIndexes(transaction.objectStore('contentRevisions'));
    }

    if (db.objectStoreNames.contains('userKnowledgeState')) {
        const existingStore = transaction.objectStore('userKnowledgeState');
        const needsRebuild = existingStore.keyPath !== 'id';
        const rebuild = () => {
            const capture = existingStore.getAll();
            capture.onsuccess = () => {
                const existing = Array.isArray(capture.result) ? capture.result : [];
                db.deleteObjectStore('userKnowledgeState');
                const knowledgeStore = db.createObjectStore('userKnowledgeState', { keyPath: 'id' });
                ensureKnowledgeIndexes(knowledgeStore);
                existing.forEach(record => knowledgeStore.put(prepareKnowledgeRecord(record)));
            };
            capture.onerror = () => {
                db.deleteObjectStore('userKnowledgeState');
                const knowledgeStore = db.createObjectStore('userKnowledgeState', { keyPath: 'id' });
                ensureKnowledgeIndexes(knowledgeStore);
            };
        };

        if (needsRebuild) {
            rebuild();
        } else {
            ensureKnowledgeIndexes(existingStore);
            const capture = existingStore.getAll();
            capture.onsuccess = () => {
                const existing = Array.isArray(capture.result) ? capture.result : [];
                if (!existing.length) return;
                existingStore.clear();
                existing.forEach(record => existingStore.put(prepareKnowledgeRecord(record)));
            };
        }
    } else {
        const knowledgeStore = db.createObjectStore('userKnowledgeState', { keyPath: 'id' });
        ensureKnowledgeIndexes(knowledgeStore);
    }
}

export function initDB() {
    if (db) return Promise.resolve();
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION);

        request.onerror = event => {
            console.error('DB Open Error:', event.target.error);
            reject(event.target.error || new Error('Failed to open database'));
        };

        request.onblocked = () => {
            reject(new Error('Database upgrade blocked by another connection.'));
        };

        request.onsuccess = event => {
            db = event.target.result;
            resolve();
        };

        request.onupgradeneeded = event => {
            db = event.target.result;
            migrateStores(event.target.transaction, event.oldVersion);
        };
    });
}

function getStore(storeName, mode = 'readonly') {
    if (!db) throw new Error('Database not initialised');
    return db.transaction([storeName], mode).objectStore(storeName);
}

function writeTransaction(storeNames, enqueue) {
    return new Promise((resolve, reject) => {
        if (!db) return reject(new Error('Database not initialised'));
        let transaction;
        let failure;
        const abort = error => {
            failure = error;
            transaction.abort();
        };
        try {
            transaction = db.transaction(storeNames, 'readwrite');
            transaction.oncomplete = () => resolve();
            transaction.onabort = () => reject(failure || transaction.error || new Error('Database transaction aborted'));
            transaction.onerror = () => { failure ||= transaction.error; };
            enqueue(transaction, abort);
        } catch (error) {
            if (transaction) abort(error);
            else reject(error);
        }
    });
}

function enqueueRecord(store, record, abort, importing = false) {
    if (store.name === 'userKnowledgeState') {
        store.put(prepareKnowledgeRecord(record));
    } else if (isExamEngineStore(store.name)) {
        const request = store.get(record.id);
        request.onsuccess = () => {
            try {
                const existing = request.result;
                if (importing && existing) {
                    const incomingVersion = parseExamVersion(record.version);
                    const existingVersion = parseExamVersion(existing.version);
                    if (incomingVersion === null ? existingVersion !== null : incomingVersion <= (existingVersion || 0)) return;
                }
                store.put(normalizeExamEngineRecord(store.name, record, existing));
            } catch (error) {
                abort(error);
            }
        };
    } else {
        store.put(record);
    }
}

export async function saveDataToDB(storeName, data) {
    return writeTransaction([storeName], (transaction, abort) => {
        enqueueRecord(transaction.objectStore(storeName), data, abort);
    });
}

export async function saveDataBatch(storeName, records) {
    if (!Array.isArray(records) || !records.length) return;
    return writeTransaction([storeName], (transaction, abort) => {
        const store = transaction.objectStore(storeName);
        records.forEach(record => enqueueRecord(store, record, abort));
    });
}

export async function getDataFromDB(storeName, key) {
    return new Promise((resolve, reject) => {
        try {
            const store = getStore(storeName, 'readonly');
            if (storeName === 'userKnowledgeState') {
                const resolvedKey = resolveKnowledgeKey(key);
                if (resolvedKey) {
                    const request = store.get(resolvedKey);
                    request.onsuccess = event => resolve(event.target.result);
                    request.onerror = event => reject(event.target.error || new Error('Error getting data'));
                    return;
                }
                if (Array.isArray(key) && store.indexNames.contains('by_user_card')) {
                    const request = store.index('by_user_card').get([key[0], key[1]]);
                    request.onsuccess = event => resolve(event.target.result);
                    request.onerror = event => reject(event.target.error || new Error('Error getting data'));
                    return;
                }
            }
            const request = store.get(normalizeKey(key));
            request.onsuccess = event => resolve(event.target.result);
            request.onerror = event => reject(event.target.error || new Error('Error getting data'));
        } catch (error) {
            reject(error);
        }
    });
}

export async function getAllDataFromDB(storeName) {
    return new Promise((resolve, reject) => {
        try {
            const store = getStore(storeName, 'readonly');
            const request = store.getAll();
            request.onsuccess = event => resolve(event.target.result);
            request.onerror = event => reject(event.target.error || new Error('Error getting all data'));
        } catch (error) {
            reject(error);
        }
    });
}

export async function getDataByIndex(storeName, indexName, keyRange) {
    return new Promise((resolve, reject) => {
        try {
            const store = getStore(storeName, 'readonly');
            if (!store.indexNames.contains(indexName)) {
                resolve([]);
                return;
            }
            const index = store.index(indexName);
            const request = index.getAll(keyRange);
            request.onsuccess = event => resolve(event.target.result);
            request.onerror = event => reject(event.target.error || new Error('Error getting data by index'));
        } catch (error) {
            reject(error);
        }
    });
}

export async function deleteDataFromDB(storeName, key) {
    return writeTransaction([storeName], transaction => {
        transaction.objectStore(storeName).delete(storeName === 'userKnowledgeState' ? resolveKnowledgeKey(key) || normalizeKey(key) : normalizeKey(key));
    });
}

export async function clearStoreInDB(storeName) {
    return writeTransaction([storeName], transaction => {
        transaction.objectStore(storeName).clear();
    });
}

export async function softDeleteRecord(storeName, id, overrides = {}) {
    if (!isExamEngineStore(storeName)) {
        return deleteDataFromDB(storeName, id);
    }
    return new Promise((resolve, reject) => {
        try {
            const store = getStore(storeName, 'readwrite');
            store.transaction.oncomplete = () => resolve();
            store.transaction.onabort = () => reject(store.transaction.error || new Error('Soft deletion aborted'));
            const getRequest = store.get(id);
            getRequest.onsuccess = () => {
                const existing = getRequest.result || { id };
                const now = nowIso();
                const incomingVersion = parseExamVersion(overrides.version);
                const existingVersion = parseExamVersion(existing.version);
                const version = incomingVersion || (existingVersion ? existingVersion + 1 : 1);
                const createdAt = hasValue(existing.createdAt) ? existing.createdAt : now;
                const payload = {
                    ...existing,
                    ...overrides,
                    id,
                    version,
                    createdAt,
                    updatedAt: now,
                    isDeleted: true,
                    deletedAt: now
                };
                const putRequest = store.put(payload);
                putRequest.onerror = event => reject(event.target.error || new Error('Error soft deleting record'));
            };
            getRequest.onerror = event => reject(event.target.error || new Error('Error soft deleting record'));
        } catch (error) {
            reject(error);
        }
    });
}

export async function exportFullData() {
    if (!db) throw new Error('Database not initialised');
    const names = ['decks', 'userKnowledgeState', 'interactionLogs', 'examPlans', 'appData', ...EXAM_ENGINE_STORES];
    const snapshot = await new Promise((resolve, reject) => {
        const transaction = db.transaction(names, 'readonly');
        const data = {};
        transaction.oncomplete = () => resolve(data);
        transaction.onabort = () => reject(transaction.error || new Error('Backup snapshot aborted'));
        for (const name of names) {
            const request = transaction.objectStore(name).getAll();
            request.onsuccess = () => { data[name] = request.result; };
        }
    });
    const { decks, interactionLogs, examPlans, atoms, errorAtoms, questions, markSchemes, examSpecs, examPapers, examSittings, markingRecords, contentRevisions } = snapshot;
    const knowledgeStates = snapshot.userKnowledgeState;
    const userSettings = snapshot.appData.find(record => record.key === 'userSettings');
    const analytics = snapshot.appData.find(record => record.key === 'analytics');

    return {
        exportSchemaVersion: 1,
        exportedAt: nowIso(),
        settings: userSettings,
        analytics,
        decks,
        examPlans,
        knowledgeStates,
        interactionLogs,
        examEngine: {
            atoms: atoms || [],
            errorAtoms: errorAtoms || [],
            questions: questions || [],
            markSchemes: markSchemes || [],
            examSpecs: examSpecs || [],
            examPapers: examPapers || [],
            examSittings: examSittings || [],
            markingRecords: markingRecords || [],
            contentRevisions: contentRevisions || []
        }
    };
}

export async function importFullData(payload) {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
        throw new Error('Invalid backup payload');
    }
    const collections = {
        decks: payload.decks,
        userKnowledgeState: payload.knowledgeStates,
        interactionLogs: payload.interactionLogs,
        examPlans: payload.examPlans
    };
    const examEngine = payload.examEngine || {};
    for (const storeName of EXAM_ENGINE_STORES) collections[storeName] = examEngine[storeName];
    for (const [name, records] of Object.entries(collections)) {
        if (records !== undefined && (!Array.isArray(records) || records.some(record => !record || typeof record !== 'object' || Array.isArray(record)))) {
            throw new Error(`Invalid backup collection: ${name}`);
        }
    }
    return writeTransaction([...Object.keys(collections), 'appData'], (transaction, abort) => {
        for (const [name, records] of Object.entries(collections)) {
            const store = transaction.objectStore(name);
            for (const record of records || []) enqueueRecord(store, record, abort, true);
        }
        const appData = transaction.objectStore('appData');
        if (payload.settings) appData.put({ ...payload.settings, key: 'userSettings' });
        if (payload.analytics) appData.put({ ...payload.analytics, key: 'analytics' });
    });
}
