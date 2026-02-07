/**
 * Cloud Sync Server Mock
 * 
 * Provides a client-side mock implementation of the sync server
 * for development and testing. Implements the server-side logic
 * of the operation log sync protocol.
 */

import { generateUUID } from './exam-mode.js';
import { OP_TYPES, createTombstone, NON_SYNC_DERIVED } from './exam-sync.js';

/**
 * Creates a mock sync server.
 * @param {Object} options Server options
 * @returns {Object} Mock server interface
 */
export function createMockSyncServer(options = {}) {
    // In-memory storage
    const storage = {
        operations: [],
        entities: new Map(),
        tombstones: new Map()
    };
    
    let serverSequence = 0;
    const latency = options.latency || 100; // Simulated network latency
    
    /**
     * Simulates network delay.
     * @returns {Promise} Delay promise
     */
    function simulateDelay() {
        return new Promise(resolve => setTimeout(resolve, latency));
    }
    
    /**
     * Gets the next server sequence number.
     * @returns {number} Sequence number
     */
    function nextSeq() {
        return ++serverSequence;
    }
    
    /**
     * Stores an operation.
     * @param {Object} op Operation
     */
    function storeOperation(op) {
        const stored = {
            ...op,
            serverSeq: nextSeq(),
            storedAt: new Date().toISOString()
        };
        storage.operations.push(stored);
        
        // Apply to entity state
        applyOperationToState(op);
        
        return stored;
    }
    
    /**
     * Applies an operation to the server state.
     * @param {Object} op Operation
     */
    function applyOperationToState(op) {
        const { type, entityId, payload } = op;
        
        // Handle deletions (case-insensitive)
        if (/_delete$/i.test(type)) {
            storage.tombstones.set(entityId, createTombstone(
                type.replace(/_delete$/i, ''),
                entityId,
                { userId: op.userId }
            ));
            storage.entities.delete(entityId);
            return;
        }
        
        // Handle updates/creates
        const existing = storage.entities.get(entityId) || {};
        storage.entities.set(entityId, {
            ...existing,
            ...payload,
            id: entityId,
            serverSeq: serverSequence,
            lastModified: (payload && payload.updatedAt) ? payload.updatedAt : op.clientTimestamp,
            lastDeviceId: op.deviceId
        });
    }
    
    /**
     * Checks for conflicts.
     * @param {Object} op Incoming operation
     * @returns {Object|null} Conflict info or null
     */
    function checkConflict(op) {
        const existing = storage.entities.get(op.entityId);
        if (!existing) return null;
        
        // Check if this is a content edit conflict
        const contentTypes = [
            OP_TYPES.ATOM_UPDATE,
            OP_TYPES.QUESTION_UPDATE,
            OP_TYPES.MARK_SCHEME_UPDATE
        ];
        
        if (contentTypes.includes(op.type) && op.payload?.updatedAt) {
            // Different device, same entity, both updates = potential conflict
            if (existing.lastModified && 
                existing.lastModified !== op.payload.updatedAt &&
                op.deviceId !== existing.lastDeviceId) {
                return {
                    type: 'edit_conflict',
                    entityId: op.entityId,
                    serverVersion: existing,
                    clientVersion: op.payload
                };
            }
        }
        
        return null;
    }
    
    return {
        /**
         * Pushes operations from client.
         * @param {Array} operations Client operations
         * @returns {Promise<Object>} Push result
         */
        async push(operations) {
            await simulateDelay();
            
            if (!Array.isArray(operations)) {
                return { success: false, error: 'Operations must be an array' };
            }
            
            const results = [];
            const syncedOpIds = [];
            const conflicts = [];
            
            for (const op of operations) {
                // Check for duplicate
                const exists = storage.operations.some(o => o.opId === op.opId);
                if (exists) {
                    results.push({ opId: op.opId, status: 'duplicate', serverSeq: null });
                    continue;
                }
                
                // Check for conflicts
                const conflict = checkConflict(op);
                if (conflict) {
                    conflicts.push(conflict);
                    // For content, reject; for sittings, allow
                    if (op.type.startsWith('SITTING_') || op.type.includes('_RESPONSE')) {
                        const stored = storeOperation(op);
                        results.push({ opId: op.opId, status: 'synced_conflict', serverSeq: stored.serverSeq });
                        syncedOpIds.push(op.opId);
                    } else {
                        results.push({ 
                            opId: op.opId, 
                            status: 'conflict', 
                            conflict,
                            resolution: 'manual_review_required'
                        });
                    }
                    continue;
                }
                
                // Store operation
                const stored = storeOperation(op);
                results.push({ opId: op.opId, status: 'synced', serverSeq: stored.serverSeq });
                syncedOpIds.push(op.opId);
            }
            
            return {
                success: true,
                syncedOpIds,
                serverSeq: serverSequence,
                results,
                conflicts: conflicts.length > 0 ? conflicts : undefined
            };
        },
        
        /**
         * Pulls operations since a sequence number.
         * @param {number} since Last known sequence
         * @returns {Promise<Object>} Pull result
         */
        async pull(since = 0) {
            await simulateDelay();
            
            const operations = storage.operations
                .filter(op => op.serverSeq > since)
                .sort((a, b) => a.serverSeq - b.serverSeq);
            
            return {
                success: true,
                operations: operations.map(op => ({
                    opId: op.opId,
                    type: op.type,
                    entityId: op.entityId,
                    payload: op.payload,
                    clientTimestamp: op.clientTimestamp,
                    serverSeq: op.serverSeq,
                    userId: op.userId,
                    deviceId: op.deviceId
                })),
                serverSeq: serverSequence,
                hasMore: false // Pagination could be added
            };
        },
        
        /**
         * Gets current entity state.
         * @param {string} entityType Entity type
         * @returns {Array} Entities of type
         */
        getEntities(entityType) {
            const entities = [];
            for (const [id, entity] of storage.entities) {
                if (entity.entityType === entityType || !entityType) {
                    entities.push(entity);
                }
            }
            return entities;
        },
        
        /**
         * Gets a specific entity.
         * @param {string} entityId Entity ID
         * @returns {Object|null} Entity
         */
        getEntity(entityId) {
            return storage.entities.get(entityId) || null;
        },
        
        /**
         * Checks if entity is tombstoned.
         * @param {string} entityId Entity ID
         * @returns {boolean} Is deleted
         */
        isTombstoned(entityId) {
            return storage.tombstones.has(entityId);
        },
        
        /**
         * Gets server statistics.
         * @returns {Object} Stats
         */
        getStats() {
            return {
                totalOperations: storage.operations.length,
                totalEntities: storage.entities.size,
                totalTombstones: storage.tombstones.size,
                currentSeq: serverSequence
            };
        },
        
        /**
         * Resets server state (for testing).
         */
        reset() {
            storage.operations.length = 0;
            storage.entities.clear();
            storage.tombstones.clear();
            serverSequence = 0;
        },
        
        /**
         * Simulates a server error.
         * @param {boolean} shouldError Whether to error
         */
        setErrorMode(shouldError) {
            this._errorMode = shouldError;
        },
        
        /**
         * Gets raw storage (for debugging).
         */
        _getStorage() {
            return {
                operations: [...storage.operations],
                entities: new Map(storage.entities),
                tombstones: new Map(storage.tombstones)
            };
        }
    };
}

/**
 * Creates a sync client that connects to the mock server.
 * @param {Object} mockServer Mock server instance
 * @param {Object} options Client options
 * @returns {Object} Enhanced sync client
 */
export function createMockSyncClient(mockServer, options = {}) {
    const client = {
        queue: [],
        lastServerSeq: 0,
        
        /**
         * Queues an operation.
         */
        queueOperation(type, entityId, payload) {
            const op = {
                opId: generateUUID(),
                type,
                entityId,
                payload,
                clientTimestamp: new Date().toISOString(),
                deviceId: options.deviceId || 'mock_device',
                userId: options.userId || 'mock_user'
            };
            this.queue.push(op);
            return op;
        },
        
        /**
         * Pushes queued operations.
         */
        async push() {
            if (this.queue.length === 0) {
                return { success: true, pushed: 0 };
            }
            
            const result = await mockServer.push(this.queue);
            
            if (result.success) {
                // Remove synced operations
                const syncedSet = new Set(result.syncedOpIds);
                this.queue = this.queue.filter(op => !syncedSet.has(op.opId));
                this.lastServerSeq = result.serverSeq;
            }
            
            return {
                success: result.success,
                pushed: result.syncedOpIds?.length || 0,
                conflicts: result.conflicts
            };
        },
        
        /**
         * Pulls operations from server.
         */
        async pull() {
            const result = await mockServer.pull(this.lastServerSeq);
            
            if (result.success) {
                this.lastServerSeq = result.serverSeq;
            }
            
            return result;
        },
        
        /**
         * Full sync (push then pull).
         */
        async sync(applyFn) {
            const pushResult = await this.push();
            const pullResult = await this.pull();
            
            const applied = [];
            for (const op of pullResult.operations || []) {
                if (applyFn) {
                    await applyFn(op);
                }
                applied.push(op);
            }
            
            return {
                success: pushResult.success && pullResult.success,
                pushed: pushResult.pushed,
                pulled: applied.length,
                conflicts: pushResult.conflicts?.length || 0
            };
        },
        
        /**
         * Gets status.
         */
        getStatus() {
            return {
                pendingCount: this.queue.length,
                lastServerSeq: this.lastServerSeq
            };
        }
    };
    
    return client;
}

/**
 * Runs a sync integration test scenario.
 * @returns {Promise<Object>} Test results
 */
export async function runSyncIntegrationTest() {
    const server = createMockSyncServer({ latency: 10 });
    
    // Create two clients simulating different devices
    const clientA = createMockSyncClient(server, { deviceId: 'device_a', userId: 'user_1' });
    const clientB = createMockSyncClient(server, { deviceId: 'device_b', userId: 'user_1' });
    
    // Scenario: Client A creates an atom
    clientA.queueOperation(OP_TYPES.ATOM_CREATE, 'atom_1', { 
        name: 'Test Atom', 
        mastery: 0.5 
    });
    
    // Client A pushes
    const pushA = await clientA.push();
    
    // Client B pulls
    const pullB = await clientB.pull();
    
    // Client B updates the atom
    clientB.queueOperation(OP_TYPES.ATOM_UPDATE, 'atom_1', { 
        mastery: 0.7 
    });
    
    // Client B pushes
    const pushB = await clientB.push();
    
    // Client A pulls
    const pullA = await clientA.pull();
    
    // Verify server state
    const serverStats = server.getStats();
    const entity = server.getEntity('atom_1');
    
    return {
        success: pushA.success && pushB.success,
        operationsExchanged: pushA.pushed + pushB.pushed + pullA.operations?.length + pullB.operations?.length,
        finalMastery: entity?.mastery,
        serverStats,
        conflictOccurred: (pushA.conflicts?.length || 0) + (pushB.conflicts?.length || 0) > 0
    };
}

// --- Export Module ---

export default {
    createMockSyncServer,
    createMockSyncClient,
    runSyncIntegrationTest
};
