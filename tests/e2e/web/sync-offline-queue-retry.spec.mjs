import { test, expect } from '@playwright/test';
import {
    applyTestMode,
    waitForTestReady,
    setupNetworkMocks,
    openDeckById
} from '../helpers.mjs';
import { createTestLogger, runIntegrityCheck } from '../test-logging.mjs';
import { createSyncMockServer } from '../sync-mock-server.mjs';

async function openProfileMenu(page) {
    const dropdown = page.locator('#userProfileDropdown');
    await page.getByTestId('nav-profile').click({ force: true });
    const isHidden = await dropdown.evaluate(el => el.classList.contains('hidden'));
    if (isHidden) {
        await page.evaluate(() => document.getElementById('userProfileBtn')?.click());
    }
    await expect(dropdown).not.toHaveClass(/hidden/);
}

async function triggerSync(page) {
    await openProfileMenu(page);
    await page.getByTestId('profile-sync').click();
}

async function waitForLastSyncedChange(page, previousValue) {
    await page.waitForFunction(prev => {
        const current = localStorage.getItem('lastSynced');
        return Boolean(current) && current !== prev;
    }, previousValue, { timeout: 10000 });
}

async function setupDevice(page, server, loggerOptions = {}) {
    await applyTestMode(page, { allowSync: true });
    await setupNetworkMocks(page, { syncHandler: route => server.handleRoute(route), useContext: true });
    const logger = createTestLogger(page, loggerOptions);
    await page.goto('http://127.0.0.1:4173/', { waitUntil: 'domcontentloaded' });
    await waitForTestReady(page);
    return logger;
}

test('sync queues changes offline and retries after reconnect', async ({ browser }, testInfo) => {
    const server = createSyncMockServer();
    let contextA;
    let contextB;
    let pageA;
    let pageB;
    let loggerA;
    let loggerB;
    try {
        contextA = await browser.newContext();
        contextB = await browser.newContext();
        pageA = await contextA.newPage();
        pageB = await contextB.newPage();

        loggerA = await setupDevice(pageA, server, {
            allowedConsoleErrors: [/503/],
            allowedResponseFailures: [{ urlPattern: /\/api\/sync/, status: 503 }]
        });
        loggerB = await setupDevice(pageB, server);

        const initialSyncA = await pageA.evaluate(() => localStorage.getItem('lastSynced'));
        await triggerSync(pageA);
        await waitForLastSyncedChange(pageA, initialSyncA);

        const initialSyncB = await pageB.evaluate(() => localStorage.getItem('lastSynced'));
        await triggerSync(pageB);
        await waitForLastSyncedChange(pageB, initialSyncB);

        await contextA.setOffline(true);
        await pageA.evaluate(() => window.dispatchEvent(new Event('offline')));

        await openDeckById(pageA, 'deck-learn', 'Learn Mode Deck');
        await pageA.getByTestId('deck-edit').click();
        await pageA.getByTestId('deck-add-card').click();
        const questionInputs = pageA.locator('textarea[data-testid^="editor-card-question-"]');
        const answerInputs = pageA.locator('textarea[data-testid^="editor-card-answer-"]');
        const count = await questionInputs.count();
        const lastIndex = Math.max(0, count - 1);
        await questionInputs.nth(lastIndex).fill('Offline card');
        await answerInputs.nth(lastIndex).fill('Queued');
        await pageA.getByTestId('deck-save').click();
        await pageA.getByTestId('nav-logo').click();

        const localCardCount = await pageA.evaluate(async () => {
            const deck = await window.lagiote.db.getDataFromDB('decks', 'deck-learn');
            return Array.isArray(deck?.cards) ? deck.cards.length : 0;
        });
        expect(localCardCount).toBeGreaterThan(4);

        const requestsBefore = server.state.requestLog.length;
        await triggerSync(pageA);
        expect(server.state.requestLog.length).toBe(requestsBefore);

        await contextA.setOffline(false);
        await pageA.evaluate(() => window.dispatchEvent(new Event('online')));

        const syncBeforeRetry = await pageA.evaluate(() => localStorage.getItem('lastSynced'));
        server.setFailNext(1);
        await triggerSync(pageA);
        await triggerSync(pageA);
        await waitForLastSyncedChange(pageA, syncBeforeRetry);

        await expect.poll(() => {
            const snapshot = server.getStateSnapshot();
            const deck = snapshot.decks.find(item => item.id === 'deck-learn');
            return deck?.cards?.length || 0;
        }, { timeout: 10000 }).toBeGreaterThan(4);

        const syncBeforePull = await pageB.evaluate(() => localStorage.getItem('lastSynced'));
        await triggerSync(pageB);
        await waitForLastSyncedChange(pageB, syncBeforePull);

        const cardCount = await pageB.evaluate(async () => {
            const deckData = await window.lagiote.db.getDataFromDB('decks', 'deck-learn');
            return Array.isArray(deckData?.cards) ? deckData.cards.length : 0;
        });
        expect(cardCount).toBeGreaterThan(4);

        await runIntegrityCheck(pageA, loggerA);
        await runIntegrityCheck(pageB, loggerB);
    } finally {
        const issues = [];
        if (loggerA) issues.push(...await loggerA.finalize(testInfo));
        if (loggerB) issues.push(...await loggerB.finalize(testInfo));
        if (contextA) await contextA.close();
        if (contextB) await contextB.close();
        expect(issues, issues.join('\n')).toEqual([]);
    }
});
