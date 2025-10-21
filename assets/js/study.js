// Study Mode Logic
import state, { DEFAULT_DECK_SETTINGS } from './state.js';
import { saveDataToDB } from './db.js';
import { showToast, getBucketName, shuffleArray, calculateIQS } from './utils.js';
import { showView, transitionSubView, updateProgressBar } from './ui.js';

// Initialize study session
export async function startStudySession(deckId, mode) {
    state.currentDeckId = deckId;
    state.currentMode = mode;
    const deck = state.decks[deckId];
    
    if (!deck) {
        showToast('Deck not found', 'error');
        return;
    }

    // Initialize deck settings if not present
    deck.settings = { ...DEFAULT_DECK_SETTINGS, ...(deck.settings || {}) };

    if (mode === 'learn') {
        await startLearnMode(deck);
    } else if (mode === 'review') {
        await startReviewMode(deck);
    } else if (mode === 'spaced') {
        await startSpacedLearning(deck);
    }
}

// Learning Mode
async function startLearnMode(deck) {
    if (!deck.learnState || !deck.settings || !deck.learnState.buckets) {
        deck.learnState = {
            buckets: [[...deck.cards]],
            currentRound: 1,
            maxBuckets: deck.settings.maxBuckets
        };
    }

    // Ensure correct number of buckets
    while (deck.learnState.buckets.length < deck.settings.maxBuckets) {
        deck.learnState.buckets.push([]);
    }

    state.studyState = {
        ...state.studyState,
        buckets: JSON.parse(JSON.stringify(deck.learnState.buckets)),
        currentRound: deck.learnState.currentRound || 1,
        settings: deck.settings,
        startTime: new Date()
    };

    showView('studyMode');
    document.getElementById('studyTitle').textContent = 'Learning Mode';
    document.getElementById('studySubtitle').textContent = deck.name;
    showProgress();
}

// Review Mode
async function startReviewMode(deck) {
    state.studyState = {
        ...state.studyState,
        settings: deck.settings,
        startTime: new Date(),
        stillLearning: [...deck.cards],
        correct: [],
        currentRound: 1,
        lastRoundIncorrect: []
    };

    showView('studyMode');
    document.getElementById('studyTitle').textContent = 'Review Mode';
    document.getElementById('studySubtitle').textContent = deck.name;
    showProgress();
}

// Spaced Learning Mode
async function startSpacedLearning(deck) {
    const now = new Date();
    const dueCards = deck.cards.filter(card => {
        if (!card.sm2Data) return true;
        const dueDate = new Date(card.sm2Data.dueDate);
        return dueDate <= now;
    });

    if (dueCards.length === 0) {
        showToast('No cards due for review!', 'info');
        return;
    }

    state.studyState = {
        ...state.studyState,
        roundCards: shuffleArray(dueCards),
        currentCardIndex: 0,
        settings: deck.settings,
        startTime: new Date()
    };

    showView('studyMode');
    document.getElementById('studyTitle').textContent = 'Spaced Learning';
    document.getElementById('studySubtitle').textContent = deck.name;
    showNextCard();
}

// Card Movement Logic
export async function moveCard(card, correct) {
    const cardInDeck = state.decks[state.currentDeckId].cards.find(c => c.id === card.id);
    if (cardInDeck) cardInDeck.isNew = false;

    if (state.currentMode === 'learn') {
        await moveCardInLearnMode(card, correct);
    } else if (state.currentMode === 'review') {
        await moveCardInReviewMode(card, correct);
    } else if (state.currentMode === 'spaced') {
        await moveCardInSpacedMode(card, correct);
    }
}

async function moveCardInLearnMode(card, correct) {
    let currentBucketIndex = -1;
    
    // Find current bucket index
    for (let i = 0; i < state.studyState.buckets.length; i++) {
        if (state.studyState.buckets[i].some(c => c.id === card.id)) {
            currentBucketIndex = i;
            break;
        }
    }

    if (currentBucketIndex === -1) return;

    // Remove card from current bucket
    state.studyState.buckets[currentBucketIndex] = 
        state.studyState.buckets[currentBucketIndex].filter(c => c.id !== card.id);

    // Move to next or previous bucket based on correctness
    let newBucketIndex;
    if (correct) {
        newBucketIndex = Math.min(currentBucketIndex + 1, state.studyState.settings.maxBuckets - 1);
    } else {
        newBucketIndex = Math.max(currentBucketIndex - 1, 0);
    }

    // Add to new bucket
    state.studyState.buckets[newBucketIndex].push(card);

    // Save progress
    await saveStudyProgress();
}

async function moveCardInReviewMode(card, correct) {
    const index = state.studyState.stillLearning.findIndex(c => c.id === card.id);
    if (index === -1) return;

    if (correct) {
        state.studyState.stillLearning.splice(index, 1);
        state.studyState.correct.push(card);
    } else {
        state.studyState.lastRoundIncorrect.push(card);
    }

    await saveStudyProgress();
}

async function moveCardInSpacedMode(card, quality) {
    const cardInDeck = state.decks[state.currentDeckId].cards.find(c => c.id === card.id);
    if (!cardInDeck) return;

    // Update SM2 data
    const sm2 = new SM2Algorithm();
    cardInDeck.sm2Data = sm2.calculateNextReview(cardInDeck)(quality);

    await saveStudyProgress();
}

// Progress Saving
export async function saveStudyProgress() {
    if (!state.currentDeckId) return;
    
    const deck = state.decks[state.currentDeckId];
    if (!deck) return;

    if (state.currentMode === 'learn') {
        deck.learnState = {
            buckets: state.studyState.buckets,
            currentRound: state.studyState.currentRound,
            maxBuckets: state.studyState.settings.maxBuckets
        };
    } else if (state.currentMode === 'review') {
        deck.reviewState = {
            stillLearning: state.studyState.stillLearning,
            correct: state.studyState.correct,
            currentRound: state.studyState.currentRound,
            lastRoundIncorrect: state.studyState.lastRoundIncorrect
        };
    }

    await saveDataToDB('decks', deck);
}

// Progress Display
export function showProgress() {
    const progressView = document.getElementById('progressView');
    const cardView = document.getElementById('cardView');
    transitionSubView(cardView, progressView);

    if (state.currentMode === 'learn') {
        updateLearnProgress();
    } else if (state.currentMode === 'review') {
        updateReviewProgress();
    }
}

function updateLearnProgress() {
    const deck = state.decks[state.currentDeckId];
    const maxBuckets = state.studyState.settings.maxBuckets;
    const mastered = state.studyState.buckets[maxBuckets - 1]?.length || 0;
    const total = deck.cards.length;

    // Update bucket display
    document.getElementById('bucketsContainer').innerHTML = 
        Array.from({length: maxBuckets}, (_, i) => 
            `<div class="bucket">
                <div class="bucket-number">${getBucketName(i, maxBuckets)}</div>
                <div class="bucket-count">${state.studyState.buckets[i]?.length || 0}</div>
            </div>`
        ).join('');

    // Calculate and update progress
    let currentProgressPoints = 0;
    state.studyState.buckets.forEach((bucket, i) => {
        currentProgressPoints += bucket.length * i;
    });
    const maxProgressPoints = total > 0 ? total * (maxBuckets - 1) : 0;
    const progress = maxProgressPoints > 0 ? (currentProgressPoints / maxProgressPoints) * 100 : 0;

    updateProgressBar('progressBarFill', progress);
}

function updateReviewProgress() {
    const deck = state.decks[state.currentDeckId];
    const remaining = state.studyState.stillLearning.length;
    const mastered = state.studyState.correct.length;
    const total = deck.cards.length;
    const progress = total > 0 ? (mastered / total) * 100 : 0;

    // Update display
    document.getElementById('bucketsContainer').innerHTML = 
        `<div class="bucket">
            <div class="bucket-number">Still Learning</div>
            <div class="bucket-count">${remaining}</div>
        </div>
        <div class="bucket">
            <div class="bucket-number">Correct</div>
            <div class="bucket-count">${mastered}</div>
        </div>`;

    updateProgressBar('progressBarFill', progress);
}

// SM2 Algorithm Implementation
class SM2Algorithm {
    constructor() {
        this.defaultInterval = 1;
        this.defaultFactor = 2.5;
    }

    calculateNextReview(card) {
        const now = new Date();
        
        if (!card.sm2Data) {
            card.sm2Data = {
                interval: 0,
                factor: this.defaultFactor,
                repetition: 0,
                dueDate: now.toISOString()
            };
        }
        
        const data = card.sm2Data;
        
        return function(quality) {
            if (quality >= 3) {
                if (data.repetition === 0) {
                    data.interval = 1;
                } else if (data.repetition === 1) {
                    data.interval = 6;
                } else {
                    data.interval = Math.round(data.interval * data.factor);
                }
                data.repetition++;
            } else {
                data.repetition = 0;
                data.interval = 1;
            }
            
            data.factor = data.factor + (0.1 - (5 - quality) * (0.08 + (5 - quality) * 0.02));
            if (data.factor < 1.3) data.factor = 1.3;
            
            const dueDate = new Date();
            dueDate.setDate(dueDate.getDate() + data.interval);
            data.dueDate = dueDate.toISOString();
            
            return data;
        };
    }
}