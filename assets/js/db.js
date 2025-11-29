let db;

export function getDB() {
    return db;
}

export function initDB() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open('LagioteDB', 7);
        request.onerror = event => reject("Error opening DB: " + (event.target.error ? event.target.error.message : event.target.errorCode));

        request.onsuccess = event => {
            db = event.target.result;
            resolve();
        };

        request.onupgradeneeded = event => {
            db = event.target.result;
            const transaction = event.target.transaction;

            if (!db.objectStoreNames.contains('decks')) {
                db.createObjectStore('decks', { keyPath: 'id' });
            }
            if (!db.objectStoreNames.contains('analyticsQueue')) {
                db.createObjectStore('analyticsQueue', { keyPath: 'id' });
            }
            if (!db.objectStoreNames.contains('appData')) {
                db.createObjectStore('appData', { keyPath: 'key' });
            }
            if (!db.objectStoreNames.contains('concepts')) {
                db.createObjectStore('concepts', { keyPath: 'conceptID' });
            }
            if (!db.objectStoreNames.contains('userKnowledgeState')) {
                db.createObjectStore('userKnowledgeState', { keyPath: ['userID', 'cardID'] });
            }
            if (!db.objectStoreNames.contains('interactionLogs')) {
                const logStore = db.createObjectStore('interactionLogs', { keyPath: 'id', autoIncrement: true });
                logStore.createIndex('by_cardID', 'cardID', { unique: false });
                logStore.createIndex('by_timestamp', 'timestamp', { unique: false });
                console.log("Created 'interactionLogs' object store.");
            }
            if (!db.objectStoreNames.contains('examPlans')) {
                db.createObjectStore('examPlans', { keyPath: 'id' });
            }
            if (!db.objectStoreNames.contains('analyticsQueue')) {
                db.createObjectStore('analyticsQueue', { keyPath: 'id' });
                console.log("Created 'analyticsQueue' object store.");
            }

            if (event.oldVersion > 0 && event.oldVersion < 5) {
                console.log("Starting database migration for cognitive engine...");
                const deckStore = transaction.objectStore('decks');
                const stateStore = transaction.objectStore('userKnowledgeState');

                deckStore.getAll().onsuccess = (e) => {
                    const allDecks = e.target.result;
                    if (!allDecks) return;

                    allDecks.forEach(deck => {
                        let deckNeedsUpdate = false;
                        deck.cards.forEach(card => {
                            if (typeof card.masteryScore === 'undefined') {
                                deckNeedsUpdate = true;
                                stateStore.put({
                                    userID: 'default_user',
                                    cardID: card.id,
                                    masteryScore: 0.5,
                                    stability: 1.0,
                                    lastReviewed: new Date().toISOString(),
                                    recallHistory: []
                                });
                            }
                        });
                        if (deckNeedsUpdate) {
                            deckStore.put(deck);
                        }
                    });
                    console.log("Cognitive engine migration complete.");
                };
            }
        };
    });
}

export async function saveDataToDB(storeName, data) {
    if (!db) {
        console.warn('Database not initialized, skipping save to', storeName);
        return Promise.resolve();
    }
    return new Promise((resolve, reject) => {
        try {
            const transaction = db.transaction([storeName], 'readwrite');
            const store = transaction.objectStore(storeName);
            const request = store.put(data);
            request.onsuccess = () => resolve();
            request.onerror = event => reject("Error saving data: " + (event.target.error && event.target.error.message || event.target.error));
        } catch (error) {
            console.warn('Error in saveDataToDB:', error);
            resolve();
        }
    });
}


export async function getDataFromDB(storeName, key) {
    if (!db) {
        console.warn('Database not initialized, cannot get from', storeName);
        return Promise.resolve(undefined);
    }
    return new Promise((resolve, reject) => {
        try {
            const transaction = db.transaction([storeName], 'readonly');
            const store = transaction.objectStore(storeName);
            const request = store.get(key);
            request.onsuccess = event => resolve(event.target.result);
            request.onerror = event => reject("Error getting data: " + (event.target.error && event.target.error.message || event.target.error));
        } catch (error) {
            console.warn('Error in getDataFromDB:', error);
            resolve(undefined);
        }
    });
}


export async function getAllDataFromDB(storeName) {
    if (!db) {
        console.warn('Database not initialized, cannot get all from', storeName);
        return Promise.resolve([]);
    }
    return new Promise((resolve, reject) => {
        try {
            const transaction = db.transaction([storeName], 'readonly');
            const store = transaction.objectStore(storeName);
            const request = store.getAll();
            request.onsuccess = event => resolve(event.target.result);
            request.onerror = event => reject("Error getting all data: " + (event.target.error && event.target.error.message || event.target.error));
        } catch (error) {
            console.warn('Error in getAllDataFromDB:', error);
            resolve([]);
        }
    });
}


export async function deleteDataFromDB(storeName, key) {
    if (!db) {
        console.warn('Database not initialized, skipping delete from', storeName);
        return Promise.resolve();
    }
    return new Promise((resolve, reject) => {
        try {
            const transaction = db.transaction([storeName], 'readwrite');
            const store = transaction.objectStore(storeName);
            const request = store.delete(key);
            request.onsuccess = () => resolve();
            request.onerror = event => reject("Error deleting data: " + (event.target.error && event.target.error.message || event.target.error));
        } catch (error) {
            console.warn('Error in deleteDataFromDB:', error);
            resolve();
        }
    });
}

export async function clearStoreInDB(storeName) {
    return new Promise((resolve, reject) => {
        const transaction = db.transaction([storeName], 'readwrite');
        const store = transaction.objectStore(storeName);
        const request = store.clear();
        request.onsuccess = () => resolve();
        request.onerror = event => reject("Error clearing store: " + event.target.error);
    });
}
