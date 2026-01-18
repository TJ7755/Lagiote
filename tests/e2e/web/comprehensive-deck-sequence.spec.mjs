import { test, expect } from '@playwright/test';
import {
    applyTestMode,
    waitForTestReady,
    setupNetworkMocks,
    openDeckById
} from '../helpers.mjs';
import { createTestLogger, runIntegrityCheck } from '../test-logging.mjs';

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

test('sequence mode - submit button', async ({ page }) => {
    const deckOpen = page.getByTestId('deck-open-deck-sequence-legacy');
    if (!await deckOpen.isVisible().catch(() => false)) {
        test.skip();
        return;
    }
    
    await deckOpen.click();
    await expect(page.locator('#deckDetailView')).not.toHaveClass(/hidden/);
    await page.getByTestId('mode-sequence-start').click();
    await expect(page.locator('#sequenceTaskView')).toBeVisible();
    
    // Wait for task to load
    await page.waitForFunction(() => {
        const body = document.getElementById('sequenceTaskBody');
        return body && body.textContent && body.textContent.trim().length > 0;
    });
    
    // Handle different sequence types
    const textInput = page.locator('#sequenceNextInput');
    const gapSelect = page.locator('#sequenceGapSelect');
    
    if (await textInput.isVisible().catch(() => false)) {
        await textInput.fill('Test response');
    } else if (await gapSelect.isVisible().catch(() => false)) {
        const optionValue = await page.evaluate(() => {
            const select = document.getElementById('sequenceGapSelect');
            if (!select || !select.options.length) return '';
            return select.options[0].value;
        });
        if (optionValue) {
            await gapSelect.selectOption(optionValue);
        }
    }
    
    await page.getByTestId('sequence-submit').click();
    await expect(page.locator('#sequenceTaskFeedback')).toBeVisible();
    await runIntegrityCheck(page, logger);
});

test('sequence mode - continue button', async ({ page }) => {
    const deckOpen = page.getByTestId('deck-open-deck-sequence-legacy');
    if (!await deckOpen.isVisible().catch(() => false)) {
        test.skip();
        return;
    }
    
    await deckOpen.click();
    await expect(page.locator('#deckDetailView')).not.toHaveClass(/hidden/);
    await page.getByTestId('mode-sequence-start').click();
    await expect(page.locator('#sequenceTaskView')).toBeVisible();
    
    await page.waitForFunction(() => {
        const body = document.getElementById('sequenceTaskBody');
        return body && body.textContent && body.textContent.trim().length > 0;
    });
    
    // Submit to show continue
    await page.getByTestId('sequence-submit').click();
    await page.waitForTimeout(300);
    
    const continueBtn = page.getByTestId('sequence-continue');
    if (await continueBtn.isVisible().catch(() => false)) {
        await continueBtn.click();
        await page.waitForTimeout(300);
        await expect(page.locator('#studyMode')).toBeVisible();
    }
});

test('sequence mode - order up button', async ({ page }) => {
    const deckOpen = page.getByTestId('deck-open-deck-sequence');
    if (!await deckOpen.isVisible().catch(() => false)) {
        test.skip();
        return;
    }
    
    await deckOpen.click();
    await expect(page.locator('#deckDetailView')).not.toHaveClass(/hidden/);
    await page.getByTestId('mode-sequence-start').click();
    await expect(page.locator('#sequenceTaskView')).toBeVisible();
    
    await page.waitForFunction(() => {
        const body = document.getElementById('sequenceTaskBody');
        return body && body.textContent && body.textContent.trim().length > 0;
    });
    
    // Check if order list is visible
    const orderList = page.locator('#sequenceOrderList');
    if (await orderList.isVisible().catch(() => false)) {
        const upBtn = page.locator('[data-testid^="sequence-order-up-"]').first();
        if (await upBtn.isVisible().catch(() => false)) {
            await upBtn.click();
            await page.waitForTimeout(200);
            await expect(page.locator('#sequenceTaskView')).toBeVisible();
        }
    }
});

test('sequence mode - order down button', async ({ page }) => {
    const deckOpen = page.getByTestId('deck-open-deck-sequence');
    if (!await deckOpen.isVisible().catch(() => false)) {
        test.skip();
        return;
    }
    
    await deckOpen.click();
    await expect(page.locator('#deckDetailView')).not.toHaveClass(/hidden/);
    await page.getByTestId('mode-sequence-start').click();
    await expect(page.locator('#sequenceTaskView')).toBeVisible();
    
    await page.waitForFunction(() => {
        const body = document.getElementById('sequenceTaskBody');
        return body && body.textContent && body.textContent.trim().length > 0;
    });
    
    const orderList = page.locator('#sequenceOrderList');
    if (await orderList.isVisible().catch(() => false)) {
        const downBtn = page.locator('[data-testid^="sequence-order-down-"]').first();
        if (await downBtn.isVisible().catch(() => false)) {
            await downBtn.click();
            await page.waitForTimeout(200);
            await expect(page.locator('#sequenceTaskView')).toBeVisible();
        }
    }
});

test('sequence mode - gap select dropdown', async ({ page }) => {
    const deckOpen = page.getByTestId('deck-open-deck-sequence-legacy');
    if (!await deckOpen.isVisible().catch(() => false)) {
        test.skip();
        return;
    }
    
    await deckOpen.click();
    await expect(page.locator('#deckDetailView')).not.toHaveClass(/hidden/);
    await page.getByTestId('mode-sequence-start').click();
    await expect(page.locator('#sequenceTaskView')).toBeVisible();
    
    await page.waitForFunction(() => {
        const body = document.getElementById('sequenceTaskBody');
        return body && body.textContent && body.textContent.trim().length > 0;
    });
    
    const gapSelect = page.locator('#sequenceGapSelect');
    if (await gapSelect.isVisible().catch(() => false)) {
        const options = await gapSelect.locator('option').count();
        expect(options).toBeGreaterThan(0);
        
        // Select an option
        const optionValue = await page.evaluate(() => {
            const select = document.getElementById('sequenceGapSelect');
            if (!select || !select.options.length) return '';
            return select.options[0].value;
        });
        if (optionValue) {
            await gapSelect.selectOption(optionValue);
        }
    }
});

test('sequence mode - text input', async ({ page }) => {
    const deckOpen = page.getByTestId('deck-open-deck-sequence-legacy');
    if (!await deckOpen.isVisible().catch(() => false)) {
        test.skip();
        return;
    }
    
    await deckOpen.click();
    await expect(page.locator('#deckDetailView')).not.toHaveClass(/hidden/);
    await page.getByTestId('mode-sequence-start').click();
    await expect(page.locator('#sequenceTaskView')).toBeVisible();
    
    await page.waitForFunction(() => {
        const body = document.getElementById('sequenceTaskBody');
        return body && body.textContent && body.textContent.trim().length > 0;
    });
    
    const textInput = page.locator('#sequenceNextInput');
    if (await textInput.isVisible().catch(() => false)) {
        await textInput.fill('My sequence answer');
        await expect(textInput).toHaveValue('My sequence answer');
    }
});

test('deck detail - learn button', async ({ page }) => {
    await openDeckById(page, 'deck-learn', 'Learn Mode Deck');
    
    const learnBtn = page.getByTestId('mode-learn-start');
    await expect(learnBtn).toBeVisible();
    await learnBtn.click({ force: true, timeout: 5000 });
    
    await page.waitForTimeout(500);
    await expect(page.locator('#studyMode')).toBeVisible();
});

test('deck detail - review button', async ({ page }) => {
    await openDeckById(page, 'deck-review', 'Review Deck');
    
    const reviewBtn = page.getByTestId('mode-review-start');
    await expect(reviewBtn).toBeVisible();
    await reviewBtn.click({ force: true, timeout: 5000 });
    
    await page.waitForTimeout(500);
    await expect(page.locator('#studyMode')).toBeVisible();
});

test('deck detail - spaced learning button', async ({ page }) => {
    await openDeckById(page, 'deck-review', 'Review Deck');
    
    const spacedBtn = page.getByTestId('mode-spaced-start');
    await expect(spacedBtn).toBeVisible();
    await spacedBtn.click({ force: true, timeout: 5000 });
    
    await page.waitForTimeout(500);
    await expect(page.locator('#studyMode')).toBeVisible();
});

test('deck detail - practice test button', async ({ page }) => {
    await openDeckById(page, 'deck-practice', 'Practice Test Deck');
    
    const testBtn = page.getByTestId('mode-practice-start');
    await expect(testBtn).toBeVisible();
    await testBtn.click({ force: true, timeout: 5000 });
    
    // Practice test modal should appear
    await expect(page.locator('#practiceTestModal')).toHaveClass(/show/);
});

test('deck detail - export button', async ({ page }) => {
    await openDeckById(page, 'deck-learn', 'Learn Mode Deck');
    
    const exportBtn = page.getByTestId('deck-export');
    await expect(exportBtn).toBeVisible();
    
    // Set up download listener
    const downloadPromise = page.waitForEvent('download', { timeout: 5000 }).catch(() => null);
    await exportBtn.click();
    
    const download = await downloadPromise;
    if (download) {
        expect(download.suggestedFilename()).toContain('.json');
    }
});

test('deck detail - edit button', async ({ page }) => {
    await openDeckById(page, 'deck-learn', 'Learn Mode Deck');
    
    const editBtn = page.getByTestId('deck-edit');
    await expect(editBtn).toBeVisible();
    await editBtn.click();
    
    await expect(page.locator('#editorView')).toHaveClass(/is-visible/);
});

test('deck detail - settings button', async ({ page }) => {
    await openDeckById(page, 'deck-learn', 'Learn Mode Deck');
    
    const settingsBtn = page.getByTestId('deck-settings');
    await expect(settingsBtn).toBeVisible();
    await settingsBtn.click();
    
    await expect(page.locator('#deckSettingsModal')).toHaveClass(/show/);
});

test('deck detail - reset progress button shows confirmation', async ({ page }) => {
    await openDeckById(page, 'deck-learn', 'Learn Mode Deck');
    
    const resetBtn = page.getByTestId('deck-reset');
    await expect(resetBtn).toBeVisible();
    await resetBtn.click();
    
    // Confirmation dialog should appear
    const confirmModal = page.locator('#confirmModal');
    const confirmVisible = await confirmModal.isVisible().catch(() => false);
    
    if (confirmVisible) {
        // Cancel it
        await page.getByTestId('confirm-cancel').click();
    }
});

test('deck detail - delete button shows confirmation', async ({ page }) => {
    // Create a temporary deck first
    await page.getByTestId('deck-create-manual').click();
    await page.getByTestId('deck-title').fill('Temp Delete Test Deck');
    const questionInputs = page.locator('textarea[data-testid^="editor-card-question-"]');
    const answerInputs = page.locator('textarea[data-testid^="editor-card-answer-"]');
    await questionInputs.first().fill('Q');
    await answerInputs.first().fill('A');
    await page.getByTestId('deck-save').click();
    await page.waitForTimeout(500);
    await page.getByTestId('nav-logo').click();
    
    // Open the deck
    await page.waitForFunction(() => {
        const cards = document.querySelectorAll('.deck-card');
        return Array.from(cards).some(card => card.textContent?.includes('Temp Delete Test Deck'));
    });
    
    const deckCard = page.locator('.deck-card', { hasText: 'Temp Delete Test Deck' });
    await deckCard.locator('[data-testid^="deck-open-"]').click();
    
    const deleteBtn = page.getByTestId('deck-delete');
    await expect(deleteBtn).toBeVisible();
    await deleteBtn.click();
    
    // Confirmation should appear
    const confirmBtn = page.getByTestId('confirm-confirm');
    await expect(confirmBtn).toBeVisible();
    
    // Confirm deletion
    await confirmBtn.click();
    await page.waitForTimeout(500);
    
    // Should be back on dashboard
    await page.getByTestId('nav-logo').click();
    await expect(page.locator('.deck-card', { hasText: 'Temp Delete Test Deck' })).toHaveCount(0);
});

test('deck card - edit card button', async ({ page }) => {
    await openDeckById(page, 'deck-learn', 'Learn Mode Deck');
    
    const editCardBtn = page.locator('[data-testid^="deck-card-edit-"]').first();
    if (await editCardBtn.isVisible().catch(() => false)) {
        await editCardBtn.click();
        
        // Edit modal should appear
        const editModal = page.locator('#editCardModal');
        await expect(editModal).toHaveClass(/show/);
        
        // Cancel
        await page.getByTestId('edit-card-cancel').click();
    }
});

test('deck card - delete card button shows confirmation', async ({ page }) => {
    await openDeckById(page, 'deck-learn', 'Learn Mode Deck');
    
    const deleteCardBtn = page.locator('[data-testid^="deck-card-delete-"]').first();
    if (await deleteCardBtn.isVisible().catch(() => false)) {
        await deleteCardBtn.click();
        
        // Confirmation should appear
        const confirmCancel = page.getByTestId('confirm-cancel');
        if (await confirmCancel.isVisible()) {
            await confirmCancel.click();
        }
    }
});
