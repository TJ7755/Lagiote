import { test, expect } from '@playwright/test';
import {
    applyTestMode,
    waitForTestReady,
    setupNetworkMocks
} from '../helpers.mjs';
import { createTestLogger } from '../test-logging.mjs';

let logger;

test.beforeEach(async ({ page }, testInfo) => {
    await applyTestMode(page, { auth: 'none' });
    await setupNetworkMocks(page);
    logger = createTestLogger(page, { testInfo });
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await waitForTestReady(page);
});

test.afterEach(async ({}, testInfo) => {
    const issues = await logger.finalize(testInfo);
    expect(issues, issues.join('\n')).toEqual([]);
});

test('auth login action runs in test mode', async ({ page }) => {
    await expect(page.getByTestId('auth-login')).toBeVisible();
    await page.getByTestId('auth-login').click();
    await expect(page.getByTestId('nav-profile')).toBeVisible();
});

test('auth signup action runs in test mode', async ({ page }) => {
    await expect(page.getByTestId('auth-signup')).toBeVisible();
    await page.getByTestId('auth-signup').click();
    await expect(page.getByTestId('nav-profile')).toBeVisible();
});

test('guest continuation bypasses auth', async ({ page }) => {
    await page.getByTestId('auth-remember-guest').check();
    await page.getByTestId('auth-continue-guest').click();
    await expect(page.getByTestId('nav-signup')).toBeVisible();
});
