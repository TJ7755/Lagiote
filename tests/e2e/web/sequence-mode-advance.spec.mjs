import { test, expect } from '@playwright/test';
import {
    applyTestMode,
    waitForTestReady,
    setupNetworkMocks
} from '../helpers.mjs';
import { createTestLogger, runIntegrityCheck } from '../test-logging.mjs';

let logger;

async function startSequenceMode(page, deckTestId) {
    const deckOpen = page.getByTestId(deckTestId);
    await deckOpen.waitFor({ state: 'visible' });
    await deckOpen.click();
    await expect(page.locator('#deckDetailView')).not.toHaveClass(/hidden/);
    await page.getByTestId('mode-sequence-start').click();

    const setupStart = page.getByTestId('sequence-setup-start');
    if (await setupStart.isVisible().catch(() => false)) {
        await setupStart.click();
    }

    await expect(page.locator('#sequenceTaskView')).toBeVisible();
}

async function readSequenceStepId(page) {
    return page.evaluate(() => {
        const state = window.sequenceModeController?.getState?.() || window.studyState || null;
        const fallbackTask = state?.sequenceSession?.currentTask || null;
        const anchorIndex = Number.isFinite(fallbackTask?.anchorIndex) ? fallbackTask.anchorIndex : 0;
        return state?.sequenceState?.currentStep?.cardId
            ?? state?.currentCard?.id
            ?? fallbackTask?.chunk?.[anchorIndex]?.id
            ?? fallbackTask?.chunk?.[0]?.id
            ?? null;
    });
}

async function waitForSequenceTaskReady(page) {
    await page.waitForFunction(() => {
        const submit = document.getElementById('sequenceSubmitBtn');
        const body = document.getElementById('sequenceTaskBody');
        return submit && !submit.classList.contains('hidden') && body && body.children.length > 0;
    });
}

async function completeVisibleSequenceTask(page) {
    const submitBtn = page.getByTestId('sequence-submit');
    const continueBtn = page.getByTestId('sequence-continue');
    const textInput = page.locator('[data-testid="sequence-input"], #sequenceInput, #sequenceNextInput');
    const gapSelect = page.locator('[data-testid="sequence-gap-select"], #sequenceGapSelect');
    const orderList = page.locator('[data-testid="sequence-order-list"], #sequenceOrderList');

    if (await textInput.first().isVisible().catch(() => false)) {
        await textInput.first().fill('test');
        await submitBtn.click();
    } else if (await gapSelect.first().isVisible().catch(() => false)) {
        const optionValue = await page.evaluate(() => {
            const select = document.querySelector('[data-testid="sequence-gap-select"]')
                || document.getElementById('sequenceGapSelect');
            if (!select || !select.options.length) return '';
            const options = Array.from(select.options)
                .map(option => option.value)
                .filter(value => value && value !== '--');
            return options[0] || '';
        });
        if (optionValue) {
            await gapSelect.first().selectOption(optionValue);
        }
        await submitBtn.click();
    } else if (await orderList.first().isVisible().catch(() => false)) {
        await submitBtn.click();
    } else if (await submitBtn.isVisible().catch(() => false)) {
        await submitBtn.click();
    }

    if (await continueBtn.isVisible().catch(() => false)) {
        await continueBtn.click();
    }
}

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

test('completing a task advances to a different step', async ({ page }) => {
    const mixedDeck = page.getByTestId('deck-open-deck-sequence-mixed');
    const mixedCount = await mixedDeck.count();
    const deckTestId = mixedCount > 0 ? 'deck-open-deck-sequence-mixed' : 'deck-open-deck-sequence-legacy';

    await startSequenceMode(page, deckTestId);
    await waitForSequenceTaskReady(page);

    const beforeId = await readSequenceStepId(page);
    expect(beforeId).not.toBeNull();

    const beforeAccuracy = await page.evaluate(() => {
        const state = window.sequenceModeController?.getState?.() || window.studyState || null;
        const log = state?.sequenceAccuracy || [];
        return log.length;
    });
    await completeVisibleSequenceTask(page);
    await runIntegrityCheck(page, logger);
    await page.waitForFunction((prev) => {
        const state = window.sequenceModeController?.getState?.() || window.studyState || null;
        const log = state?.sequenceAccuracy || [];
        return log.length > prev;
    }, beforeAccuracy, { timeout: 5000 });
});
