import { test, expect } from '@playwright/test';
import {
    applyTestMode,
    waitForTestReady,
    setupNetworkMocks
} from '../helpers.mjs';
import { createTestLogger } from '../test-logging.mjs';

let logger;

test.beforeEach(async ({ page, context }, testInfo) => {
    await applyTestMode(page);
    await setupNetworkMocks(page);
    logger = createTestLogger(page, { testInfo, allowRequestFailures: true });
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await waitForTestReady(page);
    await context.setOffline(true);
    await page.evaluate(() => window.dispatchEvent(new Event('offline')));
});

test.afterEach(async ({}, testInfo) => {
    const issues = await logger.finalize(testInfo);
    expect(issues, issues.join('\n')).toEqual([]);
});

test('handles offline mode without crashing', async ({ page }) => {
    await expect(page.locator('#onlineStatusText')).toHaveText('Offline');
    await page.getByTestId('deck-create-ai').click();
    await page.getByTestId('ai-text-input').fill('Offline generation');
    await page.getByTestId('ai-add-text').click();
    await page.getByTestId('ai-process').click();
    await expect(page.locator('#aiGenerator')).toHaveClass(/is-visible/);
});
