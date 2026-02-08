let db;

export function getDB() {
    return db;
}

export function initDB(isRetry = false) {
    return new Promise((resolve, reject) => {
        // Incremented DB version to 14 to force onupgradeneeded
        const request = indexedDB.open('LagioteDB', 14);

        request.onerror = event => {
            console.error("DB Open Error:", event.target.error);
            // If this is the first attempt and it failed, try the destructive recovery
            if (!isRetry) {
                console.warn("Attempting to recover from DB error by deleting the database.");
                const deleteRequest = indexedDB.deleteDatabase('LagioteDB');
                deleteRequest.onsuccess = () => {
                    console.log("Database deleted successfully. Retrying initialisation.");
                    // Retry initDB, marking it as a retry to prevent infinite loops
                    initDB(true).then(resolve).catch(reject);
                };
                deleteRequest.onerror = (err) => {
                    console.error("Failed to delete database:", err.target.error);
                    reject("Error opening DB, and failed to recover: " + (event.target.error ? event.target.error.message : event.target.errorCode));
                };
            } else {
                // If the retry also fails, then there's a deeper issue.
                reject("Error opening DB even after recovery attempt: " + (event.target.error ? event.target.error.message : event.target.errorCode));
            }
        };

        request.onsuccess = event => {
            db = event.target.result;
            resolve();
        };

        request.onupgradeneeded = event => {
            db = event.target.result;
            const transaction = event.target.transaction;
            
            console.log(`Upgrading database from version ${event.oldVersion} to ${event.newVersion}`);

            // Use a set of required stores for cleaner checking
            const requiredStores = new Set(['decks', 'analyticsQueue', 'appData', 'concepts', 'userKnowledgeState', 'interactionLogs', 'examPlans']);

            requiredStores.forEach(storeName => {
                if (!db.objectStoreNames.contains(storeName)) {
                    console.log(`Creating object store: ${storeName}`);
                    if (storeName === 'userKnowledgeState') {
                        db.createObjectStore(storeName, { keyPath: ['userID', 'cardID'] });
                    } else if (storeName === 'interactionLogs') {
                        const logStore = db.createObjectStore(storeName, { keyPath: 'id', autoIncrement: true });
                        logStore.createIndex('by_cardID', 'cardID', { unique: false });
                        logStore.createIndex('by_timestamp', 'timestamp', { unique: false });
                    } else {
                         db.createObjectStore(storeName, { keyPath: storeName === 'appData' ? 'key' : 'id' });
                    }
                }
            });
        };
    });
}

export async function saveDataToDB(storeName, data) {
    if (!db) {
        console.warn('Database not initialised, skipping save to', storeName);
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
        console.warn('Database not initialised, cannot get from', storeName);
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
        console.warn('Database not initialised, cannot get all from', storeName);
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
        console.warn('Database not initialised, skipping delete from', storeName);
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
