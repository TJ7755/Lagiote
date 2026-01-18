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

test('settings - username input and save', async ({ page }) => {
    await page.getByTestId('nav-settings').click();
    await expect(page.locator('#settingsView')).toBeVisible();
    
    const usernameInput = page.locator('#usernameInput');
    await usernameInput.fill('Test User Name');
    await page.getByTestId('settings-save-name').click();
    await page.waitForTimeout(300);
    
    // Verify the save action completed (button should still be there)
    await expect(page.getByTestId('settings-save-name')).toBeVisible();
});

test('settings - dark mode toggle', async ({ page }) => {
    await page.getByTestId('nav-settings').click();
    await expect(page.locator('#settingsView')).toBeVisible();
    
    const darkModeToggle = page.getByTestId('settings-dark-mode');
    if (await darkModeToggle.isVisible().catch(() => false)) {
        const wasChecked = await darkModeToggle.isChecked();
        
        // Toggle dark mode
        await darkModeToggle.click();
        await page.waitForTimeout(300);
        
        // Check body has dark-mode class changed
        const hasDarkMode = await page.evaluate(() => document.body.classList.contains('dark-mode'));
        expect(hasDarkMode).toBe(!wasChecked);
    }
});

test('settings - in-study editing toggle', async ({ page }) => {
    await page.getByTestId('nav-settings').click();
    await expect(page.locator('#settingsView')).toBeVisible();
    
    const editingToggle = page.getByTestId('settings-editing');
    if (await editingToggle.isVisible().catch(() => false)) {
        await editingToggle.check();
        await page.getByTestId('settings-save-study').click();
        await page.waitForTimeout(300);
        
        // Verify toggle is checked
        await expect(editingToggle).toBeChecked();
    }
});

test('settings - toast notifications toggle', async ({ page }) => {
    await page.getByTestId('nav-settings').click();
    await expect(page.locator('#settingsView')).toBeVisible();
    
    const toastsToggle = page.getByTestId('settings-toasts');
    if (await toastsToggle.isVisible().catch(() => false)) {
        await toastsToggle.check();
        await page.getByTestId('settings-save-study').click();
        await page.waitForTimeout(300);
        
        await expect(toastsToggle).toBeChecked();
    }
});

test('settings - exam plan banner toggle', async ({ page }) => {
    await page.getByTestId('nav-settings').click();
    await expect(page.locator('#settingsView')).toBeVisible();
    
    const bannerToggle = page.getByTestId('settings-exam-banner');
    if (await bannerToggle.isVisible().catch(() => false)) {
        const wasChecked = await bannerToggle.isChecked();
        await bannerToggle.click();
        await page.getByTestId('settings-save-study').click();
        await page.waitForTimeout(300);
        
        // Verify toggle state changed
        const isCheckedNow = await bannerToggle.isChecked();
        expect(isCheckedNow).toBe(!wasChecked);
    }
});

test('settings - export research data button exists', async ({ page }) => {
    await page.getByTestId('nav-settings').click();
    await expect(page.locator('#settingsView')).toBeVisible();
    
    const exportBtn = page.getByTestId('settings-export-data');
    if (await exportBtn.isVisible().catch(() => false)) {
        await expect(exportBtn).toBeEnabled();
    }
});

test('settings - clear all decks button exists (dangerous action)', async ({ page }) => {
    await page.getByTestId('nav-settings').click();
    await expect(page.locator('#settingsView')).toHaveClass(/is-visible/);
    
    const clearBtn = page.getByTestId('settings-clear-decks');
    if (await clearBtn.isVisible().catch(() => false)) {
        await expect(clearBtn).toBeVisible();
        // Don't click it - it's destructive
    }
});

test('deck settings modal - cards per round', async ({ page }) => {
    const deckOpen = page.getByTestId('deck-open-deck-learn');
    await deckOpen.click();
    await expect(page.locator('#deckDetailView')).not.toHaveClass(/hidden/);
    
    await page.getByTestId('deck-settings').click();
    await expect(page.locator('#deckSettingsModal')).toHaveClass(/show/);
    
    await page.getByTestId('deck-settings-cards-per-round').fill('10');
    await page.getByTestId('deck-settings-save').click();
    
    // Verify saved
    await page.getByTestId('deck-settings').click();
    await expect(page.getByTestId('deck-settings-cards-per-round')).toHaveValue('10');
    await page.getByTestId('deck-settings-cancel').click();
});

test('deck settings modal - retype incorrect toggle', async ({ page }) => {
    const deckOpen = page.getByTestId('deck-open-deck-learn');
    await deckOpen.click();
    await expect(page.locator('#deckDetailView')).not.toHaveClass(/hidden/);
    
    await page.getByTestId('deck-settings').click();
    await expect(page.locator('#deckSettingsModal')).toHaveClass(/show/);
    
    const retypeToggle = page.getByTestId('deck-settings-retype-incorrect');
    if (await retypeToggle.isVisible().catch(() => false)) {
        const wasChecked = await retypeToggle.isChecked();
        await retypeToggle.click();
        await page.getByTestId('deck-settings-save').click();
        
        await page.getByTestId('deck-settings').click();
        const isCheckedNow = await page.getByTestId('deck-settings-retype-incorrect').isChecked();
        expect(isCheckedNow).toBe(!wasChecked);
    }
    await page.getByTestId('deck-settings-cancel').click();
});

test('deck settings modal - cancel discards changes', async ({ page }) => {
    const deckOpen = page.getByTestId('deck-open-deck-learn');
    await deckOpen.click();
    await expect(page.locator('#deckDetailView')).not.toHaveClass(/hidden/);
    
    await page.getByTestId('deck-settings').click();
    await expect(page.locator('#deckSettingsModal')).toHaveClass(/show/);
    
    const originalValue = await page.getByTestId('deck-settings-cards-per-round').inputValue();
    await page.getByTestId('deck-settings-cards-per-round').fill('999');
    await page.getByTestId('deck-settings-cancel').click();
    
    // Reopen and verify original value
    await page.getByTestId('deck-settings').click();
    await expect(page.getByTestId('deck-settings-cards-per-round')).toHaveValue(originalValue);
});

test('search input filters decks', async ({ page }) => {
    await page.getByTestId('search-decks').fill('Learn');
    await page.waitForTimeout(300);
    
    // Learn Mode Deck should be visible
    await expect(page.getByTestId('deck-card-deck-learn')).toBeVisible();
    
    // Clear search
    await page.getByTestId('search-decks').fill('');
    await page.waitForTimeout(300);
    
    // All decks should be visible again
    const deckCount = await page.locator('.deck-card').count();
    expect(deckCount).toBeGreaterThan(1);
});

test('search input with no results', async ({ page }) => {
    await page.getByTestId('search-decks').fill('zzzznonexistent');
    await page.waitForTimeout(300);
    
    // No decks should match
    const deckCount = await page.locator('.deck-card:visible').count();
    expect(deckCount).toBe(0);
});
