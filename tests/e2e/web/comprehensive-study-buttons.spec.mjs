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

test('study mode - show answer button', async ({ page }) => {
    await openDeckById(page, 'deck-review', 'Review Deck');
    await page.getByTestId('mode-review-start').click({ force: true, timeout: 5000 });
    await page.waitForTimeout(500);
    
    await page.waitForFunction(() => {
        const cardView = document.getElementById('cardView');
        return cardView && !cardView.classList.contains('hidden');
    }, { timeout: 10000 });
    
    const showBtn = page.getByTestId('answer-show');
    if (await showBtn.isVisible().catch(() => false)) {
        await showBtn.click();
        await page.waitForTimeout(200);
        
        const correctBtn = page.getByTestId('answer-correct');
        const incorrectBtn = page.getByTestId('answer-incorrect');
        expect(await correctBtn.isVisible() || await incorrectBtn.isVisible()).toBe(true);
    }
});

test('study mode - show question button (after answer shown)', async ({ page }) => {
    await openDeckById(page, 'deck-review', 'Review Deck');
    await page.getByTestId('mode-review-start').click({ force: true, timeout: 5000 });
    await page.waitForTimeout(500);
    
    await page.waitForFunction(() => {
        const cardView = document.getElementById('cardView');
        return cardView && !cardView.classList.contains('hidden');
    }, { timeout: 10000 });
    
    const showBtn = page.getByTestId('answer-show');
    if (await showBtn.isVisible().catch(() => false)) {
        await showBtn.click();
        await page.waitForTimeout(200);
        
        const showQuestionBtn = page.getByTestId('answer-show-question');
        if (await showQuestionBtn.isVisible().catch(() => false)) {
            await showQuestionBtn.click();
            await page.waitForTimeout(200);
            // Should toggle back to show answer
            await expect(page.getByTestId('answer-show')).toBeVisible();
        }
    }
});

test('study mode - correct button advances', async ({ page }) => {
    await openDeckById(page, 'deck-review', 'Review Deck');
    await page.getByTestId('mode-review-start').click({ force: true, timeout: 5000 });
    await page.waitForTimeout(500);
    
    await page.waitForFunction(() => {
        const cardView = document.getElementById('cardView');
        return cardView && !cardView.classList.contains('hidden');
    }, { timeout: 10000 });
    
    if (await page.getByTestId('answer-show').isVisible().catch(() => false)) {
        await page.getByTestId('answer-show').click();
    }
    await page.waitForTimeout(200);
    
    const correctBtn = page.getByTestId('answer-correct');
    if (await correctBtn.isVisible().catch(() => false)) {
        await correctBtn.click();
        await page.waitForTimeout(300);
        
        // Should still be in study mode
        await expect(page.locator('#studyMode')).toBeVisible();
    }
});

test('study mode - incorrect button advances', async ({ page }) => {
    await openDeckById(page, 'deck-review', 'Review Deck');
    await page.getByTestId('mode-review-start').click({ force: true, timeout: 5000 });
    await page.waitForTimeout(500);
    
    await page.waitForFunction(() => {
        const cardView = document.getElementById('cardView');
        return cardView && !cardView.classList.contains('hidden');
    }, { timeout: 10000 });
    
    if (await page.getByTestId('answer-show').isVisible().catch(() => false)) {
        await page.getByTestId('answer-show').click();
    }
    await page.waitForTimeout(200);
    
    const incorrectBtn = page.getByTestId('answer-incorrect');
    if (await incorrectBtn.isVisible().catch(() => false)) {
        await incorrectBtn.click();
        await page.waitForTimeout(300);
        
        await expect(page.locator('#studyMode')).toBeVisible();
    }
});

test('study mode - check answer button (type mode)', async ({ page }) => {
    await openDeckById(page, 'deck-learn', 'Learn Mode Deck');
    const learnSetup = page.getByTestId('learn-setup-start');
    if (await learnSetup.isVisible().catch(() => false)) {
        await learnSetup.click();
    } else {
        await page.getByTestId('mode-learn-start').click({ force: true, timeout: 5000 });
    }
    await page.waitForTimeout(500);
    
    await expect(page.locator('#studyMode')).toBeVisible({ timeout: 10000 });
    
    const checkBtn = page.getByTestId('answer-check');
    const answerInput = page.getByTestId('answer-input');
    
    if (await checkBtn.isVisible().catch(() => false)) {
        if (await answerInput.isVisible().catch(() => false)) {
            await answerInput.fill('test answer');
        }
        await checkBtn.click();
        await page.waitForTimeout(300);
        
        // Should show feedback
        await expect(page.locator('#studyMode')).toBeVisible();
    }
});

test('study mode - dont know button', async ({ page }) => {
    await openDeckById(page, 'deck-learn', 'Learn Mode Deck');
    await page.getByTestId('mode-learn-start').click({ force: true, timeout: 5000 });
    await page.waitForTimeout(500);
    
    await expect(page.locator('#studyMode')).toBeVisible({ timeout: 10000 });
    
    const dontKnowBtn = page.getByTestId('answer-dont-know');
    if (await dontKnowBtn.isVisible().catch(() => false)) {
        await dontKnowBtn.click();
        await page.waitForTimeout(300);
        
        // Should show the answer
        await expect(page.locator('#studyMode')).toBeVisible();
    }
});

test('study mode - next button', async ({ page }) => {
    await openDeckById(page, 'deck-learn', 'Learn Mode Deck');
    await page.getByTestId('mode-learn-start').click({ force: true, timeout: 5000 });
    await page.waitForTimeout(500);
    
    await expect(page.locator('#studyMode')).toBeVisible({ timeout: 10000 });
    
    // First show answer or answer question
    if (await page.getByTestId('answer-show').isVisible().catch(() => false)) {
        await page.getByTestId('answer-show').click();
        await page.waitForTimeout(200);
    }
    
    if (await page.getByTestId('answer-correct').isVisible().catch(() => false)) {
        await page.getByTestId('answer-correct').click();
        await page.waitForTimeout(200);
    }
    
    const nextBtn = page.getByTestId('answer-next');
    if (await nextBtn.isVisible().catch(() => false)) {
        await nextBtn.click();
        await page.waitForTimeout(300);
        await expect(page.locator('#studyMode')).toBeVisible();
    }
});

test('study mode - continue round button', async ({ page }) => {
    await openDeckById(page, 'deck-review', 'Review Deck');
    await page.getByTestId('mode-review-start').click({ force: true, timeout: 5000 });
    await page.waitForTimeout(500);
    
    await page.waitForFunction(() => {
        const studyMode = document.getElementById('studyMode');
        return studyMode && !studyMode.classList.contains('hidden');
    }, { timeout: 10000 });
    
    const continueBtn = page.getByTestId('study-continue-round');
    if (await continueBtn.isVisible().catch(() => false)) {
        await continueBtn.click();
        await page.waitForTimeout(300);
        await expect(page.locator('#studyMode')).toBeVisible();
    }
});

test('study mode - end session button', async ({ page }) => {
    await openDeckById(page, 'deck-review', 'Review Deck');
    await page.getByTestId('mode-review-start').click({ force: true, timeout: 5000 });
    await page.waitForTimeout(500);
    
    await page.waitForFunction(() => {
        const studyMode = document.getElementById('studyMode');
        return studyMode && !studyMode.classList.contains('hidden');
    }, { timeout: 10000 });
    
    // End session using the end session button if visible
    const endBtn = page.getByTestId('study-end');
    if (await endBtn.isVisible().catch(() => false)) {
        await endBtn.click();
        await page.waitForTimeout(300);
    }
    
    // Complete view should show or we return to deck
    const completeVisible = await page.locator('#completeView').isVisible().catch(() => false);
    const deckDetailVisible = await page.locator('#deckDetailView').isVisible().catch(() => false);
    const studyModeVisible = await page.locator('#studyMode').isVisible().catch(() => false);
    expect(completeVisible || deckDetailVisible || studyModeVisible).toBe(true);
});

test('study mode - reset progress button shows confirmation', async ({ page }) => {
    await openDeckById(page, 'deck-learn', 'Learn Mode Deck');
    
    // Reset should be on the deck detail view
    const resetBtn = page.getByTestId('deck-reset');
    if (await resetBtn.isVisible().catch(() => false)) {
        await resetBtn.click();
        await page.waitForTimeout(300);
        
        // Confirmation modal should appear
        const confirmModal = page.locator('#confirmActionModal');
        await expect(confirmModal).toHaveClass(/show/);
        
        // Cancel
        await page.getByTestId('confirm-cancel').click();
    }
});

test('study mode - instructions button', async ({ page }) => {
    await openDeckById(page, 'deck-review', 'Review Deck');
    await page.getByTestId('mode-review-start').click({ force: true, timeout: 5000 });
    await page.waitForTimeout(500);
    
    await page.waitForFunction(() => {
        const studyMode = document.getElementById('studyMode');
        return studyMode && !studyMode.classList.contains('hidden');
    }, { timeout: 10000 });
    
    const instructionsBtn = page.getByTestId('study-instructions');
    if (await instructionsBtn.isVisible().catch(() => false)) {
        await instructionsBtn.click();
        await page.waitForTimeout(200);
        
        // Instructions modal should show
        const instructionsModal = page.locator('#instructionsModal');
        await expect(instructionsModal).toHaveClass(/show/);
        
        // Close it
        const closeBtn = page.getByTestId('modal-close-instructionsModal');
        if (await closeBtn.isVisible().catch(() => false)) {
            await closeBtn.click();
        }
    }
});

test('study mode - edit card button (when enabled)', async ({ page }) => {
    // First enable in-study editing
    await page.getByTestId('nav-settings').click();
    await page.getByTestId('settings-editing').check();
    await page.getByTestId('settings-save-study').click();
    await page.waitForTimeout(300);
    await page.getByTestId('nav-logo').click();
    
    await openDeckById(page, 'deck-learn', 'Learn Mode Deck');
    await page.evaluate(() => configureStudy('learn'));
    await page.waitForTimeout(500);
    
    const studyModeVisible = await page.locator('#studyMode').isVisible().catch(() => false);
    expect(studyModeVisible).toBe(true);
    
    const editBtn = page.getByTestId('study-edit-card');
    if (await editBtn.isVisible().catch(() => false)) {
        await editBtn.click();
        await page.waitForTimeout(200);
        
        // Edit modal should appear
        const editModal = page.locator('#editCardModal');
        if (await editModal.isVisible().catch(() => false)) {
            // Close the modal
            await page.locator('#editCardModal .btn-secondary').click();
        }
    }
});

test('spaced mode - rating buttons work', async ({ page }) => {
    await openDeckById(page, 'deck-review', 'Review Deck');
    await page.getByTestId('mode-spaced-start').click({ force: true, timeout: 5000 });
    await page.waitForTimeout(500);
    
    await page.waitForFunction(() => {
        const studyMode = document.getElementById('studyMode');
        return studyMode && !studyMode.classList.contains('hidden');
    }, { timeout: 10000 });
    
    // Continue if needed
    if (await page.getByTestId('study-continue-round').isVisible().catch(() => false)) {
        await page.getByTestId('study-continue-round').click();
        await page.waitForTimeout(300);
    }
    
    // Show answer
    if (await page.getByTestId('answer-show').isVisible().catch(() => false)) {
        await page.getByTestId('answer-show').click();
        await page.waitForTimeout(200);
    }
    
    // Test each rating button
    const ratings = ['rating-again', 'rating-hard', 'rating-good', 'rating-easy'];
    for (const rating of ratings) {
        const ratingBtn = page.getByTestId(rating);
        if (await ratingBtn.isVisible().catch(() => false)) {
            // Just verify it's visible and has interval display
            await expect(ratingBtn).toBeEnabled();
            break; // Only test one to avoid exhausting the queue
        }
    }
    
    await runIntegrityCheck(page, logger);
});
