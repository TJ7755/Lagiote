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

test('navigates dashboard, settings, insights, analytics, and AI generator', async ({ page }) => {
    const openProfileMenu = async () => {
        const dropdown = page.locator('#userProfileDropdown');
        await page.getByTestId('nav-profile').click({ force: true });
        const isHidden = await dropdown.evaluate(el => el.classList.contains('hidden'));
        if (isHidden) {
            await page.evaluate(() => document.getElementById('userProfileBtn')?.click());
        }
        await expect(dropdown).not.toHaveClass(/hidden/);
    };
    await expect(page.getByTestId('deck-card-deck-learn')).toBeVisible();
    await page.getByTestId('search-decks').fill('Learn');
    await expect(page.getByTestId('deck-card-deck-learn')).toBeVisible();
    await page.getByTestId('search-decks').fill('');

    await page.getByTestId('deck-open-deck-learn').click();
    await expect(page.locator('#deckDetailView')).not.toHaveClass(/hidden/);
    const navBack = page.getByTestId('nav-back');
    const navHome = page.getByTestId('nav-home');
    if (await navBack.isVisible()) {
        await navBack.click();
    } else if (await navHome.isVisible()) {
        await navHome.click();
    } else {
        await page.getByTestId('nav-logo').click();
    }

    await page.getByTestId('nav-settings').click();
    await expect(page.locator('#settingsView')).toHaveClass(/is-visible/);
    await page.getByTestId('usernameInput').fill('Test User');
    await page.getByTestId('settings-save-name').click();
    await page.getByTestId('settings-toasts').check();
    await page.getByTestId('settings-save-study').click();

    await page.goBack({ waitUntil: 'domcontentloaded' });
    await page.goForward({ waitUntil: 'domcontentloaded' });
    await expect(page.getByTestId('nav-logo')).toBeVisible();

    await page.reload({ waitUntil: 'domcontentloaded' });
    await waitForTestReady(page);
    await page.getByTestId('nav-settings').click();
    await expect(page.getByTestId('settings-toasts')).toBeChecked();

    await page.getByTestId('nav-logo').click();
    await expect(page.locator('#dashboard')).toHaveClass(/is-visible/);
    await page.evaluate(() => {
        document.querySelector('[data-testid="nav-insights"]')?.scrollIntoView({ block: 'center' });
        document.querySelector('[data-testid="nav-insights"]')?.click();
    });
    await expect(page.locator('#insightsView')).toHaveClass(/is-visible/);
    await page.getByTestId('insights-deck-select').selectOption('deck-learn');
    await expect(page.locator('#insightsContent')).not.toHaveClass(/hidden/);

    await page.getByTestId('nav-logo').click();
    await page.evaluate(() => {
        document.querySelector('[data-testid="nav-global-analytics"]')?.click();
    });
    await expect(page.locator('#globalAnalyticsView')).toHaveClass(/is-visible/);

    await page.getByTestId('nav-logo').click();
    await page.evaluate(() => {
        document.querySelector('[data-testid="deck-create-ai"]')?.scrollIntoView({ block: 'center' });
        document.querySelector('[data-testid="deck-create-ai"]')?.click();
    });
    await expect(page.locator('#aiGenerator')).toHaveClass(/is-visible/);
    await page.getByTestId('ai-text-input').fill('Generate flashcards about photosynthesis.');
    await page.getByTestId('ai-add-text').click();
    await page.getByTestId('ai-process').click();
    await expect(page.getByTestId('ai-save-deck')).toBeVisible();
    await page.getByTestId('ai-save-deck').click();
    await page.waitForFunction(async () => {
        const decks = await window.lagiote.db.getAllDataFromDB('decks');
        return decks.some(deck => deck.name === 'AI Test Deck');
    });

    await page.getByTestId('nav-logo').click();
    const aiDeckSaved = await page.evaluate(async () => {
        const decks = await window.lagiote.db.getAllDataFromDB('decks');
        return decks.some(deck => deck.name === 'AI Test Deck');
    });
    expect(aiDeckSaved).toBe(true);

    await openProfileMenu();
    await page.getByTestId('profile-sync').click();
    await openProfileMenu();
    await page.getByTestId('profile-check-updates').click();
    await openProfileMenu();
    await page.getByTestId('profile-logout').click();
    await expect(page.getByTestId('auth-signup')).toBeVisible();
});
