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

test('starts sequence mode for legacy decks with non-empty prompts', async ({ page }) => {
    const deckOpen = page.getByTestId('deck-open-deck-sequence-legacy');
    await deckOpen.waitFor({ state: 'visible' });
    await deckOpen.click();
    await expect(page.locator('#deckDetailView')).not.toHaveClass(/hidden/);
    await page.getByTestId('mode-sequence-start').click();
    await expect(page.locator('#sequenceTaskView')).toBeVisible();
    await page.waitForFunction(() => {
        const body = document.getElementById('sequenceTaskBody');
        return body && body.textContent && body.textContent.trim().length > 0;
    });

    const hasStepText = await page.evaluate(() => {
        const body = document.getElementById('sequenceTaskBody');
        if (!body) return false;
        const orderTexts = Array.from(body.querySelectorAll('.sequence-order-text'))
            .map(el => (el.textContent || '').trim())
            .filter(Boolean);
        if (orderTexts.length) return true;
        const gapTexts = Array.from(body.querySelectorAll('.sequence-gap-item'))
            .map(el => (el.textContent || '').trim())
            .filter(text => text && text !== '[blank]');
        if (gapTexts.length) return true;
        const prompt = body.querySelector('.sequence-next-prompt');
        if (prompt) {
            const text = prompt.textContent || '';
            const marker = 'Current step:';
            if (text.includes(marker)) {
                const step = text.split(marker)[1].trim();
                return step.length > 0;
            }
            return text.trim().length > 0;
        }
        return false;
    });
    expect(hasStepText).toBe(true);

    if (await page.locator('#sequenceNextInput').isVisible()) {
        await page.locator('#sequenceNextInput').fill('Test response');
        await page.getByTestId('sequence-submit').click();
    } else if (await page.locator('#sequenceGapSelect').isVisible()) {
        const optionValue = await page.evaluate(() => {
            const select = document.getElementById('sequenceGapSelect');
            if (!select || !select.options.length) return '';
            return select.options[0].value;
        });
        if (optionValue) {
            await page.locator('#sequenceGapSelect').selectOption(optionValue);
        }
        await page.getByTestId('sequence-submit').click();
    } else {
        await page.getByTestId('sequence-submit').click();
    }
    await runIntegrityCheck(page, logger);

    await expect(page.locator('#sequenceTaskFeedback')).toBeVisible();

    const continueBtn = page.getByTestId('sequence-continue');
    if (await continueBtn.isVisible().catch(() => false)) {
        await continueBtn.click();
    }
});
