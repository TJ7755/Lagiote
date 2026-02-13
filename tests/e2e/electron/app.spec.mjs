import { test, expect } from '@playwright/test';
import { _electron as electron } from 'playwright';
import {
    applyTestMode,
    waitForTestReady,
    setupNetworkMocks,
    installPageErrorGuards,
    attachLogsOnFailure,
    createTempUserDataDir
} from '../helpers.mjs';

test('electron app core flows', async ({}, testInfo) => {
    const userDataDir = createTempUserDataDir();
    const app = await electron.launch({
        args: ['.'],
        env: {
            ...process.env,
            TEST_MODE: '1',
            LAGIOTE_TEST_USER_DATA_DIR: userDataDir
        }
    });
    const page = await app.firstWindow();
    await applyTestMode(page);
    await setupNetworkMocks(page);
    const guard = installPageErrorGuards(page);

    try {
        await page.reload({ waitUntil: 'domcontentloaded' });
        await waitForTestReady(page);
        await expect(page.getByTestId('deck-card-deck-learn')).toBeVisible();

        const learnDeck = page.locator('.deck-card', { hasText: 'Learn Mode Deck' });
        await learnDeck.locator('[data-testid^="deck-open-"]').click();
        await page.getByTestId('mode-learn-start').click();
        const learnSetupStart = page.getByTestId('learn-setup-start');
        if (await learnSetupStart.isVisible()) {
            await learnSetupStart.click();
        }
        if (await page.getByTestId('study-continue-round').isVisible().catch(() => false)) {
            await page.evaluate(() => document.querySelector('[data-testid="study-continue-round"]')?.click());
        }
        const mcqAvailable = await page.evaluate(() => {
            const pool = window.studyState?.activeLearningPool;
            if (!Array.isArray(pool)) return false;
            const mcqCard = pool.find(card => card.questionTypeToShow === 'MultipleChoice');
            if (mcqCard) {
                window.studyState.currentCard = mcqCard;
                if (typeof window.showNextCard === 'function') {
                    window.showNextCard();
                }
                return true;
            }
            return false;
        });

        const seen = new Set();
        for (let i = 0; i < 6; i += 1) {
            if (await page.locator('#completeView').isVisible()) break;
            const mcqVisible = await page.locator('#mcqView').isVisible();
            const inputVisible = await page.getByTestId('answer-input').isVisible().catch(() => false);
            if (mcqVisible) {
                seen.add('mcq');
                await page.locator('[data-testid^="mcq-option-"]').first().click();
            } else if (inputVisible) {
                const questionText = await page.locator('#cardQuestion').innerText();
                if (questionText.includes('___________')) {
                    seen.add('cloze');
                } else {
                    seen.add('type');
                }
                const answerInput = page.getByTestId('answer-input');
                if (await answerInput.isEnabled().catch(() => false)) {
                    await answerInput.fill('test');
                    await page.getByTestId('answer-check').click();
                    await page.evaluate(() => document.querySelector('[data-testid="answer-correct"]')?.click());
                } else {
                    await page.evaluate(() => document.querySelector('[data-testid="answer-show"]')?.click());
                }
            } else {
                seen.add('flashcard');
                await page.evaluate(() => document.querySelector('[data-testid="answer-show"]')?.click());
                await page.evaluate(() => document.querySelector('[data-testid="answer-correct"]')?.click());
            }
            const nextBtn = page.getByTestId('answer-next');
            if (await nextBtn.isVisible()) {
                await nextBtn.click({ force: true, timeout: 2000 });
            }
        }
        if (mcqAvailable) {
            expect(seen.has('mcq')).toBe(true);
        }
        expect(seen.has('type') || seen.has('cloze')).toBe(true);
        await page.evaluate(() => endSession());
        await page.getByTestId('nav-logo').click();

        const sequenceDeck = page.locator('.deck-card', { hasText: 'Water Cycle' });
        await sequenceDeck.locator('[data-testid^="deck-open-"]').click();
        await page.getByTestId('mode-sequence-start').click();
        await expect(page.locator('#sequenceTaskView')).toBeVisible();
        await page.evaluate(() => document.querySelector('[data-testid="sequence-submit"]')?.click());
        if (await page.getByTestId('sequence-continue').isVisible().catch(() => false)) {
            await page.evaluate(() => document.querySelector('[data-testid="sequence-continue"]')?.click());
        }
        await page.evaluate(() => endSession());
        await page.getByTestId('nav-logo').click();

        const legacyDeck = page.locator('.deck-card', { hasText: 'Legacy Sequence' });
        await legacyDeck.locator('[data-testid^="deck-open-"]').click();
        await page.getByTestId('mode-sequence-start').click();
        await expect(page.locator('#sequenceTaskView')).toBeVisible();
        await page.evaluate(() => endSession());
        await page.getByTestId('nav-logo').click();

        await page.evaluate(() => document.querySelector('[data-testid="deck-open-deck-practice"]')?.click());
        await page.evaluate(() => document.querySelector('[data-testid="mode-practice-start"]')?.click());
        await page.getByTestId('test-question-count').fill('3');
        await page.getByTestId('practice-test-generate').click();
        await page.getByTestId('test-start').click();

        for (let i = 0; i < 5; i += 1) {
            if (await page.locator('#testCompleteView').isVisible()) break;
            const optionsVisible = await page.getByTestId('test-options').isVisible().catch(() => false);
            if (optionsVisible) {
                await page.locator('[data-testid^="test-mcq-option-"]').first().click();
            } else {
                const testAnswerInput = page.getByTestId('test-answer-input');
                if (await testAnswerInput.isEnabled().catch(() => false)) {
                    await testAnswerInput.fill('test');
                    if (await page.getByTestId('test-check-answer').isVisible().catch(() => false)) {
                        await page.evaluate(() => document.querySelector('[data-testid="test-check-answer"]')?.click());
                    }
                } else if (await page.getByTestId('test-next').isVisible().catch(() => false)) {
                    await page.evaluate(() => document.querySelector('[data-testid="test-next"]')?.click());
                }
            }
            if (await page.getByTestId('test-correct').isVisible().catch(() => false)) {
                await page.evaluate(() => document.querySelector('[data-testid="test-correct"]')?.click());
            }
            if (await page.getByTestId('test-next').isVisible().catch(() => false)) {
                await page.evaluate(() => document.querySelector('[data-testid="test-next"]')?.click());
            }
        }
        await expect(page.locator('#testCompleteView')).toBeVisible();
        await page.evaluate(() => document.querySelector('[data-testid="test-end"]')?.click());

        await page.context().setOffline(true);
        await expect(page.locator('#onlineStatusText')).toHaveText('Offline');
    } finally {
        await attachLogsOnFailure(testInfo, guard.logs);
        expect(guard.errors, guard.errors.join('\n')).toEqual([]);
        await app.close();
    }
});
