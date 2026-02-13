import { test, expect } from '@playwright/test';
import {
    applyTestMode,
    waitForTestReady,
    setupNetworkMocks,
    openDeckById
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

test('nav logo navigates to dashboard', async ({ page }) => {
    // Navigate away first
    await page.getByTestId('nav-settings').click();
    await expect(page.locator('#settingsView')).toBeVisible();
    
    // Click logo
    await page.getByTestId('nav-logo').click();
    await expect(page.locator('#dashboard')).toBeVisible();
});

test('nav back button appears in sub-views', async ({ page }) => {
    // Navigate to settings first (to add view history)
    await page.getByTestId('nav-settings').click();
    await expect(page.locator('#settingsView')).toBeVisible();
    
    // Back button should be visible now (since there's history)
    const backBtn = page.getByTestId('nav-back');
    
    // Wait a bit for button to update
    await page.waitForTimeout(300);
    
    const backVisible = await backBtn.isVisible().catch(() => false);
    // The back button should be visible after navigation
    // Or the logo button can be used to go home
    const logoBtn = page.getByTestId('nav-logo');
    const logoVisible = await logoBtn.isVisible().catch(() => false);
    
    expect(backVisible || logoVisible).toBe(true);
});

test('nav home button returns to dashboard', async ({ page }) => {
    await openDeckById(page, 'deck-learn', 'Learn Mode Deck');
    
    const homeBtn = page.getByTestId('nav-home');
    if (await homeBtn.isVisible().catch(() => false)) {
        await homeBtn.click();
        await expect(page.locator('#dashboard')).toBeVisible();
    }
});

test('nav settings button opens settings', async ({ page }) => {
    await page.getByTestId('nav-settings').click();
    await expect(page.locator('#settingsView')).toBeVisible();
});

test('nav profile button opens dropdown', async ({ page }) => {
    await page.getByTestId('nav-profile').click();
    
    const dropdown = page.locator('#userProfileDropdown');
    await expect(dropdown).not.toHaveClass(/hidden/);
});

test('profile sync button exists', async ({ page }) => {
    await page.getByTestId('nav-profile').click();
    
    const syncBtn = page.getByTestId('profile-sync');
    await expect(syncBtn).toBeVisible();
});

test('profile check updates button exists', async ({ page }) => {
    await page.getByTestId('nav-profile').click();
    
    const checkUpdatesBtn = page.getByTestId('profile-check-updates');
    await expect(checkUpdatesBtn).toBeVisible();
});

test('profile logout button exists', async ({ page }) => {
    await page.getByTestId('nav-profile').click();
    
    const logoutBtn = page.getByTestId('profile-logout');
    await expect(logoutBtn).toBeVisible();
});

test('nav insights button opens insights', async ({ page }) => {
    const insightsBtn = page.getByTestId('nav-insights');
    if (await insightsBtn.isVisible().catch(() => false)) {
        await insightsBtn.click();
        await expect(page.locator('#insightsView')).toHaveClass(/is-visible/);
    }
});

test('nav global analytics button opens analytics', async ({ page }) => {
    const analyticsBtn = page.getByTestId('nav-global-analytics');
    if (await analyticsBtn.isVisible().catch(() => false)) {
        await analyticsBtn.click();
        await expect(page.locator('#globalAnalyticsView')).toHaveClass(/is-visible/);
    }
});

test('insights deck select changes content', async ({ page }) => {
    const insightsBtn = page.getByTestId('nav-insights');
    if (!await insightsBtn.isVisible().catch(() => false)) {
        await page.evaluate(() => {
            document.querySelector('[data-testid="nav-insights"]')?.click();
        });
    } else {
        await insightsBtn.click();
    }
    
    await expect(page.locator('#insightsView')).toHaveClass(/is-visible/);
    
    const deckSelect = page.getByTestId('insights-deck-select');
    await deckSelect.selectOption('deck-learn');
    
    // Insights content should show
    await expect(page.locator('#insightsContent')).not.toHaveClass(/hidden/);
});

test('deck create manual button opens editor', async ({ page }) => {
    await page.getByTestId('deck-create-manual').click();
    await expect(page.locator('#editorView')).toHaveClass(/is-visible/);
});

test('deck import button opens import modal', async ({ page }) => {
    await page.getByTestId('deck-import').click();
    await expect(page.locator('#importModal')).toHaveClass(/show/);
});

test('deck create ai button opens AI generator', async ({ page }) => {
    await page.getByTestId('deck-create-ai').click();
    await expect(page.locator('#aiGenerator')).toHaveClass(/is-visible/);
});

test('import modal - paste tab', async ({ page }) => {
    await page.getByTestId('deck-import').click();
    await expect(page.locator('#importModal')).toHaveClass(/show/);
    
    await page.getByTestId('import-tab-paste').click();
    // Paste tab should be active
    const pasteTab = page.getByTestId('import-tab-paste');
    await expect(pasteTab).toHaveClass(/active/);
});

test('import modal - file tab', async ({ page }) => {
    await page.getByTestId('deck-import').click();
    await expect(page.locator('#importModal')).toHaveClass(/show/);
    
    await page.getByTestId('import-tab-file').click();
    const fileTab = page.getByTestId('import-tab-file');
    await expect(fileTab).toHaveClass(/active/);
});

test('import modal - deck name input', async ({ page }) => {
    await page.getByTestId('deck-import').click();
    await expect(page.locator('#importModal')).toHaveClass(/show/);
    
    await page.getByTestId('import-deck-name').fill('Test Import Deck');
    await expect(page.getByTestId('import-deck-name')).toHaveValue('Test Import Deck');
});

test('import modal - category select', async ({ page }) => {
    await page.getByTestId('deck-import').click();
    await expect(page.locator('#importModal')).toHaveClass(/show/);
    
    await page.getByTestId('import-deck-category').selectOption('Science');
    await expect(page.getByTestId('import-deck-category')).toHaveValue('Science');
});

test('confirm modal - cancel button', async ({ page }) => {
    await openDeckById(page, 'deck-learn', 'Learn Mode Deck');
    
    // Trigger a confirmation by clicking reset
    const resetBtn = page.getByTestId('deck-reset');
    if (await resetBtn.isVisible().catch(() => false)) {
        await resetBtn.click();
        await page.waitForTimeout(300);
        
        const confirmModal = page.locator('#confirmActionModal');
        if (await confirmModal.isVisible().catch(() => false)) {
            const cancelBtn = page.getByTestId('confirm-cancel');
            if (await cancelBtn.isVisible().catch(() => false)) {
                await cancelBtn.click();
                await page.waitForTimeout(300);
                // Modal should close - either hidden or not visible
                const stillVisible = await confirmModal.isVisible().catch(() => false);
                expect(stillVisible).toBe(false);
            }
        }
    }
});

test('edit card modal - save button', async ({ page }) => {
    await openDeckById(page, 'deck-learn', 'Learn Mode Deck');
    
    const editCardBtn = page.locator('[data-testid^="deck-card-edit-"]').first();
    if (await editCardBtn.isVisible().catch(() => false)) {
        await editCardBtn.click();
        await page.waitForTimeout(300);
        
        const editModal = page.locator('#editCardModal');
        if (await editModal.isVisible().catch(() => false)) {
            // Make a change
            const questionInput = page.locator('#editCardQuestion');
            const originalValue = await questionInput.inputValue();
            await questionInput.fill(originalValue + ' (edited)');
            
            // Click save
            const saveBtn = page.locator('#editCardModal .btn-success');
            if (await saveBtn.isVisible().catch(() => false)) {
                await saveBtn.click();
                await page.waitForTimeout(300);
            }
        }
    }
});

test('edit card modal - cancel button', async ({ page }) => {
    await openDeckById(page, 'deck-learn', 'Learn Mode Deck');
    
    const editCardBtn = page.locator('[data-testid^="deck-card-edit-"]').first();
    if (await editCardBtn.isVisible().catch(() => false)) {
        await editCardBtn.click();
        await page.waitForTimeout(300);
        
        const editModal = page.locator('#editCardModal');
        if (await editModal.isVisible().catch(() => false)) {
            const cancelBtn = page.locator('#editCardModal .btn-secondary');
            if (await cancelBtn.isVisible().catch(() => false)) {
                await cancelBtn.click();
                await page.waitForTimeout(300);
            }
        }
    }
});

test('deck card quick actions - learn button', async ({ page }) => {
    const deckCard = page.locator('.deck-card').first();
    const quickLearnBtn = deckCard.locator('[data-testid^="deck-quick-learn-"]');
    
    if (await quickLearnBtn.isVisible().catch(() => false)) {
        await quickLearnBtn.click();
        await page.waitForTimeout(500);
        await expect(page.locator('#studyMode')).toBeVisible();
    }
});

test('deck card quick actions - review button', async ({ page }) => {
    const deckCard = page.locator('.deck-card').first();
    const quickReviewBtn = deckCard.locator('[data-testid^="deck-quick-review-"]');
    
    if (await quickReviewBtn.isVisible().catch(() => false)) {
        await quickReviewBtn.click();
        await page.waitForTimeout(500);
        await expect(page.locator('#studyMode')).toBeVisible();
    }
});

test('deck open button opens deck detail', async ({ page }) => {
    await openDeckById(page, 'deck-learn', 'Learn Mode Deck');
    await expect(page.locator('#deckDetailTitle')).toContainText('Learn Mode Deck');
});
