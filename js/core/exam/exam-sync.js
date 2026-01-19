/**
 * Exam Mode Sync - Operation Log for Cloud Syncing
 * 
 * Implements an event-sourced sync architecture for offline-first, multi-device
 * exam data synchronisation.
 * 
 * Key principles:
 * - Sync **events**, not final state
 * - Server assigns global ordering (serverSeq)
 * - Client queues ops offline, pushes in batches
 * - Deterministic replay into local store
 */

import { generateUUID } from './exam-mode.js';

// --- Operation Types ---

/**
 * Operation types for the sync log.
 */
export const OP_TYPES = {
    // Atom operations
    ATOM_CREATE: 'atom_create',
    ATOM_UPDATE: 'atom_update',
    ATOM_DELETE: 'atom_delete',
    
    // Error atom operations
    ERROR_ATOM_CREATE: 'error_atom_create',
    ERROR_ATOM_UPDATE: 'error_atom_update',
    ERROR_ATOM_DELETE: 'error_atom_delete',
    
    // Question operations
    QUESTION_CREATE: 'question_create',
    QUESTION_UPDATE: 'question_update',
    QUESTION_DELETE: 'question_delete',
    
    // Mark scheme operations
    MARK_SCHEME_CREATE: 'mark_scheme_create',
    MARK_SCHEME_UPDATE: 'mark_scheme_update',
    MARK_SCHEME_DELETE: 'mark_scheme_delete',
    
    // Exam spec operations
    EXAM_SPEC_CREATE: 'exam_spec_create',
    EXAM_SPEC_UPDATE: 'exam_spec_update',
    EXAM_SPEC_DELETE: 'exam_spec_delete',
    
    // Exam paper operations
    EXAM_PAPER_CREATE: 'exam_paper_create',
    EXAM_PAPER_DELETE: 'exam_paper_delete',
    
    // Sitting operations
    SITTING_CREATE: 'sitting_create',
    SITTING_START: 'sitting_start',
    SITTING_PAUSE: 'sitting_pause',
    SITTING_RESUME: 'sitting_resume',
    SITTING_RESPONSE: 'sitting_response',
    SITTING_SUBMIT: 'sitting_submit',
    
    // Marking operations
    MARKING_RECORD_CREATE: 'marking_record_create',
    MARKING_OVERRIDE: 'marking_override'
};

// --- Operation Creation ---

/**
 * Creates a sync operation.
 * @param {string} type Operation type from OP_TYPES
 * @param {string} entityId ID of the entity being operated on
 * @param {Object} payload Operation data
 * @param {Object} options Additional options
 * @returns {Object} Operation object
 */
export function createOperation(type, entityId, payload, options = {}) {
    return {
        opId: generateUUID(),
        type,
        entityId,
        payload: payload || {},
        clientTimestamp: new Date().toISOString(),
        serverSeq: null, // Assigned by server
        userId: options.userId || 'default_user',
        deviceId: options.deviceId || getDeviceId(),
        version: 1
    };
}

/**
 * Gets or creates a device ID.
 * @returns {string} Device ID
 */
function getDeviceId() {
    if (typeof localStorage !== 'undefined') {
        let deviceId = localStorage.getItem('lagiote_device_id');
        if (!deviceId) {
            deviceId = generateUUID();
            localStorage.setItem('lagiote_device_id', deviceId);
        }
        return deviceId;
    }
    return 'unknown_device';
}

// --- Operation Queue ---

/**
 * Creates an operation queue for managing pending sync operations.
 * @returns {Object} Queue manager
 */
export function createOperationQueue() {
    const pending = [];
    let lastServerSeq = 0;
    
    return {
        /**
         * Adds an operation to the queue.
         * @param {Object} op Operation to queue
         */
        enqueue(op) {
            pending.push(op);
        },
        
        /**
         * Gets all pending operations.
         * @returns {Array} Pending operations
         */
        getPending() {
            return [...pending];
        },
        
        /**
         * Removes operations that have been synced.
         * @param {Array} opIds IDs of synced operations
         */
        markSynced(opIds) {
            const idSet = new Set(opIds);
            for (let i = pending.length - 1; i >= 0; i--) {
                if (idSet.has(pending[i].opId)) {
                    pending.splice(i, 1);
                }
            }
        },
        
        /**
         * Gets the last known server sequence number.
         * @returns {number} Last server sequence
         */
        getLastServerSeq() {
            return lastServerSeq;
        },
        
        /**
         * Updates the last known server sequence number.
         * @param {number} seq New sequence number
         */
        setLastServerSeq(seq) {
            lastServerSeq = Math.max(lastServerSeq, seq);
        },
        
        /**
         * Gets queue length.
         * @returns {number} Number of pending operations
         */
        size() {
            return pending.length;
        },
        
        /**
         * Clears the queue.
         */
        clear() {
            pending.length = 0;
        }
    };
}

// --- Sync Client ---

/**
 * Creates a sync client for pushing and pulling operations.
 * @param {Object} options Client options
 * @returns {Object} Sync client
 */
export function createSyncClient(options = {}) {
    const queue = createOperationQueue();
    const baseUrl = options.baseUrl || '';
    const onConflict = options.onConflict || defaultConflictHandler;
    const onError = options.onError || console.error;
    
    return {
        queue,
        
        /**
         * Queues an operation for sync.
         * @param {string} type Operation type
         * @param {string} entityId Entity ID
         * @param {Object} payload Payload data
         */
        queueOperation(type, entityId, payload) {
            const op = createOperation(type, entityId, payload, {
                userId: options.userId,
                deviceId: options.deviceId
            });
            queue.enqueue(op);
            return op;
        },
        
        /**
         * Pushes pending operations to the server.
         * @returns {Promise<Object>} Push result
         */
        async push() {
            const pending = queue.getPending();
            if (!pending.length) {
                return { success: true, pushed: 0 };
            }
            
            try {
                const response = await fetch(`${baseUrl}/sync/push`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ operations: pending })
                });
                
                if (!response.ok) {
                    throw new Error(`Push failed: ${response.status}`);
                }
                
                const result = await response.json();
                
                // Mark successfully pushed operations
                if (result.syncedOpIds) {
                    queue.markSynced(result.syncedOpIds);
                }
                
                // Update last server sequence
                if (result.serverSeq) {
                    queue.setLastServerSeq(result.serverSeq);
                }
                
                return { success: true, pushed: result.syncedOpIds?.length || 0 };
            } catch (error) {
                onError(error);
                return { success: false, error: error.message };
            }
        },
        
        /**
         * Pulls operations from the server since last sync.
         * @returns {Promise<Object>} Pull result with operations
         */
        async pull() {
            try {
                const lastSeq = queue.getLastServerSeq();
                const response = await fetch(
                    `${baseUrl}/sync/pull?since=${lastSeq}`,
                    { method: 'GET' }
                );
                
                if (!response.ok) {
                    throw new Error(`Pull failed: ${response.status}`);
                }
                
                const result = await response.json();
                
                if (result.serverSeq) {
                    queue.setLastServerSeq(result.serverSeq);
                }
                
                return {
                    success: true,
                    operations: result.operations || [],
                    serverSeq: result.serverSeq
                };
            } catch (error) {
                onError(error);
                return { success: false, error: error.message, operations: [] };
            }
        },
        
        /**
         * Performs a full sync (push then pull).
         * @param {Function} applyOperation Function to apply operations locally
         * @returns {Promise<Object>} Sync result
         */
        async sync(applyOperation) {
            // Push pending changes
            const pushResult = await this.push();
            
            // Pull new changes
            const pullResult = await this.pull();
            
            // Apply pulled operations
            const applied = [];
            const conflicts = [];
            
            for (const op of pullResult.operations || []) {
                try {
                    const result = await applyOperation(op);
                    if (result.conflict) {
                        const resolution = await onConflict(op, result);
                        conflicts.push({ op, resolution });
                    } else {
                        applied.push(op);
                    }
                } catch (error) {
                    onError(error);
                }
            }
            
            return {
                success: pushResult.success && pullResult.success,
                pushed: pushResult.pushed || 0,
                pulled: applied.length,
                conflicts: conflicts.length
            };
        },
        
        /**
         * Gets sync status.
         * @returns {Object} Status info
         */
        getStatus() {
            return {
                pendingCount: queue.size(),
                lastServerSeq: queue.getLastServerSeq()
            };
        }
    };
}

/**
 * Default conflict handler - last write wins.
 * @param {Object} op The conflicting operation
 * @param {Object} result The conflict details
 * @returns {Object} Resolution
 */
function defaultConflictHandler(op, result) {
    // Last write wins for sittings and responses
    if (op.type.startsWith('sitting_') || op.type === OP_TYPES.SITTING_RESPONSE) {
        return { strategy: 'last_write_wins', apply: true };
    }
    
    // For content (questions, mark schemes), flag for manual review
    return { strategy: 'manual_review', apply: false };
}

// --- Operation Application ---

/**
 * Applies an operation to the local store.
 * @param {Object} op Operation to apply
 * @param {Object} stores Store accessors { atoms, questions, markSchemes, ... }
 * @returns {Object} Application result
 */
export async function applyOperation(op, stores) {
    const { type, entityId, payload } = op;
    
    switch (type) {
        case OP_TYPES.ATOM_CREATE:
        case OP_TYPES.ATOM_UPDATE:
            await stores.atoms.put({ id: entityId, ...payload, updatedAt: op.clientTimestamp });
            break;
            
        case OP_TYPES.ATOM_DELETE:
            await stores.atoms.put({ id: entityId, isDeleted: true, updatedAt: op.clientTimestamp });
            break;
            
        case OP_TYPES.ERROR_ATOM_CREATE:
        case OP_TYPES.ERROR_ATOM_UPDATE:
            await stores.errorAtoms.put({ id: entityId, ...payload, updatedAt: op.clientTimestamp });
            break;
            
        case OP_TYPES.ERROR_ATOM_DELETE:
            await stores.errorAtoms.put({ id: entityId, isDeleted: true, updatedAt: op.clientTimestamp });
            break;
            
        case OP_TYPES.QUESTION_CREATE:
        case OP_TYPES.QUESTION_UPDATE:
            await stores.questions.put({ id: entityId, ...payload, updatedAt: op.clientTimestamp });
            break;
            
        case OP_TYPES.QUESTION_DELETE:
            await stores.questions.put({ id: entityId, isDeleted: true, updatedAt: op.clientTimestamp });
            break;
            
        case OP_TYPES.MARK_SCHEME_CREATE:
        case OP_TYPES.MARK_SCHEME_UPDATE:
            await stores.markSchemes.put({ id: entityId, ...payload, updatedAt: op.clientTimestamp });
            break;
            
        case OP_TYPES.MARK_SCHEME_DELETE:
            await stores.markSchemes.put({ id: entityId, isDeleted: true, updatedAt: op.clientTimestamp });
            break;
            
        case OP_TYPES.EXAM_SPEC_CREATE:
        case OP_TYPES.EXAM_SPEC_UPDATE:
            await stores.examSpecs.put({ id: entityId, ...payload, updatedAt: op.clientTimestamp });
            break;
            
        case OP_TYPES.EXAM_SPEC_DELETE:
            await stores.examSpecs.put({ id: entityId, isDeleted: true, updatedAt: op.clientTimestamp });
            break;
            
        case OP_TYPES.EXAM_PAPER_CREATE:
            await stores.examPapers.put({ id: entityId, ...payload });
            break;
            
        case OP_TYPES.EXAM_PAPER_DELETE:
            await stores.examPapers.put({ id: entityId, isDeleted: true, updatedAt: op.clientTimestamp });
            break;
            
        case OP_TYPES.SITTING_CREATE:
        case OP_TYPES.SITTING_START:
        case OP_TYPES.SITTING_PAUSE:
        case OP_TYPES.SITTING_RESUME:
        case OP_TYPES.SITTING_SUBMIT:
            const sitting = await stores.examSittings.get(entityId) || { id: entityId };
            await stores.examSittings.put({ ...sitting, ...payload, updatedAt: op.clientTimestamp });
            break;
            
        case OP_TYPES.SITTING_RESPONSE:
            const sittingForResponse = await stores.examSittings.get(entityId);
            if (sittingForResponse) {
                const responses = { ...sittingForResponse.responses, [payload.questionId]: payload.response };
                await stores.examSittings.put({
                    ...sittingForResponse,
                    responses,
                    updatedAt: op.clientTimestamp
                });
            }
            break;
            
        case OP_TYPES.MARKING_RECORD_CREATE:
            await stores.markingRecords.put({ id: entityId, ...payload });
            break;
            
        case OP_TYPES.MARKING_OVERRIDE:
            const record = await stores.markingRecords.get(entityId);
            if (record) {
                await stores.markingRecords.put({
                    ...record,
                    ...payload,
                    overriddenAt: op.clientTimestamp,
                    overriddenBy: op.userId
                });
            }
            break;
            
        default:
            console.warn(`Unknown operation type: ${type}`);
    }
    
    return { success: true };
}

// --- Non-Sync Derived Data ---

/**
 * List of data types that should NOT be synced.
 * These are computed/derived and should be recalculated locally.
 */
export const NON_SYNC_DERIVED = [
    'predictions',
    'analytics_aggregates',
    'completion_estimates',
    'time_remaining_estimates',
    'cached_masteries',
    'session_recommendations'
];

/**
 * Checks if a data type should be synced.
 * @param {string} dataType Type of data
 * @returns {boolean} True if should sync
 */
export function shouldSync(dataType) {
    return !NON_SYNC_DERIVED.includes(dataType);
}

// --- Tombstone Handling ---

/**
 * Creates a tombstone for a deleted entity.
 * @param {string} entityType Entity type
 * @param {string} entityId Entity ID
 * @param {Object} options Options
 * @returns {Object} Tombstone record
 */
export function createTombstone(entityType, entityId, options = {}) {
    return {
        id: entityId,
        entityType,
        isDeleted: true,
        deletedAt: new Date().toISOString(),
        deletedBy: options.userId || 'default_user',
        version: options.version || 1
    };
}

/**
 * Checks if an entity is tombstoned.
 * @param {Object} entity Entity to check
 * @returns {boolean} True if tombstoned
 */
export function isTombstoned(entity) {
    return entity && entity.isDeleted === true;
}

// --- Schema Versioning ---

/**
 * Current sync schema version.
 */
export const SYNC_SCHEMA_VERSION = 1;

/**
 * Migrates an operation to the current schema version.
 * @param {Object} op Operation to migrate
 * @returns {Object} Migrated operation
 */
export function migrateOperation(op) {
    // Currently only v1, no migration needed
    if (op.version === SYNC_SCHEMA_VERSION) {
        return op;
    }
    
    // Add migration logic here for future versions
    return { ...op, version: SYNC_SCHEMA_VERSION };
}

export default {
    OP_TYPES,
    createOperation,
    createOperationQueue,
    createSyncClient,
    applyOperation,
    NON_SYNC_DERIVED,
    shouldSync,
    createTombstone,
    isTombstoned,
    SYNC_SCHEMA_VERSION,
    migrateOperation
};
