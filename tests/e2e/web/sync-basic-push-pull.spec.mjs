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

async function setupDevice(page, server) {
    await applyTestMode(page, { allowSync: true });
    await setupNetworkMocks(page, { syncHandler: route => server.handleRoute(route), useContext: true });
    const logger = createTestLogger(page, {});
    await page.goto('http://127.0.0.1:4173/', { waitUntil: 'domcontentloaded' });
    await waitForTestReady(page);
    return logger;
}

test('sync basic push and pull across devices', async ({ browser }, testInfo) => {
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

        loggerA = await setupDevice(pageA, server);
        loggerB = await setupDevice(pageB, server);

        await openDeckById(pageA, 'deck-learn', 'Learn Mode Deck');
        await pageA.getByTestId('deck-edit').click();
        await pageA.getByTestId('deck-title').fill('Learn Mode Deck Synced');
        await pageA.getByTestId('deck-add-card').click();
        const questionInputs = pageA.locator('textarea[data-testid^="editor-card-question-"]');
        const answerInputs = pageA.locator('textarea[data-testid^="editor-card-answer-"]');
        const count = await questionInputs.count();
        const lastIndex = Math.max(0, count - 1);
        await questionInputs.nth(lastIndex).fill('Synced question?');
        await answerInputs.nth(lastIndex).fill('Synced answer.');
        await pageA.getByTestId('deck-save').click();
        await expect.poll(async () => {
            return pageA.evaluate(async () => {
                const deck = await window.lagiote.db.getDataFromDB('decks', 'deck-learn');
                return deck?.name || '';
            });
        }, { timeout: 10000 }).toBe('Learn Mode Deck Synced');
        await pageA.getByTestId('nav-logo').click();
        await pageA.waitForFunction(() => document.getElementById('dashboard')?.classList.contains('is-visible'));

        await openDeckById(pageA, 'deck-learn', 'Learn Mode Deck Synced');
        await pageA.evaluate(() => configureStudy('learn'));
        const setupStart = pageA.getByTestId('learn-setup-start');
        if (await setupStart.isVisible().catch(() => false)) {
            await setupStart.click();
        }
        if (await pageA.getByTestId('answer-show').isVisible().catch(() => false)) {
            await pageA.getByTestId('answer-show').click();
        }
        if (await pageA.getByTestId('answer-correct').isVisible().catch(() => false)) {
            await pageA.getByTestId('answer-correct').click();
        }
        await runIntegrityCheck(pageA, loggerA);
        await pageA.evaluate(() => endSession());
        await pageA.getByTestId('nav-logo').click();
        await pageA.waitForFunction(() => document.getElementById('dashboard')?.classList.contains('is-visible'));

        const syncBeforePush = await pageA.evaluate(() => localStorage.getItem('lastSynced'));
        await triggerSync(pageA);
        await waitForLastSyncedChange(pageA, syncBeforePush);

        const snapshot = server.getStateSnapshot();
        const hasSyncedDeck = snapshot.decks.some(deck => deck.name === 'Learn Mode Deck Synced');
        expect(hasSyncedDeck).toBe(true);

        const syncBeforePull = await pageB.evaluate(() => localStorage.getItem('lastSynced'));
        await triggerSync(pageB);
        await waitForLastSyncedChange(pageB, syncBeforePull);

        const deckData = await pageB.evaluate(async () => {
            const deck = await window.lagiote.db.getDataFromDB('decks', 'deck-learn');
            return {
                name: deck?.name || null,
                cardCount: Array.isArray(deck?.cards) ? deck.cards.length : 0
            };
        });
        expect(deckData.name).toBe('Learn Mode Deck Synced');
        expect(deckData.cardCount).toBeGreaterThan(4);

    } finally {
        const issues = [];
        if (loggerA) issues.push(...await loggerA.finalize(testInfo));
        if (loggerB) issues.push(...await loggerB.finalize(testInfo));
        if (contextA) await contextA.close();
        if (contextB) await contextB.close();
        expect(issues, issues.join('\n')).toEqual([]);
    }
});
