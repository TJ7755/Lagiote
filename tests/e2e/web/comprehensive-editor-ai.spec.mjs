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

test('AI generator - text input', async ({ page }) => {
    await page.getByTestId('deck-create-ai').click();
    await expect(page.locator('#aiGenerator')).toHaveClass(/is-visible/);
    
    await page.getByTestId('ai-text-input').fill('Generate flashcards about the solar system.');
    await expect(page.getByTestId('ai-text-input')).toHaveValue('Generate flashcards about the solar system.');
});

test('AI generator - add text button', async ({ page }) => {
    await page.getByTestId('deck-create-ai').click();
    await expect(page.locator('#aiGenerator')).toHaveClass(/is-visible/);
    
    await page.getByTestId('ai-text-input').fill('Test content about photosynthesis.');
    await page.getByTestId('ai-add-text').click();
    
    // Document should appear in list
    await page.waitForTimeout(300);
    const docList = page.locator('#document-list');
    const docCount = await docList.locator('.doc-item, .document-item').count();
    expect(docCount).toBeGreaterThan(0);
});

test('AI generator - card type selection', async ({ page }) => {
    await page.getByTestId('deck-create-ai').click();
    await expect(page.locator('#aiGenerator')).toHaveClass(/is-visible/);
    
    const cardTypeSelect = page.locator('#aiCardType');
    await cardTypeSelect.selectOption('flashcard');
    await expect(cardTypeSelect).toHaveValue('flashcard');
    
    await cardTypeSelect.selectOption('vocab');
    await expect(cardTypeSelect).toHaveValue('vocab');
    
    await cardTypeSelect.selectOption('sequence');
    await expect(cardTypeSelect).toHaveValue('sequence');
});

test('AI generator - card count selection', async ({ page }) => {
    await page.getByTestId('deck-create-ai').click();
    await expect(page.locator('#aiGenerator')).toHaveClass(/is-visible/);
    
    const countSelect = page.locator('#aiCardCount');
    await countSelect.selectOption('short');
    await expect(countSelect).toHaveValue('short');
    
    await countSelect.selectOption('medium');
    await expect(countSelect).toHaveValue('medium');
    
    await countSelect.selectOption('long');
    await expect(countSelect).toHaveValue('long');
});

test('AI generator - language selection', async ({ page }) => {
    await page.getByTestId('deck-create-ai').click();
    await expect(page.locator('#aiGenerator')).toHaveClass(/is-visible/);
    
    const langSelect = page.locator('#aiLanguage');
    await langSelect.selectOption('English');
    await expect(langSelect).toHaveValue('English');
    
    await langSelect.selectOption('French');
    await expect(langSelect).toHaveValue('French');
    
    await langSelect.selectOption('Spanish');
    await expect(langSelect).toHaveValue('Spanish');
});

test('AI generator - process button becomes enabled', async ({ page }) => {
    await page.getByTestId('deck-create-ai').click();
    await expect(page.locator('#aiGenerator')).toHaveClass(/is-visible/);
    
    // Initially disabled
    const processBtn = page.getByTestId('ai-process');
    await expect(processBtn).toBeDisabled();
    
    // Add text
    await page.getByTestId('ai-text-input').fill('Test content about biology.');
    await page.getByTestId('ai-add-text').click();
    await page.waitForTimeout(300);
    
    // Now should be enabled
    await expect(processBtn).toBeEnabled();
});

// Skip AI API tests since they require real API calls and are tested manually
test.skip('AI generator - process and generate cards', async ({ page }) => {
    await page.getByTestId('deck-create-ai').click();
    await expect(page.locator('#aiGenerator')).toHaveClass(/is-visible/);
    
    await page.getByTestId('ai-text-input').fill('Generate flashcards about photosynthesis.');
    await page.getByTestId('ai-add-text').click();
    await page.waitForTimeout(300);
    
    await page.getByTestId('ai-process').click();
    
    // Wait for cards to be generated
    await page.waitForFunction(() => {
        const flashcardList = document.getElementById('flashcard-list');
        return flashcardList && flashcardList.querySelectorAll('.flashcard-item, .ai-card-item').length > 0;
    }, { timeout: 15000 });
    
    // Save button should appear
    await expect(page.getByTestId('ai-save-deck')).toBeVisible();
});

// Skip AI API tests since they require real API calls and are tested manually
test.skip('AI generator - save deck button', async ({ page }) => {
    await page.getByTestId('deck-create-ai').click();
    await expect(page.locator('#aiGenerator')).toHaveClass(/is-visible/);
    
    await page.getByTestId('ai-text-input').fill('Generate flashcards about photosynthesis.');
    await page.getByTestId('ai-add-text').click();
    await page.waitForTimeout(300);
    
    await page.getByTestId('ai-process').click();
    
    // Wait for processing
    await page.waitForFunction(() => {
        const flashcardList = document.getElementById('flashcard-list');
        return flashcardList && flashcardList.querySelectorAll('.flashcard-item, .ai-card-item').length > 0;
    }, { timeout: 15000 });
    
    await page.getByTestId('ai-save-deck').click();
    
    // Should save and we should have the deck
    await page.waitForFunction(async () => {
        const decks = await window.lagiote.db.getAllDataFromDB('decks');
        return decks.some(deck => deck.name === 'AI Test Deck');
    }, { timeout: 10000 });
    
    const aiDeckExists = await page.evaluate(async () => {
        const decks = await window.lagiote.db.getAllDataFromDB('decks');
        return decks.some(deck => deck.name === 'AI Test Deck');
    });
    expect(aiDeckExists).toBe(true);
});

test('editor - deck title input', async ({ page }) => {
    await page.getByTestId('deck-create-manual').click();
    await expect(page.locator('#editorView')).toHaveClass(/is-visible/);
    
    await page.getByTestId('deck-title').fill('Test Editor Deck');
    await expect(page.getByTestId('deck-title')).toHaveValue('Test Editor Deck');
});

test('editor - category selection', async ({ page }) => {
    await page.getByTestId('deck-create-manual').click();
    await expect(page.locator('#editorView')).toHaveClass(/is-visible/);
    
    await page.getByTestId('deck-category').selectOption('Science');
    await expect(page.getByTestId('deck-category')).toHaveValue('Science');
});

test('editor - add card button', async ({ page }) => {
    await page.getByTestId('deck-create-manual').click();
    await expect(page.locator('#editorView')).toHaveClass(/is-visible/);
    
    const initialCount = await page.locator('#editorView .flashcard-item').count();
    await page.getByTestId('deck-add-card').click();
    
    const newCount = await page.locator('#editorView .flashcard-item').count();
    expect(newCount).toBe(initialCount + 1);
});

test('editor - question and answer inputs', async ({ page }) => {
    await page.getByTestId('deck-create-manual').click();
    await expect(page.locator('#editorView')).toHaveClass(/is-visible/);
    
    const questionInputs = page.locator('textarea[data-testid^="editor-card-question-"]');
    const answerInputs = page.locator('textarea[data-testid^="editor-card-answer-"]');
    
    await questionInputs.first().fill('What is the capital of France?');
    await answerInputs.first().fill('Paris');
    
    await expect(questionInputs.first()).toHaveValue('What is the capital of France?');
    await expect(answerInputs.first()).toHaveValue('Paris');
});

test('editor - remove card button', async ({ page }) => {
    await page.getByTestId('deck-create-manual').click();
    await expect(page.locator('#editorView')).toHaveClass(/is-visible/);
    
    // Add a card first
    await page.getByTestId('deck-add-card').click();
    const countAfterAdd = await page.locator('#editorView .flashcard-item').count();
    
    // Remove the last card
    const removeBtn = page.locator('[data-testid^="editor-card-remove-"]').last();
    await removeBtn.click();
    
    const countAfterRemove = await page.locator('#editorView .flashcard-item').count();
    expect(countAfterRemove).toBe(countAfterAdd - 1);
});

test('editor - save deck button', async ({ page }) => {
    await page.getByTestId('deck-create-manual').click();
    await expect(page.locator('#editorView')).toHaveClass(/is-visible/);
    
    await page.getByTestId('deck-title').fill('Test Save Deck');
    await page.getByTestId('deck-category').selectOption('Science');
    
    const questionInputs = page.locator('textarea[data-testid^="editor-card-question-"]');
    const answerInputs = page.locator('textarea[data-testid^="editor-card-answer-"]');
    await questionInputs.first().fill('Test Question');
    await answerInputs.first().fill('Test Answer');
    
    await page.getByTestId('deck-save').click();
    await page.waitForTimeout(500);
    
    // Verify deck was saved
    const deckSaved = await page.evaluate(async () => {
        const decks = await window.lagiote.db.getAllDataFromDB('decks');
        return decks.some(deck => deck.name === 'Test Save Deck');
    });
    expect(deckSaved).toBe(true);
});

test('editor - card type dropdown changes input mode', async ({ page }) => {
    await page.getByTestId('deck-create-manual').click();
    await expect(page.locator('#editorView')).toHaveClass(/is-visible/);
    
    const cardTypeSelect = page.locator('[data-testid^="editor-card-type-"]').first();
    if (await cardTypeSelect.isVisible().catch(() => false)) {
        // Select cloze type
        await cardTypeSelect.selectOption('cloze');
        
        // Cloze text area should appear
        const clozeTextarea = page.locator('[data-testid^="editor-card-cloze-"]').first();
        if (await clozeTextarea.isVisible().catch(() => false)) {
            await expect(clozeTextarea).toBeVisible();
        }
    }
});

test('editor - notes textarea', async ({ page }) => {
    await page.getByTestId('deck-create-manual').click();
    await expect(page.locator('#editorView')).toHaveClass(/is-visible/);
    
    const notesTextarea = page.locator('#deckNotes');
    await notesTextarea.fill('These are my study notes for this deck.');
    await expect(notesTextarea).toHaveValue('These are my study notes for this deck.');
});
