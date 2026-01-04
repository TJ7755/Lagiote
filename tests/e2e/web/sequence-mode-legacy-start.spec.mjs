import { test, expect } from '@playwright/test';
import {
    applyTestMode,
    waitForTestReady,
    setupNetworkMocks
} from '../helpers.mjs';
import { createTestLogger, runIntegrityCheck } from '../test-logging.mjs';

let logger;

async function startSequenceMode(page, deckTestId) {
    const deckOpen = page.getByTestId(deckTestId);
    await deckOpen.waitFor({ state: 'visible' });
    await deckOpen.click();
    await expect(page.locator('#deckDetailView')).not.toHaveClass(/hidden/);
    await page.getByTestId('mode-sequence-start').click();

    const setupStart = page.getByTestId('sequence-setup-start');
    if (await setupStart.isVisible().catch(() => false)) {
        await setupStart.click();
    }

    await expect(page.locator('#sequenceTaskView')).toBeVisible();
}

test.beforeEach(async ({ page }, testInfo) => {
    await applyTestMode(page);
    await setupNetworkMocks(page);
    logger = createTestLogger(page, { testInfo });
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await waitForTestReady(page);
});

test.afterEach(async ({}, testInfo) => {
    const issues = await logger.finalize(testInfo);
    expect(issues, issues.join('\n')).toEqual([]);
});

test('legacy deck starts and shows step text', async ({ page }) => {
    await startSequenceMode(page, 'deck-open-deck-sequence-legacy');

    const body = page.locator('#sequenceTaskBody');
    await expect(body).toBeVisible();
    const bodyText = (await body.innerText()).trim();
    expect(bodyText.length).toBeGreaterThan(0);

    await expect(page.getByText('No sequences found')).toBeHidden();
    await expect(page.getByText('No steps')).toBeHidden();

    const normalized = await page.evaluate(async () => {
        const deck = await window.lagiote.db.getDataFromDB('decks', 'deck-sequence-legacy');
        return {
            typeHint: deck?.typeHint || null,
            cards: Array.isArray(deck?.cards) ? deck.cards.length : 0
        };
    });
    expect(normalized.typeHint).toBe('Sequence');
    expect(normalized.cards).toBeGreaterThan(0);
    await runIntegrityCheck(page, logger);
});
