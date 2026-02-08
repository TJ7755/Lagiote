import { initDB, getDataFromDB, getDataByIndex, saveDataToDB, DEFAULT_USER_ID } from '../core/db.js';
import { getQueryParam, calculateIQS } from '../core/utils.js';
import { ensureDeckAccentMetadata } from '../core/accent-utils.js';
import { FSRSAlgorithm } from '../core/fsrs.js';
import Cortex from '../core/cortex.js';
import keyboardManager from '../core/keyboard.js';
import { pickConfusableCard } from '../core/interference.js';
import { CARD_TYPES, parseClozeText, gradeTypedAnswer } from '../core/card-types.js';

const fsrsEngine = new FSRSAlgorithm();

const studyState = {
    deck: null,
    cards: [], // Array of card objects
    cardsById: new Map(),
    queue: [], // Array of card IDs in order
    currentIndex: 0,
    mode: 'review',
    knowledgeMap: new Map(),
    completed: 0,
    currentInteraction: null,
    sessionID: null,
    sessionStartTime: null,
    sessionMetrics: {
        focusLossCount: 0,
        meanLatency: 3000
    },
    interference: {
        enabled: true,
        probeRate: 0.12,
        minSim: 0.28,
        maxSim: 0.85,
        maxCandidatesToScan: 120,
        recentIds: [],
        recentMax: 12,
        pendingProbe: null
    }
};

function showToast(message, type = 'info') {
    const bar = document.getElementById('messageBar');
    if (!bar) return;
    bar.textContent = message;
    bar.className = 'message-bar';
    bar.classList.add(type);
    bar.classList.remove('hidden');
    bar.classList.add('show');
    setTimeout(() => {
        bar.classList.remove('show');
        setTimeout(() => bar.classList.add('hidden'), 300);
    }, 2200);
}

function renderProgress() {
    const counter = document.getElementById('progressCounter');
    if (counter) counter.textContent = `${studyState.completed} / ${studyState.queue.length}`;
    const cardProgressText = document.getElementById('cardProgressText');
    if (cardProgressText) {
        cardProgressText.textContent = `Card ${studyState.currentIndex + 1} of ${studyState.queue.length}`;
    }
}

function getCurrentCard() {
    if (!studyState.queue || !studyState.cards) return null;
    const item = studyState.queue[studyState.currentIndex];
    const cardId = (typeof item === 'object') ? item.id : item;
    if (studyState.cardsById instanceof Map && studyState.cardsById.size > 0) {
        const direct = studyState.cardsById.get(cardId);
        if (direct) return direct;
    }
    return studyState.cards.find(c => c.id === cardId);
}

function getCurrentQueueItem() {
    if (!studyState.queue) return null;
    return studyState.queue[studyState.currentIndex] || null;
}

function resolveQueueItemId(item) {
    if (!item) return null;
    if (typeof item === 'object') return item.id;
    return item;
}

function recordInterferenceRecent(cardId) {
    const interference = studyState.interference;
    if (!interference || !interference.enabled) return;
    if (!cardId) return;
    interference.recentIds.push(cardId);
    while (interference.recentIds.length > (interference.recentMax || 0)) {
        interference.recentIds.shift();
    }
}

function buildUpcomingCandidatesForProbe() {
    const interference = studyState.interference;
    const maxCandidatesToScan = interference?.maxCandidatesToScan || 120;
    const candidates = [];
    const seen = new Set();
    for (let i = studyState.currentIndex + 1; i < studyState.queue.length && candidates.length < maxCandidatesToScan; i++) {
        const id = resolveQueueItemId(studyState.queue[i]);
        if (!id || seen.has(id)) continue;
        seen.add(id);
        const card = studyState.cardsById instanceof Map ? studyState.cardsById.get(id) : studyState.cards.find(c => c.id === id);
        if (card) candidates.push(card);
    }
    return candidates;
}

function attachInterferenceToQueueItem(item, interferenceContext) {
    const resolvedId = resolveQueueItemId(item);
    if (!resolvedId) return item;
    const updated = (typeof item === 'object' && item) ? { ...item } : { id: resolvedId };
    updated.interference = interferenceContext;
    if (!updated.intent) updated.intent = 'interference-probe';
    return updated;
}

function scheduleInterferenceProbeAfter(baseCard) {
    const interference = studyState.interference;
    if (!interference || !interference.enabled) return;
    if (!baseCard || !baseCard.id) return;
    if (interference.pendingProbe) return;
    if (Math.random() >= (interference.probeRate || 0)) return;

    const nextIndex = studyState.currentIndex + 1;
    if (nextIndex >= studyState.queue.length) return;

    const recentSet = new Set(interference.recentIds || []);
    recentSet.add(baseCard.id);

    const candidates = buildUpcomingCandidatesForProbe();
    const picked = pickConfusableCard(baseCard, candidates, {
        minSim: interference.minSim,
        maxSim: interference.maxSim,
        maxCandidatesToScan: interference.maxCandidatesToScan,
        recentIds: recentSet
    });
    if (!picked || !picked.card || !picked.card.id) return;

    const probeCardId = picked.card.id;
    const interferenceContext = { type: 'probe', baseCardId: baseCard.id, similarity: picked.sim };
    interference.pendingProbe = { baseCardId: baseCard.id, probeCardId, similarity: picked.sim, createdAt: Date.now() };

    const existingNext = studyState.queue[nextIndex];
    const nextId = resolveQueueItemId(existingNext);
    if (nextId === probeCardId) {
        studyState.queue[nextIndex] = attachInterferenceToQueueItem(existingNext, interferenceContext);
        return;
    }

    let foundIndex = -1;
    for (let i = nextIndex + 1; i < studyState.queue.length; i++) {
        if (resolveQueueItemId(studyState.queue[i]) === probeCardId) {
            foundIndex = i;
            break;
        }
    }
    if (foundIndex === -1) return;

    const movedItem = studyState.queue.splice(foundIndex, 1)[0];
    const annotated = attachInterferenceToQueueItem(movedItem, interferenceContext);
    studyState.queue.splice(nextIndex, 0, annotated);
}

// --- Metric Listeners ---

function startMetricTracking() {
    window.addEventListener('blur', handleFocusLoss);
    window.addEventListener('keydown', handleGlobalKey);
    // Mouse movement or click could also be "first action"
    window.addEventListener('mousedown', handleFirstAction);
}

function stopMetricTracking() {
    window.removeEventListener('blur', handleFocusLoss);
    window.removeEventListener('keydown', handleGlobalKey);
    window.removeEventListener('mousedown', handleFirstAction);
}

function handleFocusLoss() {
    if (studyState.currentInteraction) {
        studyState.currentInteraction.focusLossCount = (studyState.currentInteraction.focusLossCount || 0) + 1;
    }
}

function handleGlobalKey(e) {
    handleFirstAction();
    if (e.key === 'Backspace' && studyState.currentInteraction) {
        studyState.currentInteraction.backspaceCount = (studyState.currentInteraction.backspaceCount || 0) + 1;
    }
}

function handleFirstAction() {
    if (studyState.currentInteraction && !studyState.currentInteraction.firstActionAt) {
        studyState.currentInteraction.firstActionAt = performance.now();
    }
}

function showCard() {
    const card = getCurrentCard();
    if (!card) {
        endSession();
        return;
    }
    recordInterferenceRecent(card.id);
    const queueItem = getCurrentQueueItem();
    if (queueItem && typeof queueItem === 'object' && queueItem.interference?.type === 'probe') {
        if (studyState.interference) studyState.interference.pendingProbe = null;
    }

    document.getElementById('progressView')?.classList.add('hidden');
    document.getElementById('completeView')?.classList.add('hidden');
    document.getElementById('cardView')?.classList.remove('hidden');

    const q = document.getElementById('cardQuestion');
    const a = document.getElementById('cardAnswer');
    const answerContent = document.getElementById('cardAnswerContent');
    const clozeDisplay = document.getElementById('clozeDisplay');
    const clozeAnswerContent = document.getElementById('clozeAnswerContent');
    const clozeAnswerFull = document.getElementById('clozeAnswerFull');
    const typeAnswerContainer = document.getElementById('typeAnswerContainer');
    const typeAnswerInput = document.getElementById('typeAnswerInput');
    const typeAnswerFeedback = document.getElementById('typeAnswerFeedback');
    const showAnswerBtn = document.getElementById('showAnswerBtn');
    const checkAnswerBtn = document.getElementById('checkAnswerBtn');
    const correctBtn = document.getElementById('correctBtn');
    const incorrectBtn = document.getElementById('incorrectBtn');

    // Reset all displays
    if (q) { q.textContent = ''; q.classList.add('hidden'); }
    if (a) a.textContent = '';
    if (answerContent) answerContent.classList.add('hidden');
    if (clozeDisplay) { clozeDisplay.innerHTML = ''; clozeDisplay.classList.add('hidden'); }
    if (clozeAnswerContent) clozeAnswerContent.classList.add('hidden');
    if (clozeAnswerFull) clozeAnswerFull.innerHTML = '';
    if (typeAnswerContainer) typeAnswerContainer.classList.add('hidden');
    if (typeAnswerInput) typeAnswerInput.value = '';
    if (typeAnswerFeedback) typeAnswerFeedback.classList.add('hidden');
    showAnswerBtn?.classList.add('hidden');
    checkAnswerBtn?.classList.add('hidden');
    correctBtn?.classList.add('hidden');
    incorrectBtn?.classList.add('hidden');

    const cardType = card.cardType || CARD_TYPES.BASIC;

    // Render based on card type
    if (cardType === CARD_TYPES.CLOZE) {
        // Cloze card: show text with blanks
        const clozeData = parseClozeText(card.text || card.question || '');
        if (clozeDisplay) {
            clozeDisplay.innerHTML = clozeData.displayText;
            clozeDisplay.classList.remove('hidden');
        }
        if (clozeAnswerFull) {
            clozeAnswerFull.innerHTML = clozeData.fullText;
        }
        showAnswerBtn?.classList.remove('hidden');
    } else if (cardType === CARD_TYPES.BASIC_TYPE_ANSWER) {
        // Type-in answer card
        if (q) {
            q.textContent = card.question || '';
            q.classList.remove('hidden');
        }
        if (a) a.textContent = card.answer || '';
        if (typeAnswerContainer) typeAnswerContainer.classList.remove('hidden');
        if (typeAnswerInput) {
            typeAnswerInput.value = '';
            setTimeout(() => typeAnswerInput.focus(), 100);
        }
        checkAnswerBtn?.classList.remove('hidden');
    } else {
        // Standard flashcard types (basic, basic_reversed, basic_optional_reversed, flashcard, vocab)
        if (q) {
            q.textContent = card.question || '';
            q.classList.remove('hidden');
        }
        if (a) a.textContent = card.answer || '';
        showAnswerBtn?.classList.remove('hidden');
    }

    renderProgress();

    // Reset interaction metrics
    studyState.currentInteraction = {
        startedAt: performance.now(),
        answerShownAt: null,
        firstActionAt: null,
        focusLossCount: 0,
        backspaceCount: 0,
        attemptCount: 1,
        totalCorrections: 0,
        hesitationPauses: 0,
        typedAnswer: null,
        cardType: cardType
    };
}

function showAnswer() {
    const card = getCurrentCard();
    const cardType = card?.cardType || CARD_TYPES.BASIC;

    if (cardType === CARD_TYPES.CLOZE) {
        // Show the full cloze text with answers
        document.getElementById('clozeAnswerContent')?.classList.remove('hidden');
    } else {
        // Standard answer reveal
        document.getElementById('cardAnswerContent')?.classList.remove('hidden');
    }

    document.getElementById('showAnswerBtn')?.classList.add('hidden');
    document.getElementById('checkAnswerBtn')?.classList.add('hidden');
    document.getElementById('correctBtn')?.classList.remove('hidden');
    document.getElementById('incorrectBtn')?.classList.remove('hidden');

    if (studyState.currentInteraction) {
        studyState.currentInteraction.answerShownAt = performance.now();
        // If no action yet, this is the first action
        if (!studyState.currentInteraction.firstActionAt) {
            studyState.currentInteraction.firstActionAt = performance.now();
        }
    }
}

function checkTypedAnswer() {
    const card = getCurrentCard();
    if (!card) return;

    const typeAnswerInput = document.getElementById('typeAnswerInput');
    const typeAnswerFeedback = document.getElementById('typeAnswerFeedback');
    const typeAnswerResult = document.getElementById('typeAnswerResult');
    const typeAnswerCorrect = document.getElementById('typeAnswerCorrect');

    const userAnswer = typeAnswerInput?.value || '';
    const correctAnswer = card.answer || '';
    const gradeResult = gradeTypedAnswer(userAnswer, correctAnswer);

    if (studyState.currentInteraction) {
        studyState.currentInteraction.typedAnswer = userAnswer;
        studyState.currentInteraction.answerShownAt = performance.now();
        if (!studyState.currentInteraction.firstActionAt) {
            studyState.currentInteraction.firstActionAt = performance.now();
        }
    }

    // Show feedback
    if (typeAnswerFeedback) {
        typeAnswerFeedback.classList.remove('hidden');
        if (gradeResult.isCorrect) {
            typeAnswerFeedback.style.backgroundColor = 'var(--correct-bg, rgba(34, 197, 94, 0.1))';
            typeAnswerFeedback.style.border = '1px solid var(--correct-border, #22c55e)';
        } else {
            typeAnswerFeedback.style.backgroundColor = 'var(--incorrect-bg, rgba(239, 68, 68, 0.1))';
            typeAnswerFeedback.style.border = '1px solid var(--incorrect-border, #ef4444)';
        }
    }

    if (typeAnswerResult) {
        if (gradeResult.isCorrect) {
            typeAnswerResult.textContent = 'Correct!';
            typeAnswerResult.style.color = 'var(--correct-text, #22c55e)';
        } else {
            typeAnswerResult.textContent = `Incorrect (${Math.round(gradeResult.similarity * 100)}% match)`;
            typeAnswerResult.style.color = 'var(--incorrect-text, #ef4444)';
        }
    }

    if (typeAnswerCorrect) {
        typeAnswerCorrect.textContent = `Correct answer: ${correctAnswer}`;
    }

    // Show correct/incorrect buttons
    document.getElementById('checkAnswerBtn')?.classList.add('hidden');
    document.getElementById('correctBtn')?.classList.remove('hidden');
    document.getElementById('incorrectBtn')?.classList.remove('hidden');

    // Disable input
    if (typeAnswerInput) {
        typeAnswerInput.disabled = true;
    }
}

function buildInteractionMetrics(isCorrect) {
    const interaction = studyState.currentInteraction || {};
    const now = performance.now();
    const reference = interaction.answerShownAt || interaction.startedAt || now;
    
    // Time metrics
    const recallLatency = Math.max(0, now - (interaction.startedAt || now)); // Total time
    const timeToFirstAction = Math.max(0, (interaction.firstActionAt || now) - (interaction.startedAt || now));
    
    // Heuristic fluency
    const inferredFluency = Math.max(0, 10 - recallLatency / 350); 
    
    // Rates
    // Assuming implicit "typing" length if unavailable (placeholder)
    const approximateChars = 10; 
    const backspaceRate = (interaction.backspaceCount || 0) / approximateChars;

    return {
        recallLatency,
        timeToFirstAction,
        totalCorrections: interaction.totalCorrections || 0,
        attemptCount: interaction.attemptCount || 1,
        answerFluency: inferredFluency,
        backspaceRate: backspaceRate,
        hesitationPauses: interaction.hesitationPauses || 0,
        focusLossCount: interaction.focusLossCount || 0
    };
}

function ensureKnowledgeForCard(card) {
    const deckID = studyState.deck?.id || card.deckId || card.deckID || 'global';
    const existing = studyState.knowledgeMap.get(card.id);
    const nowIso = new Date().toISOString();
    if (existing) {
        const prepared = {
            ...existing,
            deckID,
            fsrs: fsrsEngine.prepareCard(existing.fsrs || existing)
        };
        studyState.knowledgeMap.set(card.id, prepared);
        return prepared;
    }
    const fsrsState = fsrsEngine.prepareCard();
    const fresh = {
        id: `${DEFAULT_USER_ID}:${card.id}`,
        userID: DEFAULT_USER_ID,
        cardID: card.id,
        deckID,
        fsrs: fsrsState,
        recallHistory: [],
        lastReviewed: null,
        lastModified: nowIso
    };
    studyState.knowledgeMap.set(card.id, fresh);
    return fresh;
}

async function markAnswer(explicitCorrectness) {
    const card = getCurrentCard();
    if (!card) return;

    const metrics = buildInteractionMetrics(explicitCorrectness);
    
    // Update session mean latency (Simple moving average)
    studyState.sessionMetrics.meanLatency = 
        (studyState.sessionMetrics.meanLatency * 0.9) + (metrics.recallLatency * 0.1);

    const knowledge = ensureKnowledgeForCard(card);
    const queueItem = getCurrentQueueItem();
    const interferenceContext = (queueItem && typeof queueItem === 'object') ? (queueItem.interference || null) : null;
    
    const context = {
        deck: studyState.deck,
        sessionState: {
            sessionMeanLatency: studyState.sessionMetrics.meanLatency,
            cardMetrics: new Map()
        },
        calibrationTruth: true,
        interference: interferenceContext?.type ? interferenceContext : undefined
    };

    try {
        // Pass explicit feedback to Cortex for inference
        const updatedState = await Cortex.processReview(card, knowledge, metrics, explicitCorrectness, undefined, context);
        
        // Update local map
        studyState.knowledgeMap.set(card.id, updatedState);
        
        // Save to DB
        await saveDataToDB('userKnowledgeState', updatedState);
        
        // Save telemetry/log
        const logEntry = {
             cardID: card.id,
             userID: DEFAULT_USER_ID,
             timestamp: Date.now(),
             metrics: metrics,
             explicitCorrectness: explicitCorrectness,
             interference: context.interference || null,
             inference: updatedState.lastInference,
             fsrsState: updatedState.fsrs
        };
        await saveDataToDB('interactionLogs', logEntry);

        // --- Re-queue Logic for "Retry Intent" ---
        // If pCorrect was low (implied Again/Hard), re-queue it.
        // We use the last inference result.
        if (updatedState.lastInference) {
            const { pCorrect, confidence } = updatedState.lastInference;
            const threshold = 0.6; // If probability of recall is < 60%, see it again soon
            
            if (pCorrect < threshold || explicitCorrectness === false) {
                // Re-queue
                // Check if already scheduled soon?
                // For cramming, we just push to end of queue or N steps later.
                const retryDistance = Math.max(3, Math.floor(studyState.queue.length * 0.2));
                const insertIndex = studyState.currentIndex + retryDistance;
                
                const intent = explicitCorrectness === false ? 'retry-failure' : 'retry-uncertain';
                const queueItem = { id: card.id, intent };

                // Don't add if already in queue recently? 
                // Simple approach: Insert ID again.
                // We splice it in.
                if (insertIndex < studyState.queue.length) {
                    studyState.queue.splice(insertIndex, 0, queueItem);
                } else {
                    studyState.queue.push(queueItem);
                }
                console.log(`Re-queued card ${card.id} with intent '${intent}' (p=${pCorrect.toFixed(2)})`);
            }
        }
        
        if (!interferenceContext?.type) {
            scheduleInterferenceProbeAfter(card);
        }

    } catch (err) {
        console.error('Cortex update failed:', err);
        showToast('Error saving progress', 'error');
    }

    studyState.currentInteraction = null;
    studyState.completed += 1;
    studyState.currentIndex += 1;
    
    // Save Session State for Continuity
    await saveSession();

    if (studyState.currentIndex >= studyState.queue.length) {
        await endSession();
    } else {
        showCard();
    }
}

// --- Session Persistence ---

async function saveSession() {
    if (!studyState.deck) return;
    const sessionData = {
        key: `session_${studyState.deck.id}`,
        deckID: studyState.deck.id,
        queue: studyState.queue,
        currentIndex: studyState.currentIndex,
        completed: studyState.completed,
        mode: studyState.mode,
        sessionStartTime: studyState.sessionStartTime,
        sessionMetrics: studyState.sessionMetrics,
        // Persist session objective (Exam Date)
        examDate: studyState.deck.settings?.examDate || null,
        lastSaved: Date.now()
    };
    await saveDataToDB('appData', sessionData);
}

async function loadSession(deckID) {
    const sessionData = await getDataFromDB('appData', `session_${deckID}`);
    if (!sessionData) return false;
    
    // Check expiry (e.g., 24 hours)
    if (Date.now() - sessionData.lastSaved > 24 * 60 * 60 * 1000) {
        return false; // Expired
    }

    studyState.queue = sessionData.queue || [];
    studyState.currentIndex = sessionData.currentIndex || 0;
    studyState.completed = sessionData.completed || 0;
    studyState.mode = sessionData.mode || 'review';
    studyState.sessionStartTime = sessionData.sessionStartTime || Date.now();
    studyState.sessionMetrics = sessionData.sessionMetrics || { focusLossCount: 0, meanLatency: 3000 };
    return true;
}

async function clearSession() {
    // Only clear on clean finish or explicit exit?
    // For now, we keep it until expiry or overwrite.
}

// --- Init Logic ---

async function endSession() {
    document.getElementById('cardView')?.classList.add('hidden');
    document.getElementById('progressView')?.classList.add('hidden');
    document.getElementById('completeView')?.classList.remove('hidden');
    const finalCount = document.getElementById('finalCardsReviewed');
    if (finalCount) finalCount.textContent = `${studyState.completed}`;
    stopMetricTracking();
    
    // We do NOT clear session here, so users can review the session stats or result?
    // Or maybe we should?
    // If they finished the queue, we probably should clear it or mark it done.
    // But 'queue' might grow if re-queues happen.
    // If we are here, queue is exhausted.
}

async function prepareQueue() {
    // 1. Check if we can resume
    const resumed = await loadSession(studyState.deck.id);
    if (resumed && studyState.queue.length > 0) {
        console.log('Resuming previous session', studyState.queue.length, 'cards');
        return;
    }

    // 2. Build new queue using Cortex
    studyState.queue = [];
    
    // Score all cards
    const candidates = [];
    const sessionSnapshot = {
        sessionMeanLatency: studyState.sessionMetrics.meanLatency,
        queue: [] // No queue yet
    };

    for (const card of studyState.cards) {
        const state = ensureKnowledgeForCard(card);
        const score = await Cortex.scoreCard(card, state, sessionSnapshot, studyState.deck);
        candidates.push({ card, score });
    }
    
    // Sort by score (descending)
    candidates.sort((a, b) => b.score - a.score);
    
    // Take top N (e.g., 50 or all)
    // For cramming, maybe all due cards + some new?
    // We'll just take the sorted list.
    studyState.queue = candidates.map(c => {
        // Determine intent based on card state
        // If reps > 0, it is review/spacing. Else new/exploration.
        const isNew = (!c.card.fsrs || c.card.fsrs.reps === 0);
        return {
            id: c.card.id,
            intent: isNew ? 'new' : 'spacing'
        };
    });
    studyState.currentIndex = 0;
    studyState.completed = 0;
    studyState.sessionStartTime = Date.now();
    
    await saveSession();
}

async function startSession() {
    if (!studyState.deck) {
        showToast('Deck not found', 'error');
        return;
    }
    if (!studyState.cards.length) {
        showToast('No cards to study', 'error');
        return;
    }
    
    await prepareQueue();
    
    if (studyState.queue.length === 0) {
        showToast('No cards to review!', 'info');
        return;
    }

    startMetricTracking();
    showCard();
}

async function loadKnowledge(deckId) {
    const range = IDBKeyRange.only([DEFAULT_USER_ID, deckId]);
    const knowledge = await getDataByIndex('userKnowledgeState', 'by_user_deck', range);
    studyState.knowledgeMap = new Map(knowledge.map(k => {
        const fsrsState = fsrsEngine.prepareCard(k.fsrs || k);
        return [k.cardID, { ...k, fsrs: fsrsState }];
    }));
}

function isVisible(element) {
    if (!element) return false;
    if (element.classList.contains('hidden')) return false;
    const style = window.getComputedStyle(element);
    return style.display !== 'none' && style.visibility !== 'hidden';
}

/**
 * Set up keyboard shortcuts for the study page.
 * Uses direct event listeners for maximum reliability.
 */
function setupStudyKeyboard() {
    const typeAnswerInput = document.getElementById('typeAnswerInput');
    
    // Direct Enter handler on the type answer input
    if (typeAnswerInput) {
        typeAnswerInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                checkTypedAnswer();
            }
            // All other keys (including Space) type naturally - no interception
        });
    }

    // Global keyboard handler for non-typing shortcuts
    document.addEventListener('keydown', (e) => {
        const active = document.activeElement;
        const isTypingInInput = active && (
            active.tagName === 'INPUT' || 
            active.tagName === 'TEXTAREA' || 
            active.isContentEditable
        );

        // When typing, only allow Escape
        if (isTypingInInput && e.key !== 'Escape') {
            return; // Let keys type naturally
        }

        const progressView = document.getElementById('progressView');
        const cardView = document.getElementById('cardView');
        const completeView = document.getElementById('completeView');

        // Escape - go back
        if (e.key === 'Escape') {
            const backBtn = document.getElementById('backToDashboardBtn');
            if (backBtn) {
                e.preventDefault();
                backBtn.click();
            }
            return;
        }

        // Progress view - Enter/Space to start
        if (isVisible(progressView)) {
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                document.getElementById('startSessionBtn')?.click();
            }
            return;
        }

        // Complete view - Enter to finish
        if (isVisible(completeView)) {
            if (e.key === 'Enter') {
                e.preventDefault();
                document.getElementById('finishBtn')?.click();
            }
            return;
        }

        // Card view shortcuts
        if (!isVisible(cardView)) return;

        const showAnswerBtn = document.getElementById('showAnswerBtn');
        const checkAnswerBtn = document.getElementById('checkAnswerBtn');
        const correctBtn = document.getElementById('correctBtn');
        const incorrectBtn = document.getElementById('incorrectBtn');

        // Check if we're showing the answer already
        const answerVisible = isVisible(document.getElementById('cardAnswerContent')) ||
                             isVisible(document.getElementById('clozeAnswerContent')) ||
                             isVisible(document.getElementById('typeAnswerFeedback'));

        if (!answerVisible) {
            // Before answer is shown
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                if (isVisible(showAnswerBtn)) {
                    showAnswerBtn.click();
                } else if (isVisible(checkAnswerBtn)) {
                    checkAnswerBtn.click();
                }
            }
            return;
        }

        // After answer is shown - grade the card
        if (e.key === '1' || e.key === 'ArrowLeft') {
            e.preventDefault();
            incorrectBtn?.click();
        } else if (e.key === '2' || e.key === 'ArrowRight' || e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            correctBtn?.click();
        }
    });
}


async function init() {
    await initDB();
    await fsrsEngine.init();
    await Cortex.initCortex(); // Init Cortex

    const deckId = getQueryParam('deckId');
    const mode = getQueryParam('mode') || 'review';
    if (!deckId) {
        showToast('Missing deckId', 'error');
        return;
    }

    const deck = await getDataFromDB('decks', deckId);
    if (!deck) {
        showToast('Deck not found', 'error');
        return;
    }
    studyState.deck = deck;
    studyState.mode = mode;
    
    // Load existing cards
    studyState.cards = deck.cards || [];
    studyState.cardsById = new Map(studyState.cards.map(card => [card.id, card]));
    ensureDeckAccentMetadata(deck);
    
    await loadKnowledge(deckId);
    
    const subtitle = document.getElementById('studySubtitle');
    if (subtitle) subtitle.textContent = `${deck.name} - ${mode}`;
    renderProgress();

    document.getElementById('startSessionBtn')?.addEventListener('click', startSession);
    document.getElementById('showAnswerBtn')?.addEventListener('click', showAnswer);
    document.getElementById('checkAnswerBtn')?.addEventListener('click', checkTypedAnswer);
    document.getElementById('correctBtn')?.addEventListener('click', () => markAnswer(true));
    document.getElementById('incorrectBtn')?.addEventListener('click', () => markAnswer(false));
    document.getElementById('finishBtn')?.addEventListener('click', () => window.location.href = 'index.html');
    document.getElementById('backToDashboardBtn')?.addEventListener('click', () => window.location.href = 'index.html');

    // Set up keyboard shortcuts
    setupStudyKeyboard();
}

document.addEventListener('DOMContentLoaded', () => {
    const deckId = getQueryParam('deckId');
    if (!deckId) return;

    init().catch(err => {
        console.error('Failed to initialise study page', err);
        showToast('Failed to start study session', 'error');
    });
});
