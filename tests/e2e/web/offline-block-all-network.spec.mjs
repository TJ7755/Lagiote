import { test, expect } from '@playwright/test';
import { applyTestMode, waitForTestReady, openDeckByName } from '../helpers.mjs';
import { createTestLogger, runIntegrityCheck } from '../test-logging.mjs';

test('offline with network blocked preserves local data', async ({ page }, testInfo) => {
    await applyTestMode(page, { reset: false, seed: false });
    await page.addInitScript(() => {
        Object.defineProperty(navigator, 'onLine', { get: () => false });
        window.addEventListener('load', () => {
            window.dispatchEvent(new Event('offline'));
        });
    });
    await page.addInitScript(() => {
        const originalCreateObjectURL = URL.createObjectURL;
        URL.createObjectURL = function(blob) {
            window.__lastExportBlob = blob;
            return originalCreateObjectURL.call(this, blob);
        };
    });
    await page.route('**/*', (route) => {
        const url = route.request().url();
        if (url.startsWith('http://127.0.0.1') || url.startsWith('http://localhost') || url.startsWith('file://')) {
            route.continue();
            return;
        }
        if (url.startsWith('data:') || url.startsWith('blob:')) {
            route.continue();
            return;
        }
        route.abort();
    });
    const logger = createTestLogger(page, {
        allowedConsoleErrors: [/net::ERR_FAILED/],
        allowedRequestFailures: [(entry) => {
            const url = entry?.url || '';
            return !url.startsWith('http://127.0.0.1') && !url.startsWith('http://localhost');
        }]
    });
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await waitForTestReady(page);

    await expect(page.locator('#onlineStatusText')).toHaveText('Offline');

    await page.getByTestId('deck-create-manual').click();
    await page.getByTestId('deck-title').fill('Offline Deck');
    await page.getByTestId('deck-category').selectOption('Science');

    const questionInputs = page.locator('textarea[data-testid^="editor-card-question-"]');
    const answerInputs = page.locator('textarea[data-testid^="editor-card-answer-"]');
    await questionInputs.first().fill('Offline Q1');
    await answerInputs.first().fill('Offline A1');
    await page.getByTestId('deck-add-card').click();
    await questionInputs.nth(1).fill('Offline Q2');
    await answerInputs.nth(1).fill('Offline A2');
    await page.getByTestId('deck-save').click();
    await page.getByTestId('nav-logo').click();

    await openDeckByName(page, 'Offline Deck');
    await page.evaluate(() => configureStudy('learn'));
    const setupStart = page.getByTestId('learn-setup-start');
    if (await setupStart.isVisible().catch(() => false)) {
        await setupStart.click();
    }
    if (await page.getByTestId('answer-show').isVisible().catch(() => false)) {
        await page.getByTestId('answer-show').click();
    }
    if (await page.getByTestId('answer-correct').isVisible().catch(() => false)) {
        await page.getByTestId('answer-correct').click();
    }
    await runIntegrityCheck(page, logger);
    await page.evaluate(() => endSession());

    await page.waitForFunction(() => {
        const bar = document.getElementById('messageBar');
        return !bar || !bar.classList.contains('show');
    }, { timeout: 10000 });
    await page.getByTestId('nav-settings').click();
    await expect(page.locator('#settingsView')).toHaveClass(/is-visible/);
    await page.getByTestId('settings-export-data').click();
    await page.waitForFunction(() => Boolean(window.__lastExportBlob), { timeout: 10000 });
    const exported = await page.evaluate(async () => {
        const blob = window.__lastExportBlob;
        const text = await blob.text();
        return JSON.parse(text);
    });
    expect(Array.isArray(exported.decks)).toBe(true);
    expect(exported.decks.length).toBeGreaterThan(0);

    await page.reload({ waitUntil: 'domcontentloaded' });
    await waitForTestReady(page);

    const restored = page.locator('.deck-card', { hasText: 'Offline Deck' });
    await expect(restored).toBeVisible();

    const issues = await logger.finalize(testInfo);
    expect(issues, issues.join('\n')).toEqual([]);
});
