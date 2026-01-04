import fs from 'node:fs/promises';
import path from 'node:path';
import { test, expect } from '@playwright/test';
import {
    applyTestMode,
    waitForTestReady,
    setupNetworkMocks
} from '../helpers.mjs';
import { createTestLogger } from '../test-logging.mjs';

let logger;

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

test('imports a deck from file and exports it', async ({ page }) => {
    await page.getByTestId('deck-import').click();
    await page.getByTestId('import-tab-file').click();
    await page.getByTestId('import-deck-name').fill('Imported Deck');
    await page.getByTestId('import-deck-category').selectOption('Science');
    const filePath = path.resolve('tests/fixtures/import-deck.csv');
    await page.getByTestId('import-file-input').setInputFiles(filePath);
    await page.getByTestId('import-create').click();

    await page.getByTestId('nav-logo').click();
    await expect(page.locator('.deck-card', { hasText: 'Imported Deck' })).toBeVisible();

    const deckCard = page.locator('.deck-card', { hasText: 'Imported Deck' });
    await deckCard.locator('[data-testid^="deck-open-"]').click();

    const [download] = await Promise.all([
        page.waitForEvent('download'),
        page.getByTestId('deck-export').click()
    ]);
    const downloadPath = path.resolve('test-results', await download.suggestedFilename());
    await download.saveAs(downloadPath);
    const content = await fs.readFile(downloadPath, 'utf-8');
    const parsed = JSON.parse(content);
    expect(parsed.deck).toBeTruthy();
    expect(parsed.deck.cards.length).toBeGreaterThan(0);
});
