const DB_NAME = 'LagioteDB';
const DB_VERSION = 11;
let db;

export function getDB() {
    return db;
}

export const DEFAULT_USER_ID = 'default_user';

const normalizeKey = key => (Array.isArray(key) ? key.join('::') : key);

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

function ensureFsrsShape(record) {
    const fsrs = record.fsrs || {};
    const now = new Date();
    return {
        state: typeof fsrs.state === 'number' ? fsrs.state : 0,
        stability: typeof fsrs.stability === 'number' ? fsrs.stability : 0,
        difficulty: typeof fsrs.difficulty === 'number' ? fsrs.difficulty : 0,
        reps: typeof fsrs.reps === 'number' ? fsrs.reps : 0,
        lapses: typeof fsrs.lapses === 'number' ? fsrs.lapses : 0,
        due: fsrs.due ? new Date(fsrs.due) : now,
        last_review: fsrs.last_review ? new Date(fsrs.last_review) : now
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
    return {
        id,
        userID,
        cardID,
        deckID,
        fsrs,
        lastReviewed: data.lastReviewed || data.last_review || fsrs.last_review?.toISOString?.() || new Date().toISOString(),
        lastModified: data.lastModified || new Date().toISOString(),
        recallHistory: Array.isArray(data.recallHistory) ? data.recallHistory : [],
        masteryScore: data.masteryScore,
        stability: data.stability,
        difficulty: data.difficulty,
        reps: data.reps,
        lapses: data.lapses
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
    if (!db) throw new Error('Database not initialized');
    return db.transaction([storeName], mode).objectStore(storeName);
}

export async function saveDataToDB(storeName, data) {
    return new Promise((resolve, reject) => {
        try {
            const store = getStore(storeName, 'readwrite');
            const payload = storeName === 'userKnowledgeState' ? prepareKnowledgeRecord(data) : data;
            const request = store.put(payload);
            request.onsuccess = () => resolve();
            request.onerror = event => reject(event.target.error || new Error('Error saving data'));
        } catch (error) {
            reject(error);
        }
    });
}

export async function saveDataBatch(storeName, records) {
    if (!Array.isArray(records) || !records.length) return;
    return new Promise((resolve, reject) => {
        try {
            const store = getStore(storeName, 'readwrite');
            records.forEach(record => {
                const payload = storeName === 'userKnowledgeState' ? prepareKnowledgeRecord(record) : record;
                store.put(payload);
            });
            store.transaction.oncomplete = () => resolve();
            store.transaction.onerror = event => reject(event.target.error || new Error('Error saving batch'));
        } catch (error) {
            reject(error);
        }
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
    return new Promise((resolve, reject) => {
        try {
            const store = getStore(storeName, 'readwrite');
            const request = store.delete(storeName === 'userKnowledgeState' ? resolveKnowledgeKey(key) || normalizeKey(key) : normalizeKey(key));
            request.onsuccess = () => resolve();
            request.onerror = event => reject(event.target.error || new Error('Error deleting data'));
        } catch (error) {
            reject(error);
        }
    });
}

export async function clearStoreInDB(storeName) {
    return new Promise((resolve, reject) => {
        try {
            const store = getStore(storeName, 'readwrite');
            const request = store.clear();
            request.onsuccess = () => resolve();
            request.onerror = event => reject(event.target.error || new Error('Error clearing store'));
        } catch (error) {
            reject(error);
        }
    });
}