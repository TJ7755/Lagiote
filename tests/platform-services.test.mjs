import assert from 'assert';
import { createPlatformServices } from '../src/platform/shared/platform-services.js';
import { createLegacyDashboardFacade } from '../src/features/dashboard/legacy-dashboard-facade.js';

const services = createPlatformServices();

assert.ok(services.runtime, 'runtime service missing');
assert.ok(services.auth, 'auth service missing');
assert.ok(services.storage, 'storage service missing');
assert.ok(services.ai, 'ai service missing');
assert.ok(services.sync, 'sync service missing');
assert.ok(services.shell, 'shell service missing');
assert.strictEqual(typeof services.runtime.isOnline, 'function', 'runtime.isOnline must be a function');
assert.strictEqual(typeof services.auth.startAuthFlow, 'function', 'auth.startAuthFlow must be a function');
assert.strictEqual(typeof services.ai.generateDeck, 'function', 'ai.generateDeck must be a function');
assert.strictEqual(typeof services.sync.syncData, 'function', 'sync.syncData must be a function');
assert.strictEqual(typeof services.shell.navigate, 'function', 'shell.navigate must be a function');

const originalWindow = globalThis.window;
const originalFetch = globalThis.fetch;

try {
    delete globalThis.window;
    const facade = createLegacyDashboardFacade();
    assert.strictEqual(facade.loadInitialState(), false, 'loadInitialState should return false without window');

    globalThis.window = {
        BACKEND_URL: 'https://example.com'
    };
    globalThis.fetch = async (url, options) => ({
        ok: true,
        async json() {
            return { url, options };
        }
    });

    const syncResult = await services.sync.syncData({
        token: 'test-token',
        lastSynced: '2026-03-07T00:00:00.000Z',
        dirtyDecks: []
    });

    assert.strictEqual(syncResult.url, 'https://example.com/api/sync', 'syncData should use the configured web sync endpoint');
    assert.strictEqual(syncResult.options.headers.Authorization, 'Bearer test-token', 'syncData should forward auth headers');
} finally {
    if (originalWindow === undefined) {
        delete globalThis.window;
    } else {
        globalThis.window = originalWindow;
    }

    if (originalFetch === undefined) {
        delete globalThis.fetch;
    } else {
        globalThis.fetch = originalFetch;
    }
}

console.log('Platform services contract passed.');
