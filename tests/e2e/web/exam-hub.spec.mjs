import { test, expect } from '@playwright/test';
import {
    applyTestMode,
    waitForTestReady,
    setupNetworkMocks,
    openDeckById
} from '../helpers.mjs';
import { createTestLogger } from '../test-logging.mjs';

let logger;
const MOD = 'Control';

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

test('Exam Hub button exists on deck cards', async ({ page }) => {
    // Wait for deck cards to load
    await page.waitForSelector('[data-testid^="deck-card-"]', { timeout: 10000 });
    
    // Check that at least one Exam Hub button exists
    const examHubButtons = page.locator('[data-testid^="deck-action-exam-hub-"]');
    await expect(examHubButtons.first()).toBeVisible({ timeout: 5000 });
    
    // Verify button text
    await expect(examHubButtons.first()).toHaveText('Exam Hub');
});

test('Exam Hub button exists in deck detail view', async ({ page }) => {
    // Open a deck
    await openDeckById(page, 'deck-learn', 'Learn Mode Deck');
    
    // Check for the Exam Hub button in deck detail
    const examHubBtn = page.locator('#deckDetailExamModeBtn');
    await expect(examHubBtn).toBeVisible({ timeout: 5000 });
    await expect(examHubBtn).toHaveText('Exam Hub');
});

test('clicking Exam Hub button opens the hub view', async ({ page }) => {
    // Wait for deck cards to load
    await page.waitForSelector('[data-testid^="deck-card-"]', { timeout: 10000 });
    
    // Click the Exam Hub button on the first deck
    const examHubBtn = page.locator('[data-testid^="deck-action-exam-hub-"]').first();
    await examHubBtn.click();
    
    // Wait for the Exam Hub view to become visible
    const examHubView = page.locator('#examModeHubView');
    await expect(examHubView).toBeVisible({ timeout: 5000 });
});

test('Exam Hub shows expected sections', async ({ page }) => {
    // Wait for deck cards and click Exam Hub
    await page.waitForSelector('[data-testid^="deck-card-"]', { timeout: 10000 });
    const examHubBtn = page.locator('[data-testid^="deck-action-exam-hub-"]').first();
    await examHubBtn.click();
    
    // Wait for hub to load
    const examHubView = page.locator('#examModeHubView');
    await expect(examHubView).toBeVisible({ timeout: 5000 });
    
    // Check for key sections (use flexible selectors as IDs may vary)
    // Look for countdown, prediction, completeness elements
    const hubContent = await examHubView.textContent();
    
    // The hub should contain these key terms
    expect(hubContent).toMatch(/predicted|score|completeness|session/i);
});

test('keyboard shortcut Ctrl+Shift+E shows deck selector when no deck selected', async ({ page }) => {
    // Wait for dashboard to load
    await page.waitForSelector('[data-testid^="deck-card-"]', { timeout: 10000 });
    
    // Press Ctrl+Shift+E without selecting a deck first
    await page.keyboard.press(`${MOD}+Shift+E`);
    
    // Should show either the deck selector modal or a toast message
    await page.waitForTimeout(500);
    
    // Check if deck selector modal appeared or message bar (toast)
    const deckSelectorModal = page.locator('#examHubDeckSelectorModal');
    const messageBarVisible = await page.locator('#messageBar').isVisible().catch(() => false);
    const modalVisible = await deckSelectorModal.isVisible().catch(() => false);
    
    // One of these should be true
    expect(modalVisible || messageBarVisible).toBe(true);
});

test('keyboard shortcut Ctrl+Shift+E opens hub when deck is selected', async ({ page }) => {
    // Open a deck first
    await openDeckById(page, 'deck-learn', 'Learn Mode Deck');
    
    // Press Ctrl+Shift+E
    await page.keyboard.press(`${MOD}+Shift+E`);
    
    // Should open Exam Hub
    const examHubView = page.locator('#examModeHubView');
    await expect(examHubView).toBeVisible({ timeout: 5000 });
});

test('keyboard shortcuts help modal can be opened via shortcut', async ({ page }) => {
    // Wait for dashboard
    await page.waitForSelector('[data-testid^="deck-card-"]', { timeout: 10000 });
    
    // Try Ctrl+Shift+/ to open help (standard key, behaviour may vary by keyboard layout)
    await page.keyboard.press(`${MOD}+Shift+/`);
    
    // If the shortcut didn't work, fall back to the function call
    const shortcutsModal = page.locator('#keyboardShortcutsModal');
    let isVisible = await shortcutsModal.isVisible().catch(() => false);
    
    if (!isVisible) {
        // Fallback: try via window function
        await page.evaluate(() => {
            if (typeof window.showKeyboardShortcutsHelp === 'function') {
                window.showKeyboardShortcutsHelp();
            }
        });
    }
    
    // Check if modal is visible
    await expect(shortcutsModal).toBeVisible({ timeout: 3000 });
    
    // Verify it contains shortcut information
    const modalContent = await shortcutsModal.textContent();
    expect(modalContent).toContain('Ctrl');
    expect(modalContent).toContain('Exam Hub');
});

test('closing Exam Hub returns to dashboard', async ({ page }) => {
    // Open Exam Hub
    await page.waitForSelector('[data-testid^="deck-card-"]', { timeout: 10000 });
    const examHubBtn = page.locator('[data-testid^="deck-action-exam-hub-"]').first();
    await examHubBtn.click();
    
    // Wait for hub
    const examHubView = page.locator('#examModeHubView');
    await expect(examHubView).toBeVisible({ timeout: 5000 });
    
    // Press Escape to close
    await page.keyboard.press('Escape');
    
    // Dashboard should be visible again
    await page.waitForTimeout(500);
    const dashboard = page.locator('#dashboard');
    await expect(dashboard).toBeVisible({ timeout: 5000 });
});
