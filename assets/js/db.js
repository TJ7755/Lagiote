
let db;


export async function initDB() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open('StudyStackDB', 4);

        request.onerror = event => {
            const errorMsg = (event.target.error && event.target.error.message) || event.target.errorCode || 'Unknown error';
            reject("Error opening DB: " + errorMsg);
        };
        
        request.onsuccess = event => {
            db = event.target.result;
            resolve(db);
        };

        request.onupgradeneeded = event => {
            db = event.target.result;
            const transaction = event.target.transaction;

            if (!db.objectStoreNames.contains('decks')) {
                db.createObjectStore('decks', { keyPath: 'id' });
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


export async function logInteraction(logData) {
    if (!db) {
        console.error("Database not available for logging interaction.");
        return;
    }

    try {
        const transaction = db.transaction(['interactionLogs'], 'readwrite');
        const store = transaction.objectStore('interactionLogs');
        
        const logEntry = {
            userID: 'default_user', 
            cardID: logData.cardID,
            timestamp: new Date().toISOString(),
            wasCorrect: logData.wasCorrect,
            latency: logData.recallLatency,
            fluency: logData.answerFluency,
            corrections: logData.totalCorrections,
            attempts: logData.attemptCount,
            userAnswer: logData.userAnswer,
            synced: false 
        };
        
        await new Promise((resolve, reject) => {
            const request = store.add(logEntry);
            request.onsuccess = () => resolve();
            request.onerror = event => reject(event.target.error);
        });
    } catch (error) {
        console.error("Failed to initiate IndexedDB transaction for logging:", error);
    }
}


export function getDB() {
    return db;
}