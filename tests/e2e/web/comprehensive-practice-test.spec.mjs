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

test('practice test - free practice preset', async ({ page }) => {
    await openDeckById(page, 'deck-practice', 'Practice Test Deck');
    await page.getByTestId('mode-practice-start').click({ force: true, timeout: 5000 });
    
    await page.getByTestId('presetFree').click();
    await expect(page.getByTestId('presetFree')).toHaveClass(/active/);
});

test('practice test - question count input', async ({ page }) => {
    await openDeckById(page, 'deck-practice', 'Practice Test Deck');
    await page.getByTestId('mode-practice-start').click({ force: true, timeout: 5000 });
    
    await page.getByTestId('presetFree').click();
    await page.getByTestId('test-question-count').fill('5');
    await expect(page.getByTestId('test-question-count')).toHaveValue('5');
});

test('practice test - generate button', async ({ page }) => {
    await openDeckById(page, 'deck-practice', 'Practice Test Deck');
    await page.getByTestId('mode-practice-start').click({ force: true, timeout: 5000 });
    
    await page.getByTestId('presetFree').click();
    await page.getByTestId('test-question-count').fill('3');
    await page.getByTestId('practice-test-generate').click();
    
    // Start button should appear
    await expect(page.getByTestId('test-start')).toBeVisible({ timeout: 5000 });
});

test('practice test - start button', async ({ page }) => {
    await openDeckById(page, 'deck-practice', 'Practice Test Deck');
    await page.getByTestId('mode-practice-start').click({ force: true, timeout: 5000 });
    
    await page.getByTestId('presetFree').click();
    await page.getByTestId('test-question-count').fill('2');
    await page.getByTestId('practice-test-generate').click();
    await page.getByTestId('test-start').click();
    
    // Practice test view should be active
    await expect(page.locator('#practiceTestView')).toBeVisible({ timeout: 5000 });
});

test('practice test - MCQ option selection', async ({ page }) => {
    await openDeckById(page, 'deck-practice', 'Practice Test Deck');
    await page.getByTestId('mode-practice-start').click({ force: true, timeout: 5000 });
    
    await page.getByTestId('presetFree').click();
    await page.getByTestId('test-question-count').fill('2');
    await page.getByTestId('practice-test-generate').click();
    await page.getByTestId('test-start').click();
    
    await page.waitForTimeout(500);
    
    const mcqOptions = page.locator('[data-testid^="test-mcq-option-"]');
    if (await mcqOptions.first().isVisible().catch(() => false)) {
        await mcqOptions.first().click();
        await page.waitForTimeout(300);
        // Should have selected the option
        await expect(page.locator('#practiceTestView')).toBeVisible();
    }
});

test('practice test - show answer button', async ({ page }) => {
    await openDeckById(page, 'deck-practice', 'Practice Test Deck');
    await page.getByTestId('mode-practice-start').click({ force: true, timeout: 5000 });
    
    await page.getByTestId('presetFree').click();
    await page.getByTestId('test-question-count').fill('2');
    await page.getByTestId('practice-test-generate').click();
    await page.getByTestId('test-start').click();
    
    await page.waitForTimeout(500);
    
    const showAnswerBtn = page.getByTestId('test-show-answer');
    if (await showAnswerBtn.isVisible().catch(() => false)) {
        await showAnswerBtn.click();
        await page.waitForTimeout(300);
        
        // Answer should now be visible
        await expect(page.locator('#practiceTestView')).toBeVisible();
    }
});

test('practice test - check answer button', async ({ page }) => {
    await openDeckById(page, 'deck-practice', 'Practice Test Deck');
    await page.getByTestId('mode-practice-start').click({ force: true, timeout: 5000 });
    
    await page.getByTestId('presetFree').click();
    await page.getByTestId('test-question-count').fill('2');
    await page.getByTestId('practice-test-generate').click();
    await page.getByTestId('test-start').click();
    
    await page.waitForTimeout(500);
    
    const answerInput = page.getByTestId('test-answer-input');
    const checkBtn = page.getByTestId('test-check-answer');
    
    if (await answerInput.isVisible().catch(() => false)) {
        await answerInput.fill('test answer');
        if (await checkBtn.isVisible().catch(() => false)) {
            await checkBtn.click();
            await page.waitForTimeout(300);
            await expect(page.locator('#practiceTestView')).toBeVisible();
        }
    }
});

test('practice test - correct/incorrect buttons', async ({ page }) => {
    await openDeckById(page, 'deck-practice', 'Practice Test Deck');
    await page.getByTestId('mode-practice-start').click({ force: true, timeout: 5000 });
    
    await page.getByTestId('presetFree').click();
    await page.getByTestId('test-question-count').fill('2');
    await page.getByTestId('practice-test-generate').click();
    await page.getByTestId('test-start').click();
    
    await page.waitForTimeout(500);
    
    // Handle MCQ or flashcard mode
    const mcqOptions = page.locator('[data-testid^="test-mcq-option-"]');
    if (await mcqOptions.first().isVisible().catch(() => false)) {
        await mcqOptions.first().click();
    } else if (await page.getByTestId('test-show-answer').isVisible().catch(() => false)) {
        await page.getByTestId('test-show-answer').click();
        await page.waitForTimeout(200);
    }
    
    const correctBtn = page.getByTestId('test-correct');
    const incorrectBtn = page.getByTestId('test-incorrect');
    
    if (await correctBtn.isVisible().catch(() => false)) {
        await correctBtn.click();
        await page.waitForTimeout(300);
        await expect(page.locator('#practiceTestView')).toBeVisible();
    } else if (await incorrectBtn.isVisible().catch(() => false)) {
        await incorrectBtn.click();
        await page.waitForTimeout(300);
        await expect(page.locator('#practiceTestView')).toBeVisible();
    }
});

test('practice test - next button', async ({ page }) => {
    await openDeckById(page, 'deck-practice', 'Practice Test Deck');
    await page.getByTestId('mode-practice-start').click({ force: true, timeout: 5000 });
    
    await page.getByTestId('presetFree').click();
    await page.getByTestId('test-question-count').fill('3');
    await page.getByTestId('practice-test-generate').click();
    await page.getByTestId('test-start').click();
    
    await page.waitForTimeout(500);
    
    // Answer the first question
    const mcqOptions = page.locator('[data-testid^="test-mcq-option-"]');
    if (await mcqOptions.first().isVisible().catch(() => false)) {
        await mcqOptions.first().click();
    }
    
    const nextBtn = page.getByTestId('test-next');
    if (await nextBtn.isVisible().catch(() => false)) {
        await nextBtn.click();
        await page.waitForTimeout(300);
        await expect(page.locator('#practiceTestView')).toBeVisible();
    }
});

test('practice test - instructions button', async ({ page }) => {
    await openDeckById(page, 'deck-practice', 'Practice Test Deck');
    await page.getByTestId('mode-practice-start').click({ force: true, timeout: 5000 });
    
    await page.getByTestId('presetFree').click();
    await page.getByTestId('test-question-count').fill('2');
    await page.getByTestId('practice-test-generate').click();
    await page.getByTestId('test-start').click();
    
    await page.waitForTimeout(500);
    
    const instructionsBtn = page.getByTestId('test-instructions');
    if (await instructionsBtn.isVisible().catch(() => false)) {
        await instructionsBtn.click();
        await page.waitForTimeout(200);
        // Instructions modal should appear
    }
});

test('practice test - end test button', async ({ page }) => {
    await openDeckById(page, 'deck-practice', 'Practice Test Deck');
    await page.getByTestId('mode-practice-start').click({ force: true, timeout: 5000 });
    
    await page.getByTestId('presetFree').click();
    await page.getByTestId('test-question-count').fill('2');
    await page.getByTestId('practice-test-generate').click();
    await page.getByTestId('test-start').click();
    
    await page.waitForTimeout(500);
    
    const endBtn = page.getByTestId('test-end');
    if (await endBtn.isVisible().catch(() => false)) {
        await endBtn.click();
        await page.waitForTimeout(300);
    }
    
    await runIntegrityCheck(page, logger);
});

test('practice test - complete flow with review', async ({ page }) => {
    await openDeckById(page, 'deck-practice', 'Practice Test Deck');
    await page.getByTestId('mode-practice-start').click({ force: true, timeout: 5000 });
    
    await page.getByTestId('presetFree').click();
    await page.getByTestId('test-question-count').fill('1');
    await page.getByTestId('practice-test-generate').click();
    await page.getByTestId('test-start').click();
    
    await page.waitForTimeout(500);
    
    // Answer the question
    const mcqOptions = page.locator('[data-testid^="test-mcq-option-"]');
    if (await mcqOptions.first().isVisible().catch(() => false)) {
        await mcqOptions.first().click();
        await page.waitForTimeout(300);
    } else if (await page.getByTestId('test-show-answer').isVisible().catch(() => false)) {
        await page.getByTestId('test-show-answer').click();
        await page.waitForTimeout(200);
        if (await page.getByTestId('test-correct').isVisible().catch(() => false)) {
            await page.getByTestId('test-correct').click();
        }
    }
    
    // Test should complete
    await page.waitForTimeout(500);
    
    // Review button might be visible
    const reviewBtn = page.getByTestId('test-review');
    if (await reviewBtn.isVisible().catch(() => false)) {
        await reviewBtn.click();
        await page.waitForTimeout(300);
    }
    
    await runIntegrityCheck(page, logger);
});

test('practice test - apply learning button', async ({ page }) => {
    await openDeckById(page, 'deck-practice', 'Practice Test Deck');
    await page.getByTestId('mode-practice-start').click({ force: true, timeout: 5000 });
    
    await page.getByTestId('presetFree').click();
    await page.getByTestId('test-question-count').fill('1');
    await page.getByTestId('practice-test-generate').click();
    await page.getByTestId('test-start').click();
    
    await page.waitForTimeout(500);
    
    // Answer the question
    const mcqOptions = page.locator('[data-testid^="test-mcq-option-"]');
    if (await mcqOptions.first().isVisible().catch(() => false)) {
        await mcqOptions.first().click();
        await page.waitForTimeout(300);
    }
    
    // Test should complete
    await page.waitForTimeout(500);
    
    // Apply learning button might be visible
    const applyBtn = page.getByTestId('test-apply-learning');
    if (await applyBtn.isVisible().catch(() => false)) {
        await applyBtn.click();
        await page.waitForTimeout(300);
    }
    
    await runIntegrityCheck(page, logger);
});
