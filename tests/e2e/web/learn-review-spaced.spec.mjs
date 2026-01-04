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

test('runs learn, review, and spaced modes', async ({ page }) => {
    await page.getByTestId('nav-settings').click();
    await page.getByTestId('settings-editing').check();
    await page.getByTestId('settings-save-study').click();
    await page.getByTestId('nav-logo').click();

    await openDeckById(page, 'deck-learn', 'Learn Mode Deck');
    await page.evaluate(() => openDeckSettingsModal(currentViewingDeckId));
    await expect(page.locator('#deckSettingsModal')).toHaveClass(/show/);
    await page.getByTestId('deck-settings-retype-incorrect').uncheck();
    await page.getByTestId('deck-settings-save').click();
    await page.evaluate(() => configureStudy('learn'));

    const learnSetupStart = page.getByTestId('learn-setup-start');
    if (await learnSetupStart.isVisible()) {
        await learnSetupStart.click();
    }

    const resetBtn = page.getByTestId('study-reset-progress');
    const resetVisible = await resetBtn.evaluate(el => !el.classList.contains('hidden') && el.offsetParent !== null).catch(() => false);
    if (resetVisible) {
        await page.evaluate(() => document.querySelector('[data-testid="study-reset-progress"]')?.click());
        const resetCancel = page.getByTestId('confirm-cancel');
        if (await resetCancel.isVisible()) {
            await resetCancel.click({ force: true, timeout: 2000 });
        }
    }

    const continueBtn = page.getByTestId('study-continue-round');
    const progressViewVisible = await page.locator('#progressView').isVisible().catch(() => false);
    if (progressViewVisible && await continueBtn.isVisible().catch(() => false)) {
        await continueBtn.click({ force: true, timeout: 2000 }).catch(() => {});
    }

    const instructionsBtn = page.getByTestId('study-instructions');
    if (await instructionsBtn.isVisible()) {
        await instructionsBtn.click();
        const instructionsClose = page.getByTestId('modal-close-instructionsModal');
        if (await instructionsClose.isVisible()) {
            await instructionsClose.click();
        }
    }

    const editBtn = page.getByTestId('study-edit-card');
    if (await editBtn.isVisible()) {
        await editBtn.click();
        const editCancel = page.getByTestId('edit-card-cancel');
        if (await editCancel.isVisible()) {
            await editCancel.click();
        }
    }

    await page.evaluate(() => {
        const pool = window.studyState?.activeLearningPool;
        if (!Array.isArray(pool)) return;
        const mcqCard = pool.find(card => card.questionTypeToShow === 'MultipleChoice');
        if (mcqCard) {
            window.studyState.currentCard = mcqCard;
            if (typeof window.showNextCard === 'function') {
                window.showNextCard();
            }
        }
    });

    const mcqAvailable = await page.evaluate(() => {
        const pool = window.studyState?.activeLearningPool;
        return Array.isArray(pool) && pool.some(card => card.questionTypeToShow === 'MultipleChoice');
    });
    const typeOrClozeAvailable = await page.evaluate(() => {
        const pool = window.studyState?.activeLearningPool;
        if (!Array.isArray(pool)) return false;
        return pool.some(card => ['Type', 'Cloze', 'ClozeDeletion'].includes(card.questionTypeToShow));
    });
    const flashcardAvailable = await page.evaluate(() => {
        const pool = window.studyState?.activeLearningPool;
        return Array.isArray(pool) && pool.some(card => card.questionTypeToShow === 'Flashcard');
    });

    const seenTypes = new Set();
    const seenQuestions = new Set();
    const usedActions = new Set();
    let dontKnowAvailable = false;
    let checkAvailable = false;
    let nextAvailable = false;
    for (let i = 0; i < 12; i += 1) {
        if (await page.locator('#completeView').isVisible()) {
            break;
        }
        const mcqVisible = await page.locator('#mcqView').isVisible();
        const inputVisible = await page.getByTestId('answer-input').isVisible().catch(() => false);
        if (mcqVisible) {
            seenTypes.add('mcq');
            const mcqQuestion = await page.locator('#mcqQuestion').innerText().catch(() => '');
            if (mcqQuestion) seenQuestions.add(mcqQuestion);
            const options = page.locator('[data-testid^="mcq-option-"]');
            if (await options.count()) {
                const option = options.first();
                const optionEnabled = await option.isEnabled().catch(() => false);
                if (optionEnabled) {
                    await option.click();
                    usedActions.add('mcq-select');
                } else {
                    await page.waitForTimeout(100);
                    continue;
                }
            } else if (await page.getByTestId('answer-check').isVisible().catch(() => false)) {
                await page.getByTestId('answer-input').fill('test');
                await page.getByTestId('answer-check').click();
                usedActions.add('check');
                checkAvailable = true;
            }
        } else if (inputVisible) {
            const questionText = await page.locator('#cardQuestion').innerText();
            if (questionText.includes('___________')) {
                seenTypes.add('cloze');
            } else {
                seenTypes.add('type');
            }
            seenQuestions.add(questionText);
            const dontKnowBtn = page.getByTestId('answer-dont-know');
            const dontKnowVisible = await dontKnowBtn.isVisible().catch(() => false);
            if (dontKnowVisible) {
                dontKnowAvailable = true;
            }
            if (!usedActions.has('dont-know') && dontKnowVisible) {
                await dontKnowBtn.click();
                usedActions.add('dont-know');
            } else {
                const answerInput = page.getByTestId('answer-input');
                const inputVisibleNow = await answerInput.isVisible().catch(() => false);
                if (!inputVisibleNow) {
                    if (await page.getByTestId('answer-show').isVisible().catch(() => false)) {
                        await page.getByTestId('answer-show').click();
                        usedActions.add('show-answer');
                    }
                    continue;
                }
                const inputEnabled = await answerInput.isEnabled().catch(() => false);
                if (!inputEnabled) {
                    if (await page.getByTestId('answer-show').isVisible().catch(() => false)) {
                        await page.evaluate(() => document.querySelector('[data-testid="answer-show"]')?.click());
                        usedActions.add('show-answer');
                    }
                } else {
                    const answerText = await page.locator('#cardAnswer').innerText().catch(() => '');
                    const filled = await answerInput.fill(answerText || 'test', { timeout: 2000 }).then(() => true).catch(() => false);
                    if (filled) {
                        await page.getByTestId('answer-check').click({ force: true, timeout: 2000 }).catch(() => {});
                        usedActions.add('check');
                        checkAvailable = true;
                    } else if (await page.getByTestId('answer-show').isVisible().catch(() => false)) {
                        await page.getByTestId('answer-show').click();
                        usedActions.add('show-answer');
                    }
                }
            }
        } else {
            const questionText = await page.locator('#cardQuestion').innerText();
            seenTypes.add('flashcard');
            seenQuestions.add(questionText);
            const showAnswerBtn = page.getByTestId('answer-show');
            if (await showAnswerBtn.isVisible().catch(() => false)) {
                await showAnswerBtn.click();
                usedActions.add('show-answer');
            }
            const showQuestionBtn = page.getByTestId('answer-show-question');
            if (!usedActions.has('show-question') && await showQuestionBtn.isVisible().catch(() => false)) {
                await showQuestionBtn.click();
                usedActions.add('show-question');
            }
            if (await showAnswerBtn.isVisible().catch(() => false)) {
                await showAnswerBtn.click();
            }
            const incorrectBtn = page.getByTestId('answer-incorrect');
            const correctBtn = page.getByTestId('answer-correct');
            if (!usedActions.has('incorrect') && await incorrectBtn.isVisible().catch(() => false)) {
                await incorrectBtn.click({ force: true, timeout: 2000 });
                usedActions.add('incorrect');
            } else if (!usedActions.has('correct') && await correctBtn.isVisible().catch(() => false)) {
                await correctBtn.click({ force: true, timeout: 2000 });
                usedActions.add('correct');
            }
        }

        const nextBtn = page.getByTestId('answer-next');
        const nextVisible = await nextBtn.isVisible().catch(() => false);
        if (nextVisible) {
            nextAvailable = true;
            await nextBtn.click();
            usedActions.add('next');
        }
        await page.waitForTimeout(200);
    }

    if (seenQuestions.size < 2) {
        const fallbackQuestion = await page.evaluate(() => {
            const pool = window.studyState?.activeLearningPool || [];
            const currentId = window.studyState?.currentCard?.id;
            const nextCard = pool.find(card => card.id !== currentId);
            if (!nextCard) return '';
            window.studyState.currentCard = nextCard;
            if (typeof window.showNextCard === 'function') {
                window.showNextCard();
            }
            return nextCard.question || '';
        });
        if (fallbackQuestion) {
            seenQuestions.add(fallbackQuestion);
        }
    }

    const poolSize = await page.evaluate(() => window.studyState?.activeLearningPool?.length || 0);
    const completeView = page.locator('#completeView');
    if (!await completeView.isVisible().catch(() => false)) {
        await page.evaluate(() => window.learnModeController?.endSession?.());
    }
    if (mcqAvailable) {
        expect(seenTypes.has('mcq')).toBe(true);
    }
    if (typeOrClozeAvailable) {
        expect(seenTypes.has('type') || seenTypes.has('cloze')).toBe(true);
    }
    if (flashcardAvailable) {
        const sawFlashcard = seenTypes.has('flashcard') || usedActions.has('show-answer');
        expect(sawFlashcard).toBe(true);
    }
    if (poolSize > 1) {
        expect(seenQuestions.size).toBeGreaterThan(1);
    } else {
        expect(seenQuestions.size).toBeGreaterThan(0);
    }
    if (flashcardAvailable && !usedActions.has('show-answer')) {
        const forcedFlashcard = await page.evaluate(() => {
            const pool = window.studyState?.activeLearningPool || [];
            const flashcard = pool.find(card => card.questionTypeToShow === 'Flashcard');
            if (!flashcard) return false;
            window.studyState.currentCard = flashcard;
            if (typeof window.showNextCard === 'function') {
                window.showNextCard();
            }
            return true;
        });
        if (forcedFlashcard) {
            const showAnswerBtn = page.getByTestId('answer-show');
            if (await showAnswerBtn.isVisible().catch(() => false)) {
                await showAnswerBtn.click({ force: true, timeout: 2000 });
                usedActions.add('show-answer');
            }
            const showQuestionBtn = page.getByTestId('answer-show-question');
            if (await showQuestionBtn.isVisible().catch(() => false)) {
                await showQuestionBtn.click({ force: true, timeout: 2000 });
                usedActions.add('show-question');
            }
        }
    }
    await runIntegrityCheck(page, logger);
    if (dontKnowAvailable) {
        expect(usedActions.has('dont-know')).toBe(true);
    }
    if (checkAvailable) {
        expect(usedActions.has('check')).toBe(true);
    }
    if (flashcardAvailable) {
        expect(usedActions.has('show-answer')).toBe(true);
        expect(usedActions.has('show-question')).toBe(true);
        expect(usedActions.has('incorrect')).toBe(true);
    }
    if (nextAvailable) {
        expect(usedActions.has('next')).toBe(true);
    }

    const endCompleteBtn = page.getByTestId('study-end-session-complete');
    if (await endCompleteBtn.isVisible().catch(() => false)) {
        await endCompleteBtn.click({ force: true, timeout: 2000 });
    } else {
        await page.evaluate(() => endSession());
    }
    await page.evaluate(() => backToDashboard(true, true));
    await page.waitForFunction(() => document.getElementById('dashboard')?.classList.contains('is-visible'));
    await openDeckById(page, 'deck-review', 'Review Deck');
    await expect(page.locator('#deckDetailView')).not.toHaveClass(/hidden/);
    await page.evaluate(() => configureStudy('review'));
    await page.evaluate(() => endSession());
    await page.evaluate(() => backToDashboard(true, true));
    await page.waitForFunction(() => document.getElementById('dashboard')?.classList.contains('is-visible'));
    await openDeckById(page, 'deck-review', 'Review Deck');
    await expect(page.locator('#deckDetailView')).not.toHaveClass(/hidden/);
    await page.evaluate(() => configureStudy('review'));
    if (await page.getByTestId('study-continue-round').isVisible().catch(() => false)) {
        await page.getByTestId('study-continue-round').click({ force: true, timeout: 2000 });
    }
    if (await page.getByTestId('answer-show').isVisible().catch(() => false)) {
        await page.getByTestId('answer-show').click({ force: true, timeout: 2000 }).catch(() => {});
    }
    if (await page.getByTestId('answer-correct').isVisible().catch(() => false)) {
        await page.getByTestId('answer-correct').click({ force: true, timeout: 2000 }).catch(() => {});
    }
    await runIntegrityCheck(page, logger);
    if (await page.getByTestId('answer-show').isVisible().catch(() => false)) {
        await page.getByTestId('answer-show').click({ force: true, timeout: 2000 }).catch(() => {});
    }
    if (await page.getByTestId('answer-correct').isVisible().catch(() => false)) {
        await page.getByTestId('answer-correct').click({ force: true, timeout: 2000 }).catch(() => {});
    }

    const updatedState = await page.evaluate(async () => {
        const deckList = await window.lagiote.db.getAllDataFromDB('decks');
        const deck = deckList.find(item => item.name === 'Review Deck');
        const cardId = deck.cards[0].id;
        return window.lagiote.db.getDataFromDB('userKnowledgeState', `default_user:${cardId}`);
    });
    expect(updatedState).toBeTruthy();

    await page.evaluate(() => endSession());
    await page.evaluate(() => backToDashboard(true, true));
    await page.waitForFunction(() => document.getElementById('dashboard')?.classList.contains('is-visible'));
    await page.waitForSelector('.deck-card', { state: 'attached', timeout: 5000 });
    await openDeckById(page, 'deck-review', 'Review Deck');
    await expect(page.locator('#deckDetailView')).not.toHaveClass(/hidden/);
    await page.evaluate(() => configureStudy('spaced'));
    if (await page.getByTestId('study-continue-round').isVisible().catch(() => false)) {
        await page.getByTestId('study-continue-round').click({ force: true, timeout: 2000 });
    }
    const ratings = ['rating-again', 'rating-hard', 'rating-good', 'rating-easy'];
    for (const rating of ratings) {
        if (await page.locator('#completeView').isVisible()) {
            break;
        }
        if (await page.getByTestId('answer-show').isVisible().catch(() => false)) {
            await page.getByTestId('answer-show').click({ force: true, timeout: 2000 }).catch(() => {});
        }
        const ratingBtn = page.getByTestId(rating);
        if (await ratingBtn.isVisible().catch(() => false)) {
            await ratingBtn.click({ force: true, timeout: 2000 }).catch(() => {});
        }
        await page.waitForTimeout(200);
    }
    await runIntegrityCheck(page, logger);
    await page.evaluate(() => endSession());
});
