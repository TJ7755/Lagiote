import { test, expect } from '@playwright/test';
import {
    applyTestMode,
    waitForTestReady,
    setupNetworkMocks,
    openDeckByName
} from '../helpers.mjs';
import { createTestLogger } from '../test-logging.mjs';

let logger;

test.beforeEach(async ({ page }, testInfo) => {
    await applyTestMode(page);
    await setupNetworkMocks(page);
    logger = createTestLogger(page, { testInfo });
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await waitForTestReady(page);
    
    // Navigate to dashboard if we're on welcome page
    const goToDashboardBtn = page.getByRole('button', { name: 'Go to Dashboard' });
    if (await goToDashboardBtn.isVisible().catch(() => false)) {
        await goToDashboardBtn.click();
        await page.waitForFunction(() => document.getElementById('dashboard')?.classList.contains('is-visible'));
    }
    
    // Ensure we're on dashboard with decks visible
    await page.waitForFunction(() => {
        const dashboard = document.getElementById('dashboard');
        const deckCards = document.querySelectorAll('.deck-card');
        return dashboard && dashboard.classList.contains('is-visible') && deckCards.length > 0;
    }, { timeout: 10000 }).catch(() => {
        // If dashboard not visible, try clicking logo
        const logo = document.querySelector('[data-testid="nav-logo"]') || document.querySelector('img[alt="Lagiote"]');
        if (logo) logo.click();
    });
});

test.afterEach(async ({}, testInfo) => {
    const issues = await logger.finalize(testInfo);
    expect(issues, issues.join('\n')).toEqual([]);
});

test('creates, edits, and deletes a deck with card management', async ({ page }) => {
    await page.getByTestId('deck-create-manual').click();
    await expect(page.locator('#editorView')).toHaveClass(/is-visible/);
    await page.getByTestId('deck-title').fill('E2E Manual Deck');
    await page.getByTestId('deck-category').selectOption('Science');

    const questionInputs = page.locator('textarea[data-testid^="editor-card-question-"]');
    const answerInputs = page.locator('textarea[data-testid^="editor-card-answer-"]');
    await questionInputs.first().fill('What is 1 + 1?');
    await answerInputs.first().fill('2');

    await page.getByTestId('deck-add-card').click();
    await questionInputs.nth(1).fill('What is 2 + 2?');
    await answerInputs.nth(1).fill('4');
    await page.locator('[data-testid^="editor-card-remove-"]').nth(1).click();

    await page.getByTestId('deck-save').click();
    await page.waitForTimeout(500); // Wait for save to complete
    await page.getByTestId('nav-logo').click();
    
    // Wait for dashboard to be visible and ensure deck is created
    await page.waitForFunction(() => document.getElementById('dashboard')?.classList.contains('is-visible'));
    
    // Wait for deck cards to be visible
    await page.waitForFunction(() => {
        const deckCards = document.querySelectorAll('.deck-card');
        return Array.from(deckCards).some(card => {
            const nameElement = card.querySelector('.deck-name');
            return nameElement && nameElement.textContent.includes('E2E Manual Deck') && 
                   card.offsetParent !== null; // Check if visible
        });
    }, { timeout: 10000 });

    await openDeckByName(page, 'E2E Manual Deck');
    await expect(page.locator('#deckDetailView')).not.toHaveClass(/hidden/);
    
    // Wait for the settings button to be visible and stable
    const settingsBtn = page.getByTestId('deck-settings');
    await settingsBtn.waitFor({ state: 'visible', timeout: 5000 });
    await page.waitForTimeout(500); // Small delay to ensure stability
    await settingsBtn.click();
    await expect(page.locator('#deckSettingsModal')).toHaveClass(/show/);
    await page.getByTestId('deck-settings-cards-per-round').fill('5');
    await page.getByTestId('deck-settings-save').click();

    await page.getByTestId('deck-reset').click();
    const confirmCancel = page.getByTestId('confirm-cancel');
    if (await confirmCancel.isVisible()) {
        await confirmCancel.click();
    }
    await page.getByTestId('deck-edit').click();
    await page.getByTestId('deck-title').fill('E2E Manual Deck Updated');
    await page.getByTestId('deck-save').click();
    await page.getByTestId('nav-logo').click();
    await expect(page.getByText('E2E Manual Deck Updated')).toBeVisible();

    const updatedCard = page.locator('.deck-card', { hasText: 'E2E Manual Deck Updated' });
    await updatedCard.locator('[data-testid^="deck-open-"]').click();

    const editBtn = page.locator('[data-testid^="deck-card-edit-"]').first();
    await editBtn.click();
    await page.getByTestId('editCardQuestion').fill('What is 3 + 3?');
    await page.getByTestId('editCardAnswer').fill('6');
    await page.getByTestId('edit-card-save').click();

    const deleteBtn = page.locator('[data-testid^="deck-card-delete-"]').first();
    await deleteBtn.click();
    const confirmDelete = page.getByTestId('confirm-confirm');
    if (await confirmDelete.isVisible()) {
        await confirmDelete.click();
    }

    await page.getByTestId('deck-delete').click();
    if (await confirmDelete.isVisible()) {
        await confirmDelete.click();
    }

    await page.getByTestId('nav-logo').click();
    await expect(page.locator('.deck-card', { hasText: 'E2E Manual Deck Updated' })).toHaveCount(0);
});
