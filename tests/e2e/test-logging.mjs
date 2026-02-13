import fs from 'node:fs/promises';
import path from 'node:path';

const DEFAULT_ALLOWLIST = [/\/api\//];

function sanitizeFileName(value) {
    return String(value || 'test')
        .replace(/[^a-z0-9_-]+/gi, '_')
        .replace(/^_+|_+$/g, '')
        .slice(0, 160) || 'test';
}

async function ensureArtifactsDir() {
    const dir = path.resolve('artifacts');
    await fs.mkdir(dir, { recursive: true });
    return dir;
}

function isAllowed(entry, allowed = []) {
    if (!allowed || !allowed.length) return false;
    return allowed.some(rule => {
        if (typeof rule === 'function') return rule(entry);
        if (rule instanceof RegExp) return rule.test(entry.url || '');
        if (rule && typeof rule === 'object') {
            const urlMatch = rule.urlPattern ? rule.urlPattern.test(entry.url || '') : true;
            const statusMatch = typeof rule.status === 'number' ? entry.status === rule.status : true;
            return urlMatch && statusMatch;
        }
        return false;
    });
}

function isAllowedMessage(message, allowed = []) {
    if (!allowed || !allowed.length) return false;
    return allowed.some(rule => {
        if (typeof rule === 'function') return rule(message);
        if (rule instanceof RegExp) return rule.test(message);
        if (typeof rule === 'string') return message.includes(rule);
        return false;
    });
}

function shouldRecordNetwork(url, allowlist) {
    if (!allowlist || !allowlist.length) return true;
    return allowlist.some(rule => {
        if (rule instanceof RegExp) return rule.test(url);
        if (typeof rule === 'function') return rule(url);
        return false;
    });
}

async function collectIndexedDbSummary(page) {
    return page.evaluate(async () => {
        const dbName = 'LagioteDB';
        const openDb = () => new Promise((resolve, reject) => {
            const request = indexedDB.open(dbName);
            request.onerror = () => reject(request.error || new Error('db_open_failed'));
            request.onblocked = () => reject(new Error('db_open_blocked'));
            request.onsuccess = () => resolve(request.result);
        });
        const readAllKeys = (db, storeName) => new Promise((resolve) => {
            if (!db.objectStoreNames.contains(storeName)) {
                resolve({ missing: true, keys: [] });
                return;
            }
            const tx = db.transaction([storeName], 'readonly');
            const store = tx.objectStore(storeName);
            const request = store.getAllKeys();
            request.onsuccess = () => resolve({ missing: false, keys: Array.isArray(request.result) ? request.result : [] });
            request.onerror = () => resolve({ missing: false, keys: [] });
        });
        const readKey = (db, storeName, key) => new Promise((resolve) => {
            if (!db.objectStoreNames.contains(storeName)) {
                resolve(null);
                return;
            }
            const tx = db.transaction([storeName], 'readonly');
            const store = tx.objectStore(storeName);
            const request = store.get(key);
            request.onsuccess = () => resolve(request.result || null);
            request.onerror = () => resolve(null);
        });
        let db;
        try {
            db = await openDb();
        } catch (error) {
            return { error: String(error?.message || error) };
        }
        const storeNames = Array.from(db.objectStoreNames || []);
        const queueStores = storeNames.filter(name => /queue|sync/i.test(name));
        const coreStores = ['decks', 'reviewHistory', 'interactionLogs', 'appData', 'analytics', ...queueStores];
        const uniqueStores = Array.from(new Set(coreStores));
        const summary = {};
        for (const storeName of uniqueStores) {
            if (storeName === 'analytics') {
                const analytics = await readKey(db, 'appData', 'analytics');
                summary[storeName] = {
                    missing: false,
                    count: analytics ? 1 : 0,
                    sampleKeys: analytics ? ['appData:analytics'] : []
                };
                continue;
            }
            const data = await readAllKeys(db, storeName);
            summary[storeName] = {
                missing: data.missing,
                count: data.keys.length,
                sampleKeys: data.keys.slice(0, 20)
            };
        }
        if (db && typeof db.close === 'function') {
            db.close();
        }
        return { storeNames, summary };
    });
}

export function createTestLogger(page, options = {}) {
    const config = {
        allowRequestFailures: false,
        allowConsoleErrors: false,
        allowPageErrors: false,
        allowedResponseFailures: [],
        allowedRequestFailures: [],
        allowedConsoleErrors: [],
        networkAllowlist: DEFAULT_ALLOWLIST,
        ...options
    };
    const state = {
        logs: [],
        consoleErrors: [],
        pageErrors: [],
        requestFailures: [],
        responseFailures: [],
        invariantViolations: [],
        unhandledRejections: [],
        navigations: [],
        networkRecords: []
    };

    page.addInitScript(() => {
        window.__TEST_EVENT_LOG__ = { unhandledRejections: [], errors: [] };
        window.addEventListener('unhandledrejection', (event) => {
            window.__TEST_EVENT_LOG__.unhandledRejections.push({ reason: String(event.reason) });
        });
        window.addEventListener('error', (event) => {
            window.__TEST_EVENT_LOG__.errors.push({ message: String(event.error || event.message) });
        });
    });

    page.on('console', (msg) => {
        const type = msg.type();
        const text = msg.text();
        state.logs.push(`[console.${type}] ${text}`);
        if (type === 'error') {
            state.consoleErrors.push(text);
        }
    });

    page.on('pageerror', (error) => {
        const message = error?.message || String(error);
        state.pageErrors.push(message);
        state.logs.push(`[pageerror] ${message}`);
    });

    page.on('requestfailed', (request) => {
        const failure = request.failure();
        const entry = {
            url: request.url(),
            method: request.method(),
            failure: failure?.errorText || 'request_failed'
        };
        state.requestFailures.push(entry);
        state.logs.push(`[requestfailed] ${entry.method} ${entry.url} ${entry.failure}`);
    });

    page.on('response', async (response) => {
        const url = response.url();
        if (!shouldRecordNetwork(url, config.networkAllowlist)) return;
        const request = response.request();
        const status = response.status();
        let bodyLength = null;
        try {
            const body = await response.body();
            bodyLength = body ? body.length : 0;
        } catch (error) {
            bodyLength = null;
        }
        const record = {
            url,
            method: request.method(),
            status,
            bodyLength
        };
        state.networkRecords.push(record);
        if (status >= 400) {
            state.responseFailures.push(record);
            state.logs.push(`[responsefailure] ${record.method} ${record.url} ${record.status}`);
        }
    });

    page.on('framenavigated', (frame) => {
        if (frame === page.mainFrame()) {
            state.navigations.push({ url: frame.url(), timestamp: new Date().toISOString() });
        }
    });

    const recordInvariantViolations = (violations) => {
        if (!Array.isArray(violations) || !violations.length) return;
        state.invariantViolations.push(...violations.map(item => String(item)));
    };

    const collectRuntimeEvents = async () => {
        const runtime = await page.evaluate(() => window.__TEST_EVENT_LOG__).catch(() => null);
        if (runtime?.unhandledRejections?.length) {
            state.unhandledRejections.push(...runtime.unhandledRejections.map(entry => entry.reason));
        }
        if (runtime?.errors?.length) {
            state.pageErrors.push(...runtime.errors.map(entry => entry.message));
        }
    };

    const buildIssues = () => {
        const issues = [];
        if (!config.allowConsoleErrors) {
            const consoleIssues = state.consoleErrors.filter(msg => !isAllowedMessage(msg, config.allowedConsoleErrors));
            issues.push(...consoleIssues.map(msg => `console_error:${msg}`));
        }
        if (!config.allowPageErrors) {
            issues.push(...state.pageErrors.map(msg => `page_error:${msg}`));
        }
        issues.push(...state.unhandledRejections.map(msg => `unhandled_rejection:${msg}`));
        if (!config.allowRequestFailures) {
            const requestIssues = state.requestFailures.filter(entry => !isAllowed(entry, config.allowedRequestFailures));
            issues.push(...requestIssues.map(entry => `request_failed:${entry.method}:${entry.url}:${entry.failure}`));
        }
        const responseIssues = state.responseFailures.filter(entry => !isAllowed(entry, config.allowedResponseFailures));
        issues.push(...responseIssues.map(entry => `response_failed:${entry.method}:${entry.url}:${entry.status}`));
        issues.push(...state.invariantViolations.map(msg => `invariant:${msg}`));
        return issues;
    };

    const writeArtifacts = async (testInfo) => {
        const dir = await ensureArtifactsDir();
        const suffix = `${testInfo.project?.name || 'project'}-${testInfo.title}-${Date.now()}`;
        const base = sanitizeFileName(suffix);
        const screenshotPath = path.join(dir, `${base}.png`);
        const domPath = path.join(dir, `${base}.html`);
        const logPath = path.join(dir, `${base}.log`);
        const networkPath = path.join(dir, `${base}.network.json`);
        const idbPath = path.join(dir, `${base}.idb.json`);
        const navPath = path.join(dir, `${base}.nav.json`);
        try {
            await page.screenshot({ path: screenshotPath, fullPage: true });
        } catch (error) {
        }
        try {
            const content = await page.content();
            await fs.writeFile(domPath, content, 'utf-8');
        } catch (error) {
        }
        const logLines = [...state.logs];
        if (state.navigations.length) {
            logLines.push('[navigations]');
            for (const entry of state.navigations) {
                logLines.push(`${entry.timestamp} ${entry.url}`);
            }
        }
        await fs.writeFile(logPath, logLines.join('\n'), 'utf-8');
        await fs.writeFile(networkPath, JSON.stringify({
            records: state.networkRecords,
            requestFailures: state.requestFailures,
            responseFailures: state.responseFailures
        }, null, 2), 'utf-8');
        await fs.writeFile(navPath, JSON.stringify(state.navigations, null, 2), 'utf-8');
        const idbSummary = await collectIndexedDbSummary(page).catch(error => ({ error: String(error?.message || error) }));
        await fs.writeFile(idbPath, JSON.stringify(idbSummary, null, 2), 'utf-8');
    };

    const finalize = async (testInfo) => {
        await collectRuntimeEvents();
        const issues = buildIssues();
        if (issues.length || testInfo.status !== testInfo.expectedStatus) {
            await writeArtifacts(testInfo);
        }
        return issues;
    };

    return {
        state,
        recordInvariantViolations,
        finalize,
        collectRuntimeEvents,
        buildIssues
    };
}

export async function runIntegrityCheck(page, logger) {
    const result = await page.evaluate(async () => {
        if (typeof window.__TEST_INTEGRITY__ === 'function') {
            return await window.__TEST_INTEGRITY__();
        }
        return { ok: true, violations: [] };
    });
    if (result && result.ok === false && Array.isArray(result.violations)) {
        logger.recordInvariantViolations(result.violations);
    }
    return result;
}
