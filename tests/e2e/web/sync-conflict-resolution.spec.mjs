import { test, expect } from '@playwright/test';
import {
    applyTestMode,
    waitForTestReady,
    setupNetworkMocks
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

async function setupDevice(page, server) {
    await applyTestMode(page, { allowSync: true });
    await setupNetworkMocks(page, { syncHandler: route => server.handleRoute(route), useContext: true });
    const logger = createTestLogger(page, {});
    await page.goto('http://127.0.0.1:4173/', { waitUntil: 'domcontentloaded' });
    await waitForTestReady(page);
    return logger;
}

async function updateDeckName(page, deckId, name, lastModified) {
    await page.getByTestId(`deck-open-${deckId}`).click();
    await page.getByTestId('deck-edit').click();
    await page.getByTestId('deck-title').fill(name);
    await page.getByTestId('deck-save').click();
    await page.getByTestId('nav-logo').click();
    await page.evaluate(async ({ deckId: id, deckName, stamp }) => {
        const deck = await window.lagiote.db.getDataFromDB('decks', id);
        deck.name = deckName;
        deck.lastModified = stamp;
        await window.lagiote.db.saveDataToDB('decks', deck);
    }, { deckId, deckName: name, stamp: lastModified });
}

test('sync conflict resolution uses last modified winner', async ({ browser }, testInfo) => {
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

        await triggerSync(pageA);
        await triggerSync(pageB);

        await pageA.waitForFunction(() => Boolean(localStorage.getItem('lastSynced')));
        await pageB.waitForFunction(() => Boolean(localStorage.getItem('lastSynced')));

        const deckId = 'deck-learn';
        await updateDeckName(pageA, deckId, 'Name A', '2024-01-01T00:00:01.000Z');
        await updateDeckName(pageB, deckId, 'Name B', '2024-01-01T00:00:02.000Z');

        await triggerSync(pageA);
        await triggerSync(pageB);
        await triggerSync(pageA);

        const nameA = await pageA.evaluate(async () => {
            const deck = await window.lagiote.db.getDataFromDB('decks', 'deck-learn');
            return deck?.name || null;
        });
        const nameB = await pageB.evaluate(async () => {
            const deck = await window.lagiote.db.getDataFromDB('decks', 'deck-learn');
            return deck?.name || null;
        });
        expect(nameA).toBe('Name B');
        expect(nameB).toBe('Name B');

        const idCheck = await pageA.evaluate(async () => {
            const decks = await window.lagiote.db.getAllDataFromDB('decks');
            const ids = decks.map(deck => deck.id);
            return { total: ids.length, unique: new Set(ids).size };
        });
        expect(idCheck.total).toBe(idCheck.unique);

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
