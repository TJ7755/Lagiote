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

test('global keyboard shortcuts work', async ({ page }) => {
    // Ctrl+K focuses search
    await page.keyboard.press(`${MOD}+K`);
    await expect(page.locator('#searchInput')).toBeFocused();
    await page.keyboard.press('Escape');

    // Ctrl+, opens settings
    await page.keyboard.press(`${MOD}+,`);
    await expect(page.locator('#settingsView')).not.toHaveClass(/hidden/);
    await page.getByTestId('nav-logo').click();

    // Ctrl+Shift+A opens analytics
    await page.keyboard.press(`${MOD}+Shift+A`);
    await expect(page.locator('#analyticsView')).not.toHaveClass(/hidden/);
    await page.getByTestId('nav-logo').click();

    // Ctrl+N creates new deck (opens editor)
    await page.keyboard.press(`${MOD}+N`);
    await expect(page.locator('#editorView')).not.toHaveClass(/hidden/);
});

test('editor keyboard shortcuts work', async ({ page }) => {
    // Open editor
    await page.keyboard.press(`${MOD}+N`);
    await expect(page.locator('#editorView')).not.toHaveClass(/hidden/);

    // Track save calls
    await page.evaluate(() => {
        window.__TEST_SAVE_COUNT__ = 0;
        const originalSave = window.editorSaveDeck;
        window.editorSaveDeck = async (...args) => {
            window.__TEST_SAVE_COUNT__ += 1;
            return originalSave ? originalSave(...args) : true;
        };
    });

    // Ctrl+Enter adds a new card
    const cardCountBefore = await page.locator('#editorView .flashcard-item').count();
    await page.keyboard.press(`${MOD}+Enter`);
    await expect(page.locator('#editorView .flashcard-item')).toHaveCount(cardCountBefore + 1);

    // Ctrl+S saves the deck
    await page.keyboard.press(`${MOD}+S`);
    const saveCount = await page.evaluate(() => window.__TEST_SAVE_COUNT__ || 0);
    expect(saveCount).toBeGreaterThan(0);
});

test('typing in inputs works normally - space creates space', async ({ page }) => {
    // Open editor
    await page.keyboard.press(`${MOD}+N`);
    await expect(page.locator('#editorView')).not.toHaveClass(/hidden/);

    // Focus a question input and type with spaces
    const questionInput = page.locator('#editorView .question-input').first();
    await questionInput.click();
    await questionInput.fill('');
    await page.keyboard.type('hello world test');
    
    // Verify the text was typed correctly including spaces
    await expect(questionInput).toHaveValue('hello world test');
});

test('learn mode type input - Enter submits answer', async ({ page }) => {
    await openDeckById(page, 'deck-learn', 'Learn Mode Deck');
    await page.getByTestId('mode-learn-start').click({ force: true, timeout: 5000 });

    // Wait for study mode to load
    await expect(page.locator('#cardView')).toBeVisible({ timeout: 10000 });

    // Check if we're in write mode (has the write input)
    const writeInput = page.locator('#writeAnswerInput');
    const isWriteMode = await writeInput.isVisible().catch(() => false);

    if (isWriteMode) {
        // Type an answer with spaces
        await writeInput.fill('test answer with spaces');
        
        // Verify spaces were typed
        await expect(writeInput).toHaveValue('test answer with spaces');
        
        // Press Enter to submit
        await page.keyboard.press('Enter');
        
        // Should show feedback or move to next state
        await page.waitForTimeout(300);
        
        // Verify we're still in study mode (didn't crash)
        const stillVisible = await page.locator('#cardView').isVisible().catch(() => false);
        expect(stillVisible).toBe(true);
    } else {
        // Flashcard mode - Enter should show answer
        const showBtn = page.locator('#showAnswerBtn');
        if (await showBtn.isVisible()) {
            await page.keyboard.press('Enter');
            await page.waitForTimeout(200);
            
            // Correct/Incorrect buttons should now be visible
            const correctBtn = page.locator('#correctBtn');
            await expect(correctBtn).toBeVisible({ timeout: 2000 });
        }
    }
});

test('practice test - Enter navigates through test', async ({ page }) => {
    await openDeckById(page, 'deck-practice', 'Practice Test Deck');
    await page.getByTestId('mode-practice-start').click({ force: true, timeout: 5000 });
    await page.getByTestId('presetFree').click();
    await page.getByTestId('test-question-count').fill('2');
    await page.getByTestId('practice-test-generate').click();
    await page.getByTestId('test-start').click();

    // Wait for test to start
    await page.waitForTimeout(500);

    // Check if there's a text input
    const testInput = page.locator('#testAnswerInput');
    const hasInput = await testInput.isVisible().catch(() => false);

    if (hasInput) {
        // Type answer with spaces
        await testInput.fill('my test answer');
        await expect(testInput).toHaveValue('my test answer');
        
        // Enter should check/submit
        await page.keyboard.press('Enter');
        await page.waitForTimeout(300);
    } else {
        // Flashcard mode - Enter shows answer
        const showBtn = page.locator('#testShowAnswerBtn');
        if (await showBtn.isVisible()) {
            await page.keyboard.press('Enter');
            await page.waitForTimeout(200);
        }
    }

    // Verify still in test (didn't crash)
    const testView = page.locator('#practiceTestView');
    await expect(testView).toBeVisible();
});
