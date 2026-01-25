import { describe, it, expect, beforeEach } from 'vitest';
import {
    OP_TYPES,
    createOperation,
    createOperationQueue,
    createSyncClient,
    createTombstone,
    isTombstoned,
    shouldSync,
    NON_SYNC_DERIVED,
    SYNC_SCHEMA_VERSION,
    migrateOperation
} from '../../js/core/exam/exam-sync.js';

describe('Exam Sync - Operation Types', () => {
    it('defines all required operation types', () => {
        expect(OP_TYPES.ATOM_CREATE).toBe('atom_create');
        expect(OP_TYPES.ATOM_UPDATE).toBe('atom_update');
        expect(OP_TYPES.ATOM_DELETE).toBe('atom_delete');
        
        expect(OP_TYPES.QUESTION_CREATE).toBe('question_create');
        expect(OP_TYPES.QUESTION_UPDATE).toBe('question_update');
        expect(OP_TYPES.QUESTION_DELETE).toBe('question_delete');
        
        expect(OP_TYPES.SITTING_CREATE).toBe('sitting_create');
        expect(OP_TYPES.SITTING_RESPONSE).toBe('sitting_response');
        expect(OP_TYPES.SITTING_SUBMIT).toBe('sitting_submit');
        
        expect(OP_TYPES.MARKING_RECORD_CREATE).toBe('marking_record_create');
        expect(OP_TYPES.MARKING_OVERRIDE).toBe('marking_override');
    });
});

describe('Exam Sync - Operation Creation', () => {
    it('creates operation with required fields', () => {
        const op = createOperation(OP_TYPES.ATOM_CREATE, 'atom-123', {
            name: 'Test Atom',
            mastery: 0.5
        });
        
        expect(op.opId).toBeDefined();
        expect(op.type).toBe(OP_TYPES.ATOM_CREATE);
        expect(op.entityId).toBe('atom-123');
        expect(op.payload.name).toBe('Test Atom');
        expect(op.payload.mastery).toBe(0.5);
        expect(op.clientTimestamp).toBeDefined();
        expect(op.serverSeq).toBeNull();
        expect(op.version).toBe(1);
    });
    
    it('includes user and device IDs', () => {
        const op = createOperation(OP_TYPES.ATOM_UPDATE, 'atom-123', {}, {
            userId: 'user-456',
            deviceId: 'device-789'
        });
        
        expect(op.userId).toBe('user-456');
        expect(op.deviceId).toBe('device-789');
    });
    
    it('generates unique operation IDs', () => {
        const ops = new Set();
        for (let i = 0; i < 100; i++) {
            const op = createOperation(OP_TYPES.ATOM_CREATE, 'test', {});
            ops.add(op.opId);
        }
        expect(ops.size).toBe(100);
    });
});

describe('Exam Sync - Operation Queue', () => {
    let queue;
    
    beforeEach(() => {
        queue = createOperationQueue();
    });
    
    it('starts empty', () => {
        expect(queue.size()).toBe(0);
        expect(queue.getPending()).toHaveLength(0);
    });
    
    it('enqueues operations', () => {
        const op1 = createOperation(OP_TYPES.ATOM_CREATE, 'a1', {});
        const op2 = createOperation(OP_TYPES.ATOM_UPDATE, 'a2', {});
        
        queue.enqueue(op1);
        queue.enqueue(op2);
        
        expect(queue.size()).toBe(2);
        expect(queue.getPending()).toHaveLength(2);
    });
    
    it('marks operations as synced', () => {
        const op1 = createOperation(OP_TYPES.ATOM_CREATE, 'a1', {});
        const op2 = createOperation(OP_TYPES.ATOM_UPDATE, 'a2', {});
        
        queue.enqueue(op1);
        queue.enqueue(op2);
        queue.markSynced([op1.opId]);
        
        expect(queue.size()).toBe(1);
        expect(queue.getPending()[0].opId).toBe(op2.opId);
    });
    
    it('tracks server sequence', () => {
        expect(queue.getLastServerSeq()).toBe(0);
        
        queue.setLastServerSeq(10);
        expect(queue.getLastServerSeq()).toBe(10);
        
        queue.setLastServerSeq(5); // Should not decrease
        expect(queue.getLastServerSeq()).toBe(10);
        
        queue.setLastServerSeq(15);
        expect(queue.getLastServerSeq()).toBe(15);
    });
    
    it('clears all operations', () => {
        queue.enqueue(createOperation(OP_TYPES.ATOM_CREATE, 'a1', {}));
        queue.enqueue(createOperation(OP_TYPES.ATOM_CREATE, 'a2', {}));
        
        queue.clear();
        
        expect(queue.size()).toBe(0);
    });
});

describe('Exam Sync - Sync Client', () => {
    it('creates client with queue', () => {
        const client = createSyncClient();
        
        expect(client.queue).toBeDefined();
        expect(client.queue.size()).toBe(0);
    });
    
    it('queues operations', () => {
        const client = createSyncClient();
        
        const op = client.queueOperation(OP_TYPES.ATOM_CREATE, 'atom-1', {
            name: 'Test'
        });
        
        expect(op.opId).toBeDefined();
        expect(client.queue.size()).toBe(1);
    });
    
    it('reports status', () => {
        const client = createSyncClient();
        
        client.queueOperation(OP_TYPES.ATOM_CREATE, 'a1', {});
        client.queueOperation(OP_TYPES.ATOM_CREATE, 'a2', {});
        
        const status = client.getStatus();
        
        expect(status.pendingCount).toBe(2);
        expect(status.lastServerSeq).toBe(0);
    });
});

describe('Exam Sync - Tombstones', () => {
    it('creates tombstone for deleted entity', () => {
        const tombstone = createTombstone('atom', 'atom-123', {
            userId: 'user-1',
            version: 2
        });
        
        expect(tombstone.id).toBe('atom-123');
        expect(tombstone.entityType).toBe('atom');
        expect(tombstone.isDeleted).toBe(true);
        expect(tombstone.deletedAt).toBeDefined();
        expect(tombstone.deletedBy).toBe('user-1');
        expect(tombstone.version).toBe(2);
    });
    
    it('detects tombstoned entities', () => {
        expect(isTombstoned({ id: '1', isDeleted: true })).toBe(true);
        expect(isTombstoned({ id: '2', isDeleted: false })).toBe(false);
        expect(isTombstoned({ id: '3' })).toBe(false);
        expect(isTombstoned(null)).toBeFalsy();
        expect(isTombstoned(undefined)).toBeFalsy();
    });
});

describe('Exam Sync - Non-Sync Derived Data', () => {
    it('defines non-sync data types', () => {
        expect(NON_SYNC_DERIVED).toContain('predictions');
        expect(NON_SYNC_DERIVED).toContain('analytics_aggregates');
        expect(NON_SYNC_DERIVED).toContain('completion_estimates');
        expect(NON_SYNC_DERIVED).toContain('time_remaining_estimates');
    });
    
    it('should sync source-of-truth data', () => {
        expect(shouldSync('atoms')).toBe(true);
        expect(shouldSync('questions')).toBe(true);
        expect(shouldSync('examSittings')).toBe(true);
        expect(shouldSync('markSchemes')).toBe(true);
    });
    
    it('should not sync derived data', () => {
        expect(shouldSync('predictions')).toBe(false);
        expect(shouldSync('analytics_aggregates')).toBe(false);
        expect(shouldSync('completion_estimates')).toBe(false);
    });
});

describe('Exam Sync - Schema Versioning', () => {
    it('defines current schema version', () => {
        expect(SYNC_SCHEMA_VERSION).toBe(1);
    });
    
    it('migrates operation to current version', () => {
        const op = {
            opId: 'test',
            type: OP_TYPES.ATOM_CREATE,
            version: 1
        };
        
        const migrated = migrateOperation(op);
        
        expect(migrated.version).toBe(SYNC_SCHEMA_VERSION);
    });
    
    it('preserves operation data during migration', () => {
        const op = {
            opId: 'op-123',
            type: OP_TYPES.ATOM_UPDATE,
            entityId: 'atom-456',
            payload: { mastery: 0.7 },
            version: 1
        };
        
        const migrated = migrateOperation(op);
        
        expect(migrated.opId).toBe('op-123');
        expect(migrated.entityId).toBe('atom-456');
        expect(migrated.payload.mastery).toBe(0.7);
    });
});

describe('Exam Sync - Operation Types Coverage', () => {
    it('covers all entity types', () => {
        // Atoms
        expect(OP_TYPES.ATOM_CREATE).toBeDefined();
        expect(OP_TYPES.ATOM_UPDATE).toBeDefined();
        expect(OP_TYPES.ATOM_DELETE).toBeDefined();
        
        // Error atoms
        expect(OP_TYPES.ERROR_ATOM_CREATE).toBeDefined();
        expect(OP_TYPES.ERROR_ATOM_UPDATE).toBeDefined();
        expect(OP_TYPES.ERROR_ATOM_DELETE).toBeDefined();
        
        // Questions
        expect(OP_TYPES.QUESTION_CREATE).toBeDefined();
        expect(OP_TYPES.QUESTION_UPDATE).toBeDefined();
        expect(OP_TYPES.QUESTION_DELETE).toBeDefined();
        
        // Mark schemes
        expect(OP_TYPES.MARK_SCHEME_CREATE).toBeDefined();
        expect(OP_TYPES.MARK_SCHEME_UPDATE).toBeDefined();
        expect(OP_TYPES.MARK_SCHEME_DELETE).toBeDefined();
        
        // Exam specs
        expect(OP_TYPES.EXAM_SPEC_CREATE).toBeDefined();
        expect(OP_TYPES.EXAM_SPEC_UPDATE).toBeDefined();
        expect(OP_TYPES.EXAM_SPEC_DELETE).toBeDefined();
        
        // Exam papers
        expect(OP_TYPES.EXAM_PAPER_CREATE).toBeDefined();
        expect(OP_TYPES.EXAM_PAPER_DELETE).toBeDefined();
        
        // Sittings
        expect(OP_TYPES.SITTING_CREATE).toBeDefined();
        expect(OP_TYPES.SITTING_START).toBeDefined();
        expect(OP_TYPES.SITTING_PAUSE).toBeDefined();
        expect(OP_TYPES.SITTING_RESUME).toBeDefined();
        expect(OP_TYPES.SITTING_RESPONSE).toBeDefined();
        expect(OP_TYPES.SITTING_SUBMIT).toBeDefined();
        
        // Marking
        expect(OP_TYPES.MARKING_RECORD_CREATE).toBeDefined();
        expect(OP_TYPES.MARKING_OVERRIDE).toBeDefined();
    });
});
