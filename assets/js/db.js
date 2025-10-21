// Database operations module
let db;

// Initialize IndexedDB
export async function initDB() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open('StudyStackDB', 4);

        request.onerror = event => reject("Error opening DB: " + event.target.errorCode);
        
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

// Save data to a store
export async function saveDataToDB(storeName, data) {
    return new Promise((resolve, reject) => {
        const transaction = db.transaction([storeName], 'readwrite');
        const store = transaction.objectStore(storeName);
        const request = store.put(data);
        request.onsuccess = () => resolve();
        request.onerror = event => reject("Error saving data: " + event.target.error);
    });
}

// Get data from a store
export async function getDataFromDB(storeName, key) {
    return new Promise((resolve, reject) => {
        const transaction = db.transaction([storeName], 'readonly');
        const store = transaction.objectStore(storeName);
        const request = store.get(key);
        request.onsuccess = event => resolve(event.target.result);
        request.onerror = event => reject("Error getting data: " + event.target.error);
    });
}

// Get all data from a store
export async function getAllDataFromDB(storeName) {
    return new Promise((resolve, reject) => {
        const transaction = db.transaction([storeName], 'readonly');
        const store = transaction.objectStore(storeName);
        const request = store.getAll();
        request.onsuccess = event => resolve(event.target.result);
        request.onerror = event => reject("Error getting all data: " + event.target.error);
    });
}

// Delete data from a store
export async function deleteDataFromDB(storeName, key) {
    return new Promise((resolve, reject) => {
        const transaction = db.transaction([storeName], 'readwrite');
        const store = transaction.objectStore(storeName);
        const request = store.delete(key);
        request.onsuccess = () => resolve();
        request.onerror = event => reject("Error deleting data: " + event.target.error);
    });
}

// Log an interaction
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

// Get the database instance
export function getDB() {
    return db;
}