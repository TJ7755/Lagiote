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
    } else if (await submitBtn.isVisible().catch(() => false)) {
        await submitBtn.click();
    }

    if (await continueBtn.isVisible().catch(() => false)) {
        await continueBtn.click();
    }
}

async function seedNumericSequenceDeck(page, deckId) {
    await page.evaluate(async (targetDeckId) => {
        if (!window.__TEST_MODE__) return;
        const db = window.lagiote?.db;
        if (!db) throw new Error('DB not available');
        const deck = await db.getDataFromDB('decks', targetDeckId);
        if (!deck) throw new Error(`Missing deck ${targetDeckId}`);

        deck.cards = Array.isArray(deck.cards) ? deck.cards.map(card => {
            const numericId = Number(card.id);
            if (Number.isFinite(numericId)) {
                return { ...card, id: numericId };
            }
            return card;
        }) : [];

        await db.saveDataToDB('decks', deck);

        const sequenceId = deck.cards.find(card => card.sequenceId)?.sequenceId
            || (deck.sequenceMeta && Object.keys(deck.sequenceMeta)[0])
            || 'default';
        const steps = deck.cards
            .filter(card => String(card.sequenceId || '') === String(sequenceId))
            .slice()
            .sort((a, b) => {
                const aIdx = typeof a.stepIndex === 'number' ? a.stepIndex : (a.order || 0);
                const bIdx = typeof b.stepIndex === 'number' ? b.stepIndex : (b.order || 0);
                return aIdx - bIdx;
            });

        if (!steps.length) return;

        const normalizeText = (value) => String(value ?? '').trim().replace(/\s+/g, ' ');
        const getStepStableId = (step) => {
            if (!step || typeof step !== 'object') return null;
            const candidates = [
                step.id,
                step.stepId,
                step.stepID,
                step.cardID,
                step.cardId,
                step._id
            ];
            for (const candidate of candidates) {
                if (typeof candidate === 'string' && candidate.trim()) return candidate.trim();
                if (typeof candidate === 'number' && Number.isFinite(candidate)) return String(candidate);
            }
            return null;
        };
        const getStepText = (step, index) => {
            if (!step || typeof step !== 'object') return normalizeText(index);
            return normalizeText(step.question || step.text || step.label || step.answer || index);
        };
        const fnv1aHash = (str) => {
            let hash = 0x811c9dc5;
            for (let i = 0; i < str.length; i += 1) {
                hash ^= str.charCodeAt(i);
                hash = Math.imul(hash, 0x01000193);
            }
            return (hash >>> 0).toString(36);
        };
        const hashSequenceSteps = (items) => {
            const tokens = items.map((step, index) => {
                const stableId = getStepStableId(step);
                if (stableId) return `id:${stableId}`;
                const text = getStepText(step, index);
                return `t:${text}|i:${index}`;
            });
            return `v1:${fnv1aHash(tokens.join('|'))}`;
        };

        const stepsHash = hashSequenceSteps(steps);
        const now = Date.now();
        const edges = {};
        const nodes = {};

        for (let i = 0; i < steps.length; i += 1) {
            const nodeKey = getStepStableId(steps[i]) || `${i}`;
            nodes[nodeKey] = { ema: 0.9, n: 1, s: 1, lastSeen: now };
            if (i < steps.length - 1) {
                const fromId = getStepStableId(steps[i]);
                const toId = getStepStableId(steps[i + 1]);
                const edgeKey = (fromId && toId) ? `${fromId}->${toId}` : `${i}->${i + 1}`;
                edges[edgeKey] = { ema: 0.9, n: 1, s: 1, lastSeen: now };
            }
        }

        const sequenceGraph = {
            version: 1,
            stepsHash,
            edges,
            nodes,
            updatedAt: now
        };
        const cardID = `sequenceGraph:${String(deck.id)}:${String(sequenceId || 'default')}`;
        const nowISO = new Date(now).toISOString();
        await db.saveDataToDB('userKnowledgeState', {
            userID: 'default_user',
            cardID,
            deckID: deck.id,
            sequenceId: String(sequenceId || 'default'),
            kind: 'sequenceGraph',
            sequenceGraph,
            masteryScore: 0.9,
            fsrs: null,
            lastModified: nowISO,
            updatedAt: nowISO
        });
    }, deckId);
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

test('order task grading handles numeric card ids', async ({ page }) => {
    const deckId = 'deck-sequence-order';
    await seedNumericSequenceDeck(page, deckId);

    await startSequenceMode(page, `deck-open-${deckId}`);
    await waitForSequenceTaskReady(page);

    let orderVisible = await page.locator('#sequenceOrderList').isVisible().catch(() => false);
    for (let i = 0; i < 10 && !orderVisible; i += 1) {
        await completeVisibleSequenceTask(page);
        await waitForSequenceTaskReady(page);
        orderVisible = await page.locator('#sequenceOrderList').isVisible().catch(() => false);
    }
    expect(orderVisible).toBe(true);

    const expectedOrderCardIds = await page.evaluate(() => {
        const state = window.sequenceModeController?.getState?.() || window.studyState || null;
        const task = state?.sequenceSession?.currentTask;
        if (!task || !Array.isArray(task.chunk)) return [];
        const expected = [...task.chunk].sort((a, b) => {
            const aIdx = typeof a.stepIndex === 'number' ? a.stepIndex : (a.order || 0);
            const bIdx = typeof b.stepIndex === 'number' ? b.stepIndex : (b.order || 0);
            return aIdx - bIdx;
        });
        return expected.map(card => String(card.id));
    });
    expect(expectedOrderCardIds.length).toBeGreaterThan(1);

    await page.evaluate((orderIds) => {
        const list = document.getElementById('sequenceOrderList');
        if (!list) return;
        const items = Array.from(list.querySelectorAll('.sequence-order-item'));
        const byId = new Map(items.map(item => [String(item.dataset.cardId), item]));
        orderIds.forEach(id => {
            const item = byId.get(String(id));
            if (item) list.appendChild(item);
        });
    }, expectedOrderCardIds);

    const accuracyBefore = await page.evaluate(() => {
        const state = window.sequenceModeController?.getState?.() || window.studyState || null;
        return state?.sequenceAccuracy?.length ?? 0;
    });
    await page.getByTestId('sequence-submit').click();

    await page.waitForFunction((prev) => {
        const state = window.sequenceModeController?.getState?.() || window.studyState || null;
        const log = state?.sequenceAccuracy || [];
        return log.length > prev;
    }, accuracyBefore, { timeout: 5000 });

    const accuracy = await page.evaluate(() => {
        const state = window.sequenceModeController?.getState?.() || window.studyState || null;
        const log = state?.sequenceAccuracy || [];
        return log.length ? log[log.length - 1] : null;
    });
    expect(accuracy).toBe(1);
    await runIntegrityCheck(page, logger);
});
