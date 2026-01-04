import fs from 'node:fs/promises';
import path from 'node:path';
import { test, expect } from '@playwright/test';
import {
    applyTestMode,
    waitForTestReady,
    setupNetworkMocks
} from '../helpers.mjs';
import { createTestLogger } from '../test-logging.mjs';
import { resolveActionConfig } from '../known-actions.mjs';

const DENYLIST = [
    /delete/i,
    /remove/i,
    /reset/i,
    /clear/i,
    /logout/i,
    /confirm-confirm/i,
    /deck-card-delete-/i,
    /deck-delete/i,
    /deck-reset/i,
    /settings-clear-decks/i,
    /import-file-input/i,
    /ai-select-files/i,
    /file-input/i
];

async function handleModalCleanup(page) {
    const confirmCancel = page.getByTestId('confirm-cancel');
    if (await confirmCancel.isVisible().catch(() => false)) {
        await confirmCancel.click({ force: true, timeout: 2000 });
        return;
    }
    const modalClose = page.locator('[data-testid^="modal-close-"]');
    if (await modalClose.first().isVisible().catch(() => false)) {
        await modalClose.first().click({ force: true, timeout: 2000 });
    }
    const cancelButtons = page.locator('[data-testid$="-cancel"]');
    if (await cancelButtons.first().isVisible().catch(() => false)) {
        await cancelButtons.first().click({ force: true, timeout: 2000 });
    }
}

function shouldSkip(testid) {
    const config = resolveActionConfig(testid);
    if (config?.destructive) return true;
    return DENYLIST.some(rule => rule.test(testid));
}

async function listVisibleActions(page) {
    return page.evaluate(() => {
        const isVisible = (el) => {
            if (!el) return false;
            if (el.offsetParent === null) return false;
            const style = window.getComputedStyle(el);
            if (style.visibility === 'hidden' || style.display === 'none') return false;
            const rect = el.getBoundingClientRect();
            if (!rect || rect.width === 0 || rect.height === 0) return false;
            if (rect.bottom < 0 || rect.top > window.innerHeight) return false;
            return true;
        };
        const isClickable = (el) => {
            if (!el) return false;
            if (el.disabled || el.getAttribute('disabled') !== null) return false;
            const tag = el.tagName.toLowerCase();
            if (tag === 'input' && el.type === 'file') return false;
            return true;
        };
        const viewEl = Array.from(document.querySelectorAll('.view-container')).find(el => el.classList.contains('is-visible'))
            || Array.from(document.querySelectorAll('.view-container')).find(el => !el.classList.contains('hidden'));
        const viewName = viewEl ? viewEl.id : 'unknown';
        const items = Array.from(document.querySelectorAll('[data-testid]'))
            .filter(el => isVisible(el) && isClickable(el))
            .map(el => el.dataset.testid)
            .filter(Boolean);
        return { viewName, items };
    });
}

test('ui button coverage crawler', async ({ page }, testInfo) => {
    await applyTestMode(page);
    await setupNetworkMocks(page);
    const logger = createTestLogger(page, {});
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await waitForTestReady(page);

    const results = [];
    const visited = new Set();
    const repeats = new Map();
    const maxClicks = 500;
    let clicks = 0;

    const ensureDashboard = async () => {
        const logo = page.getByTestId('nav-logo');
        if (await logo.isVisible().catch(() => false)) {
            await logo.click({ force: true, timeout: 2000 });
        } else {
            await page.evaluate(() => backToDashboard(true, true));
        }
        await page.waitForFunction(() => document.querySelector('.deck-card'), { timeout: 5000 }).catch(() => {});
    };

    const clickVisibleActions = async () => {
        let viewData;
        try {
            viewData = await listVisibleActions(page);
        } catch (error) {
            const message = String(error?.message || error);
            if (message.includes('Execution context was destroyed')) {
                await page.waitForLoadState('domcontentloaded');
                viewData = await listVisibleActions(page);
            } else {
                throw error;
            }
        }
        const { viewName, items } = viewData;
        const candidates = items.filter(id => !visited.has(id) && !shouldSkip(id)).sort();
        for (const testid of candidates) {
            if (clicks >= maxClicks) break;
            const key = `${viewName}|${testid}`;
            const seenCount = (repeats.get(key) || 0) + 1;
            repeats.set(key, seenCount);
            if (seenCount > 3) {
                throw new Error(`Loop detected for ${key}`);
            }
            let clicked = false;
            let outcome = 'clicked';
            let error = null;
            try {
                await page.getByTestId(testid).click({ force: true, timeout: 2000 });
                clicked = true;
            } catch (err) {
                outcome = 'click-failed';
                error = String(err?.message || err);
            }
            results.push({ testid, viewName, clicked, outcome, error });
            visited.add(testid);
            clicks += 1;
            await handleModalCleanup(page);
        }
    };
    const clickWithScroll = async () => {
        await clickVisibleActions();
        await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
        await page.waitForTimeout(200);
        await clickVisibleActions();
        await page.evaluate(() => window.scrollTo(0, 0));
    };

    let testError = null;
    try {
        await clickWithScroll();

        const navTargets = ['nav-settings', 'nav-profile', 'nav-insights', 'nav-global-analytics'];
        for (const navId of navTargets) {
            const nav = page.getByTestId(navId);
            if (await nav.isVisible().catch(() => false)) {
                await nav.click({ force: true, timeout: 2000 });
                await clickWithScroll();
                await handleModalCleanup(page);
                await ensureDashboard();
            }
        }

        const deckNames = [
            'Learn Mode Deck',
            'Review Deck',
            'Water Cycle',
            'Practice Test Deck',
            'Sequence Order Deck',
            'Legacy Sequence'
        ];
        for (const name of deckNames) {
            if (clicks >= maxClicks) break;
            await ensureDashboard();
            const deck = page.locator('.deck-card', { hasText: name }).first();
            if (!await deck.isVisible().catch(() => false)) {
                continue;
            }
            const openBtn = deck.locator('[data-testid^="deck-open-"]').first();
            await deck.scrollIntoViewIfNeeded();
            await openBtn.click({ force: true, timeout: 5000 });
            await clickWithScroll();
            await handleModalCleanup(page);
            await ensureDashboard();
        }
    } catch (error) {
        testError = error;
    } finally {
        const clicked = new Set(results.filter(entry => entry.clicked).map(entry => entry.testid));
        const exercised = new Set(results.map(entry => entry.testid));
        const artifactsDir = path.resolve('artifacts');
        await fs.mkdir(artifactsDir, { recursive: true });
        await fs.writeFile(path.join(artifactsDir, 'ui-coverage.json'), JSON.stringify(results, null, 2), 'utf-8');

        expect(exercised.size).toBeGreaterThanOrEqual(25);
        expect(clicked.size).toBeGreaterThanOrEqual(10);

        const issues = await logger.finalize(testInfo);
        expect(issues, issues.join('\n')).toEqual([]);
    }
    if (testError) throw testError;
});
