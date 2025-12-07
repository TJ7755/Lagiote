import { initDB, getDataFromDB, getAllDataFromDB, saveDataToDB } from '../core/db.js';
import { shuffleArray, getQueryParam, calculateIQS } from '../core/utils.js';

const studyState = {
    deck: null,
    cards: [],
    currentIndex: 0,
    mode: 'review',
    knowledgeMap: new Map(),
    completed: 0
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
    if (counter) counter.textContent = `${studyState.completed} / ${studyState.cards.length}`;
    const cardProgressText = document.getElementById('cardProgressText');
    if (cardProgressText) {
        cardProgressText.textContent = `Card ${studyState.currentIndex + 1} of ${studyState.cards.length}`;
    }
}

function showCard() {
    const card = studyState.cards[studyState.currentIndex];
    if (!card) {
        endSession();
        return;
    }

    document.getElementById('progressView')?.classList.add('hidden');
    document.getElementById('completeView')?.classList.add('hidden');
    document.getElementById('cardView')?.classList.remove('hidden');

    const q = document.getElementById('cardQuestion');
    const a = document.getElementById('cardAnswer');
    const answerContent = document.getElementById('cardAnswerContent');
    if (q) q.innerHTML = card.question || '';
    if (a) a.innerHTML = card.answer || '';
    if (answerContent) answerContent.classList.add('hidden');

    document.getElementById('showAnswerBtn')?.classList.remove('hidden');
    document.getElementById('correctBtn')?.classList.add('hidden');
    document.getElementById('incorrectBtn')?.classList.add('hidden');
    renderProgress();
}

function showAnswer() {
    document.getElementById('cardAnswerContent')?.classList.remove('hidden');
    document.getElementById('showAnswerBtn')?.classList.add('hidden');
    document.getElementById('correctBtn')?.classList.remove('hidden');
    document.getElementById('incorrectBtn')?.classList.remove('hidden');
}

async function updateKnowledgeState(card, wasCorrect) {
    const key = ['default_user', card.id];
    const existing = studyState.knowledgeMap.get(card.id);

    const now = new Date().toISOString();
    const base = existing || {
        userID: 'default_user',
        cardID: card.id,
        masteryScore: 0.5,
        stability: 1.0,
        lastReviewed: now,
        recallHistory: []
    };

    const iqs = calculateIQS({
        recallLatency: 1500,
        answerFluency: 10,
        totalCorrections: 0,
        attemptCount: 1
    });

    const learningRate = 0.2;
    const penaltyRate = 0.3;
    let masteryScore = base.masteryScore;
    let stability = base.stability || 1.0;
    let consecutiveCorrect = base.consecutiveCorrect || 0;

    if (wasCorrect) {
        const performanceBonus = (iqs > 0.8) ? 1.5 : (iqs < 0.4 ? 0.5 : 1.0);
        masteryScore += (1 - masteryScore) * learningRate * performanceBonus;
        consecutiveCorrect += 1;

        if (consecutiveCorrect < 3 && masteryScore > 0.85) {
            stability *= 1.05;
        } else if (consecutiveCorrect >= 3) {
            stability *= 1.12;
        }
    } else {
        masteryScore -= masteryScore * penaltyRate;
        consecutiveCorrect = 0;
        stability = 1.0;
    }

    const updated = {
        ...base,
        masteryScore: Math.max(0, Math.min(1, masteryScore)),
        stability: Math.max(0.5, stability),
        consecutiveCorrect,
        lastReviewed: now,
        lastModified: now,
        recallHistory: [...(base.recallHistory || []), { date: now, wasCorrect, iqs }]
    };

    studyState.knowledgeMap.set(card.id, updated);
    await saveDataToDB('userKnowledgeState', updated);
}

async function markAnswer(isCorrect) {
    const card = studyState.cards[studyState.currentIndex];
    if (!card) return;

    await updateKnowledgeState(card, isCorrect);
    studyState.completed += 1;
    studyState.currentIndex += 1;

    if (studyState.currentIndex >= studyState.cards.length) {
        endSession();
    } else {
        showCard();
    }
}

function endSession() {
    document.getElementById('cardView')?.classList.add('hidden');
    document.getElementById('progressView')?.classList.add('hidden');
    document.getElementById('completeView')?.classList.remove('hidden');
    const finalCount = document.getElementById('finalCardsReviewed');
    if (finalCount) finalCount.textContent = `${studyState.completed}`;
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
    studyState.currentIndex = 0;
    studyState.completed = 0;
    showCard();
}

async function loadKnowledge() {
    const knowledge = await getAllDataFromDB('userKnowledgeState');
    studyState.knowledgeMap = new Map(knowledge.map(k => [k.cardID, k]));
}

async function init() {
    await initDB();
    const deckId = getQueryParam('deckId');
    const mode = getQueryParam('mode') || 'review';
    if (!deckId) {
        showToast('Missing deckId', 'error');
        return;
    }

    studyState.mode = mode;
    await loadKnowledge();
    const deck = await getDataFromDB('decks', deckId);
    if (!deck) {
        showToast('Deck not found', 'error');
        return;
    }
    studyState.deck = deck;
    studyState.cards = shuffleArray([...deck.cards]);

    const subtitle = document.getElementById('studySubtitle');
    if (subtitle) subtitle.textContent = `${deck.name} · ${mode}`;
    renderProgress();

    document.getElementById('startSessionBtn')?.addEventListener('click', startSession);
    document.getElementById('showAnswerBtn')?.addEventListener('click', showAnswer);
    document.getElementById('correctBtn')?.addEventListener('click', () => markAnswer(true));
    document.getElementById('incorrectBtn')?.addEventListener('click', () => markAnswer(false));
    document.getElementById('finishBtn')?.addEventListener('click', () => window.location.href = 'index.html');
    document.getElementById('backToDashboardBtn')?.addEventListener('click', () => window.location.href = 'index.html');
}

document.addEventListener('DOMContentLoaded', () => {
    init().catch(err => {
        console.error('Failed to initialize study page', err);
        showToast('Failed to start study session', 'error');
    });
});
