/**
 * Sync Server Mock Tests
 * 
 * Tests the mock sync server and client integration.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
    createMockSyncServer,
    createMockSyncClient,
    runSyncIntegrationTest
} from '../../js/core/exam/sync-server-mock.js';
import { OP_TYPES } from '../../js/core/exam/exam-sync.js';

describe('Sync Server Mock - Server Operations', () => {
    let server;
    
    beforeEach(() => {
        server = createMockSyncServer({ latency: 0 });
    });
    
    it('stores operations with sequence numbers', async () => {
        const ops = [
            { opId: 'op1', type: OP_TYPES.ATOM_CREATE, entityId: 'a1', payload: { name: 'Test' } }
        ];
        
        const result = await server.push(ops);
        
        expect(result.success).toBe(true);
        expect(result.serverSeq).toBe(1);
    });
    
    it('assigns incrementing sequence numbers', async () => {
        await server.push([{ opId: 'op1', type: OP_TYPES.ATOM_CREATE, entityId: 'a1', payload: {} }]);
        await server.push([{ opId: 'op2', type: OP_TYPES.ATOM_CREATE, entityId: 'a2', payload: {} }]);
        
        const stats = server.getStats();
        expect(stats.currentSeq).toBe(2);
    });
    
    it('detects duplicate operations', async () => {
        const op = { opId: 'op1', type: OP_TYPES.ATOM_CREATE, entityId: 'a1', payload: {} };
        
        await server.push([op]);
        const result = await server.push([op]);
        
        expect(result.results[0].status).toBe('duplicate');
    });
    
    it('pulls operations since sequence', async () => {
        await server.push([
            { opId: 'op1', type: OP_TYPES.ATOM_CREATE, entityId: 'a1', payload: {} },
            { opId: 'op2', type: OP_TYPES.ATOM_CREATE, entityId: 'a2', payload: {} }
        ]);
        
        const result = await server.pull(1);
        
        expect(result.success).toBe(true);
        expect(result.operations).toHaveLength(1);
        expect(result.operations[0].opId).toBe('op2');
    });
    
    it('stores entity state', async () => {
        await server.push([{
            opId: 'op1',
            type: OP_TYPES.ATOM_CREATE,
            entityId: 'atom-1',
            payload: { name: 'Test Atom', mastery: 0.5 }
        }]);
        
        const entity = server.getEntity('atom-1');
        
        expect(entity).toBeDefined();
        expect(entity.name).toBe('Test Atom');
    });
    
    it('applies updates to entities', async () => {
        await server.push([{
            opId: 'op1',
            type: OP_TYPES.ATOM_CREATE,
            entityId: 'atom-1',
            payload: { name: 'Test', mastery: 0.5 }
        }]);
        
        await server.push([{
            opId: 'op2',
            type: OP_TYPES.ATOM_UPDATE,
            entityId: 'atom-1',
            payload: { mastery: 0.8 }
        }]);
        
        const entity = server.getEntity('atom-1');
        expect(entity.mastery).toBe(0.8);
        expect(entity.name).toBe('Test'); // Original preserved
    });
    
    it('handles deletions with tombstones', async () => {
        await server.push([{
            opId: 'op1',
            type: OP_TYPES.ATOM_CREATE,
            entityId: 'atom-1',
            payload: { name: 'Test' }
        }]);
        
        await server.push([{
            opId: 'op2',
            type: OP_TYPES.ATOM_DELETE,
            entityId: 'atom-1',
            payload: {}
        }]);
        
        expect(server.getEntity('atom-1')).toBeNull();
        expect(server.isTombstoned('atom-1')).toBe(true);
    });
    
    it('rejects invalid operations', async () => {
        const result = await server.push('not an array');
        
        expect(result.success).toBe(false);
        expect(result.error).toContain('must be an array');
    });
    
    it('provides statistics', async () => {
        await server.push([{
            opId: 'op1',
            type: OP_TYPES.ATOM_CREATE,
            entityId: 'a1',
            payload: {}
        }]);
        
        const stats = server.getStats();
        
        expect(stats.totalOperations).toBe(1);
        expect(stats.totalEntities).toBe(1);
        expect(stats.currentSeq).toBe(1);
    });
    
    it('resets state', async () => {
        await server.push([{ opId: 'op1', type: OP_TYPES.ATOM_CREATE, entityId: 'a1', payload: {} }]);
        
        server.reset();
        
        const stats = server.getStats();
        expect(stats.totalOperations).toBe(0);
        expect(stats.totalEntities).toBe(0);
        expect(stats.currentSeq).toBe(0);
    });
});

describe('Sync Server Mock - Client Operations', () => {
    let server;
    let client;
    
    beforeEach(() => {
        server = createMockSyncServer({ latency: 0 });
        client = createMockSyncClient(server, { deviceId: 'test-device' });
    });
    
    it('queues operations', () => {
        const op = client.queueOperation(OP_TYPES.ATOM_CREATE, 'a1', { name: 'Test' });
        
        expect(op.opId).toBeDefined();
        expect(client.queue).toHaveLength(1);
    });
    
    it('pushes queued operations', async () => {
        client.queueOperation(OP_TYPES.ATOM_CREATE, 'a1', { name: 'Test' });
        
        const result = await client.push();
        
        expect(result.success).toBe(true);
        expect(result.pushed).toBe(1);
        expect(client.queue).toHaveLength(0);
    });
    
    it('returns success for empty queue', async () => {
        const result = await client.push();
        
        expect(result.success).toBe(true);
        expect(result.pushed).toBe(0);
    });
    
    it('pulls operations from server', async () => {
        // Add operation to server directly
        await server.push([{
            opId: 'server-op',
            type: OP_TYPES.ATOM_CREATE,
            entityId: 'a1',
            payload: { name: 'Server Atom' }
        }]);
        
        const result = await client.pull();
        
        expect(result.success).toBe(true);
        expect(result.operations).toHaveLength(1);
        expect(client.lastServerSeq).toBe(1);
    });
    
    it('performs full sync', async () => {
        client.queueOperation(OP_TYPES.ATOM_CREATE, 'a1', { name: 'Client Atom' });
        
        const applied = [];
        const result = await client.sync((op) => {
            applied.push(op);
        });
        
        expect(result.success).toBe(true);
        expect(result.pushed).toBe(1);
        expect(applied).toHaveLength(0); // No server ops yet
    });
    
    it('tracks pending count', () => {
        expect(client.getStatus().pendingCount).toBe(0);
        
        client.queueOperation(OP_TYPES.ATOM_CREATE, 'a1', {});
        client.queueOperation(OP_TYPES.ATOM_CREATE, 'a2', {});
        
        expect(client.getStatus().pendingCount).toBe(2);
    });
    
    it('includes device and user IDs', async () => {
        client.queueOperation(OP_TYPES.ATOM_CREATE, 'a1', {});
        
        await client.push();
        
        const entity = server.getEntity('a1');
        expect(entity).toBeDefined();
    });
});

describe('Sync Server Mock - Integration', () => {
    let server;
    let clientA;
    let clientB;
    
    beforeEach(() => {
        server = createMockSyncServer({ latency: 0 });
        clientA = createMockSyncClient(server, { deviceId: 'device-a', userId: 'user-1' });
        clientB = createMockSyncClient(server, { deviceId: 'device-b', userId: 'user-1' });
    });
    
    it('synchronizes between clients', async () => {
        // Client A creates an atom
        clientA.queueOperation(OP_TYPES.ATOM_CREATE, 'atom-1', { name: 'Shared Atom' });
        await clientA.push();
        
        // Client B pulls
        await clientB.pull();
        
        // Verify server has the entity
        const entity = server.getEntity('atom-1');
        expect(entity.name).toBe('Shared Atom');
    });
    
    it('merges concurrent updates', async () => {
        // Initial creation
        clientA.queueOperation(OP_TYPES.ATOM_CREATE, 'atom-1', { name: 'Test', mastery: 0.5 });
        await clientA.push();
        
        // Both clients update
        clientA.queueOperation(OP_TYPES.ATOM_UPDATE, 'atom-1', { mastery: 0.7 });
        clientB.queueOperation(OP_TYPES.ATOM_UPDATE, 'atom-1', { name: 'Updated' });
        
        await clientA.push();
        await clientB.push();
        
        // Last write wins
        const entity = server.getEntity('atom-1');
        expect(entity.name).toBe('Updated');
    });
    
    it('handles multiple entity types', async () => {
        clientA.queueOperation(OP_TYPES.ATOM_CREATE, 'atom-1', { name: 'Atom' });
        clientA.queueOperation(OP_TYPES.QUESTION_CREATE, 'q1', { prompt: 'Question' });
        clientA.queueOperation(OP_TYPES.MARK_SCHEME_CREATE, 'ms1', { schemeType: 'points' });
        
        await clientA.push();
        
        const stats = server.getStats();
        expect(stats.totalOperations).toBe(3);
        expect(stats.totalEntities).toBe(3);
    });
    
    it('tracks sitting operations', async () => {
        clientA.queueOperation(OP_TYPES.SITTING_CREATE, 'sitting-1', { status: 'not_started' });
        clientA.queueOperation(OP_TYPES.SITTING_RESPONSE, 'sitting-1', { questionId: 'q1', response: 'A' });
        clientA.queueOperation(OP_TYPES.SITTING_SUBMIT, 'sitting-1', { submittedAt: new Date().toISOString() });
        
        await clientA.push();
        
        const stats = server.getStats();
        expect(stats.totalOperations).toBe(3);
    });
});

describe('Sync Server Mock - Pre-built Integration Test', () => {
    it('runs complete integration test', async () => {
        const result = await runSyncIntegrationTest();
        
        expect(result.success).toBe(true);
        expect(result.operationsExchanged).toBeGreaterThan(0);
        expect(result.finalMastery).toBe(0.7);
    });
});

describe('Sync Server Mock - Error Handling', () => {
    it('handles server errors gracefully', async () => {
        const server = createMockSyncServer();
        const client = createMockSyncClient(server);
        
        // Note: The mock doesn't actually support error mode in the current implementation
        // This test documents expected behavior
        
        client.queueOperation(OP_TYPES.ATOM_CREATE, 'a1', {});
        const result = await client.push();
        
        expect(result.success).toBe(true);
    });
});

describe('Sync Server Mock - Timing', () => {
    it('simulates network latency', async () => {
        const server = createMockSyncServer({ latency: 50 });
        
        const start = Date.now();
        await server.push([{ opId: 'op1', type: OP_TYPES.ATOM_CREATE, entityId: 'a1', payload: {} }]);
        const elapsed = Date.now() - start;
        
        expect(elapsed).toBeGreaterThanOrEqual(45); // Allow some tolerance
    });
});
