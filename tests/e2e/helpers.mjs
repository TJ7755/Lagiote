import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const DEFAULT_TEST_CONFIG = {
    reset: true,
    seed: true,
    auth: 'user'
};

export function buildTestConfig(overrides = {}) {
    return { ...DEFAULT_TEST_CONFIG, ...(overrides || {}) };
}

export async function applyTestMode(page, config = {}) {
    const resolved = buildTestConfig(config);
    const allowSync = Boolean(config.allowSync);
    await page.addInitScript((cfg) => {
        window.__TEST_MODE__ = true;
        window.__TEST_CONFIG__ = cfg.config;
        window.__TEST_ALLOW_SYNC__ = cfg.allowSync === true;
        window.open = () => null;
        window.addEventListener('unhandledrejection', (event) => {
            console.error('Unhandled rejection', event.reason);
        });
        window.addEventListener('error', (event) => {
            console.error('Runtime error', event.error || event.message);
        });
        window.__TEST_INTEGRITY__ = async () => {
            const errors = [];
            const dbName = 'LagioteDB';
            const openDb = () => new Promise((resolve, reject) => {
                const request = indexedDB.open(dbName);
                request.onerror = () => reject(request.error || new Error('db_open_failed'));
                request.onblocked = () => reject(new Error('db_open_blocked'));
                request.onsuccess = () => resolve(request.result);
            });
            let db;
            try {
                db = await openDb();
            } catch (error) {
                return { ok: false, violations: [`db_open:${String(error?.message || error)}`] };
            }
            const hasStore = (name) => db.objectStoreNames.contains(name);
            const readAll = (storeName) => new Promise((resolve) => {
                if (!hasStore(storeName)) {
                    resolve([]);
                    return;
                }
                const tx = db.transaction([storeName], 'readonly');
                const store = tx.objectStore(storeName);
                const request = store.getAll();
                request.onsuccess = () => resolve(Array.isArray(request.result) ? request.result : []);
                request.onerror = () => resolve([]);
            });
            const readKey = (storeName, key) => new Promise((resolve) => {
                if (!hasStore(storeName)) {
                    resolve(null);
                    return;
                }
                const tx = db.transaction([storeName], 'readonly');
                const store = tx.objectStore(storeName);
                const request = store.get(key);
                request.onsuccess = () => resolve(request.result || null);
                request.onerror = () => resolve(null);
            });
            const decks = await readAll('decks');
            const cardIds = new Set();
            for (const deck of decks) {
                if (!deck || typeof deck !== 'object') {
                    errors.push('deck_record_invalid');
                    continue;
                }
                if (!Array.isArray(deck.cards)) {
                    errors.push(`deck_cards_not_array:${String(deck.id || 'unknown')}`);
                    continue;
                }
                const seen = new Set();
                for (const card of deck.cards) {
                    const rawCardId = card?.id;
                    const cardId = rawCardId !== undefined && rawCardId !== null ? String(rawCardId) : '';
                    if (!cardId) {
                        errors.push(`card_missing_id:${String(deck.id || 'unknown')}`);
                        continue;
                    }
                    if (seen.has(cardId)) {
                        errors.push(`duplicate_card_id:${String(deck.id || 'unknown')}:${String(cardId)}`);
                    }
                    seen.add(cardId);
                    cardIds.add(cardId);
                }
            }
            const reviewHistory = await readAll('reviewHistory');
            for (const log of reviewHistory) {
                const rawCardId = log?.cardID || log?.cardId || log?.card;
                const cardId = rawCardId !== undefined && rawCardId !== null ? String(rawCardId) : '';
                if (cardId && !cardIds.has(cardId)) {
                    errors.push(`log_missing_card:${String(cardId)}`);
                }
            }
            const analytics = await readKey('appData', 'analytics');
            const sessions = Array.isArray(analytics?.sessions) ? analytics.sessions : [];
            for (const session of sessions) {
                const stamp = session?.date || session?.startTime || session?.timestamp;
                if (!stamp || Number.isNaN(Date.parse(stamp))) {
                    errors.push(`analytics_bad_timestamp:${String(stamp)}`);
                }
            }
            if (db && typeof db.close === 'function') {
                db.close();
            }
            return { ok: errors.length === 0, violations: errors };
        };
    }, { config: resolved, allowSync });
}

export async function waitForTestReady(page) {
    await page.waitForFunction(() => window.__APP_READY__ === true);
}

export async function openDeckById(page, deckId, expectedTitle) {
    await page.waitForSelector(`[data-testid="deck-open-${deckId}"]`, { state: 'attached', timeout: 10000 });
    await page.evaluate((id) => {
        document.querySelector(`[data-testid="deck-open-${id}"]`)?.click();
    }, deckId);
    await page.waitForFunction(() => {
        const view = document.getElementById('deckDetailView');
        return view && !view.classList.contains('hidden');
    }, { timeout: 10000 });
    if (expectedTitle) {
        await page.waitForFunction((title) => {
            const el = document.getElementById('deckDetailTitle');
            return el && el.textContent && el.textContent.includes(title);
        }, expectedTitle, { timeout: 10000 });
    }
}

export async function openDeckByName(page, deckName) {
    await page.waitForFunction((name) => {
        return Boolean(Array.from(document.querySelectorAll('.deck-card')).find(card => card.textContent?.includes(name)));
    }, deckName, { timeout: 10000 });
    await page.evaluate((name) => {
        const card = Array.from(document.querySelectorAll('.deck-card')).find(item => item.textContent?.includes(name));
        card?.querySelector('[data-testid^="deck-open-"]')?.click();
    }, deckName);
    await page.waitForFunction(() => {
        const view = document.getElementById('deckDetailView');
        return view && !view.classList.contains('hidden');
    }, { timeout: 10000 });
    await page.waitForFunction((title) => {
        const el = document.getElementById('deckDetailTitle');
        return el && el.textContent && el.textContent.includes(title);
    }, deckName, { timeout: 10000 });
}

export function installPageErrorGuards(page) {
    const errors = [];
    const logs = [];
    page.on('console', (msg) => {
        const type = msg.type();
        const text = msg.text();
        logs.push(`[console.${type}] ${text}`);
        if (type === 'error') {
            errors.push(text);
        }
    });
    page.on('pageerror', (error) => {
        const message = error?.message || String(error);
        errors.push(message);
        logs.push(`[pageerror] ${message}`);
    });
    page.on('crash', () => {
        errors.push('page-crash');
        logs.push('[page-crash]');
    });
    return { errors, logs };
}

export async function attachLogsOnFailure(testInfo, logs) {
    if (testInfo.status !== testInfo.expectedStatus) {
        await testInfo.attach('console-logs', {
            body: logs.join('\n'),
            contentType: 'text/plain'
        });
    }
}

export async function setupNetworkMocks(page, options = {}) {
    const syncHandler = options.syncHandler;
    const blockExternal = Boolean(options.blockExternal);
    const router = options.useContext ? page.context() : page;
    const aiPayload = {
        type: 'flashcard',
        deckName: 'AI Test Deck',
        deckNotes: 'Generated in test mode',
        language: 'English',
        cards: [
            { question: 'AI Question 1', answer: 'AI Answer 1' },
            { question: 'AI Question 2', answer: 'AI Answer 2' },
            { question: 'AI Question 3', answer: 'AI Answer 3' }
        ]
    };

    await router.route('**/*', (route) => {
        const url = route.request().url();
        if (url.startsWith('http://127.0.0.1') || url.startsWith('http://localhost') || url.startsWith('file://')) {
            route.continue();
            return;
        }
        if (url.startsWith('data:') || url.startsWith('blob:')) {
            route.continue();
            return;
        }
        if (blockExternal) {
            route.abort();
            return;
        }
        route.fulfill({ status: 200, body: '' });
    });

    await router.route('**/api/**', (route) => route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({})
    }));

    await router.route('**/api/generate', (route) => route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(aiPayload)
    }));

    await router.route('**/api/distractors', (route) => route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ distractors: ['Option A', 'Option B', 'Option C'] })
    }));

    await router.route('**/api/autocomplete', (route) => route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ suggestion: '' })
    }));

    await router.route('**/api/public-curricula', (route) => route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ curricula: [] })
    }));

    if (syncHandler) {
        await router.route('**/api/sync', syncHandler);
    } else {
        await router.route('**/api/sync', (route) => route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({
                updatedDecks: [],
                updatedKnowledgeStates: [],
                updatedSettings: null,
                deletedDeckIds: []
            })
        }));
    }
}

export function createTempUserDataDir() {
    const base = fs.mkdtempSync(path.join(os.tmpdir(), 'lagiote-test-'));
    return base;
}
