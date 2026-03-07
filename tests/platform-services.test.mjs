import assert from 'assert';
import { createPlatformServices } from '../src/platform/shared/platform-services.js';

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

console.log('Platform services contract passed.');
