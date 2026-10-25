import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { IDBFactory, IDBObjectStore } from 'fake-indexeddb';
import { fsrs, Rating } from 'ts-fsrs';
import { FSRSAlgorithm } from '../../js/core/fsrs.js';

describe('committed storage', () => {
    let db;
    beforeEach(async () => {
        vi.resetModules();
        vi.stubGlobal('indexedDB', new IDBFactory());
        db = await import('../../js/core/db.js');
        await db.initDB();
    });
    afterEach(() => {
        db.closeDB();
        vi.restoreAllMocks();
        vi.unstubAllGlobals();
    });

    it('rejects a write when its transaction aborts after the request succeeds', async () => {
        const put = IDBObjectStore.prototype.put;
        vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (...args) {
            const request = put.apply(this, args);
            request.addEventListener('success', () => this.transaction.abort());
            return request;
        });
        await expect(db.saveDataToDB('decks', { id: 'lost', cards: [] })).rejects.toThrow();
        expect(await db.getDataFromDB('decks', 'lost')).toBeUndefined();
    });

    it('rolls back all collections when a later backup collection cannot be written', async () => {
        await db.saveDataToDB('decks', { id: 'existing', name: 'Original', cards: [] });
        const put = IDBObjectStore.prototype.put;
        vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (...args) {
            if (this.name === 'interactionLogs') throw new Error('Simulated storage failure');
            return put.apply(this, args);
        });
        await expect(db.importFullData({
            decks: [{ id: 'existing', name: 'Replaced', cards: [] }],
            interactionLogs: [{ cardID: 'card', timestamp: '2026-01-01T00:00:00Z' }]
        })).rejects.toThrow();
        expect((await db.getDataFromDB('decks', 'existing')).name).toBe('Original');
    });
});

it('uses the bundled FSRS scheduler for offline and test reviews', async () => {
    const scheduler = new FSRSAlgorithm();
    const now = new Date('2026-01-01T12:00:00Z');
    const card = scheduler.prepareCard({ state: 0, due: now });
    const expected = fsrs().repeat(card, now);
    const actual = await scheduler.repeat(card, now);
    expect(scheduler.getRatings().Again).toBe(Rating.Again);
    expect(actual[Rating.Again].card.due).toEqual(expected[Rating.Again].card.due);
    expect(actual[Rating.Good].card.stability).toBe(expected[Rating.Good].card.stability);
});
