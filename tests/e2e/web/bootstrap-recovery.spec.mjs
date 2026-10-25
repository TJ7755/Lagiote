import { test, expect } from '@playwright/test';
import { applyTestMode, setupNetworkMocks } from '../helpers.mjs';

test('dashboard initialises when its controller loads after the page load event', async ({ page }) => {
    await applyTestMode(page);
    await setupNetworkMocks(page);
    let releaseController;
    const controllerReleased = new Promise(resolve => { releaseController = resolve; });
    await page.route('**/js/pages/dashboard.js', async route => {
        await controllerReleased;
        await route.continue();
    });

    await page.goto('/', { waitUntil: 'load' });
    releaseController();
    await expect(page.getByTestId('deck-card-deck-learn')).toBeVisible({ timeout: 10000 });
    await expect.poll(() => page.evaluate(() => window.__APP_READY__)).toBe(true);
});

test('restores a full backup through settings and retains it after reload', async ({ page }) => {
    await applyTestMode(page, { reset: false, seed: false, auth: 'guest' });
    await setupNetworkMocks(page);
    await page.goto('/');
    await page.waitForFunction(() => window.__APP_READY__);
    await page.getByTestId('nav-settings').click();
    await page.getByTestId('settings-restore-backup').setInputFiles({
        name: 'backup.json',
        mimeType: 'application/json',
        buffer: Buffer.from(JSON.stringify({
            exportSchemaVersion: 1,
            decks: [{ id: 'recovered', name: 'Recovered Deck', category: 'Science', cards: [{ id: 'recovered-card', question: 'Recovered question', answer: 'Recovered answer' }] }]
        }))
    });
    await page.getByTestId('confirm-confirm').click();
    await expect(page.locator('.deck-card', { hasText: 'Recovered Deck' })).toBeVisible();
    await page.reload();
    await expect(page.locator('.deck-card', { hasText: 'Recovered Deck' })).toBeVisible();
});

test('standalone study initialises when its controller loads after the document', async ({ page }) => {
    await applyTestMode(page);
    await setupNetworkMocks(page);
    await page.goto('/');
    await expect(page.getByTestId('deck-card-deck-review')).toBeVisible();

    let releaseController;
    const controllerReleased = new Promise(resolve => { releaseController = resolve; });
    await page.route('**/js/pages/study.js', async route => {
        await controllerReleased;
        await route.continue();
    });
    await page.goto('/study.html?deckId=deck-review&mode=review', { waitUntil: 'load' });
    releaseController();
    await expect(page.locator('#studySubtitle')).toContainText('Review Deck', { timeout: 10000 });
    await page.locator('#startSessionBtn').click();
    await expect(page.locator('#cardQuestion')).not.toBeEmpty();
});
