import { test, expect } from '@playwright/test';
import {
    applyTestMode,
    waitForTestReady,
    setupNetworkMocks
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

test('runs sequence mode and practice test flows', async ({ page }) => {
    const orderCheck = await page.evaluate(async () => {
        const deck = await window.lagiote.db.getDataFromDB('decks', 'deck-sequence');
        const steps = deck.cards
            .slice()
            .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
            .map(card => card.question);
        return steps;
    });
    expect(orderCheck).toEqual(['Evaporation', 'Condensation', 'Precipitation', 'Collection']);

    const sequenceDeckOpen = page.getByTestId('deck-open-deck-sequence');
    await sequenceDeckOpen.click({ force: true, timeout: 5000 });
    await expect(page.locator('#deckDetailView')).not.toHaveClass(/hidden/);
    await page.getByTestId('mode-sequence-start').click();
    await expect(page.locator('#sequenceTaskView')).toBeVisible();

    if (await page.locator('#sequenceOrderList').isVisible()) {
        const upBtn = page.locator('[data-testid^="sequence-order-up-"]').first();
        if (await upBtn.isVisible()) {
            await upBtn.click();
        }
        const downBtn = page.locator('[data-testid^="sequence-order-down-"]').first();
        if (await downBtn.isVisible()) {
            await downBtn.click();
        }
        await page.evaluate(() => {
            const list = document.querySelector('#sequenceOrderList');
            if (!list) return;
            const items = Array.from(list.children);
            items.reverse().forEach(item => list.appendChild(item));
        });
        await page.getByTestId('sequence-submit').click();
    } else if (await page.locator('#sequenceNextInput').isVisible()) {
        await page.locator('#sequenceNextInput').fill('Not the right step');
        await page.getByTestId('sequence-submit').click();
    } else if (await page.locator('#sequenceGapSelect').isVisible()) {
        const wrongOption = await page.evaluate(() => {
            const items = Array.from(document.querySelectorAll('.sequence-gap-item'));
            const choice = items.map(item => item.textContent).find(text => text && text !== '[blank]');
            return choice || '';
        });
        if (wrongOption) {
            await page.locator('#sequenceGapSelect').selectOption({ label: wrongOption });
        }
        await page.getByTestId('sequence-submit').click();
    }
    const feedback = page.locator('#sequenceTaskFeedback');
    if (await feedback.isVisible().catch(() => false)) {
        const accuracyLabel = await feedback.locator('.metric-chip').getAttribute('aria-label');
        expect(accuracyLabel || '').not.toMatch(/100 percent/);
    }
    if (await page.getByTestId('sequence-continue').isVisible().catch(() => false)) {
        await page.getByTestId('sequence-continue').click();
    }
    await runIntegrityCheck(page, logger);

    await page.evaluate(() => endSession());
    await page.getByTestId('nav-logo').click();
    await page.waitForFunction(() => document.getElementById('dashboard')?.classList.contains('is-visible'));
    const orderCheckAfter = await page.evaluate(async () => {
        const deck = await window.lagiote.db.getDataFromDB('decks', 'deck-sequence');
        return deck.cards
            .slice()
            .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
            .map(card => card.question);
    });
    expect(orderCheckAfter).toEqual(orderCheck);

    const legacyDeckOpen = page.getByTestId('deck-open-deck-sequence-legacy');
    await legacyDeckOpen.click({ force: true, timeout: 5000 });
    await expect(page.locator('#deckDetailView')).not.toHaveClass(/hidden/);
    await page.getByTestId('mode-sequence-start').click();
    await expect(page.locator('#sequenceTaskView')).toBeVisible();
    const legacyType = await page.evaluate(async () => {
        const deck = await window.lagiote.db.getDataFromDB('decks', 'deck-sequence-legacy');
        return deck.typeHint;
    });
    expect(legacyType).toBe('Sequence');
    await page.evaluate(() => endSession());
    await page.getByTestId('nav-logo').click();
    await page.waitForFunction(() => document.getElementById('dashboard')?.classList.contains('is-visible'));

    await page.waitForFunction(() => {
        const el = document.querySelector('[data-testid="deck-open-deck-practice"]');
        return el && el.offsetParent !== null;
    }, { timeout: 10000 });
    const practiceDeckOpen = page.getByTestId('deck-open-deck-practice');
    await practiceDeckOpen.click({ force: true, timeout: 5000 });
    await expect(page.locator('#deckDetailView')).not.toHaveClass(/hidden/);
    await expect(page.locator('#deckDetailTitle')).toContainText('Practice Test Deck');
    await page.getByTestId('mode-practice-start').click({ force: true, timeout: 5000 });
    await page.getByTestId('presetFree').click();
    await page.getByTestId('test-question-count').fill('4');
    await page.getByTestId('practice-test-generate').click();
    await page.getByTestId('test-start').click();
    const instructionsBtn = page.getByTestId('test-instructions');
    if (await instructionsBtn.isVisible()) {
        await instructionsBtn.click();
    }

    const testActions = new Set();
    for (let i = 0; i < 8; i += 1) {
        if (await page.locator('#testCompleteView').isVisible()) break;
        await page.waitForFunction(() => {
            const options = document.getElementById('testOptions');
            const input = document.getElementById('testAnswerInput');
            const optionsVisible = options && !options.classList.contains('hidden');
            const inputVisible = input && !input.classList.contains('hidden');
            return optionsVisible || inputVisible;
        });
        const optionsVisible = await page.getByTestId('test-options').isVisible().catch(() => false);
        if (optionsVisible) {
            await page.locator('[data-testid^="test-mcq-option-"]').first().click();
            testActions.add('mcq');
        } else if (await page.getByTestId('test-show-answer').isVisible().catch(() => false) && !testActions.has('show')) {
            await page.getByTestId('test-show-answer').click();
            testActions.add('show');
        } else {
            const answerInput = page.getByTestId('test-answer-input');
            const inputVisible = await answerInput.isVisible().catch(() => false);
            if (inputVisible) {
                if (await answerInput.isDisabled()) {
                    const nextBtn = page.getByTestId('test-next');
                    if (await nextBtn.isVisible().catch(() => false)) {
                        await nextBtn.click({ force: true, timeout: 2000 }).catch(() => {});
                        continue;
                    }
                }
                await answerInput.fill('test');
                await page.getByTestId('test-check-answer').click();
                testActions.add('check');
            }
        }
        if (await page.getByTestId('test-incorrect').isVisible() && !testActions.has('incorrect')) {
            await page.getByTestId('test-incorrect').click();
            testActions.add('incorrect');
        } else if (await page.getByTestId('test-correct').isVisible()) {
            await page.getByTestId('test-correct').click();
            testActions.add('correct');
        }
        if (await page.getByTestId('test-next').isVisible()) {
            await page.getByTestId('test-next').click({ force: true, timeout: 2000 });
            testActions.add('next');
        }
    }

    await expect(page.locator('#testCompleteView')).toBeVisible();
    const mcqItems = await page.evaluate(() => {
        const state = window.practiceTestController?.getState?.();
        return Array.isArray(state?.flatItems)
            ? state.flatItems.filter(item => Array.isArray(item.options) && item.options.length)
            : [];
    });
    if (mcqItems.length) {
        expect(testActions.has('mcq')).toBe(true);
    }
    expect(testActions.has('check')).toBe(true);
    expect(testActions.has('correct') || testActions.has('incorrect')).toBe(true);
    expect(testActions.has('next')).toBe(true);
    await expect(page.locator('#testScore')).toBeVisible();
    await page.getByTestId('test-apply-learning').click();
    await runIntegrityCheck(page, logger);
    const restartBtn = page.getByTestId('test-restart');
    if (await restartBtn.isVisible()) {
        await restartBtn.click();
    }
    const endBtn = page.getByTestId('test-end');
    if (await endBtn.isVisible().catch(() => false)) {
        await page.evaluate(() => {
            const btn = document.querySelector('[data-testid="test-end"]');
            if (btn && !btn.classList.contains('hidden')) {
                btn.click();
            } else if (typeof endTest === 'function') {
                endTest();
            }
        });
    } else {
        await page.evaluate(() => endTest());
    }
});
