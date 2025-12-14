console.log('Test 1: Script is starting!');
pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/2.11.338/pdf.worker.min.js';

const isElectron = typeof window.electronAPI !== 'undefined';
let toastQueue = [];
let currentEditingPlanId = null;
let dailyPriorityQueue = [];
let isToastVisible = false;
let sortableInstance = null;
let documentsForAi = [];
let isOnline = navigator.onLine;
let db;
let decks = {};
let categories = ["Science", "Maths", "Language",];
let globalSettings = {};
let analyticsData = {
    lastUsed: null,
    streak: 0,
    totalStudyTime: 0,
    sessions: []
};

let lastKnownFocusScore = 1.0;
let focusLossStartTime = null;
let accumulatedAwayDuration = 0;
let currentDeckId = null;
let currentMode = null;
let confirmCallback = null;
let cardToEdit = { deckId: null, cardIndex: null, from: null };
let aiCardToEditIndex = null;
let studyState = {
    buckets: [],
    currentRound: 1,
    currentCardIndex: 0,
    roundCards: [],
    settings: {},
    lastRoundIncorrect: [],
    isRetypingIncorrect: false,
    startTime: null,
    activeLearningPool: [],
    knowledgeStates: new Map(),
    incorrectInThisRound: [],
    sessionState: null,
    currentCard: null,
    sequencePhase: null,
    sequenceCards: [],
    sequenceChunks: [],
    currentChunkIndex: 0,
    correctDragDropOrder: [],
    sequenceMissedInChunk: [],
    sequenceActiveChunkOverride: null,
    sequenceQuestionStartTime: null,
    sequenceTimerInterval: null,
    preGenerationCountdownInterval: null,
    sequenceForwardQueue: [],
    weakestLinkIteration: 0,
    maxWeakestLinkIterations: 3,
    nextPhaseAfterReview: null,
    preGeneratedDistractors: new Map(),
    examDate: null,
    targetRetention: 0.8,
    cortexDebugEnabled: false,
    pendingMCQToken: 0,
    pendingMCQCardId: null
};

function fallbackCoerceFsrsNumber(value, fallback = 0) {
    const coerced = Number(value);
    return Number.isFinite(coerced) ? coerced : fallback;
}

function fallbackParseFsrsDate(value) {
    if (!value) return null;
    const candidate = value instanceof Date ? value : new Date(value);
    return Number.isNaN(candidate.getTime()) ? null : candidate;
}

function fallbackNormalizeFsrsState(fsrs) {
    if (!fsrs || typeof fsrs !== 'object') return null;
    return {
        state: fallbackCoerceFsrsNumber(fsrs.state),
        stability: fallbackCoerceFsrsNumber(fsrs.stability),
        difficulty: fallbackCoerceFsrsNumber(fsrs.difficulty),
        reps: fallbackCoerceFsrsNumber(fsrs.reps),
        lapses: fallbackCoerceFsrsNumber(fsrs.lapses),
        due: fallbackParseFsrsDate(fsrs.due),
        last_review: fallbackParseFsrsDate(fsrs.last_review)
    };
}

function fallbackIsFsrsReviewedState(fsrs) {
    if (!fsrs || typeof fsrs !== 'object') return false;
    const stability = fallbackCoerceFsrsNumber(fsrs.stability);
    const reps = fallbackCoerceFsrsNumber(fsrs.reps);
    const lastReview = fallbackParseFsrsDate(fsrs.last_review);
    return stability > 0 && reps > 0 && Boolean(lastReview);
}

function fallbackIsKnowledgeStateReviewed(state) {
    if (!state) return false;
    return fallbackIsFsrsReviewedState(state.fsrs);
}

const fallbackKnowledgeStateUtils = {
    coerceFsrsNumber: fallbackCoerceFsrsNumber,
    parseFsrsDate: fallbackParseFsrsDate,
    normalizeFsrsState: fallbackNormalizeFsrsState,
    isFsrsReviewedState: fallbackIsFsrsReviewedState,
    isKnowledgeStateReviewed: fallbackIsKnowledgeStateReviewed
};

let cachedKnowledgeStateUtils = null;
function getKnowledgeStateUtils() {
    const globalUtils = (typeof window !== 'undefined' && window.lagiote && window.lagiote.knowledgeStateUtils)
        ? window.lagiote.knowledgeStateUtils
        : null;
    if (globalUtils) {
        cachedKnowledgeStateUtils = globalUtils;
        return globalUtils;
    }
    if (!cachedKnowledgeStateUtils) {
        cachedKnowledgeStateUtils = fallbackKnowledgeStateUtils;
    }
    return cachedKnowledgeStateUtils;
}
const DEFAULT_DECK_SETTINGS = {
    learnMode: 'flashcard',
    reviewOrder: 'random',
    cardsPerRound: 10,
    maxBuckets: 4,
    caseSensitive: false,
    punctuation: false,
    retypeIncorrect: true,
    learnHorizonDays: 0,
    feedbackStyle: 'simple',
    forgivingAutomarking: true
};
const CURRENT_ANALYSIS_VERSION = 2;
const smartCoachMessages = {
    greetings: [
        "Welcome back, {username}! Ready to learn something new today?",
        "Glad to see you again, {username}! Let's build that knowledge.",
        "Let's get started, {username}! Consistency is key.",
        "A new day, a new opportunity to learn. Let's do this, {username}!"
    ],
    sessionFeedback: {
        highAccuracy: [
            "Excellent work! You achieved over 90% accuracy that round. Keep up the great momentum!",
            "Fantastic session! Your focus is clearly paying off. Well done!",
            "That was a brilliant round. You've got a strong grasp on this material."
        ],
        mediumAccuracy: [
            "Good session! You're making solid progress. Every review strengthens your memory.",
            "Nice work. You pushed through and learned a lot. Let's keep building on it.",
            "Solid effort. The tricky cards are the ones that teach us the most."
        ],
        lowAccuracy: [
            "That was a tough round, but you stuck with it. That's how real learning happens!",
            "Don't be discouraged. The most challenging sessions often lead to the biggest breakthroughs.",
            "You've laid the groundwork. The next time you see these cards, they'll be more familiar."
        ]
    },
    roundFeedback: {
        highFocus: [
            "Excellent focus that round. Keep it up!",
            "You're on a roll! Let's keep the momentum going.",
            "Great work. You're building strong recall."
        ],
        mediumFocus: [
            "Good progress. Every card is a step forward.",
            "Nice work. Let's see what's in the next round.",
            "You're doing great. Keep up the consistent effort."
        ],
        encouragement: [
            "You've got this. The challenging cards are the best for learning.",
            "Keep pushing through. This is how strong memories are built.",
            "Don't give up. Every review makes the next one easier."
        ]
    },
    milestones: {
        streak: [
            "You're on a {streak}-day streak! Amazing consistency, {username}!",
            "That's a {streak}-day streak! You're building a powerful learning habit."
        ],
        deckMastered: [
            "Incredible! You've mastered every card in the '{deckName}' deck. That's a huge achievement!",
            "Congratulations! You've officially mastered the '{deckName}' deck. Time to celebrate!"
        ],
        cardsMastered: [
            "Big milestone! You've now mastered over {count} cards in this deck. Your knowledge is growing!",
            "You just crossed the {count}-card mastery threshold in this deck. Fantastic progress!"
        ]
    }
};

let editorCardCounter = 0;
let currentViewingDeckId = null;
let activeView = 'dashboard';
let viewHistory = [];
const keyboardManager = window.keyboardManager || null;
let deckSelectionState = { items: [], index: -1 };

// Lightweight safe binder: no-ops if element missing
function bind(id, event, handler, options) {
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener(event, handler, options);
}

function isElementVisible(element) {
    if (!element) return false;
    if (keyboardManager?.isVisible) return keyboardManager.isVisible(element);
    return element.offsetParent !== null && !element.classList.contains('hidden');
}

function idbRequestToPromise(request) {
    return new Promise((resolve, reject) => {
        if (!request) {
            reject(new Error('IndexedDB request missing'));
            return;
        }
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error || new Error('IndexedDB request failed'));
    });
}

function transactionCompletePromise(transaction) {
    return new Promise((resolve, reject) => {
        if (!transaction) {
            reject(new Error('IndexedDB transaction missing'));
            return;
        }
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error || new Error('IndexedDB transaction error'));
        transaction.onabort = () => reject(transaction.error || new Error('IndexedDB transaction aborted'));
    });
}

function syncDeckSelectionHighlight() {
    deckSelectionState.items.forEach((card, idx) => {
        card.classList.toggle('deck-card-selected', idx === deckSelectionState.index);
    });
}

function rebuildDeckSelection() {
    const cards = Array.from(document.querySelectorAll('#decksContainer .deck-card')).filter(card => card.offsetParent !== null);
    deckSelectionState.items = cards;
    if (!cards.length) {
        deckSelectionState.index = -1;
        return;
    }
    if (deckSelectionState.index < 0 || deckSelectionState.index >= cards.length) {
        deckSelectionState.index = 0;
    }
    cards.forEach((card, idx) => {
        card.addEventListener('click', () => {
            deckSelectionState.index = idx;
            syncDeckSelectionHighlight();
        });
    });
    syncDeckSelectionHighlight();
}

function moveDeckSelection(delta) {
    if (!deckSelectionState.items.length) return false;
    const nextIndex = Math.min(Math.max(deckSelectionState.index + delta, 0), deckSelectionState.items.length - 1);
    if (nextIndex === deckSelectionState.index) return false;
    deckSelectionState.index = nextIndex;
    syncDeckSelectionHighlight();
    const card = deckSelectionState.items[deckSelectionState.index];
    if (card) card.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    return true;
}

function getSelectedDeckId() {
    const card = deckSelectionState.items[deckSelectionState.index];
    return card?.dataset?.deckId || null;
}

function openSelectedDeck() {
    const card = deckSelectionState.items[deckSelectionState.index];
    if (!card) return false;
    const trigger = card.querySelector('.deck-card-main-clickable');
    return keyboardManager?.clickIfVisible(trigger) || false;
}

function deleteSelectedDeck() {
    const deckId = getSelectedDeckId();
    if (!deckId) return false;
    deleteDeck(deckId);
    return true;
}

// ============================================
// ANALYTICS MANAGER
// ============================================
// Handles batched analytics event collection and submission

class AnalyticsManager {
    constructor() {
        this.eventQueue = [];
        this.sessionId = this.generateSessionId();
        this.sessionStartTime = new Date();
        this.lastFlushTime = new Date();
        this.flushInterval = 5 * 60 * 1000; // 5 minutes
        this.maxBatchSize = 50; // flush when queue reaches this size
        this.isOnline = navigator.onLine;
        this.currentView = 'dashboard';
        this.viewStartTime = new Date();

        // Start periodic flush
        this.startPeriodicFlush();

        // Listen for online/offline events
        window.addEventListener('online', () => {
            this.isOnline = true;
            this.flush(); // Send queued events when back online
        });
        window.addEventListener('offline', () => {
            this.isOnline = false;
        });

        // Flush on page unload
        window.addEventListener('beforeunload', () => {
            this.flush(true); // synchronous flush
        });

        // Load any persisted events from IndexedDB
        this.loadPersistedQueue();
    }

    generateSessionId() {
        return `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    }

    logEvent(eventType, eventData) {
        const event = {
            type: eventType,
            timestamp: new Date().toISOString(),
            sessionId: this.sessionId,
            ...eventData
        };

        this.eventQueue.push(event);

        // Persist to IndexedDB immediately
        this.persistQueue();

        // Flush if queue is getting large
        if (this.eventQueue.length >= this.maxBatchSize) {
            this.flush();
        }
    }

    // Session tracking
    startSession() {
        this.sessionStartTime = new Date();
        this.logEvent('system_metric', {
            metricType: 'session_start',
            metricValue: 1,
            severity: 'info',
            metadata: {
                platform: window.electronAPI ? 'electron' : 'web',
                screenSize: `${window.screen.width}x${window.screen.height}`,
                userAgent: navigator.userAgent
            }
        });
    }

    endSession(sessionStats) {
        const endTime = new Date();
        const duration = Math.floor((endTime - this.sessionStartTime) / 1000);

        this.logEvent('session', {
            startTime: this.sessionStartTime.toISOString(),
            endTime: endTime.toISOString(),
            duration: duration,
            activeDuration: sessionStats?.activeDuration || duration,
            focusScore: sessionStats?.focusScore || 1.0,
            breakCount: sessionStats?.breakCount || 0,
            cardsStudied: sessionStats?.cardsStudied || 0,
            decksAccessed: sessionStats?.decksAccessed || [],
            accuracyRate: sessionStats?.accuracyRate || 0,
            onlineStatus: this.isOnline,
            deviceInfo: {
                platform: window.electronAPI ? 'electron' : 'web'
            }
        });

        this.flush();
    }

    // UI interaction tracking
    trackViewChange(fromView, toView, metadata = {}) {
        const now = new Date();
        const viewDuration = Math.floor((now - this.viewStartTime) / 1000);

        this.logEvent('ui_interaction', {
            eventType: 'view_change',
            fromView: fromView,
            toView: toView,
            metadata: {
                ...metadata,
                previousDuration: viewDuration
            }
        });

        this.currentView = toView;
        this.viewStartTime = now;
    }

    trackButtonClick(buttonName, metadata = {}) {
        this.logEvent('ui_interaction', {
            eventType: 'button_click',
            fromView: this.currentView,
            metadata: {
                buttonName,
                ...metadata
            }
        });
    }

    trackModalOpen(modalName, metadata = {}) {
        this.logEvent('ui_interaction', {
            eventType: 'modal_open',
            fromView: this.currentView,
            metadata: {
                modalName,
                ...metadata
            }
        });
    }

    trackSettingsChange(settingName, oldValue, newValue) {
        this.logEvent('ui_interaction', {
            eventType: 'settings_change',
            metadata: {
                settingName,
                oldValue,
                newValue
            }
        });
    }

    // Card attempt tracking
    trackCardAttempt(cardId, attemptData) {
        if (!cardId) {
            throw new Error("Card ID missing in analytics pipeline.");
        }
        this.logEvent('card_attempt', {
            cardId,
            ...attemptData
        });
    }

    // Error pattern tracking
    trackErrorPattern(cardId, incorrectAnswer, correctAnswer, errorType, similarityScore) {
        this.logEvent('error_pattern', {
            cardId,
            incorrectAnswer,
            correctAnswer,
            errorType,
            similarityScore,
            metadata: {}
        });
    }

    // Learning path tracking
    trackLearningPath(eventType, data) {
        this.logEvent('learning_path', {
            eventType,
            ...data
        });
    }

    // System metrics tracking
    trackSystemMetric(metricType, metricValue, metadata = {}, severity = 'info') {
        this.logEvent('system_metric', {
            metricType,
            metricValue,
            metadata,
            severity
        });
    }

    // Persist queue to IndexedDB
    async persistQueue() {
        if (!db) return;

        try {
            const transaction = db.transaction(['analyticsQueue'], 'readwrite');
            const store = transaction.objectStore('analyticsQueue');

            // Store the entire queue
            const request = store.put({
                id: 'pending_events',
                events: this.eventQueue,
                lastUpdated: new Date().toISOString()
            });
            await idbRequestToPromise(request);
            await transactionCompletePromise(transaction);
        } catch (error) {
            console.error('Failed to persist analytics queue:', error);
        }
    }

    // Load persisted queue from IndexedDB
    async loadPersistedQueue() {
        if (!db) return;

        try {
            const transaction = db.transaction(['analyticsQueue'], 'readonly');
            const store = transaction.objectStore('analyticsQueue');
            const request = store.get('pending_events');

            request.onsuccess = (event) => {
                const data = event.target.result;
                if (data && data.events && data.events.length > 0) {
                    this.eventQueue = data.events;
                    console.log(`Loaded ${this.eventQueue.length} persisted analytics events`);
                    // Try to flush them
                    if (this.isOnline) {
                        this.flush();
                    }
                }
            };
        } catch (error) {
            console.error('Failed to load persisted analytics queue:', error);
        }
    }

    // Flush events to server
    async flush(sync = false) {
        if (this.eventQueue.length === 0) return;

        if (!this.isOnline) {
            console.log('Offline - analytics events queued for later');
            return;
        }

        const eventsToSend = [...this.eventQueue];
        this.eventQueue = []; // Clear queue optimistically

        const backendUrl = window.BACKEND_URL || 'https://tj7755-lagiote-proxy.hf.space';
        const endpoint = `${backendUrl}/api/analytics/batch`;

        // Get auth token or guest ID
        let headers = {
            'Content-Type': 'application/json'
        };

        const savedSession = localStorage.getItem('auth0Session');
        if (savedSession) {
            try {
                const session = JSON.parse(savedSession);
                headers['Authorization'] = `Bearer ${session.access_token}`;
            } catch (e) {
                console.error('Failed to parse auth session for analytics');
            }
        } else {
            // Guest user
            const guestId = localStorage.getItem('guestId') || `guest_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
            if (!localStorage.getItem('guestId')) {
                localStorage.setItem('guestId', guestId);
            }
            headers['x-guest-id'] = guestId;
        }

        try {
            const payload = JSON.stringify({ events: eventsToSend });
            const fetchOptions = {
                method: 'POST',
                headers: headers,
                body: payload
            };
            if (sync) {
                fetchOptions.keepalive = true;
            }

            const response = await fetch(endpoint, fetchOptions);
            if (!response.ok) {
                console.warn(`Analytics batch failed: ${response.status}`);
                if (!sync && response.status === 401) {
                    console.error("Analytics authentication failed. Logging out.");
                    logout();
                }
                this.eventQueue.unshift(...eventsToSend);
                await this.persistQueue();
            } else {
                await this.clearPersistedQueue();
            }

            this.lastFlushTime = new Date();
        } catch (error) {
            console.error('Failed to send analytics batch:', error);
            // Re-queue events on error
            this.eventQueue.unshift(...eventsToSend);
            await this.persistQueue();
        }
    }

    async clearPersistedQueue() {
        if (!db) return;

        try {
            const transaction = db.transaction(['analyticsQueue'], 'readwrite');
            const store = transaction.objectStore('analyticsQueue');
            const request = store.delete('pending_events');
            await idbRequestToPromise(request);
            await transactionCompletePromise(transaction);
        } catch (error) {
            console.error('Failed to clear persisted analytics queue:', error);
        }
    }

    startPeriodicFlush() {
        setInterval(() => {
            const now = new Date();
            if (now - this.lastFlushTime >= this.flushInterval) {
                this.flush();
            }
        }, 60 * 1000); // Check every minute
    }
}

// Initialize analytics manager globally
let analyticsManager = null;

// FSRS engine helpers
const DEFAULT_FSRS_BASELINE = { latency: 2500, corrections: 1, attempts: 1, fluency: 5 };
let adaptiveBaselineCache = null;
let fsrsEnginePromise = null;
let fsrsRatings = null;

async function getFsrsEngine() {
    if (!fsrsEnginePromise) {
        fsrsEnginePromise = (async () => {
            const { FSRSAlgorithm } = await import('../core/fsrs.js');
            const engine = new FSRSAlgorithm();
            await engine.init();
            if (globalSettings?.adaptiveFsrsBaseline && typeof engine.setAdaptiveBaseline === 'function') {
                engine.setAdaptiveBaseline(globalSettings.adaptiveFsrsBaseline);
            }
            fsrsRatings = engine.getRatings();
            return engine;
        })();
    }
    return fsrsEnginePromise;
}

function getFsrsBaseline() {
    const adaptive = globalSettings.adaptiveFsrsBaseline || adaptiveBaselineCache || {};
    return {
        ...DEFAULT_FSRS_BASELINE,
        ...(globalSettings.userBaseline || {}),
        ...adaptive
    };
}

function serializeFsrsCard(fsrsCard) {
    if (!fsrsCard) return null;
    return {
        ...fsrsCard,
        due: fsrsCard.due instanceof Date ? fsrsCard.due.toISOString() : fsrsCard.due,
        last_review: fsrsCard.last_review instanceof Date ? fsrsCard.last_review.toISOString() : fsrsCard.last_review
    };
}

let cortexEnginePromise = null;

async function getCortexEngine() {
    if (!cortexEnginePromise) {
        cortexEnginePromise = (async () => {
            const module = await import('../core/cortex.js');
            const cortex = module.default || module.Cortex || module;
            if (cortex?.initCortex) await cortex.initCortex({ nowProvider: () => new Date() });
            if (cortex?.setDebug) cortex.setDebug(studyState.cortexDebugEnabled);
            return cortex;
        })();
    }
    return cortexEnginePromise;
}

function createDefaultSessionState() {
    return {
        sessionAccuracyRecent: 0.5,
        sessionMeanLatency: 2500,
        sessionMeanCorrections: 1,
        sessionMeanFluency: 3,
        sessionCardsSeen: 0,
        sessionUniqueCardsSeen: 0,
        recentCards: [],
        recentOutcomes: [],
        cardMetrics: new Map(),
        uniqueCardIds: new Set()
    };
}

async function saveStudySession() {
    if (!studyState.sessionState || !db) return;
    const sessionData = {
        deckId: currentDeckId,
        mode: currentMode,
        timestamp: Date.now(),
        recentCards: studyState.sessionState.recentCards,
        sessionMetrics: {
            sessionAccuracyRecent: studyState.sessionState.sessionAccuracyRecent,
            sessionMeanLatency: studyState.sessionState.sessionMeanLatency,
            sessionCardsSeen: studyState.sessionState.sessionCardsSeen
        }
    };
    try {
        await saveDataToDB('appData', { key: 'lastSession', value: sessionData });
    } catch (e) {
        console.warn('Failed to save session state', e);
    }
}

async function restoreStudySession() {
    if (!db) return false;
    try {
        const record = await getDataFromDB('appData', 'lastSession');
        if (!record || !record.value) return false;
        const data = record.value;
        
        // 6-hour resume window
        if (Date.now() - data.timestamp > 6 * 60 * 60 * 1000) return false;
        
        if (data.deckId === currentDeckId && data.mode === currentMode) {
            const state = ensureSessionState();
            state.recentCards = data.recentCards || [];
            state.sessionAccuracyRecent = data.sessionMetrics?.sessionAccuracyRecent || 0.5;
            state.sessionMeanLatency = data.sessionMetrics?.sessionMeanLatency || 2500;
            state.sessionCardsSeen = data.sessionMetrics?.sessionCardsSeen || 0;
            console.log('Restored previous session context');
            return true;
        }
    } catch (e) {
        console.warn('Failed to restore session', e);
    }
    return false;
}

function resetSessionState() {
    studyState.sessionState = createDefaultSessionState();
    if (db) deleteDataFromDB('appData', 'lastSession').catch(() => {});
}

function ensureSessionState() {
    if (!studyState.sessionState) resetSessionState();
    if (!(studyState.sessionState.cardMetrics instanceof Map)) studyState.sessionState.cardMetrics = new Map();
    if (!(studyState.sessionState.uniqueCardIds instanceof Set)) studyState.sessionState.uniqueCardIds = new Set();
    if (!Array.isArray(studyState.sessionState.recentCards)) studyState.sessionState.recentCards = [];
    if (!Array.isArray(studyState.sessionState.recentOutcomes)) studyState.sessionState.recentOutcomes = [];
    return studyState.sessionState;
}

function updateSessionStateMetrics(cardId, wasCorrect, interactionLog = {}) {
    const state = ensureSessionState();
    state.sessionCardsSeen += 1;
    state.uniqueCardIds.add(cardId);
    state.sessionUniqueCardsSeen = state.uniqueCardIds.size;
    const latency = Number.isFinite(interactionLog.recallLatency) ? interactionLog.recallLatency : state.sessionMeanLatency;
    const corrections = Number.isFinite(interactionLog.totalCorrections) ? interactionLog.totalCorrections : state.sessionMeanCorrections;
    const fluency = Number.isFinite(interactionLog.answerFluency) ? interactionLog.answerFluency : state.sessionMeanFluency;
    state.sessionMeanLatency += (latency - state.sessionMeanLatency) / state.sessionCardsSeen;
    state.sessionMeanCorrections += (corrections - state.sessionMeanCorrections) / state.sessionCardsSeen;
    state.sessionMeanFluency += (fluency - state.sessionMeanFluency) / state.sessionCardsSeen;
    state.recentOutcomes.push(wasCorrect ? 1 : 0);
    if (state.recentOutcomes.length > 20) state.recentOutcomes.shift();
    const accSum = state.recentOutcomes.reduce((sum, v) => sum + v, 0);
    state.sessionAccuracyRecent = state.recentOutcomes.length ? accSum / state.recentOutcomes.length : state.sessionAccuracyRecent;
    state.recentCards.push(cardId);
    if (state.recentCards.length > 5) state.recentCards.shift();
    const metrics = state.cardMetrics.get(cardId) || { timesSeenThisSession: 0 };
    metrics.timesSeenThisSession += 1;
    metrics.lastCorrect = wasCorrect ? 1 : 0;
    metrics.lastLatency = latency;
    metrics.lastCorrections = corrections;
    state.cardMetrics.set(cardId, metrics);
    
    // Auto-save session state
    saveStudySession();
}

function getActiveCard() {
    if (currentMode === 'learn') return studyState.currentCard || null;
    return studyState.roundCards ? studyState.roundCards[studyState.currentCardIndex] : null;
}

function isCardMasteredForLearn(knowledgeState, deck, targetDate) {
    if (!knowledgeState || !knowledgeState.fsrs || !targetDate) return false;

    const retention = typeof calculateRetentionAtDate === 'function'
        ? calculateRetentionAtDate(knowledgeState, targetDate)
        : 0;
    if (typeof retention !== 'number') return false;

    const sigma = typeof knowledgeState.evidenceSigma === 'number' ? knowledgeState.evidenceSigma : 0.3;
    const targetRetention = deck?.settings?.targetRetention ?? 0.9;
    const k = 1.0;
    return (retention - (k * sigma)) >= targetRetention;
}

function logLearnTargetSource(deck, now, targetDate) {
    if (!studyState.cortexDebugEnabled || !deck || !targetDate) return;
    const deckId = deck.id || deck.name || 'unknown';
    const examDate = deck.settings?.examDate ? new Date(deck.settings.examDate) : null;
    if (examDate && !isNaN(examDate.getTime()) && examDate > now) {
        console.log(`[LearnTarget] deck=${deckId} using examDate ${examDate.toISOString()} -> target ${targetDate.toISOString()}`);
        return;
    }

    const horizon = Number(deck.settings?.learnHorizonDays ?? 0);
    if (horizon > 0) {
        console.log(`[LearnTarget] deck=${deckId} using learnHorizonDays=${horizon} -> ${targetDate.toISOString()}`);
    }
}

async function prepareFsrsCard(card) {
    const fsrsEngine = await getFsrsEngine();

    if (card?.fsrs) {
        return fsrsEngine.prepareCard(card.fsrs);
    }

    if (card?.sm2Data) {
        const migrated = (typeof fsrsEngine.convertSm2ToFsrs === 'function')
            ? fsrsEngine.convertSm2ToFsrs(card.sm2Data)
            : null;

        if (migrated) {
            return fsrsEngine.prepareCard(migrated);
        }
    }

    return fsrsEngine.prepareCard(card || null);
}


function mapQualityToFsrsRating(quality, ratingsOverride = null) {
    const ratings = ratingsOverride || fsrsRatings || { Again: 0, Hard: 1, Good: 2, Easy: 3 };
    if (quality <= 1) return ratings.Again;
    if (quality === 2) return ratings.Hard;
    if (quality === 3) return ratings.Good;
    if (quality >= 4) return ratings.Easy;
    return ratings.Good;
}

function createDefaultKnowledgeState(card = {}, overrides = {}) {
    const nowISO = new Date().toISOString();
    const cardIdentifier = overrides.cardID || card.cardID || card.cardId || card.id;
    if (!cardIdentifier) return null;
    const record = {
        userID: overrides.userID || card.userID || 'default_user',
        cardID: cardIdentifier,
        deckID: overrides.deckID || card.deckID || card.deckId || card.deck || currentDeckId || null,
        masteryScore: overrides.masteryScore ?? 0.5,
        consecutiveCorrect: overrides.consecutiveCorrect ?? 0,
        stability: overrides.stability ?? card.stability ?? 1.0,
        lastReviewed: overrides.lastReviewed || card.lastReviewed || nowISO,
        recallHistory: Array.isArray(overrides.recallHistory)
            ? overrides.recallHistory
            : (Array.isArray(card.recallHistory) ? card.recallHistory : []),
        fsrs: overrides.fsrs || card.fsrs || null,
        lastModified: overrides.lastModified || nowISO,
        createdAt: overrides.createdAt || nowISO,
        updatedAt: overrides.updatedAt || nowISO
    };
    return prepareKnowledgeRecord(record);
}

async function applyFsrsReviewUpdate(card, deckId, explicitFeedback, interactionLog = {}, iqs = 0.5, options = {}) {
    const deck = decks[deckId];
    const cardInDeck = deck?.cards?.find(c => c.id === card.id) || card;
    const cortex = await getCortexEngine();
    const fsrsEngine = await getFsrsEngine();
    const resolvedDeckId = deckId || card.deckId || card.deck || cardInDeck?.deckId || deck?.id || null;
    const state = await getOrCreateKnowledgeState('default_user', card.id, resolvedDeckId);
    const questionType = options.questionType || interactionLog?.questionType || 'Flashcard';

    const totalCorrections = (typeof interactionLog?.totalCorrections === 'number')
        ? interactionLog.totalCorrections
        : ((typeof interactionLog?.backspaceCount === 'number' ? interactionLog.backspaceCount : 0)
            + (typeof interactionLog?.deleteCount === 'number' ? interactionLog.deleteCount : 0));

    const metrics = {
        recallLatency: Number.isFinite(interactionLog?.recallLatency) ? interactionLog.recallLatency : null,
        answerFluency: Number.isFinite(interactionLog?.answerFluency) ? interactionLog.answerFluency : null,
        totalCorrections,
        attemptCount: (typeof interactionLog?.attemptCount === 'number' && interactionLog.attemptCount > 0)
            ? interactionLog.attemptCount
            : 1,
        backspaceRate: typeof interactionLog?.backspaceCount === 'number'
            ? Math.min(1, Math.max(0, interactionLog.backspaceCount / Math.max(1, interactionLog?.answerLength || 10)))
            : 0,
        timeToFirstAction: typeof interactionLog?.timeToFirstKeystroke === 'number'
            ? interactionLog.timeToFirstKeystroke
            : (Number.isFinite(interactionLog?.recallLatency) ? interactionLog.recallLatency : null),
        focusLossCount: typeof interactionLog?.focusLossCount === 'number' ? interactionLog.focusLossCount : 0,
        questionType,
        iqs: typeof iqs === 'number' ? iqs : null
    };

    const context = {
        deck,
        sessionState: studyState.sessionState
    };

    let updatedState;
    try {
        if (typeof options.explicitFsrsRating === 'number') {
            updatedState = await cortex.processReviewWithRating(
                card,
                state,
                options.explicitFsrsRating,
                options.nowOverride || null,
                { metrics },
                context
            );
        } else {
            updatedState = await cortex.processReview(card, state, metrics, explicitFeedback, getFsrsBaseline(), context);
        }
    } catch (err) {
        console.error('Cortex review failed', err);
        const fallbackSnapshot = serializeFsrsCard(state.fsrs || state);
        if (cardInDeck) cardInDeck.fsrs = fallbackSnapshot;
        card.fsrs = fallbackSnapshot;
        return {
            fsrsSnapshot: fallbackSnapshot,
            rating: null,
            state,
            reviewTime: new Date(),
            questionType
        };
    }

    const resolvedFsrsState = updatedState?.fsrs || state.fsrs || updatedState;
    const fsrsSnapshot = serializeFsrsCard(resolvedFsrsState);
    const ratingValue = typeof updatedState?.rating === 'number'
        ? updatedState.rating
        : (typeof updatedState?.lastRating === 'number' ? updatedState.lastRating : null);
    const ratings = fsrsEngine.getRatings();
    const ratingLabel = ratingValue !== null
        ? Object.keys(ratings).find(key => ratings[key] === ratingValue) || null
        : null;
    const masteryScoreRaw = fsrsEngine.calculateRetrievability(resolvedFsrsState, new Date());
    const masteryScore = Math.max(0, Math.min(1, masteryScoreRaw));
    const prevConsecutive = Number.isFinite(state?.consecutiveCorrect) ? state.consecutiveCorrect : 0;
    const consecutiveCorrect = ratingLabel === 'Again' ? 0 : prevConsecutive + 1;
    const stability = typeof updatedState?.stability === 'number'
        ? updatedState.stability
        : (resolvedFsrsState?.stability ?? state?.stability ?? 0);
    const userId = 'default_user';
    const knowledgeId = `${userId}:${card.id}`;
    const lastReviewedIso = updatedState?.lastReviewed
        || (resolvedFsrsState?.last_review ? new Date(resolvedFsrsState.last_review).toISOString() : new Date().toISOString());

    const normalizedRecord = prepareKnowledgeRecord({
        ...updatedState,
        id: knowledgeId,
        userID: userId,
        cardID: card.id,
        deckID: resolvedDeckId,
        fsrs: fsrsSnapshot,
        masteryScore,
        consecutiveCorrect,
        stability,
        lastReviewed: lastReviewedIso,
        questionType,
        lastModified: new Date().toISOString()
    });

    let persistedState = null;
    if (normalizedRecord) {
        persistedState = await upsertKnowledgeState(normalizedRecord);
    }
    const finalState = persistedState || normalizedRecord || {
        ...state,
        fsrs: fsrsSnapshot,
        lastReviewed: lastReviewedIso,
        stability,
        masteryScore,
        consecutiveCorrect
    };

    if (!studyState.knowledgeStates) studyState.knowledgeStates = new Map();
    studyState.knowledgeStates.set(card.id, finalState);

    if (cardInDeck) cardInDeck.fsrs = fsrsSnapshot;
    card.fsrs = fsrsSnapshot;

    const reviewTime = new Date(lastReviewedIso);

    return {
        fsrsSnapshot,
        rating: ratingValue,
        state: finalState,
        reviewTime,
        questionType
    };
}


let practiceTestState = {
    deckId: null,
    cards: [],
    currentCardIndex: 0,
    correctCount: 0,
    incorrectCount: 0,
    startTime: null,
    testType: 'flashcard',
    numQuestions: 10
};

window.onload = async function () {
    console.log('Script is starting! Online:', navigator.onLine);

    await initDB();
    console.log('Database initialized.');
    initKeyboardShortcuts();

    // Initialize analytics manager
    analyticsManager = new AnalyticsManager();
    console.log('Analytics manager initialized.');

    // Handle Auth0 callback on web (if code/state in URL)
    if (!window.electronAPI && window.location.search.includes('code=') && window.location.search.includes('state=')) {
        console.log('Detected Auth0 callback in web environment');
        try {
            console.log('Starting Auth0 callback processing...');

            // Load Auth0 SDK if not already loaded
            if (!window.auth0) {
                console.log('Loading Auth0 SDK...');
                await new Promise((resolve, reject) => {
                    const script = document.createElement('script');
                    script.src = 'https://cdn.auth0.com/js/auth0-spa-js/2.4/auth0-spa-js.production.js';
                    script.onload = () => {
                        console.log('Auth0 SDK loaded successfully');
                        resolve();
                    };
                    script.onerror = (err) => {
                        console.error('Failed to load Auth0 SDK:', err);
                        reject(err);
                    };
                    document.head.appendChild(script);
                });
            }

            const auth0Domain = 'dev-tn0gt5rtacrg1qdw.uk.auth0.com';
            const auth0ClientId = 'fFvjuKKem8V4mN6W5eD753fKmCVncT1H';

            console.log('Creating Auth0 client...');
            const auth0Client = await auth0.createAuth0Client({
                domain: auth0Domain,
                clientId: auth0ClientId,
                authorizationParams: {
                    redirect_uri: window.location.origin + '/',
                    audience: 'https://dev-tn0gt5rtacrg1qdw.uk.auth0.com/api/v2/',
                    scope: 'openid profile email'
                }
            });

            console.log('Handling redirect callback...');
            await auth0Client.handleRedirectCallback();

            console.log('Getting user info...');
            const user = await auth0Client.getUser();
            console.log('User:', user);

            console.log('Getting token...');
            const token = await auth0Client.getTokenSilently();
            console.log('Token obtained');

            // Store auth session
            const authResult = {
                user: user,
                access_token: token,
                id_token: token
            };
            localStorage.setItem('auth0Session', JSON.stringify(authResult));
            console.log('Auth session saved to localStorage');

            // Clean up URL
            window.history.replaceState({}, document.title, '/');
            console.log('URL cleaned');

            console.log('Web Auth0 login successful:', user.email);
        } catch (error) {
            console.error('Auth callback error:', error);
            console.error('Error stack:', error.stack);
            alert('Sign in failed: ' + error.message + '. Please check the console for details.');
        }
    }

    const handleOfflineOrGuest = async () => {
        console.log('Entering offline/guest mode.');
        await loadSavedData();
        initializeAccentModules();
        setupEventListeners();
        document.getElementById('loggedInView').classList.remove('hidden');
        transitionView('dashboard', true, null, false);
        updateOnlineStatusUI();
        runSmartCoachChecks('dashboardLoad');
    };

    const isRememberedGuest = localStorage.getItem('guestMode') === 'true';
    const isSessionGuest = sessionStorage.getItem('guestMode') === 'true';

    if (isRememberedGuest || isSessionGuest) {
        console.log('Continuing as guest.');
        await handleOfflineOrGuest();
        return;
    }

    if (!navigator.onLine) {
        console.warn('App is offline. Entering guest mode.');
        await handleOfflineOrGuest();
        return;
    }

    // Check for existing Auth0 session
    const savedSession = localStorage.getItem('auth0Session');
    if (savedSession) {
        try {
            const session = JSON.parse(savedSession);
            console.log('Found saved session, loading user data...');
            await updateUIAfterLogin(session.user);
            // loadUserDataAndSync is called inside updateUIAfterLogin, no need to call again
            return;
        } catch (e) {
            console.error('Invalid session data:', e);
            localStorage.removeItem('auth0Session');
        }
    }

    // No session found, continue as guest
    console.log('No active session. Continuing as guest.');
    await handleOfflineOrGuest();
};

function handleGuestToUserTransition() {
    console.log('handleGuestToUserTransition called; migration not implemented yet.');
}

const DB_NAME = 'LagioteDB';
const DB_VERSION = 12;
const STORE_KEY_REQUIREMENTS = {
    decks: 'id',
    appData: 'key',
    examPlans: 'id',
    analyticsQueue: 'id',
    concepts: 'conceptID',
    userKnowledgeState: 'id'
};

function toIdString(value) {
    if (value === undefined || value === null) return null;
    if (typeof value === 'string') {
        const trimmed = value.trim();
        return trimmed || null;
    }
    if (typeof value === 'number' && Number.isFinite(value)) {
        return String(value);
    }
    return null;
}

function extractIdFromValue(value) {
    if (value === undefined || value === null) return null;
    if (typeof value === 'object') {
        const nested = value.id ?? value._id ?? value.cardID ?? value.cardId ?? value.deckID ?? value.deckId;
        if (nested !== undefined && nested !== null) {
            return extractIdFromValue(nested);
        }
        if (typeof value.toString === 'function') {
            const asString = value.toString();
            if (asString && asString !== '[object Object]') {
                return toIdString(asString);
            }
        }
        return null;
    }
    return toIdString(value);
}

function splitCompositeKnowledgeId(rawId) {
    if (typeof rawId !== 'string' || !rawId.includes(':')) {
        return { userPart: null, cardPart: null };
    }
    const [userPart, ...rest] = rawId.split(':');
    return {
        userPart: userPart || null,
        cardPart: rest.length ? (rest.join(':') || null) : null
    };
}

function deriveUserIdentifier(data, compositeUserPart) {
    const candidates = [
        data?.userID,
        data?.userId,
        data?.user_id,
        data?.user,
        data?.ownerId,
        data?.ownerID,
        data?.owner,
        data?.uid,
        data?.profileId,
        compositeUserPart
    ];
    for (const candidate of candidates) {
        const normalized = extractIdFromValue(candidate);
        if (normalized) return normalized;
    }
    if (data?.user && typeof data.user === 'object') {
        const nested = extractIdFromValue(data.user);
        if (nested) return nested;
    }
    return 'default_user';
}

function deriveCardIdentifier(data, compositeCardPart, rawId) {
    const candidates = [
        data?.cardID,
        data?.cardId,
        data?.card_id,
        data?.cardKey,
        data?.cardUUID,
        data?.cardRef,
        data?.card,
        data?.knowledgeCardId,
        data?.knowledgeCardID,
        data?.knowledgeID,
        data?.knowledgeId,
        compositeCardPart
    ];
    for (const candidate of candidates) {
        const normalized = extractIdFromValue(candidate);
        if (normalized) return normalized;
    }
    if (typeof rawId === 'string' && rawId && !rawId.includes(':')) {
        const fallback = extractIdFromValue(rawId);
        if (fallback) return fallback;
    }
    return null;
}

function deriveDeckIdentifier(data) {
    const candidates = [
        data?.deckID,
        data?.deckId,
        data?.deck_id,
        data?.deck,
        data?.collectionId
    ];
    for (const candidate of candidates) {
        const normalized = extractIdFromValue(candidate);
        if (normalized) return normalized;
    }
    if (data?.deck && typeof data.deck === 'object') {
        return extractIdFromValue(data.deck);
    }
    return null;
}

function ensureIsoString(value, fallback = null) {
    if (!value) return fallback || null;
    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) {
        return fallback || null;
    }
    return date.toISOString();
}

function resolveFsrsSource(data) {
    if (data?.fsrs) return data.fsrs;
    if (typeof data?.state === 'number' || typeof data?.stability === 'number' || typeof data?.difficulty === 'number') {
        const {
            state,
            stability,
            difficulty,
            reps,
            lapses,
            elapsed_days,
            scheduled_days,
            due,
            last_review
        } = data;
        const inferredDue = data?.due || data?.nextReview || data?.nextDue || due;
        const inferredLast = last_review || data?.lastReviewed || data?.lastReview;
        return {
            state,
            stability,
            difficulty,
            reps,
            lapses,
            elapsed_days,
            scheduled_days,
            due: inferredDue,
            last_review: inferredLast
        };
    }
    return null;
}

function normalizeDeckRecord(deck) {
    if (!deck) return null;
    const deckId = extractIdFromValue(deck.id ?? deck.deckId ?? deck.deckID ?? deck._id);
    if (!deckId) return null;
    return { ...deck, id: deckId };
}

function normalizeExamPlanRecord(plan) {
    if (!plan) return null;
    const planId = extractIdFromValue(plan.id ?? plan.planId ?? plan.planID ?? plan._id);
    if (!planId) return null;
    return { ...plan, id: planId };
}

function logSyncSkip(entity, reason, payload) {
    console.warn(`[SYNC] Skipping ${entity}: ${reason}`, payload);
}

function prepareKnowledgeRecord(data) {
    if (!data) return null;
    const nowISO = new Date().toISOString();
    const rawId = data.id || data._id || null;
    const composite = splitCompositeKnowledgeId(rawId);
    const userID = deriveUserIdentifier(data, composite.userPart);
    const cardID = deriveCardIdentifier(data, composite.cardPart, rawId);
    if (!cardID) return null;
    const deckID = deriveDeckIdentifier(data) || data.deckID || data.deckId || data.deck || currentDeckId || null;
    const fsrsSource = resolveFsrsSource(data);
    const fsrsSnapshot = fsrsSource ? serializeFsrsCard(fsrsSource) : null;
    const knowledgeStateUtils = getKnowledgeStateUtils();
    const reviewed = knowledgeStateUtils.isFsrsReviewedState(fsrsSnapshot);
    if (!reviewed && fsrsSnapshot?.last_review) {
        fsrsSnapshot.last_review = null;
    }
    const stabilityFromData = Number.isFinite(Number(data.stability)) ? Number(data.stability) : null;
    const stabilityFromFsrs = Number.isFinite(Number(fsrsSnapshot?.stability)) ? Number(fsrsSnapshot.stability) : null;
    const lastReviewedCandidate = data.lastReviewed || data.last_review || data.lastReview || fsrsSnapshot?.last_review;
    const lastReviewed = reviewed ? ensureIsoString(lastReviewedCandidate, null) : null;
    const lastModified = ensureIsoString(data.lastModified || data.updatedAt, nowISO);
    const createdAt = ensureIsoString(data.createdAt, lastModified) || lastModified;
    const updatedAt = ensureIsoString(data.updatedAt, lastModified) || lastModified;

    return {
        ...data,
        id: `${userID}:${cardID}`,
        userID,
        deckID,
        cardID,
        fsrs: fsrsSnapshot,
        stability: stabilityFromData ?? stabilityFromFsrs ?? 0,
        lastReviewed,
        createdAt,
        updatedAt,
        lastModified
    };
}

function shouldPersistNormalizedState(original, normalized) {
    if (!original || !normalized) return true;
    const utils = getKnowledgeStateUtils();
    const originalFsrs = original.fsrs || {};
    const normalizedFsrs = normalized.fsrs || {};
    const numericFields = ['state', 'stability', 'difficulty', 'reps', 'lapses'];
    for (const field of numericFields) {
        if (utils.coerceFsrsNumber(originalFsrs[field]) !== utils.coerceFsrsNumber(normalizedFsrs[field])) {
            return true;
        }
    }
    const originalLastReviewIso = ensureIsoString(
        originalFsrs.last_review || original.lastReviewed || original.last_review || original.lastReview,
        ''
    );
    const normalizedLastReviewIso = ensureIsoString(
        normalizedFsrs.last_review || normalized.lastReviewed || normalized.last_review || normalized.lastReview,
        ''
    );
    if (originalLastReviewIso !== normalizedLastReviewIso) return true;
    if ((original.lastReviewed || '') !== (normalized.lastReviewed || '')) return true;
    return false;
}

function ensureKnowledgeIndexes(store) {
    if (!store.indexNames.contains('by_user')) store.createIndex('by_user', 'userID', { unique: false });
    if (!store.indexNames.contains('by_card')) store.createIndex('by_card', 'cardID', { unique: false });
    if (!store.indexNames.contains('by_user_card')) store.createIndex('by_user_card', ['userID', 'cardID'], { unique: false });
    if (!store.indexNames.contains('by_user_deck')) store.createIndex('by_user_deck', ['userID', 'deckID'], { unique: false });
    if (!store.indexNames.contains('by_deck')) store.createIndex('by_deck', 'deckID', { unique: false });
    if (!store.indexNames.contains('idx_user_card')) store.createIndex('idx_user_card', ['userID', 'cardID'], { unique: false });
    if (!store.indexNames.contains('idx_user_deck')) store.createIndex('idx_user_deck', ['userID', 'deckID'], { unique: false });
    if (!store.indexNames.contains('idx_deck')) store.createIndex('idx_deck', 'deckID', { unique: false });
    if (!store.indexNames.contains('idx_user')) store.createIndex('idx_user', 'userID', { unique: false });
}

function migrateStores(transaction, oldVersion) {
    if (oldVersion < 1) {
        if (!db.objectStoreNames.contains('decks')) {
            const deckStore = db.createObjectStore('decks', { keyPath: 'id' });
            if (!deckStore.indexNames.contains('by_user')) {
                deckStore.createIndex('by_user', 'userID', { unique: false });
            }
        }
        if (!db.objectStoreNames.contains('analyticsQueue')) {
            db.createObjectStore('analyticsQueue', { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains('appData')) {
            db.createObjectStore('appData', { keyPath: 'key' });
        }
        if (!db.objectStoreNames.contains('concepts')) {
            db.createObjectStore('concepts', { keyPath: 'conceptID' });
        }
        if (!db.objectStoreNames.contains('interactionLogs')) {
            const logStore = db.createObjectStore('interactionLogs', { keyPath: 'id', autoIncrement: true });
            logStore.createIndex('by_cardID', 'cardID', { unique: false });
            logStore.createIndex('by_timestamp', 'timestamp', { unique: false });
        }
        if (!db.objectStoreNames.contains('examPlans')) {
            db.createObjectStore('examPlans', { keyPath: 'id' });
        }
    }

    if (!db.objectStoreNames.contains('cortexTrainingData')) {
        const trainingStore = db.createObjectStore('cortexTrainingData', { keyPath: 'id', autoIncrement: true });
        trainingStore.createIndex('by_timestamp', 'timestamp', { unique: false });
    }

    if (db.objectStoreNames.contains('userKnowledgeState')) {
        const existingStore = transaction.objectStore('userKnowledgeState');
        const needsRebuild = existingStore.keyPath !== 'id';
        if (needsRebuild) {
            const capture = existingStore.getAll();
            capture.onsuccess = () => {
                const existing = Array.isArray(capture.result) ? capture.result : [];
                db.deleteObjectStore('userKnowledgeState');
                const knowledgeStore = db.createObjectStore('userKnowledgeState', { keyPath: 'id' });
                ensureKnowledgeIndexes(knowledgeStore);
                existing.forEach(record => {
                    const normalizedRecord = prepareKnowledgeRecord(record);
                    if (normalizedRecord) {
                        knowledgeStore.put(normalizedRecord);
                    } else {
                        console.warn('[DB] Skipped invalid knowledge record during migration', record);
                    }
                });
            };
            capture.onerror = () => {
                db.deleteObjectStore('userKnowledgeState');
                const knowledgeStore = db.createObjectStore('userKnowledgeState', { keyPath: 'id' });
                ensureKnowledgeIndexes(knowledgeStore);
            };
        } else {
            ensureKnowledgeIndexes(existingStore);
        }
    } else {
        const knowledgeStore = db.createObjectStore('userKnowledgeState', { keyPath: 'id' });
        ensureKnowledgeIndexes(knowledgeStore);
    }

    if (db.objectStoreNames.contains('decks')) {
        const deckStore = transaction.objectStore('decks');
        if (!deckStore.indexNames.contains('by_user')) {
            deckStore.createIndex('by_user', 'userID', { unique: false });
        }
    }
}

function initDB() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION);

        request.onerror = event => reject(event.target.error || new Error('Error opening DB'));

        request.onsuccess = event => {
            db = event.target.result;
            resolve();
        };

        request.onupgradeneeded = event => {
            db = event.target.result;
            migrateStores(event.target.transaction, event.oldVersion);
        };
    });
}
let currentInteractionLog = {};
let interactionSequenceCounter = 0;

function startInteractionLog(cardID) {
    currentInteractionLog = {
        cardID: cardID,
        questionLoadTime: performance.now(),
        firstKeyPressTime: null,
        lastKeyPressTime: null,
        pauseCount: 0,
        maxInterKeyDelay: 0,
        backspaceCount: 0,
        deleteCount: 0,
        attemptCount: (studyState.isRetypingIncorrect ? 2 : 1),
        awayDuration: accumulatedAwayDuration
    };

    accumulatedAwayDuration = 0;
}

function handleInteractionLogging(e) {
    const isTypingKey = e.key.length === 1 || e.key === 'Backspace' || e.key === 'Delete';
    if (!isTypingKey) {
        return;
    }

    const now = performance.now();

    if (currentInteractionLog.firstKeyPressTime === null && e.key.length === 1) {
        currentInteractionLog.firstKeyPressTime = now;
    }

    if (currentInteractionLog.lastKeyPressTime !== null) {
        const interKeyDelay = now - currentInteractionLog.lastKeyPressTime;
        if (interKeyDelay > 1200) {
            currentInteractionLog.pauseCount++;
        }
        if (interKeyDelay > currentInteractionLog.maxInterKeyDelay) {
            currentInteractionLog.maxInterKeyDelay = interKeyDelay;
        }
    }

    currentInteractionLog.lastKeyPressTime = now;

    if (e.key === 'Backspace') {
        currentInteractionLog.backspaceCount++;
    } else if (e.key === 'Delete') {
        currentInteractionLog.deleteCount++;
    }
}

async function logInteraction(logData) {
    if (!db) {
        console.error("Database not available for logging interaction.");
        return;
    }

    if (!logData.cardID) {
        throw new Error("Card ID missing in analytics pipeline.");
    }

    currentInteractionLog = {
        ...currentInteractionLog,
        recallLatency: logData.recallLatency,
        answerFluency: logData.answerFluency,
        totalCorrections: logData.totalCorrections,
        attemptCount: logData.attemptCount,
        wasCorrect: logData.wasCorrect
    };

    const logCaptureTime = performance.now();
    const hasFirstKeypress = currentInteractionLog.firstKeyPressTime !== null && typeof currentInteractionLog.questionLoadTime === 'number';
    const timeToFirstKeystroke = hasFirstKeypress
        ? Math.round(currentInteractionLog.firstKeyPressTime - currentInteractionLog.questionLoadTime)
        : null;
    const typingDuration = currentInteractionLog.firstKeyPressTime !== null
        ? Math.round(logCaptureTime - currentInteractionLog.firstKeyPressTime)
        : 0;
    const typingSpeed = logData.userAnswer && typingDuration > 0
        ? (logData.userAnswer.length / (typingDuration / 1000))
        : 0;
    const confidenceDuration = currentInteractionLog.lastKeyPressTime !== null
        ? Math.round(logCaptureTime - currentInteractionLog.lastKeyPressTime)
        : null;
    const maxInterKeyDelay = currentInteractionLog.maxInterKeyDelay
        ? Math.round(currentInteractionLog.maxInterKeyDelay)
        : 0;
    const sessionId = analyticsManager?.sessionId || null;
    const sessionRelativeTime = analyticsManager?.sessionStartTime
        ? Date.now() - analyticsManager.sessionStartTime.getTime()
        : null;
    interactionSequenceCounter += 1;

    let similarityScore = null;
    let errorType = null;
    if (logData.wasCorrect === false && logData.userAnswer && logData.correctAnswer) {
        const similarity = levenshteinDistance(logData.userAnswer, logData.correctAnswer);
        const maxLen = Math.max(logData.userAnswer.length, logData.correctAnswer.length);
        similarityScore = maxLen > 0 ? 1 - (similarity / maxLen) : 0;

        errorType = 'complete_miss';
        if (similarityScore > 0.8) errorType = 'typo';
        else if (similarityScore > 0.5) errorType = 'partial';
        else if (similarity === 1) errorType = 'substitution';
    }

    try {
        const transaction = db.transaction(['interactionLogs'], 'readwrite');
        const store = transaction.objectStore('interactionLogs');

        const logEntry = {
            userID: 'default_user',
            cardID: logData.cardID,
            timestamp: new Date().toISOString(),
            wasCorrect: logData.wasCorrect,
            latency: logData.recallLatency,
            fluency: logData.answerFluency,
            corrections: logData.totalCorrections,
            attempts: logData.attemptCount,
            userAnswer: logData.userAnswer,
            questionType: logData.questionType || 'Flashcard',
            synced: false,
            questionLoadTime: currentInteractionLog.questionLoadTime || null,
            firstKeyPressTime: currentInteractionLog.firstKeyPressTime,
            lastKeyPressTime: currentInteractionLog.lastKeyPressTime,
            timeToFirstKeystroke,
            typingDuration,
            typingSpeed,
            pauseCount: currentInteractionLog.pauseCount || 0,
            maxInterKeyDelay,
            confidenceDuration,
            backspaceCount: currentInteractionLog.backspaceCount || 0,
            deleteCount: currentInteractionLog.deleteCount || 0,
            awayDuration: currentInteractionLog.awayDuration || 0,
            sessionId,
            sessionRelativeTime,
            sequenceIndex: interactionSequenceCounter,
            errorType,
            similarityScore
        };

        store.add(logEntry);

        transaction.onerror = (event) => {
            console.error("Error saving interaction log to IndexedDB:", event.target.error);
        };
    } catch (error) {
        console.error("Failed to initiate IndexedDB transaction for logging:", error);
    }

    // NEW: Also track via analytics manager with detailed card attempt data
    if (analyticsManager && currentInteractionLog) {
        analyticsManager.trackCardAttempt(logData.cardID, {
            timeToFirstKeystroke,
            typingDuration,
            typingSpeed,
            pauseCount: currentInteractionLog.pauseCount || 0,
            maxInterKeyDelay,
            backspaceCount: currentInteractionLog.backspaceCount || 0,
            deleteCount: currentInteractionLog.deleteCount || 0,
            hintUsed: false, // TODO: Track hint usage
            attemptNumber: logData.attemptCount || 1,
            wasCorrect: logData.wasCorrect,
            partialAnswer: logData.userAnswer,
            questionType: logData.questionType || 'flashcard'
        });

        // Track error pattern if incorrect
        if (errorType !== null && similarityScore !== null) {
            analyticsManager.trackErrorPattern(
                logData.cardID,
                logData.userAnswer,
                logData.correctAnswer,
                errorType,
                similarityScore
            );
        }
    }

    try {
        const backendUrl = 'http://localhost:3000/api/log/interaction';

        const response = await fetch(backendUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                userID: 'default_user',
                cardID: logData.cardID,
                timestamp: new Date().toISOString(),
                wasCorrect: logData.wasCorrect,
                recallLatency: logData.recallLatency,
                answerFluency: logData.answerFluency,
                totalCorrections: logData.totalCorrections,
                attemptCount: logData.attemptCount,
                userAnswer: logData.userAnswer
            }),
            signal: AbortSignal.timeout(5000)
        });

        if (!response.ok) {

            console.warn(`Backend logging failed with status: ${response.status}`);
        } else {

        }
    } catch (error) {

        if (error.name === 'AbortError') {
            console.warn('Backend logging timed out.');
        } else {
            console.warn('Could not send log to backend. User might be offline.', error);
        }
    }
}

let chartInstances = {};

function getCanvasContextById(canvasId) {
    if (!canvasId) return null;
    const el = document.getElementById(canvasId);
    if (!el) return null;
    // Prefer shared helper if provided
    if (typeof getCanvasContext === 'function') {
        return getCanvasContext(el);
    }
    try {
        return el.getContext && el.getContext('2d') || null;
    } catch (e) {
        console.warn('Failed to get canvas context for', canvasId, e);
        return null;
    }
}

function generateDeckStatistics(deckId, allLogs, allKnowledgeStates) {
    console.log('[Test 1] Raw data from DB:', allKnowledgeStates);
    const resultContainer = document.getElementById('deckStatisticsResult');
    const selectedDeck = decks[deckId];

    if (!selectedDeck) {
        resultContainer.innerHTML = '<p>Please select a deck to see a breakdown of its flashcard statistics.</p>';
        return;
    }

    const knowledgeMap = new Map(allKnowledgeStates.map(item => [String(item.cardID), item]));
    const targetDateForRetention = selectedDeck.settings?.examDate
        ? new Date(selectedDeck.settings.examDate)
        : new Date();

    const isSequence = selectedDeck.typeHint === 'Sequence';

    const cardStats = selectedDeck.cards.map(card => {
        const knowledgeState = knowledgeMap.get(String(card.id));
        const retention = calculateRetentionAtDate(knowledgeState, targetDateForRetention);
        if (globalSettings.devMode) {
            console.log("[FSRS insights] retention used:", retention);
        }
        console.log(`[Test 2] Lookup for card ID ${card.id}:`, knowledgeState);
        const logsForCard = allLogs.filter(log => String(log.cardID) === String(card.id));
        const correctLogs = logsForCard.filter(log => log.wasCorrect);
        const totalInteractions = logsForCard.length;
        const correctCount = correctLogs.length;

        let averageIQS = 0;
        if (correctCount > 0) {
            const totalIQS = correctLogs.reduce((sum, log) => {
                const iqs = calculateIQS({
                    recallLatency: log.latency || 2000,
                    answerFluency: log.fluency || 5,
                    totalCorrections: log.corrections || 0,
                    attemptCount: log.attempts || 1
                });
                return sum + iqs;
            }, 0);
            averageIQS = totalIQS / correctCount;
        }

        return {
            question: card.question,
            totalInteractions: totalInteractions,
            correctPercentage: totalInteractions > 0 ? (correctCount / totalInteractions) * 100 : 0,
            avgIQS: averageIQS,
            stability: knowledgeState?.stability,
            retention: retention,
            lastReviewed: knowledgeState?.lastReviewed ? new Date(knowledgeState.lastReviewed).toLocaleDateString() : 'Never',
            order: card.order || Infinity
        };
    });

    if (cardStats.length === 0) {
        resultContainer.innerHTML = '<p>This deck has no cards.</p>';
        return;
    }

    const cardsForStats = isSequence
        ? [...cardStats].sort((a, b) => a.order - b.order)
        : cardStats;

    let tableHTML = `
                <table class="stats-table">
                    <thead>
                        <tr>
                            ${isSequence ? '<th>Order</th>' : ''}
                            <th>Question</th>
                            <th>Correct %</th>
                            <th>Avg. IQS</th>
                            <th>Stability</th>
                            <th>Retention</th>
                            <th>Last Reviewed</th>
                            <th>Interactions</th>
                        </tr>
                    </thead>
                    <tbody>
            `;

    cardsForStats.forEach(stat => {
        const stabilityText = typeof stat.stability === 'number' ? stat.stability.toFixed(2) : 'N/A';
        const retentionText = typeof stat.retention === 'number'
            ? `${(stat.retention * 100).toFixed(1)}%`
            : 'N/A';

        tableHTML += `
                    <tr>
                        ${isSequence ? `<td>${escapeHtml(String(stat.order))}</td>` : ''}
                        <td title="${escapeHtml(String(stat.question))}">${escapeHtml(String(stat.question))}</td>
                        <td>${escapeHtml(String(stat.correctPercentage.toFixed(1)))}%</td>
                        <td>${escapeHtml(String((stat.avgIQS).toFixed(2)))}</td>
                        <td>${escapeHtml(String(stabilityText))}</td>
                        <td>${escapeHtml(String(retentionText))}</td>
                        <td>${escapeHtml(String(stat.lastReviewed))}</td>
                        <td>${escapeHtml(String(stat.totalInteractions))}</td>
                    </tr>
                `;
    });

    tableHTML += '</tbody></table>';
    resultContainer.innerHTML = tableHTML;
}

function renderHistograms(logs) {
    const latencies = logs.map(log => log.latency).filter(l => l !== null);
    const fluencies = logs.map(log => log.fluency).filter(f => f > 0);
    const corrections = logs.map(log => log.corrections);

    createBarChart('latencyHistogram', 'Recall Latency', latencies, 'rgba(102, 126, 234, 0.6)');
    createBarChart('fluencyHistogram', 'Answer Fluency', fluencies, 'rgba(56, 178, 172, 0.6)');
    createBarChart('correctionsHistogram', 'Corrections Count', corrections, 'rgba(229, 62, 62, 0.6)');
}

function createBarChart(canvasId, label, data, color) {
    if (chartInstances[canvasId]) chartInstances[canvasId].destroy();

    const ctx = getCanvasContextById(canvasId);
    if (!ctx) {
        if (chartInstances[canvasId]) {
            try { chartInstances[canvasId].destroy(); } catch (e) {}
            delete chartInstances[canvasId];
        }
        console.warn('createBarChart: canvas not found', canvasId);
        return;
    }

    const valueCounts = data.reduce((acc, value) => {
        acc[value] = (acc[value] || 0) + 1;
        return acc;
    }, {});
    const labels = Object.keys(valueCounts).sort((a, b) => a - b);
    const chartData = labels.map(key => valueCounts[key]);

    chartInstances[canvasId] = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: labels,
            datasets: [{
                label: `Frequency of ${label}`,
                data: chartData,
                backgroundColor: color,
                borderColor: color.replace('0.6', '1'),
                borderWidth: 1
            }]
        },
        options: { scales: { y: { beginAtZero: true } } }
    });
}

function renderLatencyScatterPlot(logs) {
    const canvasId = 'latencyScatterPlot';
    if (chartInstances[canvasId]) chartInstances[canvasId].destroy();

    const data = logs.filter(log => log.latency !== null && log.wasCorrect !== undefined).map(log => ({
        x: log.latency,
        y: log.wasCorrect ? 1 + (Math.random() * 0.1 - 0.05) : 0 + (Math.random() * 0.1 - 0.05)
    }));

    if (data.length === 0) {
        const ctx = getCanvasContextById(canvasId);
        if (!ctx) {
            console.warn('renderLatencyScatterPlot: canvas not found', canvasId);
            return;
        }
        chartInstances[canvasId] = new Chart(ctx, {
            type: 'scatter',
            data: { datasets: [] },
            options: {
                plugins: {
                    legend: { display: false },
                    tooltip: { enabled: false }
                },
                scales: {
                    x: { title: { display: true, text: 'Recall Latency (ms)' } },
                    y: {
                        title: { display: true, text: 'Outcome' },
                        ticks: { callback: (value) => value === 1 ? 'Correct' : (value === 0 ? 'Incorrect' : '') },
                        min: -0.2, max: 1.2
                    }
                }
            }
        });
        const canvasParent = document.getElementById(canvasId)?.parentNode;
        if (canvasParent) {
            const p = document.createElement('p');
            p.style.cssText = 'text-align: center; color: var(--secondary-text); margin-top: 10px;';
            p.textContent = 'No data available for scatter plot.';
            canvasParent.appendChild(p);
        }
        return;
    }

    const ctx = getCanvasContextById(canvasId);
    if (!ctx) {
        if (chartInstances[canvasId]) {
            try { chartInstances[canvasId].destroy(); } catch (e) {}
            delete chartInstances[canvasId];
        }
        console.warn('renderLatencyScatterPlot: canvas not found', canvasId);
        return;
    }
    chartInstances[canvasId] = new Chart(ctx, {
        type: 'scatter',
        data: {
            datasets: [{
                label: 'User Interaction',
                data: data,
                backgroundColor: (context) => {
                    if (!context.raw) return 'rgba(0,0,0,0)';

                    const outcome = typeof context.raw.y !== 'undefined' ? context.raw.y : 0;
                    return outcome > 0.5 ? 'rgba(56, 178, 172, 0.7)' : 'rgba(229, 62, 62, 0.7)';
                },
            }]
        },
        options: {
            scales: {
                x: { title: { display: true, text: 'Recall Latency (ms)' } },
                y: {
                    title: { display: true, text: 'Outcome' },
                    ticks: {
                        callback: (value) => value === 1 ? 'Correct' : (value === 0 ? 'Incorrect' : '')
                    },
                    min: -0.2, max: 1.2
                }
            },
            plugins: {
                tooltip: {
                    callbacks: {
                        label: function (context) {
                            let label = context.dataset.label || '';
                            if (label) {
                                label += ': ';
                            }
                            if (context.raw.y > 0.5) {
                                label += 'Correct';
                            } else {
                                label += 'Incorrect';
                            }
                            label += ` (Latency: ${context.raw.x}ms)`;
                            return label;
                        }
                    }
                }
            }
        }
    });
}

function renderInteractionsTimeSeries(logs) {
    const canvasId = 'interactionsTimeSeries';
    if (chartInstances[canvasId]) chartInstances[canvasId].destroy();

    const interactionsByDay = logs.reduce((acc, log) => {
        const day = new Date(log.timestamp).toISOString().split('T')[0];
        acc[day] = (acc[day] || 0) + 1;
        return acc;
    }, {});

    const sortedDays = Object.keys(interactionsByDay).sort();
    const chartLabels = sortedDays;
    const chartData = sortedDays.map(day => interactionsByDay[day]);

    const ctx = getCanvasContextById(canvasId);
    if (!ctx) {
        if (chartInstances[canvasId]) {
            try { chartInstances[canvasId].destroy(); } catch (e) {}
            delete chartInstances[canvasId];
        }
        console.warn('renderInteractionsTimeSeries: canvas not found', canvasId);
        return;
    }
    chartInstances[canvasId] = new Chart(ctx, {
        type: 'line',
        data: {
            labels: chartLabels,
            datasets: [{
                label: 'Number of Interactions',
                data: chartData,
                fill: false,
                borderColor: 'rgba(102, 126, 234, 1)',
                tension: 0.1
            }]
        }
    });
}

function setupErrorAnalysisAndDeckStats(allLogs, allKnowledgeStates) {
    const deckSelect = document.getElementById('errorDeckSelect');
    const cardSelect = document.getElementById('errorCardSelect');

    deckSelect.innerHTML = '<option value="">-- Select a Deck --</option>';
    Object.values(decks).forEach(deck => {
        const option = document.createElement('option');
        option.value = deck.id;
        option.textContent = deck.name;
        deckSelect.appendChild(option);
    });

    deckSelect.onchange = () => {
        const deckId = deckSelect.value;
        const selectedDeck = decks[deckId];

        cardSelect.innerHTML = '<option value="">-- Select a Card --</option>';
        if (deckId && selectedDeck) {
            const cardsToDisplay = selectedDeck.typeHint === 'Sequence'
                ? [...selectedDeck.cards].sort((a, b) => a.order - b.order)
                : selectedDeck.cards;

            cardsToDisplay.forEach(card => {
                const option = document.createElement('option');
                option.value = card.id;
                const orderPrefix = selectedDeck.typeHint === 'Sequence' ? `[#${card.order}] ` : '';
                option.textContent = orderPrefix + card.question.substring(0, 50) + '...';
                cardSelect.appendChild(option);
            });
        }
        generateErrorAnalysisReport(allLogs, null);

        generateDeckStatistics(deckId, allLogs, allKnowledgeStates);
    };

    cardSelect.onchange = () => {
        generateErrorAnalysisReport(allLogs, cardSelect.value);
    };

    generateDeckStatistics(null, allLogs, allKnowledgeStates);
}

function generateErrorAnalysisReport(logs, cardId) {
    const resultContainer = document.getElementById('errorAnalysisResult');
    if (!cardId) {
        resultContainer.innerHTML = '<p>Please select a card to see a breakdown of common incorrect answers.</p>';
        return;
    }

    const incorrectAnswers = logs
        .filter(log => log.cardID == cardId && !log.wasCorrect)
        .map(log => log.userAnswer.trim().toLowerCase());

    if (incorrectAnswers.length === 0) {
        resultContainer.innerHTML = '<p>No incorrect answers have been logged for this card yet.</p>';
        return;
    }

    const answerCounts = incorrectAnswers.reduce((acc, answer) => {
        acc[answer] = (acc[answer] || 0) + 1;
        return acc;
    }, {});

    const sortedAnswers = Object.entries(answerCounts).sort(([, a], [, b]) => b - a);

    let tableHTML = `
                <table style="width: 100%; border-collapse: collapse;">
                    <thead>
                        <tr>
                            <th style="text-align: left; padding: 8px; border-bottom: 1px solid var(--border-color);">Incorrect Answer</th>
                            <th style="text-align: right; padding: 8px; border-bottom: 1px solid var(--border-color);">Frequency</th>
                        </tr>
                    </thead>
                    <tbody>
            `;
    sortedAnswers.forEach(([answer, count]) => {
        tableHTML += `
                    <tr>
                        <td style="padding: 8px; border-bottom: 1px solid var(--border-color);">${answer}</td>
                        <td style="text-align: right; padding: 8px; border-bottom: 1px solid var(--border-color);">${count}</td>
                    </tr>
                `;
    });
    tableHTML += '</tbody></table>';

    resultContainer.innerHTML = tableHTML;
}

const normalizeKey = (key) => Array.isArray(key) ? key.join('::') : key;
const resolveKnowledgeKey = (key) => {
    if (typeof key === 'string') return key;
    if (Array.isArray(key)) {
        const [userID, cardID] = key;
        if (userID && cardID) return `${userID}:${cardID}`;
    }
    if (key && typeof key === 'object' && (key.userID || key.userId) && (key.cardID || key.cardId)) {
        const userID = key.userID || key.userId;
        const cardID = key.cardID || key.cardId;
        return `${userID}:${cardID}`;
    }
    return null;
};

async function saveDataToDB(storeName, data) {
    const payload = storeName === 'userKnowledgeState' ? prepareKnowledgeRecord(data) : data;
    if (!payload) {
        console.warn(`[DB] Skipping invalid payload for ${storeName}`, data);
        return;
    }
    const requiredKey = STORE_KEY_REQUIREMENTS[storeName];
    if (requiredKey && (payload[requiredKey] === undefined || payload[requiredKey] === null || payload[requiredKey] === '')) {
        console.warn(`[DB] Skipping ${storeName} write with missing ${requiredKey}`, payload);
        return;
    }
    return new Promise((resolve, reject) => {
        try {
            const transaction = db.transaction([storeName], 'readwrite');
            const store = transaction.objectStore(storeName);
            store.put(payload);
            transaction.oncomplete = () => resolve();
            transaction.onerror = event => reject("Error saving data: " + event.target.error);
        } catch (error) {
            reject(error);
        }
    });
}

async function getDataFromDB(storeName, key) {
    return new Promise((resolve, reject) => {
        try {
            const transaction = db.transaction([storeName], 'readonly');
            const store = transaction.objectStore(storeName);
            if (storeName === 'userKnowledgeState') {
                const resolvedKey = resolveKnowledgeKey(key);
                if (Array.isArray(key) && store.indexNames.contains('by_user_card')) {
                    const request = store.index('by_user_card').get([key[0], key[1]]);
                    request.onsuccess = event => resolve(event.target.result);
                    request.onerror = event => reject("Error getting data: " + event.target.error);
                    return;
                }
                if (Array.isArray(key) && store.indexNames.contains('idx_user_card')) {
                    const request = store.index('idx_user_card').get([key[0], key[1]]);
                    request.onsuccess = event => resolve(event.target.result);
                    request.onerror = event => reject("Error getting data: " + event.target.error);
                    return;
                }
                if (resolvedKey) {
                    const request = store.get(resolvedKey);
                    request.onsuccess = event => resolve(event.target.result);
                    request.onerror = event => reject("Error getting data: " + event.target.error);
                    return;
                }
            }
            const request = store.get(normalizeKey(key));
            request.onsuccess = event => resolve(event.target.result);
            request.onerror = event => reject("Error getting data: " + event.target.error);
        } catch (error) {
            reject(error);
        }
    });
}

async function getAllDataFromDB(storeName) {
    return new Promise((resolve, reject) => {
        const transaction = db.transaction([storeName], 'readonly');
        const store = transaction.objectStore(storeName);
        const request = store.getAll();
        request.onsuccess = event => resolve(event.target.result);
        request.onerror = event => reject("Error getting all data: " + event.target.error);
    });
}

async function deleteDataFromDB(storeName, key) {
    return new Promise((resolve, reject) => {
        const transaction = db.transaction([storeName], 'readwrite');
        const store = transaction.objectStore(storeName);
        const targetKey = storeName === 'userKnowledgeState'
            ? (resolveKnowledgeKey(key) || normalizeKey(key))
            : normalizeKey(key);
        const request = store.delete(targetKey);
        request.onsuccess = () => resolve();
        request.onerror = (event) => reject("Error deleting data: " + event.target.error);
    });
}

async function clearStoreInDB(storeName) {
    return new Promise((resolve, reject) => {
        const transaction = db.transaction([storeName], 'readwrite');
        const store = transaction.objectStore(storeName);
        const request = store.clear();
        request.onsuccess = () => resolve();
        request.onerror = event => reject("Error clearing store: " + event.target.error);
    });
}

async function upsertKnowledgeState(record) {
    const normalized = prepareKnowledgeRecord(record);
    if (!normalized) {
        console.warn('[DB] Skipping invalid knowledge state payload', record);
        return null;
    }
    await saveDataToDB('userKnowledgeState', normalized);
    return normalized;
}

async function getOrCreateKnowledgeState(userId, cardId, deckId) {
    const user = userId || 'default_user';
    if (!studyState.knowledgeStates) studyState.knowledgeStates = new Map();
    const cached = studyState.knowledgeStates.get(cardId);
    const fsrsEngine = await getFsrsEngine();
    const normalizeFsrs = raw => serializeFsrsCard(fsrsEngine.prepareCard(raw));

    let state = cached || await getDataFromDB('userKnowledgeState', `${user}:${cardId}`);
    if (!state && db?.objectStoreNames?.contains('userKnowledgeState')) {
        try {
            const store = db.transaction(['userKnowledgeState'], 'readonly').objectStore('userKnowledgeState');
            if (store.indexNames.contains('by_user_card')) {
                state = await new Promise(resolve => {
                    const request = store.index('by_user_card').get([user, cardId]);
                    request.onsuccess = event => resolve(event.target.result);
                    request.onerror = () => resolve(null);
                });
            }
        } catch (err) {
            console.warn('Legacy knowledge lookup failed', err);
        }
    }
    if (state) {
        const fsrsSnapshot = state.fsrs ? normalizeFsrs(state.fsrs) : normalizeFsrs(state);
        state = {
            ...state,
            id: `${user}:${cardId}`,
            userID: user,
            cardID: cardId,
            deckID: deckId || state.deckID || currentDeckId || null,
            fsrs: fsrsSnapshot,
            stability: typeof state.stability === 'number' ? state.stability : fsrsSnapshot.stability || 0,
            lastReviewed: state.lastReviewed || fsrsSnapshot.last_review || null,
            lastModified: state.lastModified || new Date().toISOString()
        };
        studyState.knowledgeStates.set(cardId, state);
        await upsertKnowledgeState(state);
        return state;
    }

    const prepared = fsrsEngine.prepareCard(null);
    const fsrsSnapshot = serializeFsrsCard(prepared);
    const nowIso = new Date().toISOString();
    state = {
        id: `${user}:${cardId}`,
        userID: user,
        cardID: cardId,
        deckID: deckId || currentDeckId || null,
        fsrs: fsrsSnapshot,
        stability: typeof prepared.stability === 'number' ? prepared.stability : 0,
        lastReviewed: null,
        lastModified: nowIso,
        recallHistory: []
    };
    studyState.knowledgeStates.set(cardId, state);
    await upsertKnowledgeState(state);
    return state;
}

function setupEventListeners() {

    // Authentication event listeners will be handled by Auth0 (to be implemented)
    const authSignupBtn = document.getElementById('authSignupBtn');
    const authLoginBtn = document.getElementById('authLoginBtn');

    authSignupBtn?.addEventListener('click', async () => {
        console.log('Opening Auth0 signup window...');

        if (window.electronAPI && window.electronAPI.openLoginWindow) {
            try {
                // Auth0 login window handles both signup and login
                const authResult = await window.electronAPI.openLoginWindow();
                if (authResult && authResult.user) {
                    console.log('Signup/Login successful:', authResult.user);
                    // Save session
                    localStorage.setItem('auth0Session', JSON.stringify(authResult));
                    // Update UI - this will transition to dashboard
                    await updateUIAfterLogin(authResult.user);

                }
            } catch (error) {
                console.error('Signup error:', error);
                const errorMessage = error.message || JSON.stringify(error);
                showToast(`Signup failed: ${errorMessage}`, 'error');
            }
        } else {
            // Web environment
            try {
                const auth0Domain = document.querySelector('meta[name="auth0-domain"]')?.content || 'dev-tn0gt5rtacrg1qdw.uk.auth0.com';
                const auth0ClientId = document.querySelector('meta[name="auth0-client-id"]')?.content || 'fFvjuKKem8V4mN6W5eD753fKmCVncT1H';

                if (!window.auth0) {
                    showToast('Loading authentication...', 'info');
                    await loadCDNScript('https://cdn.auth0.com/js/auth0-spa-js/2.4/auth0-spa-js.production.js');
                }

                const auth0Client = await auth0.createAuth0Client({
                    domain: auth0Domain,
                    clientId: auth0ClientId,
                    authorizationParams: {
                        redirect_uri: window.location.origin + '/',
                        audience: 'https://dev-tn0gt5rtacrg1qdw.uk.auth0.com/api/v2/',
                        scope: 'openid profile email',
                        screen_hint: 'signup'
                    }
                });

                await auth0Client.loginWithRedirect();
            } catch (error) {
                console.error('Web auth error:', error);
                showToast('Authentication failed. Please try again.', 'error');
            }
        }
    });
    authLoginBtn?.addEventListener('click', async () => {
        console.log('Opening Auth0 login window...');

        if (window.electronAPI && window.electronAPI.openLoginWindow) {
            try {
                const authResult = await window.electronAPI.openLoginWindow();
                if (authResult && authResult.user) {
                    console.log('Login successful:', authResult.user);
                    // Save session
                    localStorage.setItem('auth0Session', JSON.stringify(authResult));
                    // Update UI - this will transition to dashboard
                    await updateUIAfterLogin(authResult.user);

                }
            } catch (error) {
                console.error('Login error:', error);
                const errorMessage = error.message || JSON.stringify(error);
                showToast(`Login failed: ${errorMessage}`, 'error');
            }
        } else {
            // Web environment
            try {
                const auth0Domain = document.querySelector('meta[name="auth0-domain"]')?.content || 'dev-tn0gt5rtacrg1qdw.uk.auth0.com';
                const auth0ClientId = document.querySelector('meta[name="auth0-client-id"]')?.content || 'fFvjuKKem8V4mN6W5eD753fKmCVncT1H';

                if (!window.auth0) {
                    showToast('Loading authentication...', 'info');
                    await loadCDNScript('https://cdn.auth0.com/js/auth0-spa-js/2.4/auth0-spa-js.production.js');
                }

                const auth0Client = await auth0.createAuth0Client({
                    domain: auth0Domain,
                    clientId: auth0ClientId,
                    authorizationParams: {
                        redirect_uri: window.location.origin + '/',
                        audience: 'https://dev-tn0gt5rtacrg1qdw.uk.auth0.com/api/v2/',
                        scope: 'openid profile email'
                    }
                });

                await auth0Client.loginWithRedirect();
            } catch (error) {
                console.error('Web auth error:', error);
                showToast('Authentication failed. Please try again.', 'error');
            }
        }
    });
    // Guest Signup Button in Header
    document.getElementById('guestSignupBtn')?.addEventListener('click', async () => {
        console.log('Opening Auth0 signup window from header...');

        // Check if we're in Electron or web
        if (window.electronAPI && window.electronAPI.openLoginWindow) {
            // Electron environment - use Electron auth window
            try {
                const authResult = await window.electronAPI.openLoginWindow();
                if (authResult && authResult.user) {
                    console.log('Signup/Login successful:', authResult.user);
                    localStorage.setItem('auth0Session', JSON.stringify(authResult));
                    // Update UI - this will transition to dashboard
                    await updateUIAfterLogin(authResult.user);

                }
            } catch (error) {
                console.error('Signup error:', error);
                const errorMessage = error.message || JSON.stringify(error);
                showToast(`Signup failed: ${errorMessage}`, 'error');
            }
        } else {
            // Web environment - use Auth0 web SDK
            try {
                // Load Auth0 config from environment or meta tags
                const auth0Domain = document.querySelector('meta[name="auth0-domain"]')?.content || 'dev-tn0gt5rtacrg1qdw.uk.auth0.com';
                const auth0ClientId = document.querySelector('meta[name="auth0-client-id"]')?.content || 'fFvjuKKem8V4mN6W5eD753fKmCVncT1H';

                if (!window.auth0) {
                    showToast('Loading authentication...', 'info');
                    // Dynamically load Auth0 SDK
                    await new Promise((resolve, reject) => {
                        const script = document.createElement('script');
                        script.src = 'https://cdn.auth0.com/js/auth0-spa-js/2.4/auth0-spa-js.production.js';
                        script.onload = resolve;
                        script.onerror = reject;
                        document.head.appendChild(script);
                    });
                }
                const auth0Client = await auth0.createAuth0Client({
                    domain: auth0Domain,
                    clientId: auth0ClientId,
                    authorizationParams: {
                        redirect_uri: window.location.origin + '/',
                        audience: 'https://dev-tn0gt5rtacrg1qdw.uk.auth0.com/api/v2/',
                        scope: 'openid profile email'
                    }
                });

                await auth0Client.loginWithRedirect();
            } catch (error) {
                console.error('Web auth error:', error);
                showToast('Authentication failed. Please try again.', 'error');
            }
        }
    });

    document.getElementById('continueAsGuestBtn')?.addEventListener('click', () => {

        const rememberGuest = document.getElementById('rememberGuestCheckbox').checked;
        if (rememberGuest) {
            localStorage.setItem('guestMode', 'true');
        } else {

            sessionStorage.setItem('guestMode', 'true');
        }

        transitionView('dashboard', false, null, false);
        const loggedInEl = document.getElementById('loggedInView');
        if (loggedInEl) {
            loggedInEl.classList.remove('hidden');
        }

        const bannerEl = document.getElementById('guestPromptBanner');
        if (bannerEl) {
            bannerEl.classList.remove('hidden');
        } else {
            const banner = document.createElement('div');
            banner.id = 'guestPromptBanner';
            banner.style.cssText = `
                    background: var(--card-bg);
                    border: 2px solid var(--border-color);
                    border-radius: 12px;
                    padding: 20px;
                    margin: 20px auto;
                    max-width: 800px;
                    text-align: center;
                    color: var(--text-color);
                `;
            banner.innerHTML = `
                    <strong>Welcome, Guest!</strong><br>
                    Your progress is stored ${rememberGuest ? 'on this device' : 'until you close the app'}. Sign up to sync across devices.
                `;
            document.body.appendChild(banner);
        }

        loadCookieConsent();
    });

    setupSearch();
    setupKeyboardControls();
    function safeAddListener(id, event, handler) {
        const el = document.getElementById(id);
        if (el) el.addEventListener(event, handler);
    }

    safeAddListener('deckDetailTestBtn', 'click', () => openPracticeTestModal(currentViewingDeckId));
    safeAddListener('deckDetailEditBtn', 'click', () => editDeck(currentViewingDeckId));
    safeAddListener('deckDetailDeleteBtn', 'click', () => deleteDeck(currentViewingDeckId));
    safeAddListener('deckDetailSettingsBtn', 'click', () => openDeckSettingsModal(currentViewingDeckId));
    safeAddListener('headerBackBtn', 'click', goBack);
    const nameForm = document.getElementById('nameForm');
    if (nameForm) {
        nameForm.addEventListener('submit', saveName);
    }
    safeAddListener('darkModeToggle', 'change', toggleDarkMode);
    safeAddListener('deckDetailResetBtn', 'click', () => resetSpecificDeck(currentViewingDeckId));
    safeAddListener('continueBtn', 'click', continueStudy);
    safeAddListener('instructionsBtn', 'click', () => {
        const m = document.getElementById('instructionsModal'); if (m) m.classList.add('show');
    });
    safeAddListener('switchStudyModeBtn', 'click', toggleStudyMode);
    safeAddListener('editStudyCardBtn', 'click', editCurrentStudyCard);
    const writeInputEl = document.getElementById('writeAnswerInput');
    if (writeInputEl) writeInputEl.addEventListener('keydown', (e) => {
        if ((e.key === 'Enter' && !e.shiftKey) || e.key === 'ArrowUp') {
            e.preventDefault();
            e.stopPropagation();
            const writeInput = document.getElementById('writeAnswerInput');
            const checkAnswerBtnVisible = !document.getElementById('checkAnswerBtn').classList.contains('hidden');
            if (!checkAnswerBtnVisible || writeInput.disabled) return;
            if (writeInput.value.trim() === '') {
                showToast('Please enter an answer', 'error');
                return;
            }
            autoCheckAnswer();
        }
    });
    document.addEventListener('visibilitychange', () => {
        if (document.hidden) {
            focusLossStartTime = Date.now();
        } else {
            if (focusLossStartTime) {
                const awayDuration = Date.now() - focusLossStartTime;
                accumulatedAwayDuration += awayDuration;
                focusLossStartTime = null;

                if (activeView === 'studyMode' && !document.getElementById('cardView').classList.contains('hidden') && awayDuration > 30000) {
                    const modal = document.getElementById('welcomeBackModal');
                    modal.classList.add('show');

                    document.getElementById('resumeStudyBtn').onclick = () => modal.classList.remove('show');
                }
            }
        }
    });
    document.getElementById('flashcardsContainer')?.addEventListener('keydown', async function (event) {
        if (event.key === 'Tab' && !event.shiftKey) {
            const activeElement = document.activeElement;
            if (activeElement.classList.contains('question-input') || activeElement.classList.contains('solution-input')) {
                // Check if we should trigger autocomplete
                const cardRow = activeElement.closest('.flashcard-editor-row');
                const fieldType = activeElement.classList.contains('question-input') ? 'question' : 'answer';
                const currentText = activeElement.value.trim();

                // Only trigger autocomplete if there's some text and we're not at the end of the last card
                if (currentText.length > 0 && !event.ctrlKey && !event.metaKey) {
                    event.preventDefault();
                    await triggerGeminiAutocomplete(activeElement, cardRow, fieldType);
                    return;
                }

                // Original behavior: if on solution-input of last card, add new card
                if (activeElement.classList.contains('solution-input')) {
                    if (cardRow === this.lastElementChild) {
                        event.preventDefault();
                        editorAddNewCard();
                    }
                }
            }
        }
    });
    document.addEventListener('keydown', handlePracticeTestShortcut);

    function handlePracticeTestShortcut(event) {
        if (event.key !== 'Enter' && event.key !== 'ArrowUp') return;
        const practiceTestView = document.getElementById('practiceTestView');
        if (!practiceTestView || practiceTestView.classList.contains('hidden')) return;

        const nextBtn = document.getElementById('testNextBtn');
        if (nextBtn && !nextBtn.classList.contains('hidden')) {
            event.preventDefault();
            nextBtn.click();
            return;
        }

        const checkBtn = document.getElementById('testCheckAnswerBtn');
        if (checkBtn && !checkBtn.classList.contains('hidden')) {
            const answerInput = document.getElementById('testAnswerInput');
            if (event.target === answerInput) {
                event.preventDefault();
            }
            checkBtn.click();
            return;
        }

        const showAnswerBtn = document.getElementById('testShowAnswerBtn');
        if (showAnswerBtn && !showAnswerBtn.classList.contains('hidden')) {
            event.preventDefault();
            showAnswerBtn.click();
        }
    }

    bind('testInstructionsBtn', 'click', () => {
        showToast("Practice test instructions would appear here", "info");
    });

    ['deckCategory'].forEach(id => {
        bind(id, 'change', handleCategoryChange);
    });

    bind('importFileInput', 'change', function () {
        const fileNameDisplay = document.getElementById('fileNameDisplay');
        if (this.files && this.files.length > 0) {
            fileNameDisplay.textContent = this.files[0].name;
        } else {
            if (fileNameDisplay) fileNameDisplay.textContent = 'No file chosen';
        }
    });
    bind('writeAnswerInput', 'keydown', handleInteractionLogging);

    window.addEventListener('online', () => {
        isOnline = true;
        updateOnlineStatusUI();
        showToast('You are back online! Smart features are enabled.', 'success');
    });

    window.addEventListener('offline', () => {
        isOnline = false;
        updateOnlineStatusUI();
        showToast('You are offline. AI features will be disabled.', 'error');
    });

    const dropZone = document.getElementById('file-drop-zone');
    const fileInput = document.getElementById('file-input');
    const selectFileBtn = document.getElementById('select-file-btn');

    if (dropZone) {
        dropZone.addEventListener('dragover', (e) => { e.preventDefault(); dropZone.classList.add('dragover'); });
        dropZone.addEventListener('dragleave', () => dropZone.classList.remove('dragover'));
        dropZone.addEventListener('drop', (e) => {
            e.preventDefault();
            dropZone.classList.remove('dragover');
            handleAiFiles(e.dataTransfer.files);
        });
    }
    bind('select-file-btn', 'click', () => fileInput?.click());
    bind('file-input', 'change', () => handleAiFiles(document.getElementById('file-input')?.files || []));
    bind('add-text-btn', 'click', addTextAsDocument);
    bind('process-btn', 'click', processAllDocuments);

    // Profile button handler using event delegation
    document.addEventListener('click', (e) => {
        const btn = e.target.closest('#userProfileBtn');
        const dropdown = document.getElementById('userProfileDropdown');
        if (btn) {
            e.stopPropagation();
            if (dropdown) dropdown.classList.toggle('hidden');
            return;
        }
        // Close dropdown when clicking outside
        if (dropdown && !dropdown.classList.contains('hidden') && !e.target.closest('#userProfileDropdown')) {
            dropdown.classList.add('hidden');
        }
    });

    /* 
    // Old direct listener removed in favor of delegation
    const profileBtn = document.getElementById('userProfileBtn');
    const profileDropdown = document.getElementById('userProfileDropdown');
    if (profileBtn) { ... } 
    */

    bind('logoutBtn', 'click', async (e) => {
        e.preventDefault();
        console.log('Logout button clicked');
        try {
            await logout();
        } catch (error) {
            console.error('Logout error:', error);
            showToast('Logout failed. Please try again.', 'error');
        }
    });

    // Sync button handler
    document.getElementById('syncBtn')?.addEventListener('click', async (e) => {
        e.preventDefault();
        console.log('Manual sync triggered from profile menu');
        try {
            if (isOnline) {
                showToast('Syncing your data...', 'info');
                await loadUserDataAndSync();
            } else {
                showToast('You are offline. Please connect to the internet to sync.', 'warning');
            }
        } catch (error) {
            console.error('Manual sync error:', error);
            showToast('Sync failed. Please try again.', 'error');
        }
    });

    document.getElementById('deckTypeHint').addEventListener('change', (e) => {
        toggleEditorView(e.target.value);
    });

    window.addEventListener('click', (e) => {
        const dropdown = document.getElementById('userProfileDropdown');
        if (!dropdown.classList.contains('hidden') && !e.target.closest('#userProfileMenu')) {
            dropdown.classList.add('hidden');
        }
    });

    // Keyboard Shortcuts Handler
    document.addEventListener('keydown', (e) => {
        // Don't trigger shortcuts when typing in text inputs
        if (e.target.matches('input[type="text"], textarea, [contenteditable="true"]') && e.target.id !== 'searchInput') {
            return;
        }

        // Global Shortcuts
        const isMeta = e.ctrlKey || e.metaKey;

        // Ctrl/Cmd + K: Search
        if (isMeta && e.key === 'k') {
            e.preventDefault();
            document.getElementById('searchInput')?.focus();
            console.log('[Shortcut] Search activated');
        }

        // Ctrl/Cmd + N: New Deck
        if (isMeta && e.key === 'n') {
            e.preventDefault();
            showEditor();
            console.log('[Shortcut] New deck');
        }

        // Ctrl/Cmd + S: Sync
        if (isMeta && e.key === 's') {
            e.preventDefault();
            if (isOnline && localStorage.getItem('auth0Session')) {
                loadUserDataAndSync();
            }
            console.log('[Shortcut] Sync triggered');
        }

        // Ctrl/Cmd + ,: Settings
        if (isMeta && e.key === ',') {
            e.preventDefault();
            showSettings();
            console.log('[Shortcut] Settings opened');
        }

        // Escape: Close modals
        if (e.key === 'Escape') {
            document.querySelectorAll('.modal.show').forEach(modal => {
                modal.classList.remove('show');
            });
            console.log('[Shortcut] Closed modals');
        }

        // Study Mode Shortcuts
        const studyView = document.getElementById('studyMode');
        if (!studyView.classList.contains('hidden')) {
            // Space: Show/Check Answer
            if (e.code === 'Space') {
                e.preventDefault();
                const showAnswerBtn = document.getElementById('showAnswerBtn');
                const checkAnswerBtn = document.getElementById('checkAnswerBtn');
                const nextBtn = document.getElementById('nextBtn');

                if (!showAnswerBtn.classList.contains('hidden')) {
                    showAnswerBtn.click();
                } else if (!checkAnswerBtn.classList.contains('hidden')) {
                    checkAnswerBtn.click();
                } else if (!nextBtn.classList.contains('hidden')) {
                    nextBtn.click();
                }
                console.log('[Shortcut] Space pressed in study mode');
            }

            // H: Show/Hide Answer
            if (e.key && e.key.toLowerCase() === 'h') {
                e.preventDefault();
                const showAnswerBtn = document.getElementById('showAnswerBtn');
                if (!showAnswerBtn.classList.contains('hidden')) {
                    showAnswerBtn.click();
                }
                console.log('[Shortcut] Show answer toggle');
            }

            // Arrow Right or N: Next Card
            if (e.key === 'ArrowRight' || (e.key && e.key.toLowerCase() === 'n')) {
                e.preventDefault();
                const nextBtn = document.getElementById('nextBtn');
                const testNextBtn = document.getElementById('testNextBtn');
                if (!nextBtn.classList.contains('hidden')) {
                    nextBtn.click();
                } else if (!testNextBtn.classList.contains('hidden')) {
                    testNextBtn.click();
                }
                console.log('[Shortcut] Next card');
            }

            // C: Mark as Correct
            if (e.key && e.key.toLowerCase() === 'c') {
                e.preventDefault();
                const correctBtn = document.getElementById('correctBtn');
                const testCorrectBtn = document.getElementById('testCorrectBtn');
                if (!correctBtn.classList.contains('hidden')) {
                    correctBtn.click();
                } else if (!testCorrectBtn.classList.contains('hidden')) {
                    testCorrectBtn.click();
                }
                console.log('[Shortcut] Marked correct');
            }

            // X: Mark as Incorrect
            if (e.key && e.key.toLowerCase() === 'x') {
                e.preventDefault();
                const incorrectBtn = document.getElementById('incorrectBtn');
                const testIncorrectBtn = document.getElementById('testIncorrectBtn');
                if (!incorrectBtn.classList.contains('hidden')) {
                    incorrectBtn.click();
                } else if (!testIncorrectBtn.classList.contains('hidden')) {
                    testIncorrectBtn.click();
                }
                console.log('[Shortcut] Marked incorrect');
            }
        }
    });

    // Setup system theme detection
    setupSystemThemeListener();
}

// Global event listeners for sync and logout buttons - attached at document level
document.addEventListener('click', async (e) => {
    const logoutBtn = e.target.closest('#logoutBtn');
    if (logoutBtn) {
        e.preventDefault();
        e.stopPropagation();
        console.log('[LOGOUT] Button clicked');
        const dropdown = document.getElementById('userProfileDropdown');
        if (dropdown) {
            dropdown.classList.add('hidden');
        }
        try {
            console.log('[LOGOUT] Calling logout function');
            await logout();
            console.log('[LOGOUT] Logout completed successfully');
        } catch (error) {
            console.error('[LOGOUT] Logout error:', error);
            showToast('Logout failed. Please try again.', 'error');
        }
    }
}, true);

document.addEventListener('click', async (e) => {
    const syncBtn = e.target.closest('#syncBtn');
    if (syncBtn) {
        e.preventDefault();
        e.stopPropagation();
        console.log('[SYNC] Button clicked');
        const dropdown = document.getElementById('userProfileDropdown');
        if (dropdown) {
            dropdown.classList.add('hidden');
        }
        try {
            if (isOnline) {
                console.log('[SYNC] Online detected, starting sync');
                showToast('Syncing your data...', 'info');
                await loadUserDataAndSync();
                console.log('[SYNC] Sync completed successfully');
            } else {
                console.log('[SYNC] App is offline');
                showToast('You are offline. Please connect to the internet to sync.', 'warning');
            }
        } catch (error) {
            console.error('[SYNC] Manual sync error:', error);
            showToast('Sync failed. Please try again.', 'error');
        }
    }
}, true);

function showToast(message, type = 'info', duration = 3000, icon = null) {
    if (globalSettings.enableToasts === false) {
        if (type !== 'error') {
            return;
        }
    }
    toastQueue.push({ message, type, duration, icon });
    if (!isToastVisible) {
        processToastQueue();
    }
}

function handleNextCard() {
    const card = getActiveCard();
    if (!card) return;
    document.getElementById('nextBtn').classList.add('hidden');
    document.getElementById('feedbackMessage').innerHTML = '';

    const questionTypeForLog = document.getElementById('mcqView').classList.contains('hidden') ? 'Type' : 'MultipleChoice';
    moveCard(card, false, questionTypeForLog);
}

function processToastQueue() {
    if (toastQueue.length === 0) {
        isToastVisible = false;
        return;
    }

    isToastVisible = true;
    const messageItem = toastQueue.shift();
    const messageBar = document.getElementById('messageBar');

    if (!messageBar) {
        console.error('Message bar element not found');
        isToastVisible = false;
        return;
    }

    // Set message content
    messageBar.textContent = messageItem.message;

    // Reset classes
    messageBar.className = 'message-bar';

    // Add type class
    if (messageItem.type) {
        messageBar.classList.add(messageItem.type);
    }

    // Show the message bar
    messageBar.classList.remove('hidden');

    // Trigger animation
    setTimeout(() => {
        messageBar.classList.add('show');
    }, 10);

    // Auto-dismiss after duration
    setTimeout(() => {
        messageBar.classList.remove('show');
        setTimeout(() => {
            messageBar.classList.add('hidden');
            processToastQueue(); // Process next message if any
        }, 300); // Wait for slide-up animation
    }, messageItem.duration);
}

async function runSmartCoachChecks(context, data = {}) {
    let messageShown = false;

    const showRandomMessage = (messageArray, replacements = {}, type = 'info', icon = null) => {
        if (messageShown) return;
        let message = messageArray[Math.floor(Math.random() * messageArray.length)];
        for (const key in replacements) {
            message = message.replace(`{${key}}`, replacements[key]);
        }
        showToast(message, type, 5000, icon);
        messageShown = true;
    };

    switch (context) {
        case 'dashboardLoad':
            if (!globalSettings.username || activeView !== 'dashboard') {
                return;
            }
            const today = new Date().toDateString();
            if (analyticsData.lastGreetingDate !== today) {
                if (analyticsData.streak > 1) {
                    showRandomMessage(smartCoachMessages.milestones.streak, { streak: analyticsData.streak, username: globalSettings.username }, 'success');
                } else {
                    showRandomMessage(smartCoachMessages.greetings, { username: globalSettings.username }, 'info');
                }
                analyticsData.lastGreetingDate = today;
                await saveDataToDB('appData', { key: 'analytics', ...analyticsData });
            }
            break;

        case 'sessionEnd':
            const { deckId, correctCount, incorrectCount } = data;
            const deck = decks[deckId];
            const totalAnswered = correctCount + incorrectCount;
            if (totalAnswered === 0) return;

            const knowledgeStates = await getAllDataFromDB('userKnowledgeState');
            const cardIdsInDeck = new Set(deck.cards.map(c => c.id));
            const examDate = deck.settings?.examDate ? new Date(deck.settings.examDate) : null;
            const masteredCount = knowledgeStates.filter(s => {
                if (!cardIdsInDeck.has(s.cardID)) return false;
                const retention = calculateRetentionAtDate(s, examDate || new Date());
                const threshold = examDate ? (deck.settings?.targetRetention || 0.8) : 0.9;
                return retention >= threshold;
            }).length;

            if (masteredCount === deck.cards.length) {
                showRandomMessage(smartCoachMessages.milestones.deckMastered, { deckName: deck.name }, 'success');
                break;
            }

            const masteryThresholds = [50, 25, 10];
            for (const threshold of masteryThresholds) {
                if (data.masteryCountBefore < threshold && masteredCount >= threshold) {
                    showRandomMessage(smartCoachMessages.milestones.cardsMastered, { count: threshold }, 'success');
                    break;
                }
            }
            if (messageShown) break;

            const accuracy = totalAnswered > 0 ? correctCount / totalAnswered : 0;
            if (accuracy >= 0.9) {
                showRandomMessage(smartCoachMessages.sessionFeedback.highAccuracy, {}, 'success');
            } else if (accuracy >= 0.6) {
                showRandomMessage(smartCoachMessages.sessionFeedback.mediumAccuracy, {}, 'info');
            } else {
                showRandomMessage(smartCoachMessages.sessionFeedback.lowAccuracy, {}, 'info');
            }
            break;
    }
}

function updateHeaderForView(viewId) {
    const header = document.getElementById('appHeader');
    if (!header) return;

    const isDashboard = viewId === 'dashboard';
    const isAuthView = viewId === 'authView';

    header.classList.toggle('hidden', isAuthView);

    const searchBarElem = document.querySelector('.search-bar');
    if (searchBarElem) {
        searchBarElem.classList.toggle('hidden', !isDashboard);
    }

    const headerSettingsBtn = document.getElementById('headerSettingsBtn');
    if (headerSettingsBtn) {
        headerSettingsBtn.classList.toggle('hidden', !isDashboard);
    }

    const headerBackBtn = document.getElementById('headerBackBtn');
    if (headerBackBtn) {
        headerBackBtn.classList.toggle('hidden', isDashboard || viewHistory.length === 0);
    }

    const headerHomeBtn = document.getElementById('headerHomeBtn');
    if (headerHomeBtn) {
        headerHomeBtn.classList.toggle('hidden', isDashboard);
    }
}

function navigateTo(viewId, { recordHistory = true, clearHistory = false, isInitial = false, callback = null } = {}) {
    const nextView = document.getElementById(viewId);
    if (!nextView) {
        console.error('View not found:', viewId);
        return;
    }

    if (clearHistory) {
        viewHistory = [];
    }

    if (!isInitial && recordHistory && !clearHistory && activeView && activeView !== viewId && viewId !== 'dashboard' && viewHistory[viewHistory.length - 1] !== activeView) {
        viewHistory.push(activeView);
    }

    if (isInitial) {
        nextView.classList.remove('hidden');
        nextView.classList.add('is-visible');
        activeView = viewId;
        updateHeaderForView(viewId);
        if (callback) callback();
        return;
    }

    const currentView = document.getElementById(activeView);
    if (currentView && currentView !== nextView) {
        currentView.classList.add('is-hiding');
        currentView.classList.remove('is-visible');

        setTimeout(() => {
            currentView.classList.remove('is-hiding');
            currentView.classList.add('hidden');
        }, 400);
    }

    nextView.classList.remove('hidden');
    nextView.classList.add('is-visible');

    activeView = viewId;
    updateHeaderForView(viewId);
    window.scrollTo(0, 0);

    if (callback) callback();
}

function transitionView(viewId, isInitial = false, callback = null, recordHistory = true) {
    navigateTo(viewId, { isInitial, callback, recordHistory });
}

const transitionTimeouts = new WeakMap();

function resetSubViewAnimation(element) {
    if (!element) return;
    const timer = transitionTimeouts.get(element);
    if (timer) {
        clearTimeout(timer);
        transitionTimeouts.delete(element);
    }
    element.classList.remove('sub-view-fade-out', 'sub-view-fade-in', 'animating');
}

function transitionSubView(currentElem, nextElem) {
    resetSubViewAnimation(currentElem);
    resetSubViewAnimation(nextElem);

    if (currentElem && !currentElem.classList.contains('hidden')) {
        currentElem.classList.add('sub-view-fade-out', 'animating');
        const hideTimer = setTimeout(() => {
            currentElem.classList.add('hidden');
            currentElem.classList.remove('sub-view-fade-out', 'animating');
            transitionTimeouts.delete(currentElem);
        }, 400);
        transitionTimeouts.set(currentElem, hideTimer);
    }

    if (nextElem) {
        nextElem.classList.remove('hidden');
        nextElem.classList.add('sub-view-fade-in', 'animating');
        const showTimer = setTimeout(() => {
            nextElem.classList.remove('sub-view-fade-in', 'animating');
            transitionTimeouts.delete(nextElem);
        }, 400);
        transitionTimeouts.set(nextElem, showTimer);
    }
}

function hidePreGenerationViewImmediately() {
    const preGenerationView = document.getElementById('preGenerationView');
    if (preGenerationView) {
        resetSubViewAnimation(preGenerationView);
        preGenerationView.classList.add('hidden');
    }
    if (studyState.preGenerationCountdownInterval) {
        clearInterval(studyState.preGenerationCountdownInterval);
        studyState.preGenerationCountdownInterval = null;
    }
}

function resetStudySubViews() {
    ['progressView', 'cardView', 'completeView', 'preGenerationView'].forEach(id => {
        const el = document.getElementById(id);
        if (el && !el.classList.contains('hidden')) {
            el.classList.add('hidden');
        }
    });
    hidePreGenerationViewImmediately();
    ['cardQuestion', 'cardAnswer', 'mcqQuestion'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.textContent = '';
    });
    const mcqOptions = document.getElementById('mcqOptions');
    if (mcqOptions) mcqOptions.innerHTML = '';
    studyState.pendingMCQToken = 0;
    studyState.pendingMCQCardId = null;
}

function goBack() {
    if (activeView === 'editorView' && !isEditorClean()) {
        showConfirmModal(
            'You have unsaved changes. Are you sure you want to leave?',
            () => continueGoBack()
        );
    } else {
        continueGoBack();
    }
}

function continueGoBack() {
    const previousView = viewHistory.pop();
    if (previousView) {
        transitionView(previousView, false, null, false);
    } else {
        transitionView('dashboard', false, () => resetDashboardState(true), false);
    }
}

function showEditor() {
    transitionView('editorView');
    editorInitialise();

    const container = document.getElementById('flashcardsContainer');
    if (sortableInstance) {
        try {
            sortableInstance.destroy();
        } catch (error) {
            console.warn('Failed to destroy Sortable instance:', error);
            // Continue execution even if destroy fails
        }
        sortableInstance = null;
    }
    sortableInstance = new Sortable(container, {
        animation: 150,
        handle: '.drag-handle',
        ghostClass: 'drag-ghost',
        onEnd: () => {
            editorRenumberCards();
        }
    });
}

async function showSettings() {
    const settings = await getDataFromDB('appData', 'userSettings');
    document.getElementById('usernameInput').value = settings?.username || '';
    document.getElementById('enableInStudyEditing').checked = settings?.enableInStudyEditing || false;
    document.getElementById('toggleExamPlanBanner').checked = !settings?.hideExamPlanBanner;
    document.getElementById('enableToastsToggle').checked = (settings?.enableToasts !== false);
    transitionView('settingsView');
}

async function backToDashboard(isFromLogo = false, skipEndSession = false) {
    if (activeView === 'editorView' && !isEditorClean()) {
        showConfirmModal(
            'You have unsaved changes. Are you sure you want to leave?',
            async () => {

                if (isFromLogo) {

                    if (!skipEndSession && currentDeckId && currentMode) endSession();

                    transitionView('dashboard', false, () => resetDashboardState(true), false);
                    return;
                }
                transitionView('dashboard', false, () => resetDashboardState(true), false);
                if (!skipEndSession && currentDeckId && currentMode) endSession();
            }
        );
        return;
    }

    if (activeView !== 'dashboard') {
        if (!skipEndSession && currentDeckId && currentMode) await endSession();
        if (isFromLogo) {

            if (!skipEndSession && currentDeckId && currentMode) await endSession();
            transitionView('dashboard', false, () => resetDashboardState(true), false);
            return;
        } else {
            transitionView('dashboard', false, () => resetDashboardState(isFromLogo), false);
        }
    } else {
        if (isFromLogo) {

            transitionView('dashboard', false, () => resetDashboardState(true), false);
            return;
        } else {
            resetDashboardState(isFromLogo);
        }
    }
}

function resetDashboardState(clearHistory = false) {
    document.getElementById('deckDetailView').classList.add('hidden');
    document.getElementById('decksSection').classList.remove('hidden');
    document.querySelector('.create-section').classList.remove('hidden');

    currentViewingDeckId = null;
    updateDashboard();

    if (clearHistory) {
        viewHistory = [];
    }

    updateHeaderForView('dashboard');
}

async function loadSavedData() {
    const settings = await getDataFromDB('appData', 'userSettings');
    globalSettings = settings || {};
    globalSettings.newCardsPerDay = globalSettings.newCardsPerDay || 20;

    if (globalSettings.username) {
        const welcomeEl = document.getElementById('welcomeMessage');
        if (welcomeEl) {
            welcomeEl.textContent = `Welcome back, ${globalSettings.username}!`;
        }
        checkName();
    } else {
        const nameModal = document.getElementById('nameModal');
        if (nameModal) {
            nameModal.classList.add('show');
        } else {
        }
    }

    const savedCategories = await getDataFromDB('appData', 'categories');
    if (savedCategories) categories = savedCategories.data;
    populateCategoryDropdowns();

    const savedDecks = await getAllDataFromDB('decks');
    decks = {};
    const fsrsEngine = await getFsrsEngine();
    for (const deck of savedDecks) {
        let deckUpdated = false;
        for (const card of deck.cards) {
            if (!card.id) {
                card.id = crypto.randomUUID();
                deckUpdated = true;
            }
            const prepared = await prepareFsrsCard(card);
            card.fsrs = serializeFsrsCard(prepared);
            // Ensure each card has a reference to its deck
            if (!card.deckId) {
                card.deckId = deck.id;
                deckUpdated = true;
            }
        }
        if (deckUpdated) {
            deck.lastModified = new Date().toISOString();
            await saveDataToDB('decks', deck);
        }
        decks[deck.id] = deck;
        if (window.AccentUtils?.ensureDeckAccentMetadata) {
            window.AccentUtils.ensureDeckAccentMetadata(deck);
        }
    }

    await updateUserBaseline();

    const savedAnalytics = await getDataFromDB('appData', 'analytics');
    if (savedAnalytics) analyticsData = savedAnalytics;
    updateStreak();

    // Apply dark mode: use manual setting if set, otherwise detect system preference
    applyDarkModePreference();

    await checkForOutdatedAnalysis();
    await updateDashboard();
    runSmartCoachChecks('dashboardLoad');
}

function detectSystemDarkMode() {
    if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) {
        return true;
    }
    return false;
}

function applyDarkModePreference() {
    const darkModeToggle = document.getElementById('darkModeToggle');
    let shouldBeDark = false;

    if (globalSettings.darkMode !== undefined) {
        shouldBeDark = globalSettings.darkMode;
    } else {
        shouldBeDark = detectSystemDarkMode();
    }

    if (shouldBeDark) {
        document.documentElement.classList.add('dark-mode');
        document.body.classList.add('dark-mode');
    } else {
        document.documentElement.classList.remove('dark-mode');
        document.body.classList.remove('dark-mode');
    }

    if (darkModeToggle) {
        darkModeToggle.checked = shouldBeDark;
    }
}

function setupSystemThemeListener() {
    if (window.matchMedia) {
        const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');

        const handleSystemThemeChange = (e) => {
            if (globalSettings.darkMode === undefined) {
                applyDarkModePreference();
            }
        };

        if (mediaQuery.addEventListener) {
            mediaQuery.addEventListener('change', handleSystemThemeChange);
        } else {
            mediaQuery.addListener(handleSystemThemeChange);
        }
    }
}

function formatDate(isoString) {
    if (!isoString) return '';
    const date = new Date(isoString);
    return date.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
}

async function exportDeck(deckId, event) {
    event.stopPropagation();
    const deck = decks[deckId];
    if (!deck) return;
    showToast('Preparing complete export...', 'info', 2000);

    const allKnowledgeStates = await getAllDataFromDB('userKnowledgeState');
    const cardIdsInDeck = new Set(deck.cards.map(c => c.id));

    const knowledgeStateForDeck = allKnowledgeStates.filter(state => cardIdsInDeck.has(state.cardID));

    const exportPayload = {
        deck: JSON.parse(JSON.stringify(deck)),
        knowledgeStateData: knowledgeStateForDeck
    };

    const dataStr = JSON.stringify(exportPayload, null, 2);
    const dataUri = 'data:application/json;charset=utf-8,' + encodeURIComponent(dataStr);
    const exportFileDefaultName = `${deck.name.replace(/ /g, '_')}_export.json`;

    const linkElement = document.createElement('a');
    linkElement.setAttribute('href', dataUri);
    linkElement.setAttribute('download', exportFileDefaultName);
    linkElement.click();

    showToast('Complete export started successfully!');
}

async function updateDashboard() {
    const knowledgeStates = await getAllDataFromDB('userKnowledgeState');
    const knowledgeMap = new Map(knowledgeStates.map(item => [item.cardID, item]));
    const allPlans = await getAllDataFromDB('examPlans');

    const decksContainer = document.getElementById('decksContainer');
    const subtitle = document.getElementById('subtitle');
    const ctaContainer = document.getElementById('examPlanCtaContainer');
    const footerBtn = document.getElementById('createExamPlanFooterBtn');

    if (ctaContainer && footerBtn) {
        if (globalSettings.hideExamPlanBanner === true) {
            ctaContainer.classList.add('hidden');
            footerBtn.classList.remove('hidden');
        } else {
            ctaContainer.classList.remove('hidden');
            footerBtn.classList.add('hidden');
        }
    }
    decksContainer.innerHTML = '';

    if (allPlans && allPlans.length > 0) {
        const plansContainer = document.createElement('div');
        plansContainer.className = 'exam-plans-container';
        plansContainer.innerHTML = `<h3 class="category-title">Your Exam Plans</h3>`;

        for (const plan of allPlans) {
            const now = new Date();
            const [year, month, day] = plan.examDate.split('-').map(Number);
            const examDate = new Date(year, month - 1, day);
            examDate.setHours(23, 59, 59, 999);

            const nowStartOfDay = new Date();
            nowStartOfDay.setHours(0, 0, 0, 0);

            const timeDiff = examDate.getTime() - nowStartOfDay.getTime();
            const daysRemaining = Math.ceil(timeDiff / (1000 * 3600 * 24));

            let countdownText = '';
            if (daysRemaining > 1) {
                countdownText = `${daysRemaining} days remaining`;
            } else if (daysRemaining === 1) {
                countdownText = `Exam is tomorrow!`;
            } else if (daysRemaining === 0) {
                countdownText = `Exam is today! Good luck!`;
            } else {
                countdownText = `Exam has passed.`;
            }

            let totalCardsInPlan = 0;
            let totalMasterySum = 0;
            const planExamDate = new Date(plan.examDate);
            const targetRetention = plan.targetRetention || 0.8;

            plan.deckIds.forEach(deckId => {
                const deck = decks[deckId];
                if (deck) {
                    totalCardsInPlan += deck.cards.length;
                    deck.cards.forEach(card => {
                        const state = knowledgeMap.get(card.id);
                        // For exam plans, always use retention
                        const retention = calculateRetentionAtDate(state, planExamDate);
                        const score = retention / targetRetention;
                        totalMasterySum += Math.min(1, score);
                    });
                }
            });
            const progressPercent = totalCardsInPlan > 0 ? (totalMasterySum / totalCardsInPlan) * 100 : 0;

            const planCard = document.createElement('div');
            planCard.className = 'exam-plan-card';
            planCard.innerHTML = `
                    <div class="deck-card-main-clickable" onclick="showPlanDetails('${plan.id}')">
                        <div class="plan-card-header">
                            <div class="plan-card-title">${plan.name}</div>
                            <div class="plan-card-countdown">${countdownText}</div>
                        </div>
                        <div class="deck-progress-container" style="margin-top: 15px;">
                            <div class="deck-progress-label">
                                <span>Overall Progress</span>
                                <span>${Math.round(progressPercent)}%</span>
                            </div>
                            <div class="deck-progress-bar-outer">
                                <div class="deck-progress-bar-inner" style="width: ${progressPercent}%; background-color: var(--success-color);"></div>
                            </div>
                        </div>
                    </div>
                    <div class="deck-actions" style="grid-template-columns: 1fr 1fr; margin-top: 15px;">
                        <button class="btn btn-secondary" onclick="showPlanDetails('${plan.id}')">View Details</button>
                        <button class="btn btn-prominent" onclick="startExamPlanSession('${plan.id}')">
                            Start Session
                        </button>
                    </div>
                `;
            plansContainer.appendChild(planCard);
        }
        decksContainer.appendChild(plansContainer);
    }

    const deckCount = Object.keys(decks).length;
    subtitle.textContent = deckCount === 0 ? "Create your first deck to get started!" : `Your saved decks:`;

    if (deckCount === 0 && (!allPlans || allPlans.length === 0)) {
        decksContainer.innerHTML = `<div class="no-decks">
                <div class="no-decks-icon"><svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M12 6.042A8.967 8.967 0 0 0 6 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 0 1 6 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 0 1 6-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0 0 18 18a8.967 8.967 0 0 0-6 2.292m0-14.25v14.25" /></svg></div>
                <div>No flashcard decks yet.<br>Create your first deck to get started!</div>
            </div>`;
    }

    const groupedDecks = {};
    for (const deck of Object.values(decks)) {
        const category = deck.category || 'Other';
        if (!groupedDecks[category]) groupedDecks[category] = [];
        groupedDecks[category].push(deck);
    }

    const sortedCategories = Object.keys(groupedDecks).sort((a, b) => categories.indexOf(a) - categories.indexOf(b));

    for (const category of sortedCategories) {
        const categoryFolder = document.createElement('div');
        categoryFolder.className = 'category-folder';
        const title = document.createElement('h3');
        title.className = 'category-title';
        title.textContent = category;
        const decksGrid = document.createElement('div');
        decksGrid.className = 'decks-grid';
        categoryFolder.appendChild(title);
        categoryFolder.appendChild(decksGrid);

        const sortedDecks = groupedDecks[category].sort((a, b) => new Date(b.created) - new Date(a.created));

        // append decks to the grid manually using DOM methods to avoid unsafe innerHTML
        decksGrid.innerHTML = '';
        sortedDecks.forEach(deck => {
            const totalCards = deck.cards.length;
            let progressPercent = 0;
            if (totalCards > 0) {
                const hasExamDate = deck.settings && deck.settings.examDate;
                const targetRetention = (deck.settings && deck.settings.targetRetention) || 0.8;
                const examDate = hasExamDate ? new Date(deck.settings.examDate) : null;
                const targetDate = examDate || new Date();

                let totalScore = 0;
                deck.cards.forEach(card => {
                    const state = knowledgeMap.get(card.id);
                    const retention = calculateRetentionAtDate(state, targetDate);
                    if (globalSettings.devMode) {
                        console.log("[FSRS insights] retention used:", retention);
                    }
                    if (hasExamDate) {
                        // Use retention for exam mode
                        const score = retention / targetRetention;
                        totalScore += Math.min(1, score);
                    } else {
                        // Use current-day retention
                        const normalizedRetention = Number.isFinite(retention) ? retention : 0;
                        totalScore += normalizedRetention;
                    }
                });
                progressPercent = (totalScore / totalCards) * 100;
            }

            let actionButtonsHTML;
            if (deck.typeHint === 'Sequence') {
                actionButtonsHTML = `
                        <button class="action-btn learn-btn spaced-btn" style="grid-column: 1 / 3;" onclick="event.stopPropagation(); startSequenceSession('${deck.id}')">
                            Learn Sequence
                        </button>
                    `;
            } else {
                actionButtonsHTML = `
                        <button class="action-btn learn-btn" onclick="event.stopPropagation(); configureStudy('learn', '${deck.id}')">Learn</button>
                        <button class="action-btn review-btn" onclick="event.stopPropagation(); configureStudy('review', '${deck.id}')">Review</button>
                    `;
            }

            const deckCard = document.createElement('div');
            deckCard.className = 'deck-card';
            deckCard.dataset.category = String(category);
            deckCard.dataset.deckId = String(deck.id);

            const mainClickable = document.createElement('div');
            mainClickable.className = 'deck-card-main-clickable';
            mainClickable.addEventListener('click', () => showDeckDetail(deck.id, mainClickable.parentElement));

            const deckHeader = document.createElement('div');
            deckHeader.className = 'deck-header';

            const deckCategoryEl = document.createElement('div');
            deckCategoryEl.className = 'deck-category';
            deckCategoryEl.textContent = String(category);
            const deckNameEl = document.createElement('div');
            deckNameEl.className = 'deck-name';
            deckNameEl.textContent = String(deck.name);
            const deckInfoEl = document.createElement('div');
            deckInfoEl.className = 'deck-info';
            deckInfoEl.innerHTML = `<span>${totalCards} cards</span>`;

            deckHeader.appendChild(deckCategoryEl);
            deckHeader.appendChild(deckNameEl);
            deckHeader.appendChild(deckInfoEl);

            const progressContainer = document.createElement('div');
            progressContainer.className = 'deck-progress-container';
            const progressLabel = document.createElement('div');
            progressLabel.className = 'deck-progress-label';
            progressLabel.innerHTML = `<span>Progress</span><span>${Math.round(progressPercent)}%</span>`;
            const progressOuter = document.createElement('div');
            progressOuter.className = 'deck-progress-bar-outer';
            const progressInner = document.createElement('div');
            progressInner.className = 'deck-progress-bar-inner';
            progressInner.style.width = `${progressPercent}%`;
            progressInner.style.backgroundColor = 'var(--success-color)';
            progressOuter.appendChild(progressInner);
            progressContainer.appendChild(progressLabel);
            progressContainer.appendChild(progressOuter);

            const deckDate = document.createElement('div');
            deckDate.className = 'deck-date';
            deckDate.textContent = `Created: ${String(formatDate(deck.created))}`;

            mainClickable.appendChild(deckHeader);
            mainClickable.appendChild(progressContainer);
            mainClickable.appendChild(deckDate);

            const actions = document.createElement('div');
            actions.className = 'deck-actions';
            if (deck.typeHint === 'Sequence') {
                const seqBtn = document.createElement('button');
                seqBtn.className = 'action-btn learn-btn spaced-btn';
                seqBtn.style.gridColumn = '1 / 3';
                seqBtn.textContent = 'Learn Sequence';
                seqBtn.addEventListener('click', (e) => { e.stopPropagation(); startSequenceSession(deck.id); });
                actions.appendChild(seqBtn);
            } else {
                const learnBtn = document.createElement('button');
                learnBtn.className = 'action-btn learn-btn';
                learnBtn.textContent = 'Learn';
                learnBtn.addEventListener('click', (e) => { e.stopPropagation(); configureStudy('learn', deck.id); });
                const reviewBtn = document.createElement('button');
                reviewBtn.className = 'action-btn review-btn';
                reviewBtn.textContent = 'Review';
                reviewBtn.addEventListener('click', (e) => { e.stopPropagation(); configureStudy('review', deck.id); });
                actions.appendChild(learnBtn);
                actions.appendChild(reviewBtn);
            }

            const exportBtn = document.createElement('button');
            exportBtn.className = 'action-btn export-btn';
            exportBtn.title = 'Export Deck';
            exportBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" width="18" height="18"><path stroke-linecap="round" stroke-linejoin="round" d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5M16.5 12 12 16.5m0 0L7.5 12m4.5 4.5V3" /></svg>`;
            exportBtn.addEventListener('click', (e) => { e.stopPropagation(); exportDeck(String(deck.id), e); });
            actions.appendChild(exportBtn);

            deckCard.appendChild(mainClickable);
            deckCard.appendChild(actions);
            decksGrid.appendChild(deckCard);
        });
        decksContainer.appendChild(categoryFolder);
    }

    rebuildDeckSelection();
    updateDueCardCounts();

    const internalBtn = document.getElementById('internalDashboardBtn');
    if (internalBtn) {
        if (globalSettings.devMode === true) {
            internalBtn.classList.remove('hidden');
        } else {
            internalBtn.classList.add('hidden');
        }
    } else {
        // `internalDashboardBtn` not present in the DOM (e.g. guest/offline view).
        // Silently ignore to avoid startup errors when the element is missing.
    }
}

function showDeckDetail(deckId, cardElement) {
    const deck = decks[deckId];
    if (!deck) return;
    if (cardElement) {
        cardElement.classList.add('deck-clicked');
        cardElement.addEventListener('animationend', () => cardElement.classList.remove('deck-clicked'), { once: true });
    }

    currentViewingDeckId = deckId;
    transitionView('dashboard', false, null, false);

    document.getElementById('deckDetailTitle').textContent = deck.name;
    const categoryElement = document.getElementById('deckDetailCategory');
    const category = deck.category || "Other";
    categoryElement.textContent = category;
    categoryElement.className = `deck-detail-category ${category}`;

    const deckDetailActions = document.getElementById('deckDetailActions');
    if (!deckDetailActions) {
        console.error("Fatal Error: deckDetailActions element not found in the DOM.");
        return;
    }

    let sequenceBtn = deckDetailActions.querySelector('.sequence-btn');
    if (deck.typeHint === 'Sequence') {
        if (!sequenceBtn) {
            sequenceBtn = document.createElement('button');
            sequenceBtn.className = 'btn sequence-btn';
            sequenceBtn.textContent = 'Practice Sequence';
            sequenceBtn.style.backgroundColor = '#dd6b20';
            sequenceBtn.onclick = () => startSequenceSession(deckId);
            const reviewBtn = deckDetailActions.querySelector('.review-btn');
            deckDetailActions.insertBefore(sequenceBtn, reviewBtn);
        }
    } else {
        if (sequenceBtn) sequenceBtn.remove();
    }

    const cardsList = document.getElementById('deckCardsList');
    cardsList.innerHTML = '';

    if (deck.cards.length === 0) {
        cardsList.innerHTML = '<p style="text-align: center; color: var(--secondary-text);">No cards in this deck yet.</p>';
    } else {
        const cardsToDisplay = (deck.typeHint === 'Sequence')
            ? [...deck.cards].sort((a, b) => a.order - b.order)
            : deck.cards;

        cardsToDisplay.forEach((card, index) => {
            const cardItem = document.createElement('div');
            cardItem.className = 'deck-card-item';
            const originalIndex = deck.cards.findIndex(c => c.id === card.id);
            const orderText = card.order ? `${card.order}. ` : `${index + 1}. `;

            const newBadgeEl = card.isNew ? (() => { const b = document.createElement('span'); b.className = 'new-badge'; b.textContent = 'New'; return b; })() : null;

            const questionDiv = document.createElement('div');
            questionDiv.className = 'deck-card-question';
            questionDiv.textContent = `${orderText}${card.question}`;
            if (newBadgeEl) questionDiv.appendChild(newBadgeEl);

            const contentDiv = document.createElement('div');
            contentDiv.className = 'deck-card-content';
            contentDiv.appendChild(questionDiv);

            if (card.questionImage) {
                const img = document.createElement('img');
                img.src = card.questionImage;
                img.className = 'card-image';
                contentDiv.appendChild(img);
            }

            const answerDiv = document.createElement('div');
            answerDiv.className = 'deck-card-answer';
            answerDiv.textContent = card.answer;
            contentDiv.appendChild(answerDiv);

            if (card.answerImage) {
                const aimg = document.createElement('img');
                aimg.src = card.answerImage;
                aimg.className = 'card-image';
                contentDiv.appendChild(aimg);
            }

            const actionsDiv = document.createElement('div');
            actionsDiv.className = 'deck-card-actions';

            const editBtn = document.createElement('button');
            editBtn.className = 'deck-card-action-btn edit';
            editBtn.title = 'Edit Card';
            editBtn.addEventListener('click', (e) => { e.stopPropagation(); editCard(deckId, originalIndex, 'detail'); });
            editBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" width="16" height="16"><path stroke-linecap="round" stroke-linejoin="round" d="m16.862 4.487 1.687-1.688a1.875 1.875 0 1 1 2.652 2.652L10.582 16.07a4.5 4.5 0 0 1-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 0 1 1.13-1.897l8.932-8.931Zm0 0L19.5 7.125M18 14v4.75A2.25 2.25 0 0 1 15.75 21H5.25A2.25 2.25 0 0 1 3 18.75V8.25A2.25 2.25 0 0 1 5.25 6H10" /></svg>`;

            const deleteBtn = document.createElement('button');
            deleteBtn.className = 'deck-card-action-btn delete';
            deleteBtn.title = 'Delete Card';
            deleteBtn.addEventListener('click', (e) => { e.stopPropagation(); deleteCardFromDetail(deckId, originalIndex); });
            deleteBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" width="16" height="16"><path stroke-linecap="round" stroke-linejoin="round" d="m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0" /></svg>`;

            actionsDiv.appendChild(editBtn);
            actionsDiv.appendChild(deleteBtn);

            cardItem.appendChild(contentDiv);
            cardItem.appendChild(actionsDiv);
            cardsList.appendChild(cardItem);
        });
    }

    document.getElementById('decksSection').classList.add('hidden');
    document.querySelector('.create-section').classList.add('hidden');
    document.getElementById('deckDetailView').classList.remove('hidden');

}

function editCard(deckId, cardIndex, from) {
    const deck = decks[deckId];
    if (!deck || !deck.cards[cardIndex]) return;
    cardToEdit = { deckId, cardIndex, from };
    const card = deck.cards[cardIndex];
    document.getElementById('editCardQuestion').value = card.question;
    document.getElementById('editCardAnswer').value = card.answer;
    document.getElementById('editCardModal').classList.add('show');
}

function editCurrentStudyCard() {
    const card = studyState.roundCards[studyState.currentCardIndex];
    if (!card || !currentDeckId || !decks[currentDeckId]) {
        return;
    }
    const deck = decks[currentDeckId];
    const cardIndexInDeck = deck.cards.findIndex(c => c.id === card.id);
    if (cardIndexInDeck > -1) {
        editCard(currentDeckId, cardIndexInDeck, 'study');
    }
}

function closeEditCardModal() {
    document.getElementById('editCardModal').classList.remove('show');
    cardToEdit = { deckId: null, cardIndex: null, from: null };
}

async function saveEditedCard() {
    const { deckId, cardIndex, from } = cardToEdit;
    if (deckId === null || cardIndex === null) return;

    const deck = decks[deckId];
    if (!deck || !deck.cards || deck.cards[cardIndex] === undefined) {
        showToast('Error: Deck or card not found.', 'error');
        return;
    }
    const newQuestion = document.getElementById('editCardQuestion').value.trim();
    const newAnswer = document.getElementById('editCardAnswer').value.trim();

    if (newQuestion && newAnswer) {
        const originalCard = deck.cards[cardIndex];
        originalCard.question = newQuestion;
        originalCard.answer = newAnswer;

        if (from === 'study') {
            const updateCardInArray = (arr) => {
                if (!arr || !Array.isArray(arr)) return;
                const idx = arr.findIndex(c => c && c.id === originalCard.id);
                if (idx > -1) arr[idx] = { ...arr[idx], question: newQuestion, answer: newAnswer };
            };

            if (currentMode === 'learn' || currentMode === 'spaced') {
                if (Array.isArray(studyState.buckets)) {
                    studyState.buckets.forEach(bucket => updateCardInArray(bucket));
                }
            } else if (currentMode === 'review') {
                updateCardInArray(studyState.stillLearning);
                updateCardInArray(studyState.correct);
            }
            updateCardInArray(studyState.roundCards);
            showNextCard();
        }

        await saveDataToDB('decks', deck);
        if (from === 'detail' && currentViewingDeckId === deckId) showDeckDetail(deckId);

        closeEditCardModal();
    } else {
        showToast("Question and Answer cannot be empty.", 'error');
    }
}

async function deleteCardFromDetail(deckId, cardIndex) {
    const deck = decks[deckId];
    if (!deck || !deck.cards[cardIndex]) return;

    showConfirmModal('Are you sure you want to delete this card?', async () => {
        try {
            deck.cards.splice(cardIndex, 1);
            await saveDataToDB('decks', deck);
            if (isOnline) {
                const auth0Session = localStorage.getItem('auth0Session');
                if (auth0Session) {
                    await loadUserDataAndSync();
                }
            }
            showDeckDetail(deckId);
            updateDashboard();
            showToast('Card deleted.', 'success');
        } catch (error) {
            console.error('Error deleting card:', error);
            showToast(`Failed to delete card: ${error.message}`, 'error');
            throw error;
        }
    });
}

function setupSearch() {
    bind('searchInput', 'input', function () {
        const query = this.value.toLowerCase().trim();
        document.querySelectorAll('.deck-card').forEach(cardElement => {
            const deckId = cardElement.dataset.deckId;
            if (!deckId || !decks[deckId]) return;
            const deck = decks[deckId];
            let isMatch = deck.name.toLowerCase().includes(query) || (deck.category && deck.category.toLowerCase().includes(query));
            cardElement.style.display = isMatch ? 'flex' : 'none';
        });
        document.querySelectorAll('.category-folder').forEach(folder => {
            const visibleCards = folder.querySelectorAll('.deck-card[style*="display: flex"], .deck-card:not([style])');
            folder.style.display = visibleCards.length > 0 ? 'block' : 'none';
        });
        rebuildDeckSelection();
    });
}

function handleDashboardShortcuts(event) {
    if (!keyboardManager) return false;
    if (activeView !== 'dashboard') return false;

    const key = event.key;
    const decksSection = document.getElementById('decksSection');
    const deckDetailView = document.getElementById('deckDetailView');
    const deckListVisible = !!decksSection && !decksSection.classList.contains('hidden');
    const detailVisible = !!deckDetailView && !deckDetailView.classList.contains('hidden');

    if ((key === 'n' || key === 'N') && (event.ctrlKey || event.metaKey)) {
        showEditor();
        return true;
    }

    if (key === 'Escape') {
        if (detailVisible) {
            backToDashboard();
            return true;
        }
        const backBtn = document.getElementById('headerBackBtn');
        if (backBtn && !backBtn.classList.contains('hidden')) {
            backBtn.click();
            return true;
        }
    }

    if (!deckListVisible) return false;
    if (!deckSelectionState.items.length) rebuildDeckSelection();

    if (key === 'ArrowDown') return moveDeckSelection(1);
    if (key === 'ArrowUp') return moveDeckSelection(-1);
    if (key === 'Enter') return openSelectedDeck();
    if (key === 'Delete' || key === 'Backspace') return deleteSelectedDeck();

    return false;
}

function initKeyboardShortcuts() {
    keyboardManager?.registerContext('dashboard', handleDashboardShortcuts);
}

async function createNewDeck(name, category, cards, notes = '', typeHint = 'General') {
    const deckId = Date.now().toString();

    const settings = {
        ...DEFAULT_DECK_SETTINGS,
        learnMode: 'write',
        reviewMode: 'flashcard',
        adaptiveModes: { auto: true, mcq: true, cloze: true }
    };

    const normalizedCards = cards.map(card => ({
        ...card,
        id: card.id || crypto.randomUUID()
    }));

    const tempDeck = { name, category, cards: normalizedCards, notes, typeHint };
        showToast("Analysing new deck content...", "info", 2000);
    await processDeckContent(tempDeck);

    const fsrsEngine = await getFsrsEngine();
    const processedCards = [];
    for (const c of tempDeck.cards) {
        const prepared = await prepareFsrsCard(c);
        processedCards.push({
            ...c,
            deckId: deckId,
            fsrs: serializeFsrsCard(prepared)
        });
    }

    const newDeck = {
        id: deckId,
        name,
        category,
        cards: processedCards,
        notes,
        typeHint,
        created: new Date().toISOString(),
        lastModified: new Date().toISOString(),
        settings: settings
    };
    decks[deckId] = newDeck;

    const transaction = db.transaction(['userKnowledgeState'], 'readwrite');
    const stateStore = transaction.objectStore('userKnowledgeState');
    newDeck.cards.forEach(card => {
        const cardId = card.id || crypto.randomUUID();
        card.id = cardId;

        const knowledgeRecord = createDefaultKnowledgeState(card, {
            userID: 'default_user',
            deckID: deckId,
            stability: 1.0,
            lastReviewed: new Date().toISOString(),
            fsrs: card.fsrs || null
        });

        if (knowledgeRecord) {
            stateStore.put(knowledgeRecord);
        } else {
            console.warn('[DB] Skipped new card knowledge state due to missing identifiers', card);
        }
    });
    await new Promise(resolve => transaction.oncomplete = resolve);
    await saveDataToDB('decks', newDeck);
    if (isOnline) {
        loadUserDataAndSync();
    }
    return deckId;
}

function editDeck(deckId) {
    const deck = decks[deckId];
    if (!deck) return;
    transitionView('editorView');
    document.getElementById('deckTitle').value = deck.name;
    document.getElementById('deckCategory').value = deck.category;
    document.getElementById('deckNotes').value = deck.notes || '';

    const deckTypeHintEl = document.getElementById('deckTypeHint');
    if (deckTypeHintEl) deckTypeHintEl.value = deck.typeHint || 'General';

    const container = document.getElementById('flashcardsContainer');
    container.innerHTML = '';
    editorCardCounter = 0;

    const addType = (deck.typeHint === 'Sequence') ? 'Sequence' : 'Standard';
    deck.cards.forEach(card => editorAddNewCard(addType, card));

    toggleEditorView(deck.typeHint || 'General');
    currentDeckId = deckId;
}

function deleteDeck(deckId) {
    const deckName = decks[deckId]?.name || 'this deck';
    showConfirmModal(`Are you sure you want to permanently delete the deck "${deckName}"? This action cannot be undone.`, async () => {
        try {
            console.log('Deleting deck:', deckId);
            delete decks[deckId];
            await deleteDataFromDB('decks', deckId);
            console.log('Deck deleted from database');

            // Navigate back to dashboard if viewing deleted deck
            if (currentViewingDeckId === deckId) {
                backToDashboard();
            } else {
                updateDashboard();
            }

            showToast(`Deck "${deckName}" deleted.`, 'success');

            // Sync if online and authenticated (check auth0Session instead of userToken)
            const auth0Session = localStorage.getItem('auth0Session');
            if (isOnline && auth0Session) {
                console.log('Syncing after deck deletion');
                await loadUserDataAndSync();
            }
        } catch (error) {
            console.error('Error deleting deck:', error);
            showToast(`Failed to delete deck: ${error.message}`, 'error');
            throw error;
        }
    });
}

function editorInitialise() {
    document.getElementById('deckTitle').value = '';
    populateCategoryDropdowns();
    document.getElementById('deckCategory').value = 'Other';
    document.getElementById('deckNotes').value = '';
    document.getElementById('deckTypeHint').value = 'General';
    editorCardCounter = 0;
    currentDeckId = null;

    toggleEditorView('General');

    editorAddNewCard('General');
    editorAddNewCard('General');
    document.getElementById('deckTitle').focus();
}

function isEditorClean() {



    const titleEl = document.getElementById('deckTitle');
    const title = titleEl ? (titleEl.value || '').trim() : '';
    if (title) return false;

    const cardItems = document.querySelectorAll('#editorView .flashcard-item');
    for (const item of cardItems) {

        const qEl = item.querySelector('.question-input') || item.querySelector('.sequence-desc-input') || item.querySelector('.sequence-term-input');
        const aEl = item.querySelector('.solution-input') || item.querySelector('.sequence-term-input') || item.querySelector('.sequence-desc-input');

        const q = qEl ? ((qEl.value || '').trim()) : '';
        const a = aEl ? ((aEl.value || '').trim()) : '';

        const qImgEl = item.querySelector('.question-image-input');
        const aImgEl = item.querySelector('.answer-image-input');
        const qImg = qImgEl ? ((qImgEl.value || '').trim()) : '';
        const aImg = aImgEl ? ((aImgEl.value || '').trim()) : '';

        if (q || a || qImg || aImg) return false;
    }
    return true;
}

function editorAddNewStandardCard(card = {}) {
    const { id = null, question = '', answer = '', questionImage = '', answerImage = '', order = '' } = card;
    editorCardCounter++;
    const container = document.getElementById('flashcardsContainer');

    const newRow = document.createElement('div');
    newRow.className = 'flashcard-editor-row';
    newRow.setAttribute('data-card-id', editorCardCounter);

    const questionImagePreview = questionImage ? `<img src="${escapeHtml(String(questionImage))}">` : '';
    const answerImagePreview = answerImage ? `<img src="${escapeHtml(String(answerImage))}">` : '';

    const deckType = document.getElementById('deckTypeHint').value;
    const cardNumber = document.querySelectorAll('.flashcard-editor-row').length + 1;

    const orderInputHTML = (deckType === 'Sequence')
        ? `<input type="number" class="card-order-input" value="${escapeHtml(String(order || cardNumber))}" style="width: 60px; margin-right: 10px; padding: 5px 8px; text-align: center;">`
        : '';

    newRow.innerHTML = `<div class="flashcard-item" data-original-id="${escapeHtml(String(id || ''))}">
                <div class="flashcard-number" style="display: flex; align-items: center;">
                    ${orderInputHTML}
                    <span>${cardNumber}.</span>
                </div>
                
                <textarea class="question-input" placeholder="Question (e.g., The event or item in the sequence)" data-card-id="${editorCardCounter}">${escapeHtml(String(question))}</textarea>
                <div class="editor-accent-buttons accent-buttons" style="margin-top: 8px;"></div>
                <div class="image-controls">
                    <button class="btn btn-secondary" style="padding: 5px 10px; font-size: 12px;" onclick="triggerImageUpload(this)" tabindex="-1">Upload Image</button>
                </div>
                <div class="question-image-preview image-preview">${questionImagePreview}</div>
                <input type="file" class="image-upload-input" accept="image/*" style="display:none;" onchange="handleImageFile(this)">
                <input type="hidden" class="question-image-input" value="${escapeHtml(String(questionImage))}">
                
                <textarea class="solution-input" placeholder="Answer (e.g., The name of the event or item)" style="margin-top:20px;" data-card-id="${editorCardCounter}">${escapeHtml(String(answer))}</textarea>
                <div class="editor-accent-buttons accent-buttons" style="margin-top: 8px;"></div>
                <div class="image-controls">
                    <button class="btn btn-secondary" style="padding: 5px 10px; font-size: 12px;" onclick="triggerImageUpload(this)" tabindex="-1">Upload Image</button>
                </div>
                <div class="answer-image-preview image-preview">${answerImagePreview}</div>
                <input type="file" class="image-upload-input" accept="image/*" style="display:none;" onchange="handleImageFile(this)">
                <input type="hidden" class="answer-image-input" value="${escapeHtml(String(answerImage))}">
            </div>
            <button class="remove-card-btn" onclick="editorRemoveCard(${editorCardCounter})"><svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor" style="width: 20px; height: 20px;"><path stroke-linecap="round" stroke-linejoin="round" d="m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0" /></svg></button>
            <div class="drag-handle" style="cursor: grab; padding: 0 10px; color: var(--secondary-text);">
                <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" fill="currentColor" viewBox="0 0 16 16">
                    <path d="M7 2a1 1 0 1 1-2 0 1 1 0 0 1 2 0zm3 0a1 1 0 1 1-2 0 1 1 0 0 1 2 0zM7 5a1 1 0 1 1-2 0 1 1 0 0 1 2 0zm3 0a1 1 0 1 1-2 0 1 1 0 0 1 2 0zM7 8a1 1 0 1 1-2 0 1 1 0 0 1 2 0zm3 0a1 1 0 1 1-2 0 1 1 0 0 1 2 0zm-3 3a1 1 0 1 1-2 0 1 1 0 0 1 2 0zm3 0a1 1 0 1 1-2 0 1 1 0 0 1 2 0z"/>
                </svg>
            </div> `;

    container.appendChild(newRow);

    newRow.querySelectorAll('textarea').forEach(textarea => {
        textarea.addEventListener('paste', handleImagePaste);
    });

    // Populate accent buttons for this card
    const questionAccentContainer = newRow.querySelector('.question-input').nextElementSibling;
    const answerAccentContainer = newRow.querySelector('.solution-input').nextElementSibling;
    populateEditorAccentButtons(questionAccentContainer, newRow.querySelector('.question-input'));
    populateEditorAccentButtons(answerAccentContainer, newRow.querySelector('.solution-input'));

    if (!question && !answer) newRow.querySelector('.question-input').focus();
}

function editorAddNewCard(type, card = {}) {
    if (type === 'Sequence') {
        editorAddNewSequenceCard(card);
    } else {
        editorAddNewStandardCard(card);
    }
    editorRenumberCards();
}

function editorAddNewSequenceCard(card = {}) {
    const { question = '', answer = '', order = 0 } = card;
    editorCardCounter++;
    const container = document.getElementById('flashcardsContainer');
    const cardNumber = document.querySelectorAll('.flashcard-editor-row').length + 1;

    const newRow = document.createElement('div');
    newRow.className = 'flashcard-editor-row drag-item';
    newRow.setAttribute('data-card-id', editorCardCounter);

    newRow.innerHTML = `
            <div class="drag-handle" style="cursor: grab; padding: 0 10px; color: var(--secondary-text); display: flex; align-items: center; align-self: stretch;">
                <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" fill="currentColor" viewBox="0 0 16 16">
                    <path d="M7 2a1 1 0 1 1-2 0 1 1 0 0 1 2 0zm3 0a1 1 0 1 1-2 0 1 1 0 0 1 2 0zM7 5a1 1 0 1 1-2 0 1 1 0 0 1 2 0zm3 0a1 1 0 1 1-2 0 1 1 0 0 1 2 0zM7 8a1 1 0 1 1-2 0 1 1 0 0 1 2 0zm3 0a1 1 0 1 1-2 0 1 1 0 0 1 2 0zm-3 3a1 1 0 1 1-2 0 1 1 0 0 1 2 0zm3 0a1 1 0 1 1-2 0 1 1 0 0 1 2 0z"/>
                </svg>
            </div>
            <div class="flashcard-item" data-original-id="${card.id || ''}" style="flex-grow: 1; display: flex; flex-direction: column; gap: 15px;">
                
                <div style="display: flex; align-items: center; justify-content: space-between;">
                    <div class="flashcard-number" style="
                        background: var(--primary-color); 
                        color: white; 
                        padding: 4px 12px; 
                        border-radius: 20px; 
                        font-weight: 600; 
                        font-size: 0.9rem;
                    "></div>
                    <span style="color: var(--secondary-text); font-size: 0.85rem; font-style: italic;">
                        Drag to reorder
                    </span>
                </div>
                
                
                <div>
                    <label style="
                        display: block; 
                        font-size: 0.9rem; 
                        font-weight: 600; 
                        color: var(--text-color); 
                        margin-bottom: 8px;
                    ">Sequence Term (Required)</label>
                    <input 
                        type="text" 
                        class="sequence-term-input" 
                        placeholder="e.g., 'Battle of Hastings' or 'Mitosis'" 
                        value="${escapeHtml(String(answer))}" 
                        style="
                            width: 100%; 
                            padding: 12px 15px; 
                            border: 2px solid var(--border-color); 
                            border-radius: 10px; 
                            font-size: 1.1rem; 
                            font-weight: 500;
                            background: var(--input-bg);
                            color: var(--text-color);
                            transition: all 0.3s;
                        "
                    >
                </div>
                
                
                <div>
                    <label style="
                        display: block; 
                        font-size: 0.85rem; 
                        font-weight: 500; 
                        color: var(--secondary-text); 
                        margin-bottom: 6px;
                    ">Description (Optional)</label>
                    <textarea 
                        class="sequence-desc-input" 
                        placeholder="Add context, dates, or additional details..." 
                        style="
                            width: 100%; 
                            padding: 10px 15px; 
                            border: 2px solid var(--border-color); 
                            border-radius: 10px; 
                            font-size: 0.95rem; 
                            background: var(--input-bg);
                            color: var(--text-color);
                            resize: vertical;
                            min-height: 60px;
                            transition: all 0.3s;
                        "
                    >${escapeHtml(String(question))}</textarea>
                </div>
            </div>
            <button class="remove-card-btn" onclick="editorRemoveCard(${editorCardCounter})" style="
                align-self: flex-start;
                margin-top: 8px;
            ">
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor" style="width: 20px; height: 20px;">
                    <path stroke-linecap="round" stroke-linejoin="round" d="m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0" />
                </svg>
            </button>
        `;

    container.appendChild(newRow);


    const termInput = newRow.querySelector('.sequence-term-input');
    const descInput = newRow.querySelector('.sequence-desc-input');

    [termInput, descInput].forEach(input => {
        input.addEventListener('focus', function () {
            this.style.borderColor = 'var(--primary-color)';
            this.style.backgroundColor = 'var(--input-focus-bg)';
        });
        input.addEventListener('blur', function () {
            this.style.borderColor = 'var(--border-color)';
            this.style.backgroundColor = 'var(--input-bg)';
        });
    });

    if (!answer) termInput.focus();
}


function triggerImageUpload(button) {
    button.closest('.image-controls').nextElementSibling.nextElementSibling.click();
}

async function handleImageFile(input) {
    const file = input.files[0];
    if (file && file.type.startsWith('image/')) {
        const reader = new FileReader();
        reader.onload = async e => {
            const dataUrl = e.target.result;
            const compressedUrl = await compressImage(dataUrl);
            const preview = input.previousElementSibling;
            const dataInput = input.nextElementSibling;
            preview.innerHTML = '';
            const img = document.createElement('img');
            img.src = compressedUrl;
            preview.appendChild(img);
            dataInput.value = compressedUrl;
        };
        reader.readAsDataURL(file);
    }
}

function handleImagePaste(event) {
    const items = (event.clipboardData || window.clipboardData).items;
    for (let i = 0; i < items.length; i++) {
        if (items[i].type.indexOf('image') !== -1) {
            event.preventDefault();
            const blob = items[i].getAsFile();
            const reader = new FileReader();
            reader.onload = (e) => {
                const dataUrl = e.target.result;
                const textarea = event.target;
                const preview = textarea.nextElementSibling.nextElementSibling;
                const dataInput = preview.nextElementSibling.nextElementSibling;
                preview.innerHTML = '';
                const img = document.createElement('img');
                img.src = dataUrl;
                preview.appendChild(img);
                dataInput.value = dataUrl;
            };
            reader.readAsDataURL(blob);
            break;
        }
    }
}

function triggerNotesImageUpload(button) {
    button.nextElementSibling.click();
}

function handleNotesImageUpload(input) {
    const file = input.files[0];
    if (file && file.type.startsWith('image/')) {
        const reader = new FileReader();
        reader.onload = e => {
            const dataUrl = e.target.result;
            const notesTextarea = document.getElementById('deckNotes');
            const imgTag = `<img src="${dataUrl}" style="max-width: 100%; border-radius: 8px;">`;
            notesTextarea.value += (notesTextarea.value ? '\n\n' : '') + imgTag;
        };
        reader.readAsDataURL(file);
    }
}

function editorRemoveCard(cardId) {
    const cardRow = document.querySelector(`#editorView [data-card-id="${cardId}"]`);
    if (cardRow) {
        cardRow.remove();
        editorRenumberCards();
    }
}

function editorRenumberCards() {
    const deckType = document.getElementById('deckTypeHint').value;
    const cardRows = document.querySelectorAll('#editorView .flashcard-editor-row');
    cardRows.forEach((row, index) => {
        const numberElement = row.querySelector('.flashcard-number');
        if (numberElement) {
            numberElement.textContent = `${index + 1}.`;
        }
    });
}

async function editorSaveDeck() {
    const saveBtn = document.querySelector('.editor-container .actions-section .btn-success');
    const originalText = saveBtn.innerHTML;
    saveBtn.innerHTML = '<span class="spinner" style="border-width:2px; width:16px; height:16px;"></span> Saving...';
    saveBtn.disabled = true;

    try {
        const name = document.getElementById('deckTitle').value.trim();
        const category = document.getElementById('deckCategory').value;
        const notes = document.getElementById('deckNotes').value.trim();
        const typeHint = document.getElementById('deckTypeHint').value;

        if (!name) {
            showToast('Please enter a title for your deck.', 'error');
            saveBtn.innerHTML = originalText;
            saveBtn.disabled = false;
            return;
        }

        let cards = [];
        if (typeHint === 'Sequence') {
            cards = Array.from(document.querySelectorAll('#editorView .flashcard-item')).map((el, index) => {
                const originalId = el.dataset.originalId;
                const term = el.querySelector('.sequence-term-input').value.trim();
                const description = el.querySelector('.sequence-desc-input').value.trim();

                if (!term) return null;

                return {
                    id: originalId || crypto.randomUUID(),
                    question: description,
                    answer: term,
                    order: index + 1,
                    isNew: !originalId,
                    questionImage: '',
                    answerImage: ''
                };
            }).filter(Boolean);
        } else {
            cards = Array.from(document.querySelectorAll('#editorView .flashcard-item')).map(el => {
                const originalId = el.dataset.originalId;
                return {
                    id: originalId ? originalId : crypto.randomUUID(),
                    question: el.querySelector('.question-input').value.trim(),
                    answer: el.querySelector('.solution-input').value.trim(),
                    questionImage: el.querySelector('.question-image-input').value.trim(),
                    answerImage: el.querySelector('.answer-image-input').value.trim(),
                    order: 0,
                    isNew: !originalId
                };
            }).filter(c => c.question || c.questionImage);
        }

        if (cards.length === 0) {
            showToast('Please add at least one complete flashcard.', 'error');
            saveBtn.innerHTML = originalText;
            saveBtn.disabled = false;
            return;
        }

        const newCards = cards.filter(c => c.isNew);
        if (newCards.length > 0) {
            try {
                await new Promise((resolve, reject) => {
                    const transaction = db.transaction(['userKnowledgeState'], 'readwrite');
                    const stateStore = transaction.objectStore('userKnowledgeState');
                    transaction.oncomplete = resolve;
                    transaction.onerror = reject;

                    newCards.forEach(card => {
                        const cardId = card.id || crypto.randomUUID();
                        card.id = cardId;

                        const knowledgeRecord = createDefaultKnowledgeState(card, {
                            userID: 'default_user',
                            deckID: currentDeckId || null,
                            stability: 1.0,
                            lastReviewed: new Date().toISOString(),
                            fsrs: card.fsrs || null
                        });

                        if (knowledgeRecord) {
                            stateStore.put(knowledgeRecord);
                        } else {
                            console.warn('[DB] Skipped imported card knowledge state due to missing identifiers', card);
                        }
                        card.isNew = false;
                    });
                });
            } catch (error) {
                console.error("Failed to save knowledge state for new cards:", error);
                showToast("Error saving new cards' progress.", "error");
                saveBtn.innerHTML = originalText;
                saveBtn.disabled = false;
                return;
            }
        }

        const tempDeck = { name, category, cards, notes, typeHint };
        showToast("Analysing deck content...", "info", 2000);
        await processDeckContent(tempDeck);

        if (currentDeckId) {
            const deck = decks[currentDeckId];
            deck.name = name;
            deck.category = category;
            deck.cards = tempDeck.cards;
            deck.notes = notes;
            deck.typeHint = typeHint;
            deck.lastModified = new Date().toISOString();
            await saveDataToDB('decks', deck);
        } else {
            await createNewDeck(name, category, tempDeck.cards, notes, typeHint);
        }
        if (isOnline) {
            loadUserDataAndSync();
        } else {
            showToast("Deck saved locally. It will sync when you're next online.", "info");
        }

        document.getElementById('deckTitle').value = '';
        document.getElementById('flashcardsContainer').innerHTML = '';
        backToDashboard();
    } catch (error) {
        console.error("Failed to save deck", error);
        showToast("Could not save deck. Please retry.", "error");
        saveBtn.innerHTML = originalText;
        saveBtn.disabled = false;
    }
}

function checkName() {
}

function saveName(e) {
}

async function saveUsername() {
    const username = document.getElementById('usernameInput').value.trim();
    if (username) {
        globalSettings.username = username;
        await saveDataToDB('appData', { key: 'userSettings', ...globalSettings });
        document.getElementById('welcomeMessage').textContent = `Welcome back, ${username}!`;
        showToast('Name saved!');
    } else showToast('Name cannot be empty.', 'error');
}

async function saveStudySettings() {
    globalSettings.enableInStudyEditing = document.getElementById('enableInStudyEditing').checked;
    globalSettings.enableInStudyEditing = document.getElementById('enableInStudyEditing').checked;
    globalSettings.hideExamPlanBanner = !document.getElementById('toggleExamPlanBanner').checked;
    globalSettings.enableToasts = document.getElementById('enableToastsToggle').checked;
    await saveDataToDB('appData', { key: 'userSettings', ...globalSettings });
    showToast('Settings saved!');
}

function closeNameModal() { }

async function toggleDarkMode() {
    const html = document.documentElement;
    const body = document.body;

    html.classList.toggle('dark-mode');
    if (html.classList.contains('dark-mode')) {
        body.classList.add('dark-mode');
    } else {
        body.classList.remove('dark-mode');
    }

    globalSettings.darkMode = html.classList.contains('dark-mode');
    await saveDataToDB('appData', { key: 'userSettings', ...globalSettings });
}

async function clearAllDecks() {
    showConfirmModal('Are you sure you want to delete all decks? This is irreversible.', async () => {
        decks = {};
        await clearStoreInDB('decks');
        updateDashboard();
        backToDashboard();
    });
}

function populateCategoryDropdowns() {
    const dropdowns = [document.getElementById('deckCategory'), document.getElementById('importDeckCategory')];
    dropdowns.forEach(dropdown => {
        if (!dropdown) return;
        const currentValue = dropdown.value;
        dropdown.innerHTML = '';
        categories.forEach(cat => {
            const opt = document.createElement('option');
            opt.value = String(cat);
            opt.textContent = String(cat);
            dropdown.appendChild(opt);
        });
        const addOpt = document.createElement('option');
        addOpt.value = 'add_new_category';
        addOpt.style.fontStyle = 'italic';
        addOpt.textContent = '+ Add New Category...';
        dropdown.appendChild(addOpt);
        if (currentValue && currentValue !== 'add_new_category') {
            dropdown.value = currentValue;
        }
    });
}

function handleCategoryChange(event) {
    if (event.target.value === 'add_new_category') openAddCategoryModal();
}

function openAddCategoryModal() {
    document.getElementById('addCategoryModal').classList.add('show');
    document.getElementById('newCategoryInput').focus();
}
function closeAddCategoryModal() {
    populateCategoryDropdowns();
    document.getElementById('addCategoryModal').classList.remove('show');
}

async function saveNewCategory() {
    const newCatInput = document.getElementById('newCategoryInput');
    let newCat = newCatInput.value.trim();
    if (newCat) {
        newCat = newCat.charAt(0).toUpperCase() + newCat.slice(1);
        if (!categories.includes(newCat)) {
            categories.push(newCat);
            await saveDataToDB('appData', { key: 'categories', data: categories });
            populateCategoryDropdowns();

            const deckCat = document.getElementById('deckCategory');
            if (deckCat) deckCat.value = newCat;

            const importCat = document.getElementById('importDeckCategory');
            if (importCat) importCat.value = newCat;
        }
        newCatInput.value = '';
        closeAddCategoryModal();
    } else showToast('Category name cannot be empty.', 'error');
}

function openLearnModeSetupModal() {
    const modal = document.getElementById('learnModeSetupModal');
    const deck = decks[currentDeckId];

    // Set default date to today + 7 days if not set
    const defaultDate = new Date();
    defaultDate.setDate(defaultDate.getDate() + 7);
    document.getElementById('learnModeExamDate').valueAsDate = defaultDate;

    if (deck.settings && deck.settings.examDate) {
        document.getElementById('learnModeExamDate').value = deck.settings.examDate;
    }
    if (deck.settings && deck.settings.targetRetention) {
        document.getElementById('learnModeRetention').value = deck.settings.targetRetention * 100;
        document.getElementById('learnModeRetentionValue').textContent = (deck.settings.targetRetention * 100) + '%';
    }
    if (deck.settings && deck.settings.learnModeMaxCards) {
        document.getElementById('learnModeMaxCards').value = deck.settings.learnModeMaxCards;
    }
    modal.classList.add('show');
}

// Pomodoro Timer Logic
let pomodoroState = {
    timeLeft: 25 * 60,
    isRunning: false,
    mode: 'work', // 'work' or 'break'
    intervalId: null
};

function togglePomodoro() {
    const playPauseBtn = document.getElementById('pomodoroPlayPause');
    if (pomodoroState.isRunning) {
        clearInterval(pomodoroState.intervalId);
        pomodoroState.isRunning = false;
        if (playPauseBtn) playPauseBtn.textContent = '\u25B6 Start';
    } else {
        pomodoroState.isRunning = true;
        if (playPauseBtn) playPauseBtn.textContent = '\u23F8 Pause';
        pomodoroState.intervalId = setInterval(() => {
            pomodoroState.timeLeft--;
            updatePomodoroDisplay();
            if (pomodoroState.timeLeft <= 0) {
                completePomodoroPhase();
            }
        }, 1000);
    }
}

function resetPomodoro() {
    clearInterval(pomodoroState.intervalId);
    pomodoroState.isRunning = false;
    pomodoroState.mode = 'work';
    pomodoroState.timeLeft = 25 * 60;
    updatePomodoroDisplay();
    const playPauseBtn = document.getElementById('pomodoroPlayPause');
    if (playPauseBtn) playPauseBtn.textContent = '\u25B6 Start';
    document.getElementById('pomodoroTimer').style.background = 'rgba(0,0,0,0.05)';
}

function completePomodoroPhase() {
    clearInterval(pomodoroState.intervalId);
    pomodoroState.isRunning = false;
    const playPauseBtn = document.getElementById('pomodoroPlayPause');
    if (playPauseBtn) playPauseBtn.textContent = '\u25B6 Start';

    if (pomodoroState.mode === 'work') {
        pomodoroState.mode = 'break';
        pomodoroState.timeLeft = 5 * 60;
        showToast("Work session complete! Time for a break.", "success");
        document.getElementById('pomodoroTimer').style.background = 'rgba(72, 187, 120, 0.2)'; // Green tint
    } else {
        pomodoroState.mode = 'work';
        pomodoroState.timeLeft = 25 * 60;
        showToast("Break over! Back to work.", "info");
        document.getElementById('pomodoroTimer').style.background = 'rgba(0,0,0,0.05)';
    }
    updatePomodoroDisplay();
}

function updatePomodoroDisplay() {
    const minutes = Math.floor(pomodoroState.timeLeft / 60);
    const seconds = pomodoroState.timeLeft % 60;
    document.getElementById('pomodoroDisplay').textContent =
        `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;

    // Update mode label
    const modeLabel = document.getElementById('pomodoroMode');
    if (modeLabel) {
        modeLabel.textContent = pomodoroState.mode === 'work' ? 'WORK' : 'BREAK';
    }
}

function closeLearnModeSetupModal() {
    document.getElementById('learnModeSetupModal').classList.remove('show');
}

async function startLearnModeWithSetup() {
    const examDate = document.getElementById('learnModeExamDate').value;
    const retention = document.getElementById('learnModeRetention').value / 100;
    const maxCards = document.getElementById('learnModeMaxCards').value;

    const deck = decks[currentDeckId];
    if (!deck.settings) deck.settings = {};

    if (examDate) deck.settings.examDate = examDate;
    deck.settings.targetRetention = retention;
    deck.settings.learnModeMaxCards = maxCards ? parseInt(maxCards) : null;

    await saveDataToDB('decks', deck);
    closeLearnModeSetupModal();
    startLearnMode(currentDeckId);
}

function configureStudy(mode, deckId) {
    currentDeckId = deckId || currentViewingDeckId;
    if (!currentDeckId) return;

    if (mode === 'learn') {
        const deck = decks[currentDeckId];
        // If exam date is not set, or user holds Shift (power user feature?), open modal
        // For now, just check if exam date is set.
        if (!deck.settings || !deck.settings.examDate) {
            openLearnModeSetupModal();
        } else {
            startLearnMode(currentDeckId);
        }
    } else if (mode === 'review') {
        startReviewMode(currentDeckId);
    } else if (mode === 'spaced') {
        startSpacedLearning(currentDeckId);
    }
}

async function startLearnMode(deckId) {
    currentMode = 'learn';
    currentDeckId = deckId;
    const deck = decks[deckId];

    studyAccentModule?.refresh();

    // Ensure defaults
    deck.settings = { ...DEFAULT_DECK_SETTINGS, ...(deck.settings || {}) };
    studyState.settings = deck.settings;
    
    // Attempt to restore previous session context
    const restored = await restoreStudySession();
    if (!restored) {
        resetSessionState();
    }
    
    studyState.currentCard = null;
    studyState.currentRound = 1;
    studyState.roundCards = [];
    studyState.currentCardIndex = 0;
    studyState.incorrectInThisRound = [];

    // Show/Hide Edit Button based on settings
    const editBtn = document.getElementById('editStudyCardBtn');
    if (globalSettings.enableInStudyEditing) {
        editBtn.classList.remove('hidden');
    } else {
        editBtn.classList.add('hidden');
    }

    const fsrsEngine = await getFsrsEngine();
    const allKnowledge = await getAllDataFromDB('userKnowledgeState');
    const knowledgeMap = new Map();
    allKnowledge.forEach(state => {
        const parsedId = typeof state.id === 'string' ? state.id.split(':').filter(Boolean) : [];
        const parsedCardId = parsedId.length >= 2 ? parsedId[1] : (parsedId.length === 1 ? parsedId[0] : null);
        const prepared = fsrsEngine.prepareCard(state.fsrs || state);
        const snapshot = serializeFsrsCard(prepared);
        const normalized = {
            ...state,
            id: `${state.userID || 'default_user'}:${state.cardID || parsedCardId}`,
            userID: state.userID || 'default_user',
            cardID: state.cardID || parsedCardId || state.id,
            deckID: state.deckID || deck.id,
            fsrs: snapshot,
            stability: typeof state.stability === 'number' ? state.stability : snapshot.stability || 0,
            lastReviewed: state.lastReviewed || snapshot.last_review || null
        };
        knowledgeMap.set(normalized.cardID, normalized);
    });
    studyState.knowledgeStates = knowledgeMap;
    for (const card of deck.cards) {
        let state = knowledgeMap.get(card.id);
        if (!state) {
            state = await getOrCreateKnowledgeState('default_user', card.id, deck.id);
            knowledgeMap.set(card.id, state);
        }
        if (state?.fsrs) card.fsrs = state.fsrs;
    }

    // Reset learn reps only if starting a fresh session
    if (!restored) {
        for (const state of knowledgeMap.values()) {
            state.learnRepsThisSession = 0;
        }
    }

    const cortex = await getCortexEngine();
    const now = new Date();
    const targetDate = cortex.buildTargetDate(deck, now);
    logLearnTargetSource(deck, now, targetDate);
    const candidates = deck.cards.map(card => {
        const state = knowledgeMap.get(card.id);
        const retention = calculateRetentionAtDate(state, targetDate);
        return { card, knowledgeState: state, projectedRetention: typeof retention === 'number' ? retention : 0 };
    }).filter(entry => {
        const retention = entry.projectedRetention;
        if (retention >= 0.9) return false;
        return !isCardMasteredForLearn(entry.knowledgeState, deck, targetDate);
    });
    candidates.sort((a, b) => (a.projectedRetention ?? 0) - (b.projectedRetention ?? 0));
    const learnModeMaxCards = deck.settings.learnModeMaxCards ? parseInt(deck.settings.learnModeMaxCards) : 40;
    const maxCards = Number.isFinite(learnModeMaxCards) ? learnModeMaxCards : 40;
    const activeLearningPool = candidates.slice(0, maxCards).map(entry => entry.card);
    studyState.activeLearningPool = activeLearningPool;
    studyState.roundCards = [];
    studyState.sessionCardIds = activeLearningPool.map(c => c.id);
    studyState.examDate = deck.settings.examDate ? new Date(deck.settings.examDate) : null;
    studyState.targetRetention = deck.settings.targetRetention || 0.85;

    if (activeLearningPool.length === 0) {
        showToast("No cards available to study.", "info");
        return;
    }

    assignQuestionTypesToCards(activeLearningPool, deckId);

    transitionView('studyMode');
    resetStudySubViews();
    document.getElementById('studyTitle').textContent = 'Learning Session';
    document.getElementById('studySubtitle').textContent = deck.name;

    if (deck.settings.enablePomodoro) {
        document.getElementById('pomodoroTimer').classList.remove('hidden');
        resetPomodoro();
    } else {
        document.getElementById('pomodoroTimer').classList.add('hidden');
    }

    setupSessionProgressBar();
    updateSessionProgress();

    const progressView = document.getElementById('progressView');
    progressView.classList.remove('hidden');
    const preGenerationView = document.getElementById('preGenerationView');
    const cardView = document.getElementById('cardView');
    const cardsRequiringGeneration = activeLearningPool.filter(card => card.questionTypeToShow === 'MultipleChoice' && isOnline);
    let transitionSource = progressView;

    if (cardsRequiringGeneration.length > 0) {
        transitionSubView(progressView, preGenerationView);

        const updateProgressUI = (completed, total) => {
            const percent = total > 0 ? (completed / total) * 100 : 100;
            document.getElementById('preGenerationProgress').style.width = `${percent}%`;
            document.getElementById('preGenerationProgressText').textContent = `Generating smart questions... ${completed}/${total}`;
        };

        try {
            await preGenerateAdaptiveQuestions(activeLearningPool, updateProgressUI);
            transitionSource = preGenerationView;
        } catch (error) {
            console.error('Pre-generation error:', error);
            showToast('Preparing smart questions failed. Continuing without them.', 'warning');
            transitionSource = preGenerationView;
        } finally {
            hidePreGenerationViewImmediately();
        }
    } else {
        hidePreGenerationViewImmediately();
        transitionSource = progressView;
    }

    studyState.currentCard = await cortex.pickNextCard(activeLearningPool, studyState.sessionState, deck, studyState.knowledgeStates);
    studyState.currentCardIndex = 0;
    studyState.startTime = new Date();

    transitionSubView(transitionSource, cardView);
    if (studyState.currentCard) {
        showNextCard();
    } else {
        showComplete();
    }
}


function setupSessionProgressBar() {
    const infoContainer = document.getElementById('cardRoundInfo');
    infoContainer.innerHTML = '';
    infoContainer.style.background = 'transparent';

    infoContainer.innerHTML = `
                <div class="session-progress-wrapper">
                    <div class="session-stats" id="sessionCounter" style="margin-bottom: 5px;">Calculating...</div>
                    <div class="session-progress-track">
                        <div class="session-progress-fill" id="sessionProgressBar"></div>
                    </div>
                </div>
            `;
}


async function updateSessionProgress() {
    if (!studyState.sessionCardIds || studyState.sessionCardIds.length === 0) return;

    let stateMap = studyState.knowledgeStates;
    if (!stateMap || stateMap.size === 0) {
        const allStates = await getAllDataFromDB('userKnowledgeState');
        stateMap = new Map(allStates.map(s => [s.cardID, s]));
        studyState.knowledgeStates = stateMap;
    }
    const deck = decks[currentDeckId];
    const hasExamDate = deck.settings && deck.settings.examDate;
    const targetRetention = (deck.settings && deck.settings.targetRetention) || 0.8;
    const examDate = hasExamDate ? new Date(deck.settings.examDate) : null;
    const targetDate = hasExamDate ? examDate : new Date();

    let totalScore = 0;

    studyState.sessionCardIds.forEach(id => {
        const state = stateMap.get(id);
        const retention = hasExamDate ? calculateExamRetention(state, targetDate) : calculateRetentionAtDate(state, targetDate);
        const target = hasExamDate ? targetRetention : 0.9;
        let score = target ? retention / target : retention;
        if (score > 1) score = 1;
        totalScore += score;
    });

    const avgScore = totalScore / studyState.sessionCardIds.length;

    let visualPercent;
    visualPercent = avgScore * 100;

    visualPercent = Math.max(0, Math.min(100, visualPercent));

    const bar = document.getElementById('sessionProgressBar');
    const text = document.getElementById('sessionCounter');

    if (bar) bar.style.width = `${visualPercent}%`;

    if (text) {
        const current = Math.round(visualPercent);
        text.innerHTML = '';
        const label = document.createTextNode('Progress: ');
        const percentSpan = document.createElement('span');
        percentSpan.style.color = 'var(--primary-color)';
        percentSpan.textContent = `${current}%`;
        text.appendChild(label);
        text.appendChild(percentSpan);
    }
}

async function startSpacedLearning(deckId) {
    resetStudySubViews();
    currentMode = 'spaced';
    currentDeckId = deckId;
    resetSessionState();
    const deck = decks[deckId];
    const now = new Date();

    const allCards = [...deck.cards];
    const knowledgeStates = await getAllDataFromDB('userKnowledgeState');
    const knowledgeMap = new Map(knowledgeStates.map(item => [item.cardID, item]));

    const dueCards = allCards.filter(card => {
        const state = knowledgeMap.get(card.id);
        const fsrsDue = card.fsrs?.due ? new Date(card.fsrs.due) : null;
        if (fsrsDue && fsrsDue <= now) return true;
        if (!state) return true;
        const pRecall = calculatePRecall(state.stability, state.lastReviewed);
        return pRecall <= 0.90;
    });

    studyState.roundCards = shuffleArray(dueCards);
    studyState.settings = deck.settings;
    studyState.currentRound = 1;
    studyState.currentCardIndex = 0;
    studyState.startTime = new Date();

    transitionView('studyMode');
    document.getElementById('studyTitle').textContent = 'Spaced Learning';
    document.getElementById('studySubtitle').textContent = deck.name;
    const progressView = document.getElementById('progressView');
    const cardView = document.getElementById('cardView');
    progressView.classList.remove('hidden');

    if (studyState.roundCards.length > 0) {
        transitionSubView(progressView, cardView);
        showNextCard();
    } else {
        showProgress();
        showToast("No cards are due for review right now!");
    }
}

async function startReviewMode(deckId) {
    currentMode = 'review';
    currentDeckId = deckId;
    resetSessionState();
    const deck = decks[deckId];

    deck.settings = { ...DEFAULT_DECK_SETTINGS, ...(deck.settings || {}) };

    const editBtn = document.getElementById('editStudyCardBtn');
    if (globalSettings.enableInStudyEditing) {
        editBtn.classList.remove('hidden');
    } else {
        editBtn.classList.add('hidden');
    }

    studyState.settings = deck.settings;
    studyState.currentCardIndex = 0;
    studyState.startTime = new Date();
    studyState.originPlanId = null;

    let allCards = [...deck.cards];
    if (allCards.length === 0) {
        showToast("This deck has no cards to review.", "error");
        return;
    }

    studyState.stillLearning = [...allCards];
    studyState.correct = [];
    studyState.lastRoundIncorrect = [];

    if (studyState.settings.reviewOrder === 'alphabetical') {
        studyState.stillLearning.sort((a, b) => a.question.localeCompare(b.question));
    } else {
        studyState.stillLearning = shuffleArray(studyState.stillLearning);
    }

    studyState.roundCards = [...studyState.stillLearning];

    transitionView('studyMode');
    resetStudySubViews();
    document.getElementById('studyTitle').textContent = 'Review Mode';
    document.getElementById('studySubtitle').textContent = deck.name;
    const progressView = document.getElementById('progressView');
    const cardView = document.getElementById('cardView');
    progressView.classList.remove('hidden');
    transitionSubView(progressView, cardView);
    showNextCard();
}


async function saveStudyProgress() {
    if (!currentDeckId) return;
    const deck = decks[currentDeckId];
    if (!deck) return;

    if (currentMode === 'learn') {
        if (deck.learnState) delete deck.learnState;
    } else if (currentMode === 'review') {
        deck.reviewState = { stillLearning: studyState.stillLearning, correct: studyState.correct, currentRound: studyState.currentRound, lastRoundIncorrect: studyState.lastRoundIncorrect };
    } else if (currentMode === 'sequence') {
        deck.sequenceState = {
            currentChunkIndex: studyState.currentChunkIndex,
            sequencePhase: studyState.sequencePhase,
            currentCardIndex: studyState.currentCardIndex,
            nextPhaseAfterReview: studyState.nextPhaseAfterReview,
            sequenceMissedInChunk: studyState.sequenceMissedInChunk,
            weakestLinkIteration: studyState.weakestLinkIteration,
            sequenceForwardQueue: studyState.sequenceForwardQueue,
            roundCardIds: (studyState.roundCards || []).map(c => c.id),
            activeChunkOverrideIds: studyState.sequenceActiveChunkOverride ? studyState.sequenceActiveChunkOverride.map(c => c.id) : null
        };
    }
    await saveDataToDB('decks', deck);
    await updateDashboard();
}

async function showProgress() {
    if (currentMode === 'learn' && studyState.currentRound > 1) {
        await runSmartCoachChecks('roundEnd');
    }
    const cardView = document.getElementById('cardView');
    const progressView = document.getElementById('progressView');
    transitionSubView(cardView, progressView);
    document.getElementById('switchStudyModeBtn').classList.add('hidden');

    const continueBtn = document.getElementById('continueBtn');
    if (studyState.currentRound === 1) {
        continueBtn.textContent = 'Start Round';
        continueBtn.classList.add('btn-prominent');
    } else {
        continueBtn.textContent = 'Continue Round';
        continueBtn.classList.remove('btn-prominent');
    }
    if (currentMode === 'learn') updateLearnProgress();

    else if (currentMode === 'exam') {
        updateExamProgress();
    }
    else if (currentMode === 'spaced') updateSpacedProgress();
}

function getBucketName(index, totalBuckets) {
    const names = {
        3: ["New", "Reviewing", "Mastered"],
        4: ["New", "Learning", "Reviewing", "Mastered"],
        5: ["New", "Learning", "Reviewing", "Mastered", "Legendary"]
    };
    return (names[totalBuckets] && names[totalBuckets][index]) || `Bucket ${index + 1}`;
}

async function updateLearnProgress() {
    const deck = decks[currentDeckId];
    const allCards = deck.cards;
    const totalCards = allCards.length;

    if (totalCards === 0) return;

    const knowledgeStates = (studyState.knowledgeStates && studyState.knowledgeStates.size > 0)
        ? Array.from(studyState.knowledgeStates.values())
        : await getAllDataFromDB('userKnowledgeState');
    const knowledgeMap = new Map(knowledgeStates.map(item => [item.cardID, item]));

    let masteredCount = 0;
    let totalRetentionScore = 0;

    const now = new Date();
    const cortex = await getCortexEngine();
    const targetDate = cortex.buildTargetDate(deck, now);
    logLearnTargetSource(deck, now, targetDate);

    allCards.forEach(card => {
        const state = knowledgeMap.get(card.id);
        const retention = calculateRetentionAtDate(state, targetDate);
        if (state && isCardMasteredForLearn(state, deck, targetDate)) {
            masteredCount++;
        }
        totalRetentionScore += retention;
    });

    const deckMasteryPercent = (totalRetentionScore / totalCards) * 100;
    const learningCount = totalCards - masteredCount;

    document.getElementById('deckMasteryProgress').style.width = `${deckMasteryPercent}%`;
    document.getElementById('deckMasteryValue').textContent = `${Math.round(deckMasteryPercent)}%`;
    document.getElementById('masteredCardCount').textContent = masteredCount;
    document.getElementById('learningCardCount').textContent = learningCount;

    const poolList = document.getElementById('activePoolList');
    if (studyState.activeLearningPool && studyState.activeLearningPool.length > 0) {
        poolList.innerHTML = '';
        studyState.activeLearningPool.forEach(card => {
            const d = document.createElement('div');
            d.className = 'deck-card-item';
            d.style.padding = '10px';
            d.style.border = 'none';
            d.textContent = card.question || '';
            poolList.appendChild(d);
        });
    } else {
        poolList.innerHTML = '';
        const p = document.createElement('p');
        p.style.cssText = 'text-align: center; color: var(--secondary-text);';
        p.textContent = "Click 'Continue' to start!";
        poolList.appendChild(p);
    }

    const continueBtn = document.getElementById('continueBtn');
    if (learningCount === 0) {
        document.getElementById('progressTitle').textContent = 'Deck Mastered!';
        document.getElementById('activeLearningPoolDisplay').classList.add('hidden');
        continueBtn.textContent = 'Finish Session';
        continueBtn.classList.add('btn-success');
        continueBtn.onclick = showComplete;
    } else {
        document.getElementById('progressTitle').textContent = 'Learning Progress';
        document.getElementById('activeLearningPoolDisplay').classList.remove('hidden');
        continueBtn.textContent = studyState.currentRound === 1 ? 'Start Round' : 'Continue Round';
        continueBtn.classList.remove('btn-success');
        continueBtn.onclick = continueStudy;
    }
}

function updateReviewProgress() {
    const deck = decks[currentDeckId];
    const mastered = studyState.correct.length, remaining = studyState.stillLearning.length, total = deck.cards.length;

    const notesContainer = document.getElementById('deckNotesDisplay');
    if (deck.notes && studyState.currentRound === 1) {
        notesContainer.innerHTML = '';
        const title = document.createElement('h3');
        title.textContent = 'Notes for this deck:';
        const noteDiv = document.createElement('div');
        noteDiv.textContent = String(deck.notes);
        notesContainer.appendChild(title);
        notesContainer.appendChild(noteDiv);
        notesContainer.classList.remove('hidden');
    } else {
        notesContainer.classList.add('hidden');
    }

    if (remaining === 0 && total > 0) {
        document.getElementById('progressTitle').textContent = 'Deck Mastered!';
        const continueBtn = document.getElementById('continueBtn');
        continueBtn.textContent = 'Finish';
        continueBtn.classList.remove('btn-prominent');
        continueBtn.classList.add('btn-success');
        continueBtn.onclick = showComplete;
        return;
    }
    document.getElementById('progressTitle').textContent = 'Review Progress';
    document.getElementById('roundInfo').textContent = `Round ${studyState.currentRound}`;
    const bucketsContainer = document.getElementById('bucketsContainer');
    if (bucketsContainer) {
        bucketsContainer.innerHTML = '';
        const bucketStill = document.createElement('div');
        bucketStill.className = 'bucket';
        const bucketNumberS = document.createElement('div');
        bucketNumberS.className = 'bucket-number';
        bucketNumberS.textContent = 'Still Learning';
        const bucketCountS = document.createElement('div');
        bucketCountS.className = 'bucket-count';
        bucketCountS.textContent = String(remaining);
        bucketStill.appendChild(bucketNumberS);
        bucketStill.appendChild(bucketCountS);
        const bucketCorrect = document.createElement('div');
        bucketCorrect.className = 'bucket';
        const bucketNumberC = document.createElement('div');
        bucketNumberC.className = 'bucket-number';
        bucketNumberC.textContent = 'Correct';
        const bucketCountC = document.createElement('div');
        bucketCountC.className = 'bucket-count';
        bucketCountC.textContent = String(mastered);
        bucketCorrect.appendChild(bucketNumberC);
        bucketCorrect.appendChild(bucketCountC);
        bucketsContainer.appendChild(bucketStill);
        bucketsContainer.appendChild(bucketCorrect);
    }
    const progress = total > 0 ? (mastered / total) * 100 : 0;
    document.getElementById('progressBarFill').style.width = `${progress}%`;
    const statsContainer = document.getElementById('statsContainer');
    if (statsContainer) {
        statsContainer.innerHTML = '';
        const stat1 = document.createElement('div');
        stat1.className = 'stat';
        const val1 = document.createElement('div');
        val1.className = 'stat-value';
        val1.textContent = String(mastered);
        const label1 = document.createElement('div');
        label1.className = 'stat-label';
        label1.textContent = 'Total Mastered';
        stat1.appendChild(val1);
        stat1.appendChild(label1);
        const stat2 = document.createElement('div');
        stat2.className = 'stat';
        const val2 = document.createElement('div');
        val2.className = 'stat-value';
        val2.textContent = String(remaining);
        const label2 = document.createElement('div');
        label2.className = 'stat-label';
        label2.textContent = 'Remaining';
        stat2.appendChild(val2);
        stat2.appendChild(label2);
        statsContainer.appendChild(stat1);
        statsContainer.appendChild(stat2);
    }
}

function updateSpacedProgress() {
    const deck = decks[currentDeckId];
    const now = new Date();
    const dueCards = deck.cards.filter(c => {
        const due = c.fsrs?.due ? new Date(c.fsrs.due) : null;
        return !due || due <= now;
    });
    const total = deck.cards.length;

    document.getElementById('progressTitle').textContent = 'Spaced Learning';
    document.getElementById('roundInfo').textContent = `${studyState.roundCards.length} cards in this session`;
    const bucketsContainer2 = document.getElementById('bucketsContainer');
    if (bucketsContainer2) bucketsContainer2.innerHTML = '';
    document.getElementById('progressBarFill').style.width = total > 0 ? `${((total - dueCards.length) / total) * 100}%` : '0%';
    const statsContainer2 = document.getElementById('statsContainer');
    if (statsContainer2) {
        statsContainer2.innerHTML = '';
        const st1 = document.createElement('div');
        st1.className = 'stat';
        const st1val = document.createElement('div');
        st1val.className = 'stat-value';
        st1val.textContent = String(dueCards.length);
        const st1label = document.createElement('div');
        st1label.className = 'stat-label';
        st1label.textContent = 'Cards Due';
        st1.appendChild(st1val);
        st1.appendChild(st1label);
        const st2 = document.createElement('div');
        st2.className = 'stat';
        const st2val = document.createElement('div');
        st2val.className = 'stat-value';
        st2val.textContent = String(total);
        const st2label = document.createElement('div');
        st2label.className = 'stat-label';
        st2label.textContent = 'Total Cards';
        st2.appendChild(st2val);
        st2.appendChild(st2label);
        statsContainer2.appendChild(st1);
        statsContainer2.appendChild(st2);
    }

    if (studyState.roundCards.length === 0) {
        document.getElementById('continueBtn').textContent = 'Finish';
        document.getElementById('continueBtn').onclick = endSession;
    } else {
        document.getElementById('continueBtn').textContent = 'Start Round';
        document.getElementById('continueBtn').onclick = continueStudy;
    }
}

async function continueStudy() {
    const continueBtn = document.getElementById('continueBtn');
    continueBtn.disabled = true;
    continueBtn.innerHTML = '<span class="spinner" style="border-width:2px; width:16px; height:16px;"></span> Loading...';

    if (currentMode === 'learn') {
        const deck = decks[currentDeckId];
        const allCards = deck.cards;
        const knowledgeStates = await getAllDataFromDB('userKnowledgeState');
        const knowledgeMap = new Map(knowledgeStates.map(item => [item.cardID, item]));
        studyState.knowledgeStates = knowledgeMap;
        studyState.currentCard = null;
        for (const card of allCards) {
            if (!knowledgeMap.get(card.id)) {
                const state = await getOrCreateKnowledgeState('default_user', card.id, deck.id);
                knowledgeMap.set(card.id, state);
            }
        }
        const cortex = await getCortexEngine();
        const now = new Date();
        const targetDate = cortex.buildTargetDate(deck, now);
        logLearnTargetSource(deck, now, targetDate);
        const learnModeMaxCards = deck.settings.learnModeMaxCards ? parseInt(deck.settings.learnModeMaxCards) : 40;
        const maxCards = Number.isFinite(learnModeMaxCards) ? learnModeMaxCards : 40;

        const nonMasteredCards = allCards.map(card => {
            const state = knowledgeMap.get(card.id);
            const retention = calculateRetentionAtDate(state, targetDate);
            return { card, knowledgeState: state, projectedRetention: typeof retention === 'number' ? retention : 0 };
        }).filter(entry => {
            if (entry.projectedRetention >= 0.9) return false;
            return !isCardMasteredForLearn(entry.knowledgeState, deck, targetDate);
        });
        nonMasteredCards.sort((a, b) => (a.projectedRetention ?? 0) - (b.projectedRetention ?? 0));

        studyState.activeLearningPool = nonMasteredCards.slice(0, maxCards).map(entry => entry.card);
        studyState.roundCards = [];
        studyState.sessionCardIds = studyState.activeLearningPool.map(c => c.id);

        const poolList = document.getElementById('activePoolList');
        if (studyState.activeLearningPool.length > 0) {
            poolList.innerHTML = '';
            studyState.activeLearningPool.forEach(card => {
                const d = document.createElement('div');
                d.className = 'deck-card-item';
                d.style.padding = '10px';
                d.style.border = 'none';
                d.textContent = card.question || '';
                poolList.appendChild(d);
            });
        } else {
            poolList.innerHTML = '';
            const p = document.createElement('p');
            p.style.cssText = 'text-align: center; color: var(--secondary-text);';
            p.textContent = 'No more cards to learn in this session!';
            poolList.appendChild(p);
        }

    } else if (currentMode === 'review') {
        let prioritized = [];
        let others = [];
        if (studyState.lastRoundIncorrect && studyState.lastRoundIncorrect.length > 0) {
            const incorrectIds = new Set(studyState.lastRoundIncorrect.map(c => c.id));
            studyState.stillLearning.forEach(card => {
                if (incorrectIds.has(card.id)) prioritized.push(card);
                else others.push(card);
            });
        } else {
            others = [...studyState.stillLearning];
        }
        studyState.lastRoundIncorrect = [];
        let sortedCards;
        if (studyState.settings.reviewOrder === 'alphabetical') {
            prioritized.sort((a, b) => a.question.localeCompare(b.question));
            others.sort((a, b) => a.question.localeCompare(b.question));
            sortedCards = prioritized.concat(others);
        } else {
            sortedCards = shuffleArray(prioritized).concat(shuffleArray(others));
        }
        const roundLimit = studyState.settings?.cardsPerRound
            || decks[currentDeckId]?.settings?.cardsPerRound
            || DEFAULT_DECK_SETTINGS.cardsPerRound
            || 10;
        studyState.roundCards = sortedCards.slice(0, roundLimit);
    } else if (currentMode === 'exam') {
        const examDate = studyState.examDate ? new Date(studyState.examDate) : null;
        const knowledgeStates = studyState.knowledgeStates?.size
            ? studyState.knowledgeStates
            : new Map((await getAllDataFromDB('userKnowledgeState')).map(item => [item.cardID, item]));
        const targetRetention = studyState.targetRetention || 0.8;

        dailyPriorityQueue = dailyPriorityQueue.map(card => {
            const state = knowledgeStates.get(card.id);
            const retention = calculateRetentionAtDate(state, examDate || new Date());
            return { ...card, projectedRetention: retention };
        });

        let needsReview = dailyPriorityQueue.filter(c => (c.projectedRetention ?? 0) < targetRetention);
        if (needsReview.length === 0) {
            needsReview = [...dailyPriorityQueue];
        }
        needsReview.sort((a, b) => (a.projectedRetention ?? 0) - (b.projectedRetention ?? 0));
        dailyPriorityQueue = needsReview;

        const defaultRoundSize = DEFAULT_DECK_SETTINGS.cardsPerRound || 10;
        let roundSize = defaultRoundSize;
        if (dailyPriorityQueue.length > 0) {
            const firstCardDeckId = dailyPriorityQueue[0].deckId;
            const deckRoundSetting = Number(decks[firstCardDeckId]?.settings?.cardsPerRound);
            if (Number.isFinite(deckRoundSetting) && deckRoundSetting > 0) {
                roundSize = deckRoundSetting;
            }
        }
        studyState.roundCards = dailyPriorityQueue.splice(0, roundSize);
    }

    studyState.currentCardIndex = 0;
    const cardsForSession = currentMode === 'learn' ? studyState.activeLearningPool : studyState.roundCards;

    assignQuestionTypesToCards(cardsForSession, currentMode === 'learn' ? currentDeckId : null);

        if (cardsForSession.length > 0) {
        const cardsRequiringGeneration = cardsForSession.filter(
            card => card.questionTypeToShow === 'MultipleChoice' && isOnline
        );

        const progressView = document.getElementById('progressView');
        const preGenerationView = document.getElementById('preGenerationView');
        const cardView = document.getElementById('cardView');
        let transitionSource = progressView;

        if (cardsRequiringGeneration.length > 0) {
            transitionSubView(progressView, preGenerationView);

            const updateProgressUI = (completed, total) => {
                const percent = total > 0 ? (completed / total) * 100 : 100;
                document.getElementById('preGenerationProgress').style.width = `${percent}%`;
                document.getElementById('preGenerationProgressText').textContent = `${completed} / ${total}`;
            };

            await preGenerateAdaptiveQuestions(cardsForSession, updateProgressUI);
            transitionSource = preGenerationView;
        } else {
            hidePreGenerationViewImmediately();
            transitionSource = progressView;
        }

        if (currentMode === 'learn') {
            const cortex = await getCortexEngine();
            const deck = decks[currentDeckId];
            studyState.currentCard = await cortex.pickNextCard(studyState.activeLearningPool, studyState.sessionState, deck, studyState.knowledgeStates);
        }
        transitionSubView(transitionSource, cardView);
        if (currentMode !== 'learn' || studyState.currentCard) {
            showNextCard();
        } else {
            showComplete();
        }

    } else {
        if (currentMode === 'learn') {
            showComplete();
        } else {
            showProgress();
            showToast("No cards available to study in this round.");
        }
    }

    continueBtn.disabled = false;
    continueBtn.innerHTML = studyState.currentRound === 1 ? 'Start Round' : 'Continue Round';
}

function assignQuestionTypesToCards(cards, deckId = null, modeOverride = currentMode) {
    if (!cards || cards.length === 0) return;

    cards.forEach(card => {
        const resolvedDeck = deckId ? decks[deckId] : decks[card.deckId || currentDeckId];
        card.questionTypeToShow = selectOptimalQuestionType(card, resolvedDeck, modeOverride);
    });
}

async function showNextCard() {
    hidePreGenerationViewImmediately();
    if (currentMode === 'learn' && !studyState.currentCard) {
        showComplete();
        return;
    }
    const cardStatsInfo = document.getElementById('cardStatsInfo');
    if (cardStatsInfo) cardStatsInfo.innerHTML = '';
    if (studyState.sequenceTimerInterval) {
        clearInterval(studyState.sequenceTimerInterval);
        studyState.sequenceTimerInterval = null;
    }
    document.getElementById('flashcardViewContainer').classList.add('hidden');
    document.getElementById('passiveReviewView').classList.add('hidden');
    document.getElementById('dragDropView').classList.add('hidden');
    document.getElementById('mcqView').classList.add('hidden');
    document.getElementById('writeAnswerInput').classList.add('hidden');
    const simpleButtons = document.getElementById('simpleAnswerButtons');
    simpleButtons.classList.remove('hidden');
    simpleButtons.querySelectorAll('button').forEach(btn => btn.classList.add('hidden'));

    const checkBtn = document.getElementById('checkAnswerBtn');
    const dontKnowBtn = document.getElementById('dontKnowBtn');

    if (currentMode === 'review') {
        if (studyState.currentCardIndex >= studyState.roundCards.length) {
            showToast("Review complete!", "success");
            await endSession();
            return;
        }

        const card = studyState.roundCards[studyState.currentCardIndex];

        if (card && studyState.knowledgeStates) {
            const state = studyState.knowledgeStates.get(card.id);
            if (state) {
                const masteryPercent = Math.round(state.masteryScore * 100);
                const pRecall = calculatePRecall(state.stability, state.lastReviewed);
                const urgency = (1 - pRecall) * 100;

                const cardStatsInfoEl = document.getElementById('cardStatsInfo');
                if (cardStatsInfoEl) {
                    cardStatsInfoEl.innerHTML = '';
                    const masteryDiv = document.createElement('div');
                    masteryDiv.style.fontWeight = '500';
                    masteryDiv.textContent = 'Mastery: ';
                    const masterySpan = document.createElement('span');
                    masterySpan.style.color = 'var(--primary-color)';
                    masterySpan.textContent = `${masteryPercent}%`;
                    masteryDiv.appendChild(masterySpan);
                    const urgencyDiv = document.createElement('div');
                    urgencyDiv.style.fontSize = '0.8rem';
                    urgencyDiv.style.color = 'var(--secondary-text)';
                    urgencyDiv.textContent = `Urgency: ${urgency.toFixed(0)}%`;
                    cardStatsInfoEl.appendChild(masteryDiv);
                    cardStatsInfoEl.appendChild(urgencyDiv);
                }
            }
        }

        document.getElementById('flashcardViewContainer').classList.remove('hidden');
                const cardQuestionEl = document.getElementById('cardQuestion');
                const cardAnswerEl = document.getElementById('cardAnswer');
                if (cardQuestionEl) cardQuestionEl.textContent = card.question || '';
                if (cardAnswerEl) cardAnswerEl.textContent = card.answer || '';

        document.getElementById('showAnswerBtn').classList.remove('hidden');

        document.querySelector('#cardView .flashcard').classList.remove('is-flipped');
        document.getElementById('cardAnswerContent').classList.add('hidden');
        document.getElementById('cardRoundInfo').textContent = `Card ${studyState.currentCardIndex + 1} of ${studyState.roundCards.length}`;

        return;
    }

    if (currentMode === 'sequence') {
        checkBtn.onclick = checkSequenceAnswer;
        dontKnowBtn.onclick = dontKnowSequenceAnswer;
    } else {
        checkBtn.onclick = autoCheckAnswer;
        dontKnowBtn.onclick = dontKnowAnswer;
    }

    if (currentMode === 'sequence') {
        const currentChunk = studyState.sequenceActiveChunkOverride || studyState.sequenceChunks[studyState.currentChunkIndex];
        if (!currentChunk) {
            showToast("Sequence chunk not found", "error");
            endSession();
            return;
        }
        const chunkOffset = studyState.sequenceChunks.slice(0, studyState.currentChunkIndex).reduce((sum, chunk) => sum + chunk.length, 0);
        const sequencePhasesUsingRoundCards = ['Weakest Link', 'InterChunkReview', 'Passive Review Quiz', 'Post-Drag Recall'];
        let card = null;
        let forwardCardIndexInChunk = studyState.currentCardIndex;
        if (studyState.sequencePhase === 'Forward Chaining') {
            if (!studyState.sequenceForwardQueue || studyState.sequenceForwardQueue.length === 0) {
                studyState.sequenceForwardQueue = currentChunk.map(c => c.id);
            }
            const forwardCardId = studyState.sequenceForwardQueue[studyState.currentCardIndex];
            const locatedCard = currentChunk.findIndex(c => c.id === forwardCardId);
            forwardCardIndexInChunk = locatedCard >= 0 ? locatedCard : studyState.currentCardIndex;
            card = currentChunk[forwardCardIndexInChunk] || null;
        } else if (sequencePhasesUsingRoundCards.includes(studyState.sequencePhase)) {
            card = studyState.roundCards ? studyState.roundCards[studyState.currentCardIndex] : null;
        } else {
            card = currentChunk ? currentChunk[studyState.currentCardIndex] : null;
        }

        const roundInfo = document.getElementById('cardRoundInfo');
        if (studyState.sequencePhase === 'Passive Review Quiz' && studyState.roundCards?.length) {
            roundInfo.textContent = `Chunk ${studyState.currentChunkIndex + 1} - Quiz Item ${studyState.currentCardIndex + 1} of ${studyState.roundCards.length}`;
        } else if (studyState.sequencePhase === 'InterChunkReview' && studyState.roundCards?.length) {
            roundInfo.textContent = `Quick Review - Card ${studyState.currentCardIndex + 1} of ${studyState.roundCards.length}`;
        } else if (studyState.sequencePhase === 'Weakest Link' && studyState.roundCards?.length) {
            roundInfo.textContent = `Weakest Link - Card ${studyState.currentCardIndex + 1} of ${studyState.roundCards.length}`;
        } else if (studyState.sequencePhase === 'Post-Drag Recall' && studyState.roundCards?.length) {
            roundInfo.textContent = `Chunk ${studyState.currentChunkIndex + 1} - Recall ${studyState.currentCardIndex + 1} of ${studyState.roundCards.length}`;
        } else if (studyState.sequencePhase === 'Forward Chaining') {
            roundInfo.textContent = `Chunk ${studyState.currentChunkIndex + 1} - Item ${forwardCardIndexInChunk + 1} of ${currentChunk.length}`;
        } else {
            roundInfo.textContent = `Chunk ${studyState.currentChunkIndex + 1} - Item ${studyState.currentCardIndex + 1} of ${currentChunk.length}`;
        }

        switch (studyState.sequencePhase) {
            case 'Passive Review':
                document.getElementById('passiveReviewView').classList.remove('hidden');
                const list = document.getElementById('passiveReviewList');
                list.innerHTML = currentChunk.map((c, idx) => `
                            <li style="
                                padding: 15px 20px;
                                margin-bottom: 12px;
                                background: var(--input-bg);
                                border-radius: 12px;
                                border-left: 4px solid var(--primary-color);
                                transition: all 0.3s;
                                line-height: 1.6;
                            ">
                                <strong style="color: var(--primary-color); font-size: 1.1rem;">${c.answer}</strong>
                                ${c.question ? `<div style="color: var(--secondary-text); font-size: 0.95rem; margin-top: 8px;">${c.question}</div>` : ''}
                            </li>
                        `).join('');
                break;
            case 'Passive Review Quiz':
                if (!studyState.roundCards || studyState.roundCards.length === 0) {
                    const quizPool = [...currentChunk];
                    const quizCount = Math.min(Math.max(2, quizPool.length >= 3 ? 3 : quizPool.length), quizPool.length);
                    studyState.roundCards = shuffleArray(quizPool).slice(0, quizCount);
                    studyState.currentCardIndex = 0;
                }
                const quizCard = studyState.roundCards[studyState.currentCardIndex];
                if (quizCard) {
                    const quizAnswerEl = document.getElementById('cardAnswer');
                    if (quizAnswerEl) quizAnswerEl.textContent = quizCard.answer || '';
                }
                document.getElementById('flashcardViewContainer').classList.remove('hidden');
                document.getElementById('writeAnswerInput').classList.remove('hidden');
                document.getElementById('checkAnswerBtn').classList.remove('hidden');
                document.getElementById('dontKnowBtn').classList.remove('hidden');
                (function renderPassiveReviewPrompt() {
                    const container = document.getElementById('cardQuestion');
                    container.innerHTML = '';
                    const wrapper = document.createElement('div');
                    wrapper.style.textAlign = 'center';
                    const header = document.createElement('div');
                    header.style.color = 'var(--primary-color)';
                    header.style.fontSize = '1rem';
                    header.style.fontWeight = 600;
                    header.style.marginBottom = '12px';
                    header.textContent = 'Passive Review Quiz';
                    const prompt = document.createElement('div');
                    prompt.style.fontSize = '1.1rem';
                    prompt.textContent = `Quick check: what is step ${chunkOffset + studyState.currentCardIndex + 1} in this sequence?`;
                    wrapper.appendChild(header);
                    wrapper.appendChild(prompt);
                    container.appendChild(wrapper);
                })();
                if (quizCard) startInteractionLog(quizCard.id);
                break;
            case 'Forward Chaining':
            case 'Backward Chaining':
                document.getElementById('flashcardViewContainer').classList.remove('hidden');
                document.getElementById('writeAnswerInput').classList.remove('hidden');
                document.getElementById('checkAnswerBtn').classList.remove('hidden');
                document.getElementById('dontKnowBtn').classList.remove('hidden');

                const qElement = document.getElementById('cardQuestion');

                if (studyState.sequencePhase === 'Forward Chaining') {
                    if (forwardCardIndexInChunk === 0) {
                        qElement.innerHTML = '';
                        (function renderForwardFirst() {
                            const wrapper = document.createElement('div');
                            wrapper.style.textAlign = 'center';
                            const header = document.createElement('div');
                            header.style.color = 'var(--primary-color)';
                            header.style.fontSize = '1rem';
                            header.style.fontWeight = 600;
                            header.style.marginBottom = '15px';
                            header.textContent = 'Forward Chaining';
                            const prompt = document.createElement('div');
                            prompt.style.fontSize = '1.3rem';
                            prompt.innerHTML = 'What is the <strong>first item</strong> in this sequence?';
                            wrapper.appendChild(header);
                            wrapper.appendChild(prompt);
                            qElement.appendChild(wrapper);
                        })();
                    } else {
                        const prevCard = currentChunk[forwardCardIndexInChunk - 1];
                        const usePositionPrompt = forwardCardIndexInChunk % 4 === 0;
                        if (usePositionPrompt) {
                            qElement.innerHTML = '';
                            (function renderForwardPosition() {
                                const wrapper = document.createElement('div');
                                wrapper.style.textAlign = 'center';
                                const header = document.createElement('div');
                                header.style.color = 'var(--primary-color)';
                                header.style.fontSize = '1rem';
                                header.style.fontWeight = 600;
                                header.style.marginBottom = '15px';
                                header.textContent = 'Forward Chaining';
                                const prompt = document.createElement('div');
                                prompt.style.fontSize = '1.2rem';
                                const strong = document.createElement('strong');
                                strong.textContent = `${chunkOffset + forwardCardIndexInChunk + 1}`;
                                prompt.appendChild(document.createTextNode('What is step '));
                                prompt.appendChild(strong);
                                prompt.appendChild(document.createTextNode(' in this sequence?'));
                                wrapper.appendChild(header);
                                wrapper.appendChild(prompt);
                                qElement.appendChild(wrapper);
                            })();
                        } else {
                            qElement.innerHTML = '';
                            (function renderForwardAfter() {
                                const wrapper = document.createElement('div');
                                wrapper.style.textAlign = 'center';
                                const header = document.createElement('div');
                                header.style.color = 'var(--primary-color)';
                                header.style.fontSize = '1rem';
                                header.style.fontWeight = 600;
                                header.style.marginBottom = '15px';
                                header.textContent = 'Forward Chaining';
                                const prompt = document.createElement('div');
                                prompt.style.fontSize = '1.1rem';
                                prompt.style.marginBottom = '20px';
                                prompt.innerHTML = 'What comes <strong>after</strong>:';
                                const answerBox = document.createElement('div');
                                answerBox.style.background = 'var(--input-bg)';
                                answerBox.style.padding = '20px';
                                answerBox.style.borderRadius = '12px';
                                answerBox.style.borderLeft = '4px solid var(--primary-color)';
                                answerBox.style.fontSize = '1.3rem';
                                answerBox.style.fontWeight = 600;
                                answerBox.textContent = prevCard.answer;
                                wrapper.appendChild(header);
                                wrapper.appendChild(prompt);
                                wrapper.appendChild(answerBox);
                                if (prevCard.question) {
                                    const qEl = document.createElement('div');
                                    qEl.style.color = 'var(--secondary-text)';
                                    qEl.style.marginTop = '10px';
                                    qEl.style.fontSize = '0.95rem';
                                    qEl.textContent = prevCard.question;
                                    wrapper.appendChild(qEl);
                                }
                                qElement.appendChild(wrapper);
                            })();
                        }
                    }
                } else {
                    if (studyState.currentCardIndex === currentChunk.length - 1) {
                        qElement.innerHTML = '';
                        (function renderBackwardLast() {
                            const wrapper = document.createElement('div');
                            wrapper.style.textAlign = 'center';
                            const header = document.createElement('div');
                            header.style.color = 'var(--primary-color)';
                            header.style.fontSize = '1rem';
                            header.style.fontWeight = 600;
                            header.style.marginBottom = '15px';
                            header.textContent = 'Backward Chaining';
                            const prompt = document.createElement('div');
                            prompt.style.fontSize = '1.3rem';
                            prompt.innerHTML = 'What is the <strong>last item</strong> in this sequence?';
                            wrapper.appendChild(header);
                            wrapper.appendChild(prompt);
                            qElement.appendChild(wrapper);
                        })();
                    } else {
                        const nextCard = currentChunk[studyState.currentCardIndex + 1];
                        const usePositionPrompt = studyState.currentCardIndex % 3 === 0;
                        if (usePositionPrompt) {
                            qElement.innerHTML = '';
                            (function renderBackwardPosition() {
                                const wrapper = document.createElement('div');
                                wrapper.style.textAlign = 'center';
                                const header = document.createElement('div');
                                header.style.color = 'var(--primary-color)';
                                header.style.fontSize = '1rem';
                                header.style.fontWeight = 600;
                                header.style.marginBottom = '15px';
                                header.textContent = 'Backward Chaining';
                                const prompt = document.createElement('div');
                                prompt.style.fontSize = '1.2rem';
                                const strong = document.createElement('strong');
                                strong.textContent = `${chunkOffset + studyState.currentCardIndex + 1}`;
                                prompt.appendChild(document.createTextNode('Which item sits at position '));
                                prompt.appendChild(strong);
                                prompt.appendChild(document.createTextNode('?'));
                                wrapper.appendChild(header);
                                wrapper.appendChild(prompt);
                                qElement.appendChild(wrapper);
                            })();
                        } else {
                            qElement.innerHTML = '';
                            (function renderBackwardBefore() {
                                const wrapper = document.createElement('div');
                                wrapper.style.textAlign = 'center';
                                const header = document.createElement('div');
                                header.style.color = 'var(--primary-color)';
                                header.style.fontSize = '1rem';
                                header.style.fontWeight = 600;
                                header.style.marginBottom = '15px';
                                header.textContent = 'Backward Chaining';
                                const prompt = document.createElement('div');
                                prompt.style.fontSize = '1.1rem';
                                prompt.style.marginBottom = '20px';
                                prompt.innerHTML = 'What comes <strong>before</strong>:';
                                const answerBox = document.createElement('div');
                                answerBox.style.background = 'var(--input-bg)';
                                answerBox.style.padding = '20px';
                                answerBox.style.borderRadius = '12px';
                                answerBox.style.borderLeft = '4px solid var(--primary-color)';
                                answerBox.style.fontSize = '1.3rem';
                                answerBox.style.fontWeight = 600;
                                answerBox.textContent = nextCard.answer;
                                wrapper.appendChild(header);
                                wrapper.appendChild(prompt);
                                wrapper.appendChild(answerBox);
                                if (nextCard.question) {
                                    const qEl = document.createElement('div');
                                    qEl.style.color = 'var(--secondary-text)';
                                    qEl.style.marginTop = '10px';
                                    qEl.style.fontSize = '0.95rem';
                                    qEl.textContent = nextCard.question;
                                    wrapper.appendChild(qEl);
                                }
                                qElement.appendChild(wrapper);
                            })();
                        }
                    }
                }
                startInteractionLog(card.id);
                break;
            case 'Drag and Drop':
                document.getElementById('dragDropView').classList.remove('hidden');
                setupDragDropView(currentChunk);
                document.getElementById('cardRoundInfo').textContent = `Chunk ${studyState.currentChunkIndex + 1} - Arrange in Order`;
                simpleButtons.classList.add('hidden');
                break;
            case 'Weakest Link':
                checkBtn.onclick = checkSequenceAnswer;
                dontKnowBtn.onclick = dontKnowSequenceAnswer;
                document.getElementById('flashcardViewContainer').classList.remove('hidden');
                document.getElementById('writeAnswerInput').classList.remove('hidden');
                document.getElementById('checkAnswerBtn').classList.remove('hidden');
                document.getElementById('dontKnowBtn').classList.remove('hidden');
                const weakestCard = studyState.roundCards[studyState.currentCardIndex];
                if (!weakestCard) {
                    moveToNextSequencePhase();
                    return;
                }
                const weakestQEl = document.getElementById('cardQuestion');
                const weakestAEl = document.getElementById('cardAnswer');
                if (weakestQEl) weakestQEl.textContent = weakestCard.question || '';
                if (weakestAEl) weakestAEl.textContent = weakestCard.answer || '';
                startInteractionLog(weakestCard.id);
                break;
            case 'InterChunkReview':
                checkBtn.onclick = checkSequenceAnswer;
                dontKnowBtn.onclick = dontKnowSequenceAnswer;
                document.getElementById('flashcardViewContainer').classList.remove('hidden');
                document.getElementById('writeAnswerInput').classList.remove('hidden');
                document.getElementById('checkAnswerBtn').classList.remove('hidden');
                document.getElementById('dontKnowBtn').classList.remove('hidden');
                const reviewCard = studyState.roundCards[studyState.currentCardIndex];
                if (!reviewCard) {
                    moveToNextSequencePhase();
                    return;
                }
                const reviewQEl = document.getElementById('cardQuestion');
                const reviewAEl = document.getElementById('cardAnswer');
                if (reviewQEl) reviewQEl.textContent = reviewCard.question || '';
                if (reviewAEl) reviewAEl.textContent = reviewCard.answer || '';
                startInteractionLog(reviewCard.id);
                break;
            case 'Post-Drag Recall':
                if (!card) {
                    studyState.sequencePhase = 'Drag and Drop';
                    moveToNextSequencePhase();
                    return;
                }
                document.getElementById('flashcardViewContainer').classList.remove('hidden');
                document.getElementById('writeAnswerInput').classList.remove('hidden');
                document.getElementById('checkAnswerBtn').classList.remove('hidden');
                document.getElementById('dontKnowBtn').classList.remove('hidden');
                const postDragQEl = document.getElementById('cardQuestion');
                if (postDragQEl) postDragQEl.innerHTML = `
                            <div style="text-align: center;">
                                <div style="color: var(--primary-color); font-size: 1rem; font-weight: 600; margin-bottom: 12px;">Post-Drag Recall</div>
                                <div style="font-size: 1.1rem;">What is step <strong>${chunkOffset + studyState.currentCardIndex + 1}</strong> in this sequence?</div>
                            </div>
                        `;
                startInteractionLog(card?.id);
                break;

        }
        document.querySelector('#cardView .flashcard').classList.remove('is-flipped');
        if (card) {
            const answerEl = document.getElementById('cardAnswer');
            if (answerEl) answerEl.textContent = card.answer || '';
        }
        document.getElementById('cardAnswerContent').classList.add('hidden');
        const writeInput = document.getElementById('writeAnswerInput');
        writeInput.value = '';
        writeInput.disabled = false;
        writeInput.classList.remove('correct', 'incorrect');
        if (!writeInput.classList.contains('hidden')) setTimeout(() => writeInput.focus(), 100);
        const timedSequencePhases = ['Forward Chaining', 'Backward Chaining', 'InterChunkReview', 'Weakest Link', 'Passive Review Quiz', 'Post-Drag Recall'];
        if (timedSequencePhases.includes(studyState.sequencePhase)) {
            studyState.sequenceQuestionStartTime = Date.now();
            if (cardStatsInfo) {
                cardStatsInfo.innerHTML = '';
                    const seqTimer = document.createElement('div');
                    seqTimer.id = 'sequenceTimer';
                    seqTimer.style.color = 'var(--secondary-text)';
                    seqTimer.style.fontSize = '0.85rem';
                    seqTimer.textContent = 'Time: 0.0s';
                    cardStatsInfo.appendChild(seqTimer);
                    const timerLabel = seqTimer;
                if (timerLabel) {
                    studyState.sequenceTimerInterval = setInterval(() => {
                        const elapsed = (Date.now() - studyState.sequenceQuestionStartTime) / 1000;
                        timerLabel.textContent = `Time: ${elapsed.toFixed(1)}s`;
                    }, 200);
                }
            }
        } else {
            studyState.sequenceQuestionStartTime = null;
        }
        return;
    }

    if (currentMode === 'learn') {
        const card = studyState.currentCard;
        if (!card) {
            showComplete();
            return;
        }
        studyState.isRetypingIncorrect = false;
        const questionType = card.questionTypeToShow || selectOptimalQuestionType(card, decks[currentDeckId], 'learn');
        card.questionTypeToShow = questionType;

        switch (questionType) {
            case 'MultipleChoice':
                document.getElementById('mcqView').classList.remove('hidden');
                const mcqQEl = document.getElementById('mcqQuestion');
                if (mcqQEl) mcqQEl.textContent = card.question || '';
                generateAndDisplayMCQ(card);
                simpleButtons.classList.add('hidden');
                break;

            case 'Cloze':
                document.getElementById('flashcardViewContainer').classList.remove('hidden');
                let clozeText = escapeHtml(String(card.question || ''));
                if (clozeText.includes('___')) {
                    clozeText = clozeText.replace(/___/g, '___________');
                } else if (clozeText.includes('...')) {
                    clozeText = clozeText.replace(/\.\.\./g, '___________');
                } else {
                    clozeText = clozeText.replace(new RegExp(escapeRegExp(escapeHtml(String(card.answer || ''))), 'ig'), '___________');
                }

                const clozeQEl = document.getElementById('cardQuestion');
                if (clozeQEl) clozeQEl.textContent = clozeText;

                document.getElementById('writeAnswerInput').classList.remove('hidden');
                document.getElementById('checkAnswerBtn').classList.remove('hidden');
                document.getElementById('dontKnowBtn').classList.remove('hidden');

                updateAccentButtonsVisibility();

                startInteractionLog(card.id);
                break;

            case 'Type':
                document.getElementById('flashcardViewContainer').classList.remove('hidden');
                const typeQEl = document.getElementById('cardQuestion');
                if (typeQEl) typeQEl.textContent = card.question || '';

                document.getElementById('writeAnswerInput').classList.remove('hidden');
                document.getElementById('checkAnswerBtn').classList.remove('hidden');
                document.getElementById('dontKnowBtn').classList.remove('hidden');

                updateAccentButtonsVisibility();

                startInteractionLog(card.id);
                break;

            default:
                document.getElementById('flashcardViewContainer').classList.remove('hidden');
                const defQEl = document.getElementById('cardQuestion');
                if (defQEl) defQEl.textContent = card.question || '';
                document.getElementById('showAnswerBtn').classList.remove('hidden');
                break;
        }

        const flashcardElem = document.querySelector('#cardView .flashcard');
        flashcardElem.classList.remove('is-flipped');
        const cardAnswerEl = document.getElementById('cardAnswer');
        if (cardAnswerEl) cardAnswerEl.textContent = card.answer || '';
        document.getElementById('cardAnswerContent').classList.add('hidden');

        const writeInput = document.getElementById('writeAnswerInput');
        writeInput.value = '';
        writeInput.disabled = false;
        writeInput.classList.remove('correct', 'incorrect');
        if (!writeInput.classList.contains('hidden')) setTimeout(() => writeInput.focus(), 100);
        const poolSize = studyState.activeLearningPool ? studyState.activeLearningPool.length : 0;
        document.getElementById('cardRoundInfo').textContent = `Learning pool: ${poolSize} cards`;
        return;
    }

    if (studyState.currentCardIndex >= studyState.roundCards.length && studyState.incorrectInThisRound.length > 0) {
        studyState.roundCards = studyState.roundCards.concat(shuffleArray(studyState.incorrectInThisRound));
        studyState.incorrectInThisRound = [];
        showToast("Let's review the ones you missed.", "info");
    }

    if (studyState.currentCardIndex >= studyState.roundCards.length) {
        studyState.currentRound++;
        await saveStudyProgress();
        await showProgress();
        return;
    }

    window.scrollTo(0, 0);
    const card = studyState.roundCards[studyState.currentCardIndex];
    const questionType = card.questionTypeToShow;


    switch (questionType) {
        case 'MultipleChoice':
            document.getElementById('mcqView').classList.remove('hidden');
            const mqEl = document.getElementById('mcqQuestion');
            if (mqEl) mqEl.textContent = card.question || '';
            generateAndDisplayMCQ(card);
            simpleButtons.classList.add('hidden');
            break;

        case 'Cloze':
            document.getElementById('flashcardViewContainer').classList.remove('hidden');
            let clozeText = card.question;

            // Handle explicit blanks
            if (clozeText.includes('___')) {
                clozeText = clozeText.replace(/___/g, '___________');
            } else if (clozeText.includes('...')) {
                clozeText = clozeText.replace(/\.\.\./g, '___________');
            } else {
                // Standard Cloze: remove answer from question
                clozeText = clozeText.replace(new RegExp(escapeRegExp(card.answer), 'ig'), '___________');
            }

            const cardQuestionEl = document.getElementById('cardQuestion');
            if (cardQuestionEl) cardQuestionEl.textContent = clozeText;

            document.getElementById('writeAnswerInput').classList.remove('hidden');
            document.getElementById('checkAnswerBtn').classList.remove('hidden');
            document.getElementById('dontKnowBtn').classList.remove('hidden');

            updateAccentButtonsVisibility();

            startInteractionLog(card.id);
            break;

        case 'Type':
            document.getElementById('flashcardViewContainer').classList.remove('hidden');
            const typeQEl2 = document.getElementById('cardQuestion');
            if (typeQEl2) typeQEl2.textContent = card.question || '';

            document.getElementById('writeAnswerInput').classList.remove('hidden');
            document.getElementById('checkAnswerBtn').classList.remove('hidden');
            document.getElementById('dontKnowBtn').classList.remove('hidden');

            updateAccentButtonsVisibility();

            startInteractionLog(card.id);
            break;

        default:
            document.getElementById('flashcardViewContainer').classList.remove('hidden');
            const defQEl2 = document.getElementById('cardQuestion');
            if (defQEl2) defQEl2.textContent = card.question || '';
            document.getElementById('showAnswerBtn').classList.remove('hidden');
            break;
    }

    const flashcardElem = document.querySelector('#cardView .flashcard');
    flashcardElem.classList.remove('is-flipped');
    const cardAnswerEl2 = document.getElementById('cardAnswer');
    if (cardAnswerEl2) cardAnswerEl2.textContent = card.answer || '';
    document.getElementById('cardAnswerContent').classList.add('hidden');

    const writeInput = document.getElementById('writeAnswerInput');
    writeInput.value = '';
    writeInput.disabled = false;
    writeInput.classList.remove('correct', 'incorrect');
    if (!writeInput.classList.contains('hidden')) setTimeout(() => writeInput.focus(), 100);

    if (currentMode !== 'learn') {
        document.getElementById('cardRoundInfo').textContent = `Round ${studyState.currentRound} - Card ${studyState.currentCardIndex + 1} of ${studyState.roundCards.length}`;
    }
}

async function moveToNextSequencePhase() {
    const currentChunk = studyState.sequenceChunks[studyState.currentChunkIndex];
    if (!currentChunk || currentChunk.length === 0) {
        showToast("No more items in this sequence", "info");
        const deckToClear = decks[currentDeckId];
        if (deckToClear?.sequenceState) delete deckToClear.sequenceState;
        if (deckToClear) await saveDataToDB('decks', deckToClear);
        if (studyState.sequenceTimerInterval) {
            clearInterval(studyState.sequenceTimerInterval);
            studyState.sequenceTimerInterval = null;
        }
        showComplete();
        return;
    }
    let nextPhase = null;


    const isShortSequence = currentChunk.length <= 2;

    switch (studyState.sequencePhase) {
        case null:
            nextPhase = 'Passive Review';
            studyState.currentCardIndex = 0;
            studyState.sequenceMissedInChunk = [];
            studyState.sequenceActiveChunkOverride = null;
            studyState.weakestLinkIteration = 0;
            studyState.sequenceForwardQueue = [];
            break;
        case 'Passive Review':
            nextPhase = 'Passive Review Quiz';
            if (!studyState.roundCards || studyState.roundCards.length === 0) {
                studyState.roundCards = [];
            }
            studyState.sequenceForwardQueue = [];
            studyState.currentCardIndex = 0;
            break;
        case 'Passive Review Quiz':
            if (isShortSequence) {
                nextPhase = 'Drag and Drop';
            } else {
                nextPhase = 'Forward Chaining';
                studyState.currentCardIndex = 0;
                studyState.sequenceForwardQueue = currentChunk.map(c => c.id);
            }
            break;
        case 'Forward Chaining':
            nextPhase = 'Backward Chaining';
            studyState.sequenceMissedInChunk = [];
            studyState.sequenceActiveChunkOverride = null;
            const knowledgeMapForward = studyState.knowledgeStates || new Map();
            const deckForward = decks[currentDeckId];
            const targetDateForward = deckForward?.settings?.examDate ? new Date(deckForward.settings.examDate) : new Date();
            let startIndex = currentChunk.length - 1;
            const targetRetentionForward = deckForward?.settings?.targetRetention || studyState.targetRetention || 0.8;
            while (startIndex > 0) {
                const state = knowledgeMapForward.get(currentChunk[startIndex].id);
                const retention = calculateRetentionAtDate(state, targetDateForward);
                if (!(retention >= Math.max(0.9, targetRetentionForward + 0.05))) break;
                startIndex--;
            }
            studyState.currentCardIndex = startIndex;
            break;
        case 'Backward Chaining':
            if (isShortSequence) {
                const deckToClear = decks[currentDeckId];
                if (deckToClear?.sequenceState) delete deckToClear.sequenceState;
                if (deckToClear) await saveDataToDB('decks', deckToClear);
                if (studyState.sequenceTimerInterval) {
                    clearInterval(studyState.sequenceTimerInterval);
                    studyState.sequenceTimerInterval = null;
                }
                showComplete();
                return;
            } else {
                nextPhase = 'Drag and Drop';
            }
            break;
        case 'Drag and Drop':
            if (studyState.currentChunkIndex > 0) {
                const reviewPool = studyState.sequenceChunks.slice(0, studyState.currentChunkIndex).flat();
                const reviewKnowledgeStates = await getAllDataFromDB('userKnowledgeState');
                const reviewKnowledgeMap = new Map(reviewKnowledgeStates.map(item => [item.cardID, item]));
                const dragDeck = decks[currentDeckId];
                const targetDate = dragDeck?.settings?.examDate ? new Date(dragDeck.settings.examDate) : new Date();
                const scoredPool = reviewPool.map(card => {
                    const state = studyState.knowledgeStates?.get(card.id) || reviewKnowledgeMap.get(card.id);
                    const retention = calculateRetentionAtDate(state, targetDate);
                    return { card, retention: typeof retention === 'number' ? retention : 0 };
                }).sort((a, b) => (a.retention ?? 0) - (b.retention ?? 0));
                const selectionWindow = scoredPool.slice(0, Math.min(5, scoredPool.length));
                const shuffledWindow = shuffleArray(selectionWindow);
                const reviewCount = selectionWindow.length >= 2 ? Math.min(3, selectionWindow.length) : selectionWindow.length;
                const selectedCards = shuffledWindow.slice(0, reviewCount).map(item => item.card);

                if (selectedCards.length === 0) {
                    studyState.currentChunkIndex++;
                    nextPhase = (studyState.currentChunkIndex < studyState.sequenceChunks.length) ? 'Passive Review' : 'CheckWeakest';
                    break;
                }

                nextPhase = 'InterChunkReview';
                studyState.roundCards = selectedCards;
                studyState.currentCardIndex = 0;
                studyState.nextPhaseAfterReview = (studyState.currentChunkIndex + 1 < studyState.sequenceChunks.length) ? 'Passive Review' : 'CheckWeakest';

                showToast(`Chunk ${studyState.currentChunkIndex + 1} complete! Quick checkup on earlier steps...`, "success");
                studyState.currentChunkIndex++;
                break;
            }

            studyState.currentChunkIndex++;
            if (studyState.currentChunkIndex < studyState.sequenceChunks.length) {
                nextPhase = 'Passive Review';
                showToast(`Chunk ${studyState.currentChunkIndex} complete! Starting chunk ${studyState.currentChunkIndex + 1}.`, "success");
            } else {
                nextPhase = 'CheckWeakest';
            }
            break;

        case 'InterChunkReview':
            nextPhase = studyState.nextPhaseAfterReview;
            studyState.nextPhaseAfterReview = null;
            break;

        case 'CheckWeakest':
            const knowledgeStates = await getAllDataFromDB('userKnowledgeState');
            const knowledgeMap = new Map(knowledgeStates.map(item => [item.cardID, item]));
            const deck = decks[currentDeckId];
            const targetDate = deck?.settings?.examDate ? new Date(deck.settings.examDate) : new Date();
            const weakestCards = studyState.sequenceCards
                .map(card => {
                    const state = studyState.knowledgeStates?.get(card.id) || knowledgeMap.get(card.id);
                    const retention = calculateRetentionAtDate(state, targetDate);
                    if (globalSettings.devMode) {
                        console.log("[FSRS insights] retention used:", retention);
                    }
                    return { ...card, retention };
                })
                .filter(card => (card.retention ?? 0) < 0.4)
                .sort((a, b) => (a.retention ?? 0) - (b.retention ?? 0));

            if (studyState.weakestLinkIteration == null) studyState.weakestLinkIteration = 0;
            const maxIterations = studyState.maxWeakestLinkIterations || 3;

            if (weakestCards.length > 0 && studyState.weakestLinkIteration < maxIterations) {
                nextPhase = 'Weakest Link';
                const subset = weakestCards.slice(0, Math.min(5, weakestCards.length));
                studyState.roundCards = subset;
                studyState.currentCardIndex = 0;
                studyState.weakestLinkIteration++;
                showToast("All chunks practiced! Quick focused review of tricky items.", "info");
            } else {
                if (deck?.sequenceState) delete deck.sequenceState;
                if (deck) await saveDataToDB('decks', deck);
                if (studyState.sequenceTimerInterval) {
                    clearInterval(studyState.sequenceTimerInterval);
                    studyState.sequenceTimerInterval = null;
                }
                showComplete();
                return;
            }
            break;

        case 'Weakest Link':
            nextPhase = 'CheckWeakest';
            break;
    }

    studyState.sequencePhase = nextPhase;
    showNextCard();
}

function showAnswer() {
    document.querySelector('#cardView .flashcard').classList.add('is-flipped');
    document.getElementById('cardAnswerContent').classList.remove('hidden');

    if (currentMode === 'sequence') {
        return;
    }

    document.getElementById('showAnswerBtn').classList.add('hidden');
    document.getElementById('checkAnswerBtn').classList.add('hidden');

    document.getElementById('correctBtn').classList.remove('hidden');
    document.getElementById('incorrectBtn').classList.remove('hidden');
    document.getElementById('showQuestionBtn').classList.remove('hidden');
}
async function logout() {
    try {
        // Get Auth0 configuration
        const auth0Domain = document.querySelector('meta[name="auth0-domain"]')?.content || 'dev-sxs00xsv43d5qfx7.us.auth0.com';
        const auth0ClientId = document.querySelector('meta[name="auth0-client-id"]')?.content || 'fFvjuKKem8V4mN6W5eD753fKmCVncT1H';

        // Load Auth0 SDK if needed
        if (!window.auth0) {
            const script = document.createElement('script');
            script.src = 'https://cdn.auth0.com/js/auth0-spa-js/2.0/auth0-spa-js.production.js';
            document.head.appendChild(script);
            await new Promise(resolve => script.onload = resolve);
        }

        // Create Auth0 client
        const auth0Client = await auth0.createAuth0Client({
            domain: auth0Domain,
            clientId: auth0ClientId,
            authorizationParams: {
                redirect_uri: window.location.origin
            }
        });

        // Clear local storage first
        localStorage.removeItem('auth0Session');

        // Update UI
        document.getElementById('userProfileMenu').classList.add('hidden');
        document.getElementById('guestSignupBtn').classList.remove('hidden');
        document.getElementById('loggedInView').classList.add('hidden');
        document.getElementById('loggedOutView').classList.remove('hidden');
        document.getElementById('appHeader').classList.add('hidden');

        // Call Auth0 logout
        await auth0Client.logout({
            logoutParams: {
                returnTo: window.location.origin
            }
        });
    } catch (error) {
        console.error('Logout error:', error);
        // Fallback: just clear session and reload
        localStorage.removeItem('auth0Session');
        location.reload();
    }
}



function showQuestion() {
    document.querySelector('#cardView .flashcard').classList.remove('is-flipped');

    document.getElementById('showQuestionBtn').classList.add('hidden');
    document.getElementById('correctBtn').classList.add('hidden');
    document.getElementById('incorrectBtn').classList.add('hidden');
    document.getElementById('advancedAnswerButtons').classList.add('hidden');

    const isWriteMode = (currentMode === 'learn' && studyState.settings.learnMode === 'write') || (currentMode === 'review' && studyState.settings.reviewMode === 'write');

    if (isWriteMode) {
        document.getElementById('checkAnswerBtn').classList.remove('hidden');
        document.getElementById('dontKnowBtn').classList.toggle('hidden', studyState.isRetypingIncorrect);
    } else {
        document.getElementById('showAnswerBtn').classList.remove('hidden');
    }
}

async function autoCheckAnswer() {
    const userInput = document.getElementById('writeAnswerInput');
    const card = getActiveCard();
    if (!card || userInput.value.trim() === '') return;

    const feedbackMessage = document.getElementById('feedbackMessage');
    feedbackMessage.innerHTML = '';

    const submissionTime = performance.now();
    const recallLatency = currentInteractionLog.firstKeyPressTime ? Math.round(currentInteractionLog.firstKeyPressTime - currentInteractionLog.questionLoadTime) : null;
    let answerFluency = 0;
    if (currentInteractionLog.firstKeyPressTime) {
        const typingDuration = submissionTime - currentInteractionLog.firstKeyPressTime;
        if (typingDuration > 0) {
            answerFluency = parseFloat((userInput.value.trim().length / (typingDuration / 1000))).toFixed(2);
        }
    }
    const userAnswer = userInput.value.trim();
    const correctAnswer = card.answer.trim();

    if (studyState.isRetypingIncorrect) {
        if (userAnswer.toLowerCase() === correctAnswer.toLowerCase()) {
            studyState.isRetypingIncorrect = false;
            userInput.classList.add('correct');
            userInput.disabled = true;
            document.getElementById('checkAnswerBtn').classList.add('feedback-correct');
            setTimeout(() => {
                document.getElementById('checkAnswerBtn').classList.remove('feedback-correct');
                moveCard(card, false);
            }, 1200);
        } else {
            showToast("That's not quite right. Please type the answer exactly as shown.", "error");
            userInput.value = '';
            userInput.focus();
        }
        return;
    }

    // Ensure settings has defaults merged in
    const deck = decks[currentDeckId];
    const settings = { ...DEFAULT_DECK_SETTINGS, ...(deck?.settings || {}), ...(studyState.settings || {}) };
    const checkResult = checkAnswerForgivingly(userAnswer, correctAnswer, settings);

    userInput.disabled = true;
    document.querySelector('#cardView .flashcard').classList.add('is-flipped');
    document.getElementById('cardAnswerContent').classList.remove('hidden');
    document.getElementById('checkAnswerBtn').classList.add('hidden');
    document.getElementById('dontKnowBtn').classList.add('hidden');
    const questionTypeForLog = document.getElementById('mcqView').classList.contains('hidden') ? 'Type' : 'MultipleChoice';

    switch (checkResult.result) {
        case 'CORRECT':
            userInput.classList.add('correct');
            showToast("Correct!", "success");
            logInteraction({ cardID: card.id, wasCorrect: true, userAnswer, recallLatency, answerFluency, totalCorrections: 0, attemptCount: 1, questionType: questionTypeForLog });
            setTimeout(() => moveCard(card, true, questionTypeForLog), 1200);
            break;

        case 'TYPO':
            userInput.classList.add('correct');
            feedbackMessage.textContent = `So close! The correct answer is: ${correctAnswer}`;
            feedbackMessage.style.color = 'var(--primary-color)';

            logInteraction({ cardID: card.id, wasCorrect: true, userAnswer, recallLatency, answerFluency, totalCorrections: checkResult.distance, attemptCount: 1, questionType: questionTypeForLog });

            setTimeout(() => {
                feedbackMessage.textContent = '';
                moveCard(card, true, questionTypeForLog);
            }, 2500);
            break;

        case 'INCORRECT':
            userInput.classList.add('incorrect');
            logInteraction({ cardID: card.id, wasCorrect: false, userAnswer, recallLatency, answerFluency, totalCorrections: 0, attemptCount: 1, questionType: questionTypeForLog });

            const diffHtml = generateDiffHTML(userAnswer, correctAnswer);
            feedbackMessage.innerHTML = `<strong>Your answer:</strong> ${diffHtml}`;
            feedbackMessage.style.color = 'var(--text-color)';

            if (settings.retypeIncorrect) {
                studyState.isRetypingIncorrect = true;
                userInput.disabled = false;
                setTimeout(() => {
                    userInput.value = '';
                    userInput.focus();
                    document.getElementById('checkAnswerBtn').classList.remove('hidden');
                }, 1000);
                showToast("Not quite. Type the correct answer to continue.", "error", 3000);
            } else {
                showToast("Not quite.", "error");
                document.getElementById('nextBtn').classList.remove('hidden');
                document.getElementById('nextBtn').onclick = function () {
                    this.classList.add('hidden');
                    feedbackMessage.innerHTML = '';
                    moveCard(card, false, questionTypeForLog);
                };
                document.getElementById('nextBtn').focus();
            }
            break;
    }
} async function updateUserBaseline() {
    const allLogs = await getAllDataFromDB('interactionLogs');
    if (!allLogs || allLogs.length === 0) return;

    const correctLogs = allLogs
        .filter(log => log?.wasCorrect)
        .sort((a, b) => {
            const timeA = a?.timestamp ? new Date(a.timestamp).getTime() : 0;
            const timeB = b?.timestamp ? new Date(b.timestamp).getTime() : 0;
            if (timeA === timeB) {
                return (b?.id || 0) - (a?.id || 0);
            }
            return timeB - timeA;
        })
        .slice(0, 200);

    const latencies = [];
    const corrections = [];
    const fluencies = [];
    const attempts = [];

    correctLogs.forEach(log => {
        if (typeof log.latency === 'number' && isFinite(log.latency)) {
            latencies.push(log.latency);
        }
        if (typeof log.corrections === 'number' && isFinite(log.corrections)) {
            corrections.push(log.corrections);
        }
        if (typeof log.fluency === 'number' && isFinite(log.fluency)) {
            fluencies.push(log.fluency);
        }
        if (typeof log.attempts === 'number' && isFinite(log.attempts)) {
            attempts.push(log.attempts);
        }
    });

    const median = (arr) => {
        if (!arr || arr.length === 0) return null;
        const sorted = [...arr].sort((a, b) => a - b);
        const mid = Math.floor(sorted.length / 2);
        if (sorted.length % 2 !== 0) return sorted[mid];
        return (sorted[mid - 1] + sorted[mid]) / 2;
    };

    const medianLatency = median(latencies);
    const medianCorrections = median(corrections);
    const medianFluency = median(fluencies);
    const medianAttempts = median(attempts);

    const adaptiveBaseline = {
        latency: (medianLatency || medianLatency === 0) ? medianLatency * 1.4 : DEFAULT_FSRS_BASELINE.latency,
        corrections: Math.max(2, ((medianCorrections || DEFAULT_FSRS_BASELINE.corrections) * 1.5)),
        attempts: 1,
        fluency: Math.max(3, ((medianFluency || DEFAULT_FSRS_BASELINE.fluency) * 0.8))
    };

    if (medianAttempts && medianAttempts > 1) {
        adaptiveBaseline.attempts = Math.max(1, Math.round(medianAttempts));
    }

    adaptiveBaselineCache = adaptiveBaseline;
    globalSettings.adaptiveFsrsBaseline = adaptiveBaseline;
    globalSettings.userBaseline = { ...(globalSettings.userBaseline || {}), ...adaptiveBaseline };

    await saveDataToDB('appData', { key: 'userSettings', ...globalSettings });

    try {
        const engine = await getFsrsEngine();
        if (engine?.setAdaptiveBaseline) {
            engine.setAdaptiveBaseline(adaptiveBaseline);
        }
    } catch (err) {
        console.warn('Failed to apply adaptive baseline to FSRS engine:', err);
    }

    if (globalSettings.devMode) {
        console.log('[FSRS debug] Adaptive Baseline:', adaptiveBaseline);
    }
}

async function moveCard(card, correct, questionType = 'Flashcard') {
    const deckIdForThisCard = card.deckId || currentDeckId;
    const deck = decks[deckIdForThisCard];

    if (!deckIdForThisCard || !deck) {
        console.error("moveCard failed: Could not determine the card's origin deck.");
        studyState.currentCardIndex++;
        showNextCard();
        return;
    }

    const cardInDeck = deck.cards.find(c => c.id === card.id);
    if (cardInDeck) cardInDeck.isNew = false;

    const lastLog = currentInteractionLog;
    const userBaseline = getFsrsBaseline();

    const iqs = calculateIQS({
        recallLatency: lastLog.recallLatency || 2000,
        answerFluency: lastLog.answerFluency || 5,
        totalCorrections: lastLog.backspaceCount + lastLog.deleteCount,
        attemptCount: lastLog.attemptCount || 1
    }, userBaseline);

    const fsrsResult = await applyFsrsReviewUpdate(
        cardInDeck || card,
        deckIdForThisCard,
        correct,
        { ...lastLog, questionType },
        iqs,
        { questionType }
    );
    const fsrsSnapshot = fsrsResult?.fsrsSnapshot || null;
    const implicitRating = fsrsResult?.rating ?? null;
    const newStability = fsrsResult?.state?.stability ?? null;
    const updatedKnowledgeState = fsrsResult?.state || null;

    if (analyticsManager) {
        analyticsManager.trackSystemMetric('fsrs_review', implicitRating, {
            deckId: deckIdForThisCard,
            due: fsrsSnapshot?.due || null,
            stability: newStability,
            questionType
        }, 'info');
    }

    if (updatedKnowledgeState) {
        studyState.knowledgeStates?.set(card.id, updatedKnowledgeState);
    }

    updateSessionStateMetrics(card.id, correct, {
        recallLatency: lastLog.recallLatency,
        totalCorrections: typeof lastLog.totalCorrections === 'number' ? lastLog.totalCorrections : (lastLog.backspaceCount || 0) + (lastLog.deleteCount || 0),
        answerFluency: lastLog.answerFluency
    });

    if (currentMode === 'sequence') {
        const currentChunk = studyState.sequenceActiveChunkOverride || studyState.sequenceChunks[studyState.currentChunkIndex];
        if (!currentChunk) {
            showToast("Sequence chunk not found", "error");
            return;
        }
        const deckSettings = decks[currentDeckId]?.settings || {};
        const targetDate = deckSettings.examDate ? new Date(deckSettings.examDate) : new Date();
        const knowledgeMap = studyState.knowledgeStates || new Map();
        const retentionState = updatedKnowledgeState || knowledgeMap.get(card.id);
        const retentionScore = calculateRetentionAtDate(retentionState, targetDate);
        if (globalSettings.devMode) {
            console.log('[Sequence] retention estimate:', retentionScore);
        }

        if (studyState.sequencePhase === 'Passive Review Quiz') {
            studyState.currentCardIndex++;
            if (studyState.currentCardIndex >= (studyState.roundCards?.length || 0)) {
                studyState.roundCards = [];
                moveToNextSequencePhase();
            } else {
                showNextCard();
            }
        } else if (studyState.sequencePhase === 'Forward Chaining') {
            if (!studyState.sequenceForwardQueue || studyState.sequenceForwardQueue.length === 0) {
                studyState.sequenceForwardQueue = currentChunk.map(c => c.id);
            }
            const queue = [...studyState.sequenceForwardQueue];
            if (correct) {
                studyState.currentCardIndex++;
                if (studyState.currentCardIndex >= queue.length) {
                    studyState.sequenceForwardQueue = [];
                    moveToNextSequencePhase();
                } else {
                    studyState.sequenceForwardQueue = queue;
                    showNextCard();
                }
            } else {
                const currentId = queue[studyState.currentCardIndex];
                queue.splice(studyState.currentCardIndex, 1);
                queue.push(currentId);
                studyState.sequenceForwardQueue = queue;
                showToast("We'll circle back to that item soon.", "error");
                showNextCard();
            }
        } else if (studyState.sequencePhase === 'Backward Chaining') {
            if (!Array.isArray(studyState.sequenceMissedInChunk)) studyState.sequenceMissedInChunk = [];
            if (!correct && card && !studyState.sequenceMissedInChunk.includes(card.id)) {
                studyState.sequenceMissedInChunk.push(card.id);
            }
            studyState.currentCardIndex--;
            if (studyState.currentCardIndex < 0) {
                if (studyState.sequenceActiveChunkOverride) {
                    studyState.sequenceActiveChunkOverride = null;
                    studyState.sequenceMissedInChunk = [];
                    moveToNextSequencePhase();
                } else if (studyState.sequenceMissedInChunk.length > 0) {
                    const backlog = (currentChunk || []).filter(c => studyState.sequenceMissedInChunk.includes(c.id));
                    studyState.sequenceActiveChunkOverride = backlog;
                    studyState.currentCardIndex = backlog.length - 1;
                    showToast("Quick retry on the tricky ones.", "info");
                    showNextCard();
                } else {
                    moveToNextSequencePhase();
                }
            } else {
                showNextCard();
            }
        } else if (studyState.sequencePhase === 'Post-Drag Recall') {
            studyState.currentCardIndex++;
            if (studyState.currentCardIndex >= (studyState.roundCards?.length || 0)) {
                studyState.roundCards = [];
                studyState.sequencePhase = 'Drag and Drop';
                moveToNextSequencePhase();
            } else {
                showNextCard();
            }
        } else if (studyState.sequencePhase === 'InterChunkReview') {
            studyState.currentCardIndex++;
            const reviewLength = studyState.roundCards ? studyState.roundCards.length : 0;
            if (reviewLength === 0 || studyState.currentCardIndex >= reviewLength) {
                studyState.sequencePhase = studyState.nextPhaseAfterReview;
                studyState.nextPhaseAfterReview = null;
                studyState.currentCardIndex = 0;
                moveToNextSequencePhase();
            } else {
                showNextCard();
            }
        } else if (studyState.sequencePhase === 'Weakest Link') {
            studyState.currentCardIndex++;
            const weakestLength = studyState.roundCards ? studyState.roundCards.length : 0;
            if (weakestLength === 0 || studyState.currentCardIndex >= weakestLength) {
                studyState.currentCardIndex = 0;
                studyState.sequencePhase = 'CheckWeakest';
                moveToNextSequencePhase();
            } else {
                showNextCard();
            }
        }
        await saveDataToDB('decks', decks[currentDeckId]);
        return;
    }

    if (currentMode === 'learn') {
        const knowledgeMap = studyState.knowledgeStates || new Map();
        const updatedState = updatedKnowledgeState || knowledgeMap.get(card.id);
        if (updatedState) knowledgeMap.set(card.id, updatedState);
        const nowTime = new Date();
        const cortex = await getCortexEngine();
        const targetDate = cortex.buildTargetDate(deck, nowTime);
        logLearnTargetSource(deck, nowTime, targetDate);
        const activePool = Array.isArray(studyState.activeLearningPool) ? studyState.activeLearningPool : [];
        const filteredPool = activePool.filter(c => !isCardMasteredForLearn(knowledgeMap.get(c.id), deck, targetDate));
        studyState.activeLearningPool = filteredPool;
        studyState.sessionCardIds = filteredPool.map(c => c.id);
        if (filteredPool.length === 0) {
            await updateSessionProgress();
            showComplete();
            await saveDataToDB('decks', decks[deckIdForThisCard]);
            return;
        }

        studyState.currentCard = await cortex.pickNextCard(filteredPool, studyState.sessionState, deck, knowledgeMap);
        if (!studyState.currentCard) {
            await updateSessionProgress();
            showComplete();
            await saveDataToDB('decks', decks[deckIdForThisCard]);
            return;
        }

        assignQuestionTypesToCards([studyState.currentCard], deckIdForThisCard, 'learn');
        await updateSessionProgress();
        showNextCard();
        updateFocusMeter();
        await saveDataToDB('decks', decks[deckIdForThisCard]);
        return;
    }


    if (currentMode === 'exam') {
        const stateForRetention = updatedKnowledgeState || await getDataFromDB('userKnowledgeState', ['default_user', card.id]);
        const planExamDate = studyState.examDate ? new Date(studyState.examDate) : null;
        const deckExamDate = deck.settings?.examDate ? new Date(deck.settings.examDate) : null;
        const examTargetDate = planExamDate || deckExamDate || new Date();
        const cardTargetRetention = deck.settings?.targetRetention || studyState.targetRetention || 0.8;
        const retention = calculateRetentionAtDate(stateForRetention, examTargetDate);

        if (retention < cardTargetRetention) {
            const queuedCard = { ...(cardInDeck || card), deckId: deckIdForThisCard, projectedRetention: retention };
            dailyPriorityQueue.push(queuedCard);
            dailyPriorityQueue.sort((a, b) => (a.projectedRetention ?? 0) - (b.projectedRetention ?? 0));
        } else {
            studyState.roundCards.splice(studyState.currentCardIndex, 1);
            studyState.currentCardIndex--;
        }
    }

    if (currentMode === 'review') {
        if (correct) {
            const index = studyState.stillLearning.findIndex(c => c.id === card.id);
            if (index > -1) {
                studyState.stillLearning.splice(index, 1);
                studyState.correct.push(card);
            }
        } else {
            if (!studyState.lastRoundIncorrect.some(c => c.id === card.id)) {
                studyState.lastRoundIncorrect.push(card);
            }
        }
    }

    // Advance to next card
    studyState.currentCardIndex++;
    showNextCard();
    updateFocusMeter();

    // Persist deck changes
    await saveDataToDB('decks', decks[deckIdForThisCard]);
}

function dontKnowAnswer() {
    const card = getActiveCard();
    if (!card) return;

    logInteraction({
        cardID: card.id,
        wasCorrect: false,
        recallLatency: null,
        answerFluency: 0,
        totalCorrections: 0,
        attemptCount: 1,
        userAnswer: "[Don't Know]"
    });

    const deck = decks[currentDeckId];
    const settings = { ...DEFAULT_DECK_SETTINGS, ...(deck?.settings || {}), ...(studyState.settings || {}) };

    document.querySelector('#cardView .flashcard').classList.add('is-flipped');
    document.getElementById('cardAnswerContent').classList.remove('hidden');

    const writeInput = document.getElementById('writeAnswerInput');
    const feedbackMessage = document.getElementById('feedbackMessage');

    document.getElementById('checkAnswerBtn').classList.add('hidden');
    document.getElementById('dontKnowBtn').classList.add('hidden');
    document.getElementById('correctBtn').classList.add('hidden');
    document.getElementById('incorrectBtn').classList.add('hidden');
    if (settings.retypeIncorrect) {
        studyState.isRetypingIncorrect = true;

        feedbackMessage.innerHTML = `<strong>The correct answer is:</strong> <span style="color:var(--primary-color)">${escapeHtml(String(card.answer))}</span>`;

        writeInput.value = '';
        writeInput.disabled = false;
        writeInput.focus();

        document.getElementById('checkAnswerBtn').classList.remove('hidden');

        showToast("Please type the correct answer to continue.", "info");
    } else {
        writeInput.value = '';
        writeInput.disabled = true;

        const nextBtn = document.getElementById('nextBtn');
        nextBtn.classList.remove('hidden');
        nextBtn.focus();
    }
}




async function markSpaced(quality) {
    if (!isActionAllowed()) return;
    const card = studyState.roundCards[studyState.currentCardIndex];
    const cardInDeck = decks[currentDeckId].cards.find(c => c.id === card.id);
    if (cardInDeck) {
        await getFsrsEngine();
        const fsrsRating = mapQualityToFsrsRating(quality);
        const fsrsResult = await applyFsrsReviewUpdate(
            cardInDeck,
            currentDeckId,
            quality >= 3,
            {
                recallLatency: null,
                answerFluency: null,
                totalCorrections: 0,
                attemptCount: 1,
                questionType: 'Spaced'
            },
            0.5,
            { explicitFsrsRating: fsrsRating, questionType: 'Spaced' }
        );
        const fsrsSnapshot = fsrsResult?.fsrsSnapshot || cardInDeck.fsrs;
        cardInDeck.fsrs = fsrsSnapshot;
        await saveDataToDB('decks', decks[currentDeckId]);

        if (analyticsManager) {
            analyticsManager.trackSystemMetric('fsrs_review', fsrsResult?.rating ?? fsrsRating, {
                deckId: currentDeckId,
                due: fsrsSnapshot?.due || null,
                stability: fsrsResult?.state?.stability || null,
                questionType: 'Spaced'
            }, 'info');
        }
    }
    updateSessionStateMetrics(card.id, quality >= 3, { recallLatency: null, totalCorrections: 0, answerFluency: 0 });
    studyState.currentCardIndex++;
    showNextCard();
}

function markCorrect(isAutomated = false) {
    if (!isAutomated && !isActionAllowed()) return;

    const btn = document.getElementById('correctBtn');
    btn.classList.add('feedback-correct');
    setTimeout(() => {
        btn.classList.remove('feedback-correct');
        const card = getActiveCard();
        if (!card) return;
        if (currentMode === 'spaced') {
            markSpaced(4);
        } else {
            moveCard(card, true);
        }
    }, 200);
}
function markIncorrect(isAutomated = false) {
    if (!isAutomated && !isActionAllowed() && document.getElementById('writeAnswerInput').value.trim() !== '') return;

    const isWriteMode = (currentMode === 'learn' && studyState.settings.learnMode === 'write') || (currentMode === 'review' && studyState.settings.reviewMode === 'write');

    if (!isAutomated && isWriteMode && studyState.settings.retypeIncorrect) {
        studyState.isRetypingIncorrect = true;
        const writeInput = document.getElementById('writeAnswerInput');
        writeInput.value = '';
        writeInput.disabled = false;
        writeInput.focus();

        document.getElementById('correctBtn').classList.add('hidden');
        document.getElementById('incorrectBtn').classList.add('hidden');
        document.getElementById('dontKnowBtn').classList.add('hidden');
        document.getElementById('checkAnswerBtn').classList.remove('hidden');

        showToast("Type the correct answer to continue.", "error");
        return;
    }

    const btn = document.getElementById('incorrectBtn');
    btn.classList.add('feedback-incorrect');
    setTimeout(() => {
        btn.classList.remove('feedback-incorrect');
        const card = getActiveCard();
        if (!card) return;
        if (currentMode === 'spaced') {
            markSpaced(1);
        } else {
            moveCard(card, false);
        }
    }, 200);
}

let studyAccentModule = null;
let testAccentModule = null;

function insertCharacterAtCursor(input, char) {
    if (!input || input.disabled) return;
    const start = typeof input.selectionStart === 'number' ? input.selectionStart : input.value.length;
    const end = typeof input.selectionEnd === 'number' ? input.selectionEnd : start;
    input.value = input.value.substring(0, start) + char + input.value.substring(end);
    const newPos = start + char.length;
    if (typeof input.setSelectionRange === 'function') {
        input.setSelectionRange(newPos, newPos);
    }
    input.focus();
    input.dispatchEvent(new Event('input', { bubbles: true }));
}

function AccentModule(config) {
    this.config = config;
    this.moduleEl = document.getElementById(config.moduleId);
    this.toggleBtn = document.getElementById(config.toggleId);
    this.buttonsContainer = document.getElementById(config.buttonsId);
    this.inputEl = document.getElementById(config.inputId);
    this.getDeck = config.getDeck;
    this.priorityBase = null;
    this.isExpanded = false;
    this.lastDeckId = null;
    this.lastRenderedHtml = '';
    this.isReady = Boolean(this.moduleEl && this.toggleBtn && this.buttonsContainer && this.inputEl && this.getDeck);
    if (!this.isReady) {
        return;
    }
    this.buttonsContainer.setAttribute('aria-label', config.ariaLabel || 'Accent characters');
    this.toggleBtn.setAttribute('aria-controls', config.buttonsId);
    this.toggleBtn.setAttribute('aria-expanded', 'false');
    this.toggleBtn.addEventListener('click', (event) => {
        event.preventDefault();
        this.toggle();
    });
    this.buttonsContainer.addEventListener('click', (event) => this.handleAccentClick(event));
    this.inputEl.addEventListener('input', () => this.handleInputChange());
    const observer = new MutationObserver(() => {
        const shouldShow = !this.inputEl.classList.contains('hidden');
        this.updateVisibility(shouldShow);
    });
    observer.observe(this.inputEl, { attributes: true, attributeFilter: ['class'] });
    this.updateVisibility(!this.inputEl.classList.contains('hidden'));
}

AccentModule.prototype.getAccentUtils = function () {
    return window.AccentUtils;
};

AccentModule.prototype.handleAccentClick = function (event) {
    const button = event.target.closest('button[data-accent]');
    if (!button) return;
    event.preventDefault();
    insertCharacterAtCursor(this.inputEl, button.dataset.accent || '');
};

AccentModule.prototype.handleInputChange = function () {
    const accentUtils = this.getAccentUtils();
    if (!accentUtils) return;
    const start = typeof this.inputEl.selectionStart === 'number' ? this.inputEl.selectionStart : 0;
    if (start <= 0) {
        if (this.priorityBase) {
            this.priorityBase = null;
            this.renderButtonsForCurrentDeck();
        }
        return;
    }
    const char = this.inputEl.value.charAt(start - 1);
    const baseKey = accentUtils.getAccentBaseKey(char);
    if (!baseKey) {
        if (this.priorityBase) {
            this.priorityBase = null;
            this.renderButtonsForCurrentDeck();
        }
        return;
    }
    if (baseKey !== this.priorityBase) {
        this.priorityBase = baseKey;
        this.renderButtonsForCurrentDeck();
    }
};

AccentModule.prototype.toggle = function () {
    const accentUtils = this.getAccentUtils();
    const deck = this.getDeck?.();
    const accentData = deck && accentUtils?.ensureDeckAccentMetadata ? accentUtils.ensureDeckAccentMetadata(deck) : null;
    this.renderButtons(deck, accentData);
    this.isExpanded = !this.isExpanded;
    if (this.isExpanded) {
        this.buttonsContainer.classList.remove('hidden');
    } else {
        this.buttonsContainer.classList.add('hidden');
    }
    this.toggleBtn.setAttribute('aria-expanded', String(this.isExpanded));
};

AccentModule.prototype.collapse = function () {
    this.isExpanded = false;
    this.buttonsContainer.classList.add('hidden');
    this.toggleBtn.setAttribute('aria-expanded', 'false');
};

AccentModule.prototype.getOrderedAccentList = function (list, baseMap) {
    if (!this.priorityBase || !baseMap) return list;
    const prioritized = baseMap[this.priorityBase] || [];
    if (!prioritized.length) return list;
    const rest = list.filter((char) => !prioritized.includes(char));
    return [...prioritized, ...rest];
};

AccentModule.prototype.renderButtons = function (deck, accentData) {
    const accents = accentData?.accents || [];
    if (!accents.length) {
        this.buttonsContainer.innerHTML = '';
        this.lastRenderedHtml = '';
        return;
    }
    const ordered = this.getOrderedAccentList(accents, accentData.baseMap || {});
    const html = ordered.map((char) => `<button type="button" class="deck-accent-button" data-accent="${char}" aria-label="Insert ${char}">${char}</button>`).join('');
    if (html === this.lastRenderedHtml) {
        return;
    }
    this.buttonsContainer.innerHTML = html;
    this.lastRenderedHtml = html;
    if (!this.isExpanded) {
        this.buttonsContainer.classList.add('hidden');
    }
};

AccentModule.prototype.renderButtonsForCurrentDeck = function () {
    const accentUtils = this.getAccentUtils();
    const deck = this.getDeck?.();
    const accentData = deck && accentUtils?.ensureDeckAccentMetadata ? accentUtils.ensureDeckAccentMetadata(deck) : { accents: [], baseMap: {} };
    this.renderButtons(deck, accentData);
};

AccentModule.prototype.updateVisibility = function (shouldShow) {
    const accentUtils = this.getAccentUtils();
    const deck = this.getDeck?.();
    const accentData = deck && accentUtils?.ensureDeckAccentMetadata ? accentUtils.ensureDeckAccentMetadata(deck) : { accents: [], baseMap: {} };
    const hasAccents = Array.isArray(accentData.accents) && accentData.accents.length > 0;
    const displayModule = shouldShow && hasAccents;
    this.moduleEl.classList.toggle('hidden', !displayModule);
    if (!displayModule) {
        this.collapse();
        this.buttonsContainer.innerHTML = '';
        this.lastRenderedHtml = '';
        this.priorityBase = null;
        this.lastDeckId = null;
        return;
    }
    if (deck && deck.id && deck.id !== this.lastDeckId) {
        this.priorityBase = null;
    }
    this.lastDeckId = deck?.id || null;
    this.renderButtons(deck, accentData);
};

AccentModule.prototype.refresh = function () {
    this.lastDeckId = null;
    this.updateVisibility(!this.inputEl.classList.contains('hidden'));
};

function initializeAccentModules() {
    if (typeof window === 'undefined' || !window.AccentUtils) return;
    if (!studyAccentModule || !studyAccentModule.isReady) {
        const module = new AccentModule({
            moduleId: 'deckAccentModule',
            toggleId: 'deckAccentToggle',
            buttonsId: 'deckAccentButtons',
            inputId: 'writeAnswerInput',
            ariaLabel: 'Deck accent characters',
            getDeck: () => decks[currentDeckId]
        });
        studyAccentModule = module.isReady ? module : null;
    } else {
        studyAccentModule.refresh();
    }
    if (!testAccentModule || !testAccentModule.isReady) {
        const module = new AccentModule({
            moduleId: 'testAccentModule',
            toggleId: 'testAccentToggle',
            buttonsId: 'testAccentButtons',
            inputId: 'testAnswerInput',
            ariaLabel: 'Deck accent characters',
            getDeck: () => decks[practiceTestState.deckId]
        });
        testAccentModule = module.isReady ? module : null;
    } else {
        testAccentModule.refresh();
    }
}

let currentAutocompleteSuggestion = null;
let currentAutocompleteTextarea = null;

async function triggerGeminiAutocomplete(textarea, cardRow, fieldType) {
    if (!textarea || !cardRow) return;

    // Remove any existing suggestion
    removeAutocompleteSuggestion();

    const currentText = textarea.value;
    const otherField = fieldType === 'question'
        ? cardRow.querySelector('.solution-input')?.value || ''
        : cardRow.querySelector('.question-input')?.value || '';

    // Get context (limit to last 3 cards to improve speed)
    const allCardElements = Array.from(document.querySelectorAll('#editorView .flashcard-item'));
    const currentIndex = allCardElements.findIndex(el => el.contains(textarea));

    // Get previous 3 cards for context
    const contextCards = allCardElements
        .slice(Math.max(0, currentIndex - 3), currentIndex)
        .map(el => {
            const qInput = el.querySelector('.question-input');
            const aInput = el.querySelector('.solution-input');
            return {
                question: qInput ? qInput.value.trim() : '',
                answer: aInput ? aInput.value.trim() : ''
            };
        })
        .filter(card => card.question || card.answer);

    // Show loading indicator
    showAutocompleteLoading(textarea);

    try {
        const currentCard = {
            question: fieldType === 'question' ? currentText : otherField,
            answer: fieldType === 'answer' ? currentText : otherField
        };

        let result;
        if (isElectron && window.electronAPI && window.electronAPI.geminiAutocomplete) {
            result = await window.electronAPI.geminiAutocomplete({
                deckContent: contextCards,
                currentCard: currentCard,
                fieldType: fieldType
            });
        } else {
            const response = await fetch('/.netlify/functions/gemini-autocomplete', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    deckContent: contextCards,
                    currentCard: currentCard,
                    fieldType: fieldType
                })
            });

            if (!response.ok) {
                throw new Error(`Server error: ${response.status}`);
            }
            result = await response.json();
        }

        if (result.error) {
            throw new Error(result.message || result.error);
        }

        if (result.suggestion) {
            showAutocompleteSuggestion(textarea, result.suggestion);
        }
    } catch (error) {
        console.error('Autocomplete error:', error);
        removeAutocompleteSuggestion();
        // Silently fail - don't show error to user, just continue normally
    }
}

function showAutocompleteLoading(textarea) {
    const suggestionDiv = document.createElement('div');
    suggestionDiv.className = 'autocomplete-suggestion';
    suggestionDiv.style.cssText = 'position: absolute; background: var(--card-bg); border: 1px solid var(--border-color); border-radius: 8px; padding: 10px; margin-top: 5px; box-shadow: 0 4px 12px var(--shadow-color); z-index: 1000; max-width: 100%;';
    suggestionDiv.innerHTML = '<div style="display: flex; align-items: center; gap: 10px;"><span class="spinner" style="border-width: 2px; width: 16px; height: 16px;"></span><span>Generating suggestion...</span></div>';

    textarea.parentElement.style.position = 'relative';
    textarea.parentElement.appendChild(suggestionDiv);
    currentAutocompleteTextarea = textarea;
}

function showAutocompleteSuggestion(textarea, suggestion) {
    removeAutocompleteSuggestion();

    // Create wrapper if not exists
    let wrapper = textarea.parentElement;
    if (!wrapper.classList.contains('autocomplete-wrapper')) {
        wrapper = document.createElement('div');
        wrapper.className = 'autocomplete-wrapper';
        textarea.parentElement.insertBefore(wrapper, textarea);
        wrapper.appendChild(textarea);
    }

    // Create ghost element
    const ghost = document.createElement('div');
    ghost.className = 'autocomplete-ghost';

    // Match styles exactly
    const computedStyle = window.getComputedStyle(textarea);
    ghost.style.padding = computedStyle.padding;
    ghost.style.fontSize = computedStyle.fontSize;
    ghost.style.fontFamily = computedStyle.fontFamily;
    ghost.style.lineHeight = computedStyle.lineHeight;
    ghost.style.letterSpacing = computedStyle.letterSpacing;

    // Set content: user text + suggestion
    const userText = textarea.value;
    ghost.innerHTML = escapeHtml(userText) + `<span>${escapeHtml(suggestion)}</span>`;

    wrapper.insertBefore(ghost, textarea);
    wrapper.classList.add('autocomplete-active');

    // Sync scrolling
    const syncScroll = () => { ghost.scrollTop = textarea.scrollTop; };
    textarea.addEventListener('scroll', syncScroll);
    ghost._scrollHandler = syncScroll;

    currentAutocompleteSuggestion = suggestion;
    currentAutocompleteTextarea = textarea;

    // Add keyboard handlers
    const handleKeyDown = (e) => {
        if ((e.key === 'ArrowRight' || (e.key === 'Enter' && (e.metaKey || e.ctrlKey))) && !e.shiftKey) {
            e.preventDefault();
            acceptAutocomplete();
        } else if (e.key === 'Escape') {
            e.preventDefault();
            dismissAutocomplete();
        }
    };
    textarea.addEventListener('keydown', handleKeyDown);
    ghost._keyHandler = handleKeyDown;
}

function acceptAutocomplete() {
    if (currentAutocompleteTextarea && currentAutocompleteSuggestion) {
        const textarea = currentAutocompleteTextarea;
        const currentValue = textarea.value;
        const cursorPos = textarea.selectionStart;

        // Insert suggestion at cursor position
        const before = currentValue.substring(0, cursorPos);
        const after = currentValue.substring(cursorPos);
        textarea.value = before + currentAutocompleteSuggestion + after;
        textarea.selectionStart = textarea.selectionEnd = cursorPos + currentAutocompleteSuggestion.length;
        textarea.focus();
    }
    removeAutocompleteSuggestion();
}

function dismissAutocomplete() {
    removeAutocompleteSuggestion();
}

function removeAutocompleteSuggestion() {
    const ghost = document.querySelector('.autocomplete-ghost');
    if (ghost) {
        if (ghost._keyHandler && currentAutocompleteTextarea) {
            currentAutocompleteTextarea.removeEventListener('keydown', ghost._keyHandler);
        }
        if (ghost._scrollHandler && currentAutocompleteTextarea) {
            currentAutocompleteTextarea.removeEventListener('scroll', ghost._scrollHandler);
        }
        ghost.remove();
    }

    const wrapper = document.querySelector('.autocomplete-wrapper.autocomplete-active');
    if (wrapper) {
        wrapper.classList.remove('autocomplete-active');
    }

    currentAutocompleteSuggestion = null;
    currentAutocompleteTextarea = null;
}

// Dismiss autocomplete when clicking outside or when user starts typing
document.addEventListener('click', (e) => {
    if (!e.target.closest('.autocomplete-suggestion') && !e.target.classList.contains('question-input') && !e.target.classList.contains('solution-input')) {
        removeAutocompleteSuggestion();
    }
});

// Dismiss autocomplete when user starts typing in a different field
document.getElementById('flashcardsContainer')?.addEventListener('input', (e) => {
    if (e.target.classList.contains('question-input') || e.target.classList.contains('solution-input')) {
        if (e.target !== currentAutocompleteTextarea) {
            removeAutocompleteSuggestion();
        }
    }
});

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function showComplete() {
    const endTime = new Date();
    const durationMs = endTime - studyState.startTime;
    const minutes = Math.floor(durationMs / 60000);
    const seconds = Math.floor((durationMs % 60000) / 1000);

    const timeString = minutes > 0
        ? `${minutes}m ${seconds}s`
        : `${seconds}s`;

    const deck = decks[currentDeckId];
    const totalCards = deck ? deck.cards.length : 0;

    document.getElementById('progressView').classList.add('hidden');
    document.getElementById('cardView').classList.add('hidden');
    hidePreGenerationViewImmediately();

    const completeView = document.getElementById('completeView');
    completeView.classList.remove('hidden');
    completeView.classList.add('sub-view-fade-in');

    document.getElementById('finalStats').innerHTML = `
                <div class="stat">
                    <div class="stat-value">${timeString}</div>
                    <div class="stat-label">Time Taken</div>
                </div>
                <div class="stat">
                    <div class="stat-value">${totalCards}</div>
                    <div class="stat-label">Total Cards</div>
                </div>
            `;

    document.querySelector('#completeView button.btn-secondary').onclick = endSession;
}


async function endSession() {
    if (currentDeckId && studyState.startTime) {
        const deck = decks[currentDeckId];
        const cardIdsInDeck = new Set(deck.cards.map(c => c.id));
        const knowledgeStates = await getAllDataFromDB('userKnowledgeState');
        const examDate = deck.settings?.examDate ? new Date(deck.settings.examDate) : null;
        const masteryCountBefore = knowledgeStates.filter(s => {
            if (!cardIdsInDeck.has(s.cardID)) return false;
            const retention = calculateRetentionAtDate(s, examDate || new Date());
            const threshold = examDate ? (deck.settings?.targetRetention || 0.8) : 0.9;
            return retention >= threshold;
        }).length;

        await runSmartCoachChecks('sessionEnd', {
            deckId: currentDeckId,
            masteryCountBefore: masteryCountBefore
        });
    }

    if (studyState.startTime) {
        const duration = Math.round((new Date() - studyState.startTime) / 1000);
        analyticsData.totalStudyTime += duration;
        analyticsData.sessions.unshift({
            date: new Date().toISOString(),
            deckName: decks[currentDeckId]?.name || 'Unknown Deck',
            mode: currentMode,
            duration: duration
        });
        if (analyticsData.sessions.length > 50) analyticsData.sessions.pop();
        await saveDataToDB('appData', { key: 'analytics', ...analyticsData });
    }

    const originPlanId = studyState.originPlanId;
    if (currentMode === 'exam') {
        dailyPriorityQueue = [];
    }
    await saveStudyProgress();
    await updateUserBaseline();

    studyState.isRetypingIncorrect = false;
    studyState.originPlanId = null;
    if (currentMode === 'exam' && originPlanId) {
        showPlanDetails(originPlanId);
    } else {
        backToDashboard(false, true);
    }
}

function resetProgress() {
    showConfirmModal('Are you sure you want to reset your progress for this deck?', () => restartStudy());
}

async function restartStudy() {
    const deck = decks[currentDeckId];
    if (!deck) return;

    showToast("Resetting progress for this deck...", "info");

    try {
        // Reset knowledge state with explicit transaction completion
        await new Promise((resolve, reject) => {
            const transaction = db.transaction(['userKnowledgeState'], 'readwrite');
            const store = transaction.objectStore('userKnowledgeState');

            const resetPromises = deck.cards.map(card => {
                return new Promise((resolveCard, rejectCard) => {
                    const defaultState = createDefaultKnowledgeState({ id: card.id, deckID: deck.id }, {
                        userID: 'default_user',
                        deckID: deck.id,
                        stability: 1.0,
                        lastReviewed: new Date().toISOString(),
                        fsrs: null
                    });

                    if (!defaultState) {
                        console.warn('[DB] Skipped reset for card due to missing identifiers', card);
                        resolveCard();
                        return;
                    }

                    const request = store.put(defaultState);
                    request.onsuccess = resolveCard;
                    request.onerror = rejectCard;
                });
            });

            Promise.all(resetPromises)
                .then(() => {
                    transaction.oncomplete = resolve;
                    transaction.onerror = reject;
                })
                .catch(reject);
        });

        if (currentMode === 'learn') {
        } else if (currentMode === 'review') {
            deck.reviewState = { stillLearning: [...deck.cards], correct: [], currentRound: 1, lastRoundIncorrect: [] };
            await saveDataToDB('decks', deck);
        } else if (currentMode === 'spaced') {
            const fsrsEngine = await getFsrsEngine();
            deck.cards.forEach(card => card.fsrs = serializeFsrsCard(fsrsEngine.prepareCard()));
            await saveDataToDB('decks', deck);
        }

        showToast("Progress has been reset.", "success");

        if (currentMode === 'learn') startLearnMode(currentDeckId);
        else if (currentMode === 'review') startReviewMode(currentDeckId);
        else if (currentMode === 'spaced') startSpacedLearning(currentDeckId);

    } catch (error) {
        console.error("Failed to reset knowledge state:", error);
        showToast("An error occurred while resetting progress.", "error");
    }
}

function isActionAllowed() {
    if (activeView !== 'studyMode' || document.getElementById('cardView').classList.contains('hidden')) {
        return false;
    }
    const correctBtnHidden = document.getElementById('correctBtn').classList.contains('hidden');
    const advancedBtnsHidden = document.getElementById('advancedAnswerButtons').classList.contains('hidden');
    return !correctBtnHidden || !advancedBtnsHidden;
}

function setupKeyboardControls() {
    document.addEventListener('keydown', (e) => {
        if (document.querySelector('.modal.show')) return;

        if (activeView === 'studyMode' && !document.getElementById('progressView').classList.contains('hidden')) {
            if (e.key === 'Enter') {
                e.preventDefault();
                document.getElementById('continueBtn').click();
            }
            return;
        }

        if (activeView !== 'studyMode' || document.getElementById('cardView').classList.contains('hidden')) return;

        if (currentMode === 'sequence' && (e.key === 'Enter' || e.key === 'ArrowUp' || e.key === ' ')) {
            const writeInput = document.getElementById('writeAnswerInput');
            const dragDropBtn = document.getElementById('checkDragDropBtn');
            const passiveReviewView = document.getElementById('passiveReviewView');

            if (!writeInput.classList.contains('hidden') && !writeInput.disabled) {
                e.preventDefault();
                checkSequenceAnswer();
                return;
            }

            if (dragDropBtn && !dragDropBtn.classList.contains('hidden')) {
                e.preventDefault();
                checkDragDropOrder();
                return;
            }

            if (passiveReviewView && !passiveReviewView.classList.contains('hidden') && (e.key === 'Enter' || e.key === ' ')) {
                e.preventDefault();
                moveToNextSequencePhase();
                return;
            }
        }

        const advancedButtons = document.getElementById('advancedAnswerButtons');
        const simpleCorrectBtn = document.getElementById('correctBtn');
        const showAnswerBtn = document.getElementById('showAnswerBtn');

        if (!advancedButtons.classList.contains('hidden')) {
            e.preventDefault();
            switch (e.key) {
                case '1': markSpaced(1); break;
                case '2': markSpaced(2); break;
                case '3': markSpaced(3); break;
                case '4': markSpaced(4); break;
            }
            return;
        }

        if (!simpleCorrectBtn.classList.contains('hidden')) {
            e.preventDefault();
            if (e.key === 'ArrowLeft' || e.key === '1') markIncorrect();
            else if (e.key === 'ArrowRight' || e.key === '2') markCorrect();
            return;
        }

        if (!showAnswerBtn.classList.contains('hidden')) {
            if (document.activeElement.tagName === 'TEXTAREA') return;
            if (e.key === ' ' || e.key === 'Enter') {
                e.preventDefault();
                showAnswer();
            }
        }
    });
}

async function toggleStudyMode() {
    if (currentMode !== 'learn') return;
    const deck = decks[currentDeckId];
    if (!deck) return;

    studyState.settings.learnMode = studyState.settings.learnMode === 'write' ? 'flashcard' : 'write';
    deck.settings.learnMode = studyState.settings.learnMode;

    await saveDataToDB('decks', deck);
    showToast(`Switched to ${studyState.settings.learnMode} mode.`);

    showNextCard();
}

function shuffleArray(array) {
    const newArray = [...array];
    for (let i = newArray.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1));[newArray[i], newArray[j]] = [newArray[j], newArray[i]]; }
    return newArray;
}

function parseDeckNumericInput(value, fallback, min = Number.NEGATIVE_INFINITY, max = Number.POSITIVE_INFINITY) {
    const parsed = Number.parseInt(value, 10);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.min(Math.max(parsed, min), max);
}

function openDeckSettingsModal(deckId) {
    currentViewingDeckId = deckId;
    const deck = decks[deckId];
    if (!deck) return;

    const settings = { ...DEFAULT_DECK_SETTINGS, ...(deck.settings || {}) };

    const hasExamDate = !!settings.examDate;
    document.getElementById('deckSettingsExamModeToggle').checked = hasExamDate;

    if (settings.examDate) {
        document.getElementById('deckSettingsExamDate').value = settings.examDate;
    } else {
        const defaultDate = new Date();
        defaultDate.setDate(defaultDate.getDate() + 7);
        document.getElementById('deckSettingsExamDate').valueAsDate = defaultDate;
    }

    const retention = settings.targetRetention || 0.8;
    const retentionPercent = Math.round(retention * 100);
    document.getElementById('deckSettingsRetention').value = retentionPercent;
    document.getElementById('deckSettingsRetentionValue').textContent = retentionPercent + '%';

    toggleExamSettingsVisibility();

    const defaultCardsPerRound = Number.isFinite(settings.cardsPerRound) && settings.cardsPerRound > 0
        ? settings.cardsPerRound
        : (DEFAULT_DECK_SETTINGS.cardsPerRound || 10);
    document.getElementById('deckSettingsCardsPerRound').value = defaultCardsPerRound;
    const defaultLearnHorizon = Number.isFinite(settings.learnHorizonDays) && settings.learnHorizonDays >= 0
        ? settings.learnHorizonDays
        : (typeof DEFAULT_DECK_SETTINGS.learnHorizonDays === 'number' ? DEFAULT_DECK_SETTINGS.learnHorizonDays : 0);
    document.getElementById('deckSettingsLearnHorizon').value = defaultLearnHorizon;

    document.getElementById('adaptiveAutoToggle').checked = settings.adaptiveModes?.auto ?? true;
    document.getElementById('adaptiveMcqToggle').checked = settings.adaptiveModes?.mcq ?? true;
    document.getElementById('adaptiveClozeToggle').checked = settings.adaptiveModes?.cloze ?? true;

    if (settings.learnMode === 'write') {
        document.getElementById('deckSettingsStudyModeWrite').checked = true;
    } else {
        document.getElementById('deckSettingsStudyModeFlashcard').checked = true;
    }

    document.getElementById('retypeIncorrectToggle').checked = settings.retypeIncorrect || false;
    document.getElementById('caseSensitiveToggle').checked = settings.caseSensitive || false;
    document.getElementById('punctuationToggle').checked = settings.punctuation || false;
    document.getElementById('reviewOrder').value = settings.reviewOrder || 'random';
    document.getElementById('enablePomodoroToggle').checked = settings.enablePomodoro || false;

    document.getElementById('deckSettingsModal').classList.add('show');

    setupRadioCardSelection('deckSettingsStudyMode');
    const autoToggle = document.getElementById('adaptiveAutoToggle');
    if (autoToggle) autoToggle.dispatchEvent(new Event('change'));
}



function closeDeckSettingsModal() { document.getElementById('deckSettingsModal').classList.remove('show'); }

async function saveDeckSettings() {
    const deck = decks[currentViewingDeckId];
    if (!deck) return;
    await completeSaveDeckSettings(deck);
}

async function completeSaveDeckSettings(deck) {
    deck.settings = deck.settings || {};
    const isExamEnabled = document.getElementById('deckSettingsExamModeToggle').checked;

    if (isExamEnabled) {
        const examDateInput = document.getElementById('deckSettingsExamDate').value;
        // For now, if empty, we save it as null effectively disabling it logic-wise, or save what's there.
        deck.settings.examDate = examDateInput || null;
    } else {
        deck.settings.examDate = null;
    }

    const retentionInput = document.getElementById('deckSettingsRetention').value;
    deck.settings.targetRetention = parseInt(retentionInput, 10) / 100;

    const safeCardsPerRound = parseDeckNumericInput(
        document.getElementById('deckSettingsCardsPerRound').value,
        DEFAULT_DECK_SETTINGS.cardsPerRound || 10,
        1,
        200
    );
    deck.settings.cardsPerRound = safeCardsPerRound;

    const safeLearnHorizon = parseDeckNumericInput(
        document.getElementById('deckSettingsLearnHorizon').value,
        typeof DEFAULT_DECK_SETTINGS.learnHorizonDays === 'number' ? DEFAULT_DECK_SETTINGS.learnHorizonDays : 0,
        0,
        365
    );
    deck.settings.learnHorizonDays = safeLearnHorizon;
    deck.settings.retypeIncorrect = document.getElementById('retypeIncorrectToggle').checked;

    deck.settings.caseSensitive = document.getElementById('caseSensitiveToggle').checked;
    deck.settings.punctuation = document.getElementById('punctuationToggle').checked;

    deck.settings.reviewOrder = document.getElementById('reviewOrder').value;

    const selectedMode = document.querySelector('input[name="deckSettingsStudyMode"]:checked');
    if (selectedMode) {
        deck.settings.learnMode = selectedMode.value;
    }

    deck.settings.adaptiveModes = {
        auto: document.getElementById('adaptiveAutoToggle').checked,
        mcq: document.getElementById('adaptiveMcqToggle').checked,
        cloze: document.getElementById('adaptiveClozeToggle').checked
    };

    deck.settings.enablePomodoro = document.getElementById('enablePomodoroToggle').checked;

    await saveDataToDB('decks', deck);
    updateDashboard();
    closeDeckSettingsModal();
    showToast('Settings saved!');
}



function showImportModal() {
    const dropdown = document.getElementById('importDeckCategory');
    dropdown.innerHTML = '';
    categories.forEach(cat => {
        const opt = document.createElement('option');
        opt.value = String(cat);
        opt.textContent = String(cat);
        dropdown.appendChild(opt);
    });
    const addOpt = document.createElement('option');
    addOpt.value = 'add_new_category';
    addOpt.style.fontStyle = 'italic';
    addOpt.textContent = '+ Add New Category...';
    dropdown.appendChild(addOpt);
    dropdown.onchange = handleCategoryChange;

    document.getElementById('importModal').classList.add('show');
}

async function importData() {
    const name = document.getElementById('importDeckName').value.trim();
    const category = document.getElementById('importDeckCategory').value;
    const typeHint = document.getElementById('importDeckTypeHint').value;

    if (!name) { showToast('Please provide a name for the new deck.', 'error'); return; }

    const fileInput = document.getElementById('importFileInput');
    const pastedText = document.getElementById('importPastedText').value;

    if (fileInput.files.length > 0) {
        const file = fileInput.files[0];
        const reader = new FileReader();
        reader.onload = async function (e) {
            try {
                if (file.name.endsWith('.json')) {
                    const importedData = JSON.parse(e.target.result);

                    if (importedData.deck && importedData.knowledgeStateData) {
                        const deckData = importedData.deck;
                        const knowledgeData = importedData.knowledgeStateData;

                        const oldIdToNewIdMap = new Map();
                        deckData.cards.forEach((card, index) => {
                            const oldId = card.id;
                            const newId = crypto.randomUUID();
                            card.id = newId;
                            oldIdToNewIdMap.set(oldId, newId);

                            if (typeHint === 'Sequence' && typeof card.order !== 'number') {
                                card.order = index + 1;
                            }
                        });

                        const newDeckId = await createNewDeck(name, category, deckData.cards, deckData.notes || '', typeHint);

                        const transaction = db.transaction(['userKnowledgeState'], 'readwrite');
                        const store = transaction.objectStore('userKnowledgeState');
                        knowledgeData.forEach(state => {
                            const newCardId = oldIdToNewIdMap.get(state.cardID || state.cardId);
                            if (newCardId) {
                                const normalizedState = prepareKnowledgeRecord({
                                    ...state,
                                    cardID: newCardId,
                                    deckID: newDeckId || state.deckID || state.deckId || null
                                });
                                if (normalizedState) {
                                    store.put(normalizedState);
                                } else {
                                    console.warn('[IMPORT] Skipped malformed knowledge state', state);
                                }
                            }
                        });

                        showToast(`Deck "${name}" and its learning progress restored!`, 'success');

                    } else {
                        if (!importedData.name || !Array.isArray(importedData.cards)) throw new Error('Invalid JSON format.');

                        if (typeHint === 'Sequence') {
                            importedData.cards.forEach((card, index) => {
                                if (typeof card.order !== 'number') {
                                    card.order = index + 1;
                                }
                            });
                        }

                        await createNewDeck(name, category, importedData.cards, importedData.notes || '', typeHint);
                        showToast(`Deck "${name}" imported successfully with ${importedData.cards.length} cards!`);
                    }

                } else if (file.name.endsWith('.csv') || file.name.endsWith('.txt')) {
                    const cards = parseTextData(e.target.result, file.name.endsWith('.csv') ? ',' : '\t', typeHint);
                    if (cards.length > 0) {
                        await createNewDeck(name, category, cards, '', typeHint);
                        showToast(`Deck "${name}" imported successfully with ${cards.length} cards!`);
                    } else { throw new Error('No valid cards found in file.'); }
                }
                closeImportModal();
                updateDashboard();
            } catch (error) { showToast(`Error importing file: ${error.message}`, 'error'); }
        };
        reader.readAsText(file);
    } else if (pastedText.trim()) {
        try {
            const cards = parseTextData(pastedText.trim(), '\t', typeHint);
            if (cards.length > 0) {
                await createNewDeck(name, category, cards, '', typeHint);
                showToast(`Deck "${name}" created successfully with ${cards.length} cards!`);
                closeImportModal();
                updateDashboard();
            } else { throw new Error('No valid cards found in text.'); }
        } catch (error) { showToast(`Error parsing text: ${error.message}`, 'error'); }
    } else {
        showToast('Please select a file or paste text to import.', 'error');
    }
}
function closeImportModal() { document.getElementById('importModal').classList.remove('show'); }
function switchImportTab(tabName) {
    document.getElementById('importContentPaste').classList.toggle('hidden', tabName !== 'paste');
    document.getElementById('importContentFile').classList.toggle('hidden', tabName !== 'file');
    document.getElementById('importTabPaste').classList.toggle('active', tabName === 'paste');
    document.getElementById('importTabFile').classList.toggle('active', tabName === 'file');
}

function parseTextData(text, separator, typeHint = 'General') {
    return text.split('\n').map((line, index) => {
        const parts = line.split(separator);
        if (parts.length >= 2 && parts[0].trim() && parts[1].trim()) {
            const card = {
                id: crypto.randomUUID(),
                question: parts[0].trim(),
                answer: parts[1].trim(),
                isNew: true
            };

            if (typeHint === 'Sequence') {
                card.order = index + 1;
            } else {
                card.order = 0;
            }

            return card;
        }
        return null;
    }).filter(Boolean);
}

// Use the shared helper compressImage if available; otherwise provide a passthrough
if (typeof compressImage === 'undefined') {
    // Keep a fallback to avoid runtime errors when utils.js is not yet loaded
    async function compressImage(dataUrl, qualityOrMaxSize = undefined, maxSizeKB = undefined) {
        if (typeof window !== 'undefined' && typeof window.compressImage === 'function') {
            // Normalize call: if second arg is > 10 we assume it's maxSizeMB so convert to KB
            if (typeof qualityOrMaxSize === 'number' && qualityOrMaxSize > 10) {
                const kb = Math.floor(qualityOrMaxSize * 1024);
                return window.compressImage(dataUrl, undefined, kb);
            }
            return window.compressImage(dataUrl, qualityOrMaxSize, maxSizeKB);
        }
        return Promise.resolve(dataUrl);
    }
}

const CONFIRM_PROCESSING_LABEL = 'Processing...';
const CONFIRM_DEFAULT_LABEL = (function () {
    if (typeof document === 'undefined') return 'Confirm';
    const btn = document.getElementById('confirmActionConfirmBtn');
    return btn?.textContent?.trim() || 'Confirm';
})();

function resetConfirmButtonState(button) {
    if (!button) return;
    button.disabled = false;
    button.textContent = CONFIRM_DEFAULT_LABEL;
    button.removeAttribute('aria-busy');
    button.removeAttribute('data-busy');
    button.classList.remove('is-busy', 'busy');
}

function showConfirmModal(text, onConfirm, title = "Confirm Action") {
    const modal = document.getElementById('confirmActionModal');
    document.getElementById('confirmActionTitle').textContent = title;
    document.getElementById('confirmActionText').textContent = text;

    const confirmBtn = document.getElementById('confirmActionConfirmBtn');
    const newConfirmBtn = confirmBtn.cloneNode(true);
    confirmBtn.parentNode.replaceChild(newConfirmBtn, confirmBtn);
    resetConfirmButtonState(newConfirmBtn);

    newConfirmBtn.addEventListener('click', async () => {
        newConfirmBtn.disabled = true;
        newConfirmBtn.textContent = CONFIRM_PROCESSING_LABEL;
        newConfirmBtn.setAttribute('aria-busy', 'true');
        try {
            await onConfirm();
            cancelAction();
        } catch (error) {
            console.error('Error in confirm action:', error);
            showToast('An error occurred. Please try again.', 'error');
            resetConfirmButtonState(newConfirmBtn);
        }
    });

    modal.classList.add('show');
}

function cancelAction() {
    document.getElementById('confirmActionModal').classList.remove('show');
    resetConfirmButtonState(document.getElementById('confirmActionConfirmBtn'));
}

function openPracticeTestModal(deckId) {
    practiceTestState.deckId = deckId;
    testAccentModule?.refresh();
    document.getElementById('numQuestions').max = decks[deckId].cards.length;
    document.getElementById('numQuestions').value = Math.min(10, decks[deckId].cards.length);
    document.getElementById('practiceTestModal').classList.add('show');
}

function closePracticeTestModal() {
    document.getElementById('practiceTestModal').classList.remove('show');
}

function startPracticeTest() {
    const deckId = practiceTestState.deckId;
    testAccentModule?.refresh();
    const deck = decks[deckId];
    const testType = document.getElementById('testType').value;
    const numQuestions = parseInt(document.getElementById('numQuestions').value);

    if (numQuestions > deck.cards.length) {
        showToast("Not enough cards in deck", "error");
        return;
    }


    if (testType === 'sequence') {
        if (deck.typeHint !== 'Sequence') {
            showToast("This deck is not marked as a sequence deck", "error");
            return;
        }
        practiceTestState.cards = [...deck.cards];
    } else {
        practiceTestState.cards = shuffleArray([...deck.cards]).slice(0, numQuestions);
    }

    practiceTestState.testType = testType;
    practiceTestState.numQuestions = testType === 'sequence' ? 1 : numQuestions;
    practiceTestState.currentCardIndex = 0;
    practiceTestState.correctCount = 0;
    practiceTestState.incorrectCount = 0;
    practiceTestState.startTime = new Date();

    closePracticeTestModal();

    transitionView('practiceTestView');
    document.getElementById('testSubtitle').textContent = deck.name;

    updateTestProgress();
    document.getElementById('testProgressView').classList.remove('hidden');
    document.getElementById('testCardView').classList.add('hidden');
    document.getElementById('testCompleteView').classList.add('hidden');
}

function updateTestProgress() {
    const total = practiceTestState.numQuestions;
    const current = practiceTestState.currentCardIndex;
    const correct = practiceTestState.correctCount;
    const incorrect = practiceTestState.incorrectCount;

    document.getElementById('testInfo').textContent = `${current} of ${total} questions`;
    document.getElementById('testProgressBar').style.width = total > 0 ? `${(current / total) * 100}%` : '0%';
    document.getElementById('testCorrectCount').textContent = correct;
    document.getElementById('testIncorrectCount').textContent = incorrect;
}

function startTest() {
    transitionSubView(
        document.getElementById('testProgressView'),
        document.getElementById('testCardView')
    );
    showNextTestQuestion();
}

function showNextTestQuestion() {
    if (practiceTestState.currentCardIndex >= practiceTestState.cards.length) {
        finishTest();
        return;
    }

    const testType = practiceTestState.testType;


    if (testType === 'sequence') {
        initSequenceTest(practiceTestState.cards);
        return;
    }


    document.getElementById('testSequenceView').classList.add('hidden');
    document.getElementById('testRegularView').classList.remove('hidden');

    const testAnswerInputEl = document.getElementById('testAnswerInput');

    const card = practiceTestState.cards[practiceTestState.currentCardIndex];
    let currentTestType = testType;
    if (testType === 'mixed') {
        currentTestType = Math.random() > 0.5 ? 'multiple_choice' : 'type';
    }

    document.querySelector('#testCardView .flashcard').classList.remove('is-flipped');
    const testQuestionEl = document.getElementById('testQuestion');
    const testAnswerEl = document.getElementById('testAnswer');
    if (testQuestionEl) testQuestionEl.textContent = card.question || '';
    if (testAnswerEl) testAnswerEl.textContent = card.answer || '';
    document.getElementById('testAnswerContent').classList.add('hidden');
    document.getElementById('testOptions').classList.add('hidden');
    document.getElementById('testAnswerInput').classList.add('hidden');
    document.getElementById('testShowAnswerBtn').classList.add('hidden');
    document.getElementById('testCheckAnswerBtn').classList.add('hidden');
    document.getElementById('testCorrectBtn').classList.add('hidden');
    document.getElementById('testIncorrectBtn').classList.add('hidden');
    document.getElementById('testNextBtn').classList.add('hidden');
    if (testAnswerInputEl) {
        testAnswerInputEl.classList.remove('correct', 'incorrect');
    }
    document.getElementById('testCardInfo').textContent =
        `Question ${practiceTestState.currentCardIndex + 1} of ${practiceTestState.numQuestions}`;

    if (currentTestType === 'multiple_choice') {
        const options = generateMultipleChoiceOptions(card, practiceTestState.cards);
        displayMultipleChoiceOptions(options);
    } else if (currentTestType === 'type') {
        document.getElementById('testAnswerInput').classList.remove('hidden');
        document.getElementById('testAnswerInput').value = '';
        document.getElementById('testAnswerInput').disabled = false;
        document.getElementById('testCheckAnswerBtn').classList.remove('hidden');
        document.getElementById('testAnswerInput').focus();


    } else {
        document.getElementById('testShowAnswerBtn').classList.remove('hidden');
    }
}

function generateMultipleChoiceOptions(correctCard, allCards) {
    const options = new Set([correctCard.answer]);
    const wrongAnswers = shuffleArray(allCards.filter(card => card.id !== correctCard.id));

    for (const wrongCard of wrongAnswers) {
        if (options.size < 4) {
            options.add(wrongCard.answer);
        } else {
            break;
        }
    }
    return shuffleArray(Array.from(options));
}

function displayMultipleChoiceOptions(options) {
    const optionsContainer = document.getElementById('testOptions');
    optionsContainer.innerHTML = '';
    optionsContainer.classList.remove('hidden');

    options.forEach((option) => {
        const button = document.createElement('button');
        button.className = 'btn btn-secondary';
        button.textContent = option;
        button.onclick = () => {
            checkTestAnswer(option);
            document.querySelectorAll('#testOptions button').forEach(btn => btn.disabled = true);
        };
        optionsContainer.appendChild(button);
    });
}

function checkTestAnswer(selectedOption = null) {
    const card = practiceTestState.cards[practiceTestState.currentCardIndex];
    const isMultipleChoice = selectedOption !== null;

    const userInput = isMultipleChoice ? selectedOption : document.getElementById('testAnswerInput').value.trim();
    const correctAnswer = card.answer.trim();

    const isCorrect = userInput.toLowerCase() === correctAnswer.toLowerCase();

    if (isMultipleChoice) {
        document.querySelectorAll('#testOptions button').forEach(btn => {
            if (btn.textContent === selectedOption) {
                btn.className = isCorrect ? 'btn btn-success' : 'btn btn-danger';
            }
            if (btn.textContent === correctAnswer && !isCorrect) {
                btn.className = 'btn btn-success';
            }
        });
    } else {
        document.getElementById('testAnswerInput').classList.toggle('correct', isCorrect);
        document.getElementById('testAnswerInput').classList.toggle('incorrect', !isCorrect);
        document.getElementById('testAnswerInput').disabled = true;
    }

    document.getElementById('testCheckAnswerBtn').classList.add('hidden');
    document.getElementById('testAnswerContent').classList.remove('hidden');
    document.querySelector('#testCardView .flashcard').classList.add('is-flipped');
    document.getElementById('testNextBtn').classList.remove('hidden');

    if (isCorrect) practiceTestState.correctCount++;
    else practiceTestState.incorrectCount++;
}

function showTestAnswer() {
    document.querySelector('#testCardView .flashcard').classList.add('is-flipped');
    document.getElementById('testAnswerContent').classList.remove('hidden');
    document.getElementById('testShowAnswerBtn').classList.add('hidden');
    document.getElementById('testCorrectBtn').classList.remove('hidden');
    document.getElementById('testIncorrectBtn').classList.remove('hidden');
}

function markTestCorrect() {
    practiceTestState.correctCount++;
    nextTestQuestion();
}

function markTestIncorrect() {
    practiceTestState.incorrectCount++;
    nextTestQuestion();
}

function nextTestQuestion() {
    practiceTestState.currentCardIndex++;
    updateTestProgress();
    showNextTestQuestion();
}

async function finishTest() {
    const endTime = new Date();
    const timeTaken = Math.round((endTime - practiceTestState.startTime) / 1000);
    const totalAnswered = practiceTestState.correctCount + practiceTestState.incorrectCount;
    const accuracy = totalAnswered > 0 ? Math.round((practiceTestState.correctCount / totalAnswered) * 100) : 0;
    const score = practiceTestState.numQuestions > 0 ? Math.round((practiceTestState.correctCount / practiceTestState.numQuestions) * 100) : 0;

    document.getElementById('testScore').textContent = score;
    document.getElementById('testCorrectFinal').textContent = practiceTestState.correctCount;
    document.getElementById('testTotalFinal').textContent = practiceTestState.numQuestions;
    document.getElementById('testTime').textContent = `${timeTaken}s`;
    document.getElementById('testAccuracy').textContent = `${accuracy}%`;

    analyticsData.totalStudyTime += timeTaken;
    analyticsData.sessions.unshift({
        date: new Date().toISOString(),
        deckName: decks[practiceTestState.deckId].name,
        mode: 'Practice Test',
        duration: timeTaken,
        accuracy: accuracy
    });
    if (analyticsData.sessions.length > 50) analyticsData.sessions.pop();
    await saveDataToDB('appData', { key: 'analytics', ...analyticsData });

    transitionSubView(
        document.getElementById('testCardView'),
        document.getElementById('testCompleteView')
    );
}

function restartTest() {
    practiceTestState.currentCardIndex = 0;
    practiceTestState.correctCount = 0;
    practiceTestState.incorrectCount = 0;
    practiceTestState.startTime = new Date();

    transitionSubView(
        document.getElementById('testCompleteView'),
        document.getElementById('testProgressView')
    );
}

function endTest() {
    transitionView('dashboard', false, null, false);
}

async function updateStreak() {
    const today = new Date().setHours(0, 0, 0, 0);
    const lastUsedDate = analyticsData.lastUsed ? new Date(analyticsData.lastUsed).setHours(0, 0, 0, 0) : null;

    if (lastUsedDate) {
        const yesterday = new Date(today);
        yesterday.setDate(yesterday.getDate() - 1);

        if (lastUsedDate === yesterday.getTime()) {
            analyticsData.streak++;
        } else if (lastUsedDate < yesterday.getTime()) {
            analyticsData.streak = 1;
        }
    } else {
        analyticsData.streak = 1;
    }

    analyticsData.lastUsed = new Date(today).toISOString();
    await saveDataToDB('appData', { key: 'analytics', ...analyticsData });
}

async function showAnalyticsView() {
    const sessions = analyticsData.sessions || [];

    const activityData = {
        labels: [],
        data: []
    };
    for (let i = 6; i >= 0; i--) {
        const date = new Date();
        date.setDate(date.getDate() - i);
        const dayString = date.toLocaleDateString('en-US', { weekday: 'short' });
        activityData.labels.push(dayString);

        const startOfDay = new Date(date).setHours(0, 0, 0, 0);
        const endOfDay = new Date(date).setHours(23, 59, 59, 999);

        const totalMinutes = sessions
            .filter(s => {
                const sessionDate = new Date(s.date).getTime();
                return sessionDate >= startOfDay && sessionDate <= endOfDay;
            })
            .reduce((sum, s) => sum + (s.duration || 0), 0) / 60;

        activityData.data.push(Math.round(totalMinutes));
    }

    const deckBreakdown = sessions.reduce((acc, session) => {
        const deckName = session.deckName || 'Unknown';
        acc[deckName] = (acc[deckName] || 0) + (session.duration || 0);
        return acc;
    }, {});

    const deckData = {
        labels: Object.keys(deckBreakdown),
        data: Object.values(deckBreakdown).map(d => Math.round(d / 60)),
    };

    document.getElementById('analyticsStreak').textContent = `${analyticsData.streak} day${analyticsData.streak === 1 ? '' : 's'}`;
    const totalMinutes = Math.round(analyticsData.totalStudyTime / 60);
    document.getElementById('analyticsTotalTime').textContent = `${totalMinutes}m`;
    document.getElementById('analyticsTotalSessions').textContent = sessions.length;

    const sessionList = document.getElementById('analyticsSessionList');
    if (sessions.length > 0) {
        sessionList.innerHTML = sessions.map(s => {
            const date = new Date(s.date).toLocaleString();
            const duration = `${Math.round(s.duration / 60)}m`;
            return `<div class="deck-card-item">${escapeHtml(date)}: Studied "${escapeHtml(s.deckName || 'Unknown')}" for ${escapeHtml(duration)}</div>`;
        }).join('');
    } else {
        sessionList.innerHTML = '<p style="color: var(--secondary-text); text-align: center;">No study sessions recorded yet.</p>';
    }

    transitionView('analyticsView', false, () => {
        renderAnalyticsActivityChart(activityData);
        renderAnalyticsDeckBreakdownChart(deckData);
    });
}

function renderAnalyticsActivityChart(activityData) {
    const canvasId = 'analyticsActivityChart';
    if (chartInstances[canvasId]) {
        chartInstances[canvasId].destroy();
        chartInstances[canvasId] = null;
    }
    const ctx = getCanvasContextById(canvasId);
    if (!ctx) {
        console.warn('renderAnalyticsActivityChart: canvas not found', canvasId);
        return;
    }
    chartInstances[canvasId] = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: activityData.labels,
            datasets: [{
                label: 'Minutes Studied',
                data: activityData.data,
                backgroundColor: 'rgba(102, 126, 234, 0.6)',
                borderColor: 'rgba(102, 126, 234, 1)',
                borderWidth: 1,
                borderRadius: 4
            }]
        },
        options: {
            scales: { y: { beginAtZero: true, title: { display: true, text: 'Minutes' } } },
            plugins: { legend: { display: false } }
        }
    });
}

function renderAnalyticsDeckBreakdownChart(deckData) {
    const canvasId = 'analyticsDeckBreakdownChart';
    if (chartInstances[canvasId]) chartInstances[canvasId].destroy();
    const ctx = getCanvasContextById(canvasId);
    if (!ctx) {
        console.warn('renderAnalyticsDeckBreakdownChart: canvas not found', canvasId);
        return;
    }

    if (deckData.labels.length === 0) {
        ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
        ctx.font = "16px 'Inter'";
        ctx.fillStyle = "var(--secondary-text)";
        ctx.textAlign = "center";
        ctx.fillText("No study data per deck yet.", ctx.canvas.width / 2, ctx.canvas.height / 2);
        return;
    }

    chartInstances[canvasId] = new Chart(ctx, {
        type: 'doughnut',
        data: {
            labels: deckData.labels,
            datasets: [{
                label: 'Minutes per Deck',
                data: deckData.data,
                backgroundColor: ['#667eea', '#4ecdc4', '#fd79a8', '#fab1a0', '#a29bfe', '#74b9ff', '#55efc4'],
                borderColor: 'var(--card-bg)',
                borderWidth: 4
            }]
        },
        options: { responsive: true, cutout: '70%', plugins: { legend: { position: 'bottom', labels: { boxWidth: 12 } } } }
    });
}

function checkForUpdates(event) {
    event.preventDefault();
    if (window.electronAPI && window.electronAPI.checkForUpdates) {
        if (!window._updateListenerRegistered) {
            window._updateListenerRegistered = true;
            window.electronAPI.onUpdateStatus((payload) => {
                const ev = payload && payload.event;
                if (ev === 'checking-for-update') {
                    showToast('Checking for updates...', 'info');
                } else if (ev === 'update-available') {
                    const v = payload.info && payload.info.version ? ` ${payload.info.version}` : '';
                    showToast(`Update available${v}`, 'info');
                } else if (ev === 'update-not-available') {
                    showToast('No updates available', 'info');
                } else if (ev === 'download-progress') {
                    const p = payload.progress && payload.progress.percent ? Math.round(payload.progress.percent) : null;
                    showToast(p !== null ? `Downloading update: ${p}%` : 'Downloading update...', 'info');
                } else if (ev === 'update-downloaded') {
                    showToast('Update downloaded. Restart to install.', 'info');
                    try {
                        if (confirm('An update is ready. Restart and install now?')) {
                            window.electronAPI.quitAndInstallUpdate();
                        }
                    } catch (e) {}
                } else if (ev === 'error') {
                    showToast(`Update error: ${payload && payload.error ? payload.error : 'Unknown error'}`, 'error');
                }
            });
        }

        window.electronAPI.checkForUpdates().catch(err => {
            showToast(`Update check failed: ${err && err.message ? err.message : String(err)}`, 'error');
            window.open('https://github.com/TJ7755/Lagiote-Revise/releases', '_blank');
        });
    } else {
        showToast('Opening updates page...', 'info');
        window.open('https://github.com/TJ7755/Lagiote-Revise/releases', '_blank');
    }
}

window.onclick = function (event) {
    document.querySelectorAll('.modal').forEach(modal => { if (event.target === modal) modal.classList.remove('show'); });
}
function levenshteinDistance(s1, s2) {
    s1 = s1.toLowerCase();
    s2 = s2.toLowerCase();

    const costs = [];
    for (let i = 0; i <= s1.length; i++) {
        let lastValue = i;
        for (let j = 0; j <= s2.length; j++) {
            if (i === 0) {
                costs[j] = j;
            } else {
                if (j > 0) {
                    let newValue = costs[j - 1];
                    if (s1.charAt(i - 1) !== s2.charAt(j - 1)) {
                        newValue = Math.min(Math.min(newValue, lastValue), costs[j]) + 1;
                    }
                    costs[j - 1] = lastValue;
                    lastValue = newValue;
                }
            }
        }
        if (i > 0) costs[s2.length] = lastValue;
    }
    return costs[s2.length];
}

function setupRadioCardSelection(radioGroupName) {
    const radioInputs = document.querySelectorAll(`input[name="${radioGroupName}"]`);

    function updateSelection() {
        radioInputs.forEach(input => {
            const parentCard = input.closest('.checkbox-group');
            if (parentCard) {
                parentCard.classList.toggle('is-selected', input.checked);
            }
        });
    }

    radioInputs.forEach(input => {
        input.addEventListener('change', updateSelection);
        const parentCard = input.closest('.checkbox-group');
        if (parentCard) {
            parentCard.addEventListener('click', () => {
                if (!input.checked) {
                    input.checked = true;
                    input.dispatchEvent(new Event('change'));
                }
            });
        }
    });

    updateSelection();
}


function calculateIQS(logData, userBaseline = { latency: 1500, fluency: 10 }) {
    const baselineLatency = Math.max(300, userBaseline.latency || 1500);
    const baselineFluency = Math.max(1, userBaseline.fluency || 10);

    const recallLatency = (typeof logData.recallLatency === 'number') ? logData.recallLatency : baselineLatency;
    const answerFluency = (typeof logData.answerFluency === 'number') ? logData.answerFluency : baselineFluency / 2;
    const totalCorrections = (typeof logData.totalCorrections === 'number') ? logData.totalCorrections : 0;
    const attemptCount = (typeof logData.attemptCount === 'number' && logData.attemptCount > 0) ? logData.attemptCount : 1;

    const latencyScore = Math.exp(-Math.max(0, recallLatency) / (baselineLatency * 1.5));
    const fluencyScore = Math.min(1, answerFluency / baselineFluency);
    const correctionScore = 1 / (1 + totalCorrections * 0.7);
    const attemptScore = 1 / (1 + (attemptCount - 1) * 0.6);
    const iqs = (latencyScore * 0.45) + (fluencyScore * 0.35) + (correctionScore * 0.1) + (attemptScore * 0.1);

    const bounded = Math.max(0, Math.min(1, iqs));
    return Number.isFinite(bounded) ? bounded : 0.5;
}


function calculateFocusScore(log) {
    const TARGET_LATENCY = 3000;
    const MAX_LATENCY = 15000;
    const latency = log.latency === null ? TARGET_LATENCY : log.latency;

    let latencyScore = 1.0;
    if (latency > TARGET_LATENCY) {
        if (latency >= MAX_LATENCY) {
            latencyScore = 0.0;
        } else {
            latencyScore = 1.0 - ((latency - TARGET_LATENCY) / (MAX_LATENCY - TARGET_LATENCY));
        }
    }

    const awayDuration = log.awayDuration || 0;
    if (awayDuration > 0) {
        const PENALTY_PER_SECOND = 0.20;
        const distractionPenalty = (awayDuration / 1000) * PENALTY_PER_SECOND;

        const finalScore = Math.max(0, latencyScore - distractionPenalty);
        return finalScore;
    }

    return latencyScore;
}

function updateFocusMeter() {
    if (!db) return;
    const transaction = db.transaction(['interactionLogs'], 'readonly');
    const store = transaction.objectStore('interactionLogs');
    const request = store.getAll();
    request.onsuccess = () => {
        const allLogs = request.result;
        const recentLogs = allLogs.slice(-7);
        if (recentLogs.length < 3) return;

        const focusScores = recentLogs.map(log => calculateFocusScore(log));
        const averageFocusScore = focusScores.reduce((sum, score) => sum + score, 0) / focusScores.length;

        lastKnownFocusScore = averageFocusScore;

        const focusDot = document.getElementById('focusDot');
        if (averageFocusScore >= 0.85) {
            focusDot.style.backgroundColor = '#38a169';
        } else if (averageFocusScore >= 0.65) {
            focusDot.style.backgroundColor = '#f6ad55';
        } else {
            focusDot.style.backgroundColor = '#fc8181';
            if (studyState.currentCardIndex > 5) {
                document.getElementById('takeABreakModal').classList.add('show');
            }
        }
    };
}

function calculatePRecall(stability, lastReviewedISO) {
    const utils = getKnowledgeStateUtils();
    const stabilityValue = utils.coerceFsrsNumber(stability);
    if (!lastReviewedISO || !stabilityValue) return 0.5;
    const reviewedDate = utils.parseFsrsDate(lastReviewedISO);
    if (!reviewedDate) return 0.5;
    return calculateFSRSRetrievability(stabilityValue, reviewedDate, new Date());
}

function calculateRetentionAtDate(state, targetDate) {
    if (!state) return 0;
    const utils = getKnowledgeStateUtils();
    const fsrsState = state.fsrs || {};
    const stability = utils.coerceFsrsNumber(fsrsState.stability ?? state.stability);
    const lastReviewedRaw = fsrsState.last_review || state.lastReviewed || null;
    const lastReviewed = utils.parseFsrsDate(lastReviewedRaw);
    if (!stability || !lastReviewed) return 0;
    const target = targetDate ? new Date(targetDate) : new Date();
    return calculateFSRSRetrievability(stability, lastReviewed, target);
}

function calculateExamRetention(state, examDate) {
    if (!state) return 0;
    const target = examDate ? new Date(examDate) : new Date();
    return calculateRetentionAtDate(state, target);
}


async function updateDueCardCounts() {
    const knowledgeStates = await getAllDataFromDB('userKnowledgeState');
    const knowledgeMap = new Map(knowledgeStates.map(item => [item.cardID, item]));

    for (const deckId in decks) {
        const deck = decks[deckId];
        let dueCount = 0;
        deck.cards.forEach(card => {
            const state = knowledgeMap.get(card.id);
            if (!state) {
                dueCount++;
            } else {
                const pRecall = calculatePRecall(state.stability, state.lastReviewed);
                if (pRecall <= 0.90) {
                    dueCount++;
                }
            }
        });

        const spacedBtn = document.querySelector(`.deck-card[data-deck-id="${deckId}"] .spaced-btn`);
        if (spacedBtn) {
            const existingBadge = spacedBtn.querySelector('.due-badge');
            if (existingBadge) existingBadge.remove();

            if (dueCount > 0) {
                const badge = document.createElement('span');
                badge.className = 'due-badge';
                badge.textContent = dueCount;
                badge.style.cssText = 'background-color: var(--danger-color); color: white; border-radius: 50%; padding: 2px 6px; font-size: 10px; margin-left: 8px;';
                spacedBtn.appendChild(badge);
            }
        }
    }
}

function determineCardArchetype(card, deckTypeHint = 'General') {
    if (deckTypeHint === 'Sequence') return 'SequenceItem';

    const q = card.question.trim();
    const a = card.answer.trim();

    if (q.split(' ').length <= 3 && a.split(' ').length > 3) {
        return 'Vocabulary';
    }
    if (q.endsWith('?')) {
        return 'Q&A';
    }
    if (a.split(' ').length <= 3 && q.split(' ').length > 3) {
        return 'Definition';
    }
    if (q.includes('...') || q.includes('___')) {
        return 'Cloze';
    }

    return 'General';
}

let nlp_pipeline = null;
async function processDeckContent(deck) {
    const concepts = {};
    let conceptCounter = 0;

    for (const card of deck.cards) {
        card.archetype = determineCardArchetype(card, deck.typeHint || 'General');

        const firstWord = card.question.split(' ')[0].toLowerCase();
        if (!concepts[firstWord]) {
            concepts[firstWord] = `c${conceptCounter++}`;
        }
        card.conceptID = concepts[firstWord];
    }
    deck.analysisVersion = CURRENT_ANALYSIS_VERSION;
    console.log("Deck content processed:", deck);
}

async function startSequenceSession(deckId) {
    currentMode = 'sequence';
    currentDeckId = deckId;
    const deck = decks[deckId];

    const sequenceCards = [...deck.cards].sort((a, b) => a.order - b.order);

    if (sequenceCards.length < 2) {
        showToast("A sequence requires at least 2 cards.", "error");
        return;
    }

    const sequenceKnowledgeStates = await getAllDataFromDB('userKnowledgeState');
    studyState.knowledgeStates = new Map(sequenceKnowledgeStates.map(item => [item.cardID, item]));

    const chunkSize = 5;
    studyState.sequenceChunks = [];
    for (let i = 0; i < sequenceCards.length; i += chunkSize) {
        studyState.sequenceChunks.push(sequenceCards.slice(i, i + chunkSize));
    }

    studyState.settings = deck.settings;
    studyState.targetRetention = deck.settings?.targetRetention || studyState.targetRetention;
    studyState.sequenceCards = sequenceCards;
    studyState.currentRound = 1;
    studyState.startTime = new Date();
    studyState.originPlanId = null;

    if (deck.sequenceState && deck.sequenceState.currentChunkIndex < studyState.sequenceChunks.length) {
        studyState.currentChunkIndex = deck.sequenceState.currentChunkIndex;
        studyState.sequencePhase = deck.sequenceState.sequencePhase;
        studyState.currentCardIndex = deck.sequenceState.currentCardIndex || 0;
        studyState.nextPhaseAfterReview = deck.sequenceState.nextPhaseAfterReview || null;
        studyState.sequenceMissedInChunk = deck.sequenceState.sequenceMissedInChunk || [];
        studyState.weakestLinkIteration = deck.sequenceState.weakestLinkIteration || 0;
        studyState.sequenceForwardQueue = deck.sequenceState.sequenceForwardQueue || [];
        if (deck.sequenceState.roundCardIds && deck.sequenceState.roundCardIds.length > 0) {
            const roundIdList = deck.sequenceState.roundCardIds;
            studyState.roundCards = roundIdList
                .map(id => studyState.sequenceCards.find(c => c.id === id))
                .filter(Boolean);
        } else {
            studyState.roundCards = [];
        }
        if (deck.sequenceState.activeChunkOverrideIds && deck.sequenceState.activeChunkOverrideIds.length > 0) {
            const chunk = studyState.sequenceChunks[studyState.currentChunkIndex] || [];
            studyState.sequenceActiveChunkOverride = deck.sequenceState.activeChunkOverrideIds
                .map(id => chunk.find(c => c.id === id))
                .filter(Boolean);
        } else {
            studyState.sequenceActiveChunkOverride = null;
        }
        showToast(`Resuming from Chunk ${studyState.currentChunkIndex + 1}...`, "info");
    } else {
        studyState.currentChunkIndex = 0;
        studyState.sequencePhase = null;
        studyState.currentCardIndex = 0;
        studyState.sequenceMissedInChunk = [];
        studyState.weakestLinkIteration = 0;
        studyState.roundCards = [];
        studyState.sequenceActiveChunkOverride = null;
        studyState.sequenceForwardQueue = [];
    }

    transitionView('studyMode');
    resetStudySubViews();
    document.getElementById('studyTitle').textContent = 'Sequence Learner';
    document.getElementById('studySubtitle').textContent = deck.name;
    transitionSubView(null, document.getElementById('cardView'));

    if (studyState.sequencePhase) {
        showNextCard();
    } else {
        moveToNextSequencePhase();
    }
}

function selectOptimalQuestionType(card, deckOverride = null, modeOverride = currentMode) {
    const resolvedDeck = deckOverride || decks[card.deckId || currentDeckId];

    if (!resolvedDeck) {
        console.error(`Could not find deck for card "${card.question}". Defaulting to Flashcard.`);
        return 'Flashcard';
    }

    resolvedDeck.settings = { ...DEFAULT_DECK_SETTINGS, ...(resolvedDeck.settings || {}) };
    const adaptive = resolvedDeck.settings.adaptiveModes || { auto: true, mcq: true, cloze: true };
    const mode = modeOverride || currentMode;

    if (mode === 'review' || mode === 'practiceTest') {
        return resolvedDeck.settings.learnMode === 'write' ? 'Type' : 'Flashcard';
    }

    if (resolvedDeck.settings.learnMode === 'write') {
        return 'Type';
    }

    if (!adaptive.auto) {
        if (adaptive.cloze && canGenerateQuestionType('Cloze', card, resolvedDeck.cards || [])) return 'Cloze';
        if (adaptive.mcq && canGenerateQuestionType('MultipleChoice', card, resolvedDeck.cards || [])) return 'MultipleChoice';
        return 'Type';
    }

    const knowledgeMap = studyState.knowledgeStates || new Map();
    const state = knowledgeMap.get(card.id);
    
    // Deterministic Policy: Strength + Confidence
    // 1. Retention (Strength)
    const now = new Date();
    const retention = typeof calculateRetentionAtDate === 'function' 
        ? calculateRetentionAtDate(state, now) 
        : 0;
        
    // 2. Confidence (Inverse of Sigma)
    // Sigma range typically 0.05 (high conf) to 0.5 (low conf).
    const sigma = (state && typeof state.evidenceSigma === 'number') ? state.evidenceSigma : 0.3;
    const confidence = Math.max(0, 1.0 - (sigma / 0.5)); // Approx 0.0 to 1.0

    const allCardsInDeck = resolvedDeck.cards || [];
    const canMCQ = adaptive.mcq && canGenerateQuestionType('MultipleChoice', card, allCardsInDeck);
    const canCloze = adaptive.cloze && canGenerateQuestionType('Cloze', card, allCardsInDeck);

    // Low Strength or Low Confidence -> Recognition (MCQ) or Scaffolding
    if (retention < 0.7 || confidence < 0.4) {
        if (canMCQ) return 'MultipleChoice';
        if (canCloze) return 'Cloze';
    }

    // Medium Strength/Confidence -> Cued Recall (Cloze)
    if (retention < 0.9) {
        if (canCloze) return 'Cloze';
        if (canMCQ) return 'MultipleChoice'; // Fallback if Cloze impossible
    }

    // High Strength & Confidence -> Free Recall (Type)
    return 'Type';
}

async function generateAndDisplayMCQ(correctCard) {
    const optionsContainer = document.getElementById('mcqOptions');
    if (!optionsContainer) return;
    optionsContainer.innerHTML = '';
    optionsContainer.classList.remove('hidden');
    const placeholder = document.createElement('div');
    placeholder.className = 'mcq-placeholder';
    placeholder.textContent = 'Generating options...';
    optionsContainer.appendChild(placeholder);

    studyState.pendingMCQToken = (studyState.pendingMCQToken || 0) + 1;
    const requestToken = studyState.pendingMCQToken;
    studyState.pendingMCQCardId = correctCard.id;

    const finalizeOptions = (options) => {
        if (studyState.pendingMCQToken !== requestToken) return;
        if (studyState.pendingMCQCardId !== correctCard.id) return;
        displayMCQButtons(options, correctCard);
    };

    const deckForThisCard = decks[correctCard.deckId];
    if (!deckForThisCard) {
        console.error("Deck not found for card:", correctCard.id, "DeckID:", correctCard.deckId);
        console.log("Available decks:", Object.keys(decks));
        optionsContainer.innerHTML = '';
        return;
    }

    const cardInDeck = deckForThisCard.cards.find(c => c.id === correctCard.id);
    if (cardInDeck?.distractors && cardInDeck.distractors.length >= 3) {
        console.log("[MCQ] Using cached distractors for card:", correctCard.id);
        const finalOptions = shuffleArray([correctCard.answer, ...cardInDeck.distractors]);
        finalizeOptions(finalOptions);
        return;
    }

    if (isOnline) {
        console.log("[MCQ] No cached data. Calling API to generate distractors for card:", correctCard.id);
        try {
            const requestBody = { question: correctCard.question, answer: correctCard.answer };
            let generatedDistractors;

            if (isElectron) {
                console.log("[MCQ] Using Electron API for distractor generation");
                generatedDistractors = await window.electronAPI.generateDistractors(requestBody);
            } else {
                console.log("[MCQ] Using Netlify function for distractor generation");
                const response = await fetch('/.netlify/functions/generateDistractors', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${localStorage.getItem('auth0Token')}`
                    },
                    body: JSON.stringify(requestBody)
                });

                if (response.status === 401) {
                    console.warn("[MCQ] Token expired, attempting to refresh");
                    if (localStorage.getItem('auth0Session')) {
                        await loadUserDataAndSync();
                    }
                    throw new Error("Token expired, please try again");
                }

                if (!response.ok) {
                    const errorText = await response.text();
                    console.error("[MCQ] API error response:", errorText);
                    throw new Error(`Server function for distractors failed: ${response.status}`);
                }
                const result = await response.json();
                generatedDistractors = result.distractors;
            }

            if (generatedDistractors?.offline) {
                throw new Error("Offline: " + (generatedDistractors.message || "Cannot generate distractors"));
            }

            if (generatedDistractors && generatedDistractors.length >= 3) {
                if (cardInDeck) {
                    cardInDeck.distractors = generatedDistractors;
                    await saveDataToDB('decks', deckForThisCard);
                    console.log("[MCQ] Distractors cached to deck for card:", correctCard.id);
                }
                correctCard.distractors = generatedDistractors;
                const finalOptions = shuffleArray([correctCard.answer, ...generatedDistractors]);
                finalizeOptions(finalOptions);
                return;
            } else {
                console.warn("[MCQ] API returned insufficient distractors:", generatedDistractors?.length || 0);
            }
        } catch (error) {
            console.error("[MCQ] Failed to generate/cache distractors:", error);
            const errorMsg = error.message || "Error generating options";
            if (errorMsg.includes('Offline') || errorMsg.includes('expired')) {
                console.log("[MCQ] Offline or auth issue detected, using random distractors");
            } else {
                showToast("Couldn't generate smart options, using random.", "warning");
            }
        }
    } else {
        console.log("[MCQ] Offline mode - skipping API call");
    }

    console.warn("[MCQ] Falling back to random distractors for card:", correctCard.id);
    const allCardsInDeck = deckForThisCard.cards;
    const options = new Set([correctCard.answer]);
    const randomFill = shuffleArray(allCardsInDeck.filter(card => card.id !== correctCard.id));
    for (const randomCard of randomFill) {
        if (options.size < 4) options.add(randomCard.answer);
        else break;
    }
    const finalOptions = shuffleArray(Array.from(options));
    finalizeOptions(finalOptions);
}

function displayMCQButtons(options, correctCard) {
    const optionsContainer = document.getElementById('mcqOptions');
    optionsContainer.innerHTML = '';

    options.forEach(optionText => {
        const button = document.createElement('button');
        button.className = 'btn btn-secondary';
        button.textContent = optionText;
        button.onclick = () => {
            optionsContainer.querySelectorAll('button').forEach(btn => btn.disabled = true);

            const isCorrect = (optionText === correctCard.answer);

            button.classList.remove('btn-secondary');
            button.classList.add(isCorrect ? 'btn-success' : 'btn-danger');

            if (!isCorrect) {
                optionsContainer.querySelectorAll('button').forEach(btn => {
                    if (btn.textContent === correctCard.answer) {
                        btn.classList.remove('btn-secondary');
                        btn.classList.add('btn-success');
                    }
                });
            }

            logInteraction({ cardID: correctCard.id, wasCorrect: isCorrect, userAnswer: optionText, questionType: 'MultipleChoice', recallLatency: null, answerFluency: 0, totalCorrections: 0, attemptCount: 1 });
            setTimeout(() => moveCard(correctCard, isCorrect, 'MultipleChoice'), 1500);
        };
        optionsContainer.appendChild(button);
    });
}

function setupAdaptiveSettings() {
    const autoToggle = document.getElementById('adaptiveAutoToggle');
    const mcqToggle = document.getElementById('adaptiveMcqToggle');
    const clozeToggle = document.getElementById('adaptiveClozeToggle');

    function handleAutoToggle() {
        const isAuto = autoToggle.checked;
        mcqToggle.disabled = isAuto;
        clozeToggle.disabled = isAuto;
        if (isAuto) {
            mcqToggle.checked = true;
            clozeToggle.checked = true;
        }
    }
    autoToggle.onchange = handleAutoToggle;
    handleAutoToggle();
}
function canGenerateQuestionType(type, card, allCardsInDeck) {
    switch (type) {
        case 'MultipleChoice':
            return allCardsInDeck.length >= 4;
        case 'Cloze':
            return card.question.toLowerCase().includes(card.answer.toLowerCase()) ||
                card.question.includes('___') ||
                card.question.includes('...');
        case 'Type':
            return true;
        default:
            return false;
    }
}

async function checkForOutdatedAnalysis() {
    let decksToUpdate = [];
    for (const deckId in decks) {
        const deck = decks[deckId];
        if (!deck.analysisVersion || deck.analysisVersion < CURRENT_ANALYSIS_VERSION) {
            decksToUpdate.push(deck);
        }
    }

    if (decksToUpdate.length > 0) {
        showLoadingScreen(`Upgrading ${decksToUpdate.length} deck(s) with new intelligence features...`);
        try {
            for (const deck of decksToUpdate) {
                await processDeckContent(deck);
                await saveDataToDB('decks', deck);
            }
            showToast("Deck upgrades complete!", "success");
        } catch (error) {
            console.error("Failed to upgrade decks:", error);
            showToast("Could not finish deck upgrades.", "error");
        } finally {
            await updateDashboard();
            hideLoadingScreen();
        }
    }
}

function calculateCosineSimilarity(vecA, vecB) {
    let dotProduct = 0;
    let magnitudeA = 0;
    let magnitudeB = 0;
    for (let i = 0; i < vecA.length; i++) {
        dotProduct += vecA[i] * vecB[i];
        magnitudeA += vecA[i] * vecA[i];
        magnitudeB += vecB[i] * vecB[i];
    }
    magnitudeA = Math.sqrt(magnitudeA);
    magnitudeB = Math.sqrt(magnitudeB);
    if (magnitudeA && magnitudeB) {
        return dotProduct / (magnitudeA * magnitudeB);
    } else {
        return 0;
    }
}

class NlpPipeline {
    static task = 'feature-extraction';
    static model = 'Xenova/all-MiniLM-L6-v2';
    static instance = null;

    static async getInstance(progress_callback = null) {
        if (this.instance === null) {
            const { pipeline } = await import('https://cdn.jsdelivr.net/npm/@xenova/transformers@2.17.1');
            this.instance = pipeline(this.task, this.model, { progress_callback });
        }
        return this.instance;
    }
}
async function preGenerateAdaptiveQuestions(roundCards, progressCallback) {
    if (!isOnline) {
        console.log("Offline mode: Skipping pre-generation of distractors.");
        if (progressCallback) progressCallback(1, 1);
        return;
    }

    studyState.preGeneratedDistractors.clear();

    const cardsToGenerate = roundCards.filter(card => card.questionTypeToShow === 'MultipleChoice');

    if (cardsToGenerate.length === 0) {
        if (progressCallback) progressCallback(1, 1);
        return;
    }

    let completedJobs = 0;
    const totalJobs = cardsToGenerate.length;
    const startTime = Date.now();
    const MAX_PRELOAD_TIME = 10000; // 10 seconds max for initial preloading
    const BATCH_SIZE = 1;
    const DELAY_BETWEEN_BATCHES = 4000; // 4 seconds (15 RPM)

    if (progressCallback) progressCallback(completedJobs, totalJobs);

    // Update countdown display function
    const updateCountdown = () => {
        const elapsed = Date.now() - startTime;
        const remaining = Math.max(0, Math.ceil((MAX_PRELOAD_TIME - elapsed) / 1000));
        const countdownDisplay = document.getElementById('countdownDisplay');
        const countdownText = document.getElementById('countdownText');
        if (countdownDisplay) countdownDisplay.textContent = remaining;
        if (countdownText) {
            if (remaining > 0) {
                countdownText.textContent = `Loading questions... ${remaining} second${remaining !== 1 ? 's' : ''} remaining`;
            } else {
                countdownText.textContent = 'Starting study session...';
            }
        }
    };

    // Start countdown interval
    const countdownInterval = setInterval(updateCountdown, 100);
    studyState.preGenerationCountdownInterval = countdownInterval;
    updateCountdown(); // Initial update

    // Phase 1: Initial preloading with time limit
    try {
        for (let i = 0; i < cardsToGenerate.length; i += BATCH_SIZE) {
            // Check if we've exceeded time limit
            if (Date.now() - startTime > MAX_PRELOAD_TIME) {
                console.log(`Preload time limit reached. Generated ${completedJobs}/${totalJobs} distractors. Remaining will generate in background.`);
                showToast(`Pre-loaded ${completedJobs} questions. Others loading in background...`, 'info');

                const remainingCards = cardsToGenerate.slice(i);
                if (remainingCards.length > 0) {
                    setTimeout(() => {
                        continueBackgroundGeneration(remainingCards, completedJobs, totalJobs, progressCallback);
                    }, 2000);
                }
                break;
            }

            const batch = cardsToGenerate.slice(i, i + BATCH_SIZE);

            const batchPromises = batch.map(card => {
                let apiPromise;
                const requestBody = {
                    question: card.question,
                    answer: card.answer
                };

                if (isElectron) {
                    apiPromise = window.electronAPI.generateDistractors(requestBody);
                } else {
                    apiPromise = fetch('/.netlify/functions/generateDistractors', {
                        method: 'POST',
                        body: JSON.stringify(requestBody)
                    })
                        .then(response => {
                            if (!response.ok) throw new Error('Server function for distractors failed.');
                            return response.json();
                        })
                        .then(result => result.distractors);
                }

                return apiPromise.then(distractors => {
                    if (distractors && distractors.length >= 3) {
                        studyState.preGeneratedDistractors.set(card.id, distractors);
                    }
                }).catch(error => {
                    console.error(`Failed to pre-generate for card: ${card.question}`, error);
                }).finally(() => {
                    completedJobs++;
                    if (progressCallback) progressCallback(completedJobs, totalJobs);
                });
            });

            await Promise.all(batchPromises);

            if (i + BATCH_SIZE < cardsToGenerate.length) {
                await new Promise(resolve => setTimeout(resolve, DELAY_BETWEEN_BATCHES));
            }
        }
    } finally {
        if (countdownInterval) {
            clearInterval(countdownInterval);
        }
        studyState.preGenerationCountdownInterval = null;
    }
}

// New function: Continue generating distractors in background during study
async function continueBackgroundGeneration(remainingCards, startingCount, totalJobs, progressCallback) {
    if (!isOnline || currentMode === null) {
        return; // Stop if offline or user exited study mode
    }

    let completedJobs = startingCount;
    const BATCH_SIZE = 1;
    const DELAY_BETWEEN_BATCHES = 4000; // 4 seconds (15 RPM)

    console.log(`Background generation: Processing ${remainingCards.length} remaining cards`);

    for (let i = 0; i < remainingCards.length; i += BATCH_SIZE) {
        // Stop if user exits study mode
        if (currentMode === null) {
            console.log('Study session ended, stopping background generation');
            break;
        }

        const batch = remainingCards.slice(i, i + BATCH_SIZE);

        const batchPromises = batch.map(card => {
            let apiPromise;
            const requestBody = {
                question: card.question,
                answer: card.answer
            };

            if (isElectron) {
                apiPromise = window.electronAPI.generateDistractors(requestBody);
            } else {
                apiPromise = fetch('/.netlify/functions/generateDistractors', {
                    method: 'POST',
                    body: JSON.stringify(requestBody)
                })
                    .then(response => {
                        if (!response.ok) throw new Error('Server function for distractors failed.');
                        return response.json();
                    })
                    .then(result => result.distractors);
            }

            return apiPromise.then(distractors => {
                if (distractors && distractors.length >= 3) {
                    studyState.preGeneratedDistractors.set(card.id, distractors);
                    console.log(`Background generated distractors for card: ${card.question.substring(0, 30)}...`);
                }
            }).catch(error => {
                console.error(`Background generation failed for card: ${card.question}`, error);
            }).finally(() => {
                completedJobs++;
                if (progressCallback) progressCallback(completedJobs, totalJobs);
            });
        });

        await Promise.all(batchPromises);

        // Add delay before next batch
        if (i + BATCH_SIZE < remainingCards.length) {
            await new Promise(resolve => setTimeout(resolve, DELAY_BETWEEN_BATCHES));
        }
    }

    console.log(`Background generation complete: ${completedJobs}/${totalJobs} total distractors generated`);
}

function updateOnlineStatusUI() {
    const statusDot = document.getElementById('onlineStatusDot');
    const statusText = document.getElementById('onlineStatusText');

    if (isOnline) {
        statusDot.style.backgroundColor = 'var(--success-color)';
        statusText.textContent = 'Online';
        statusText.style.color = 'var(--secondary-text)';
    } else {
        statusDot.style.backgroundColor = 'var(--danger-color)';
        statusText.textContent = 'Offline';
        statusText.style.color = 'var(--danger-color)';
    }
}

function showAiGenerator() {
    transitionView('aiGenerator');
    documentsForAi = [];
    renderDocumentList();
    renderAiGeneratedCards([]);
    document.getElementById('flashcard-summary').classList.add('hidden');
}



function renderDocumentList() {
    const listContainer = document.getElementById('document-list');

    if (documentsForAi.length === 0) {
        listContainer.innerHTML = `
                    <div id="empty-doc-list" class="list-empty-state">
                        <div class="list-empty-state-icon"><svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9Z" /></svg></div>
                        <p>Your uploaded documents will appear here.</p>
                    </div>`;
    } else {
        listContainer.innerHTML = documentsForAi.map((doc, index) => `
                    <div class="document-item" data-doc-id="${doc.id}">
                        <div class="document-item-header">
                            <span class="document-name">
                                <span class="document-status-icon">${doc.status === 'processing' ? '<div class="spinner"></div>' : (doc.status === 'done' ? '✓' : 'FILE')}</span>
                                ${doc.name}
                            </span>
                            <button class="remove-doc-btn" onclick="removeDocument(${index})">&times;</button>
                        </div>
                        <div class="document-info">${doc.type}</div>
                    </div>
                `).join('');
    }
    document.getElementById('doc-list-count').textContent = `Documents (${documentsForAi.length})`;
    document.getElementById('process-btn').disabled = documentsForAi.length === 0;
}

async function handleAiFiles(files) {
    for (const file of files) {
        const doc = {
            id: Date.now() + Math.random(),
            name: file.name,
            type: file.type || 'text/plain',
            content: null,
            status: 'processing'
        };
        documentsForAi.push(doc);
        renderDocumentList();

        try {
            doc.content = await readFileContent(file);
            doc.status = 'done';
        } catch (error) {
            console.error("Error reading file:", error);
            doc.status = 'error';
            showToast(`Failed to read ${file.name}`, 'error');
        }
        renderDocumentList();
    }
}

function readFileContent(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = async (e) => {
            try {
                if (file.type === 'application/pdf') {
                    const pdf = await pdfjsLib.getDocument({ data: e.target.result }).promise;
                    let text = '';
                    for (let i = 1; i <= pdf.numPages; i++) {
                        const page = await pdf.getPage(i);
                        const content = await page.getTextContent();
                        text += content.items.map(item => item.str).join(' ') + '\n';
                    }
                    resolve(text);
                } else if (file.type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
                    const result = await mammoth.extractRawText({ arrayBuffer: e.target.result });
                    resolve(result.value);
                } else if (file.type.startsWith('text/')) {
                    const decoder = new TextDecoder('utf-8');
                    resolve(decoder.decode(e.target.result));
                } else if (file.type.startsWith('image/')) {
                    resolve(e.target.result);
                } else {
                    reject(new Error(`Unsupported file type: ${file.type}`));
                }
            } catch (error) {
                reject(error);
            }
        };
        reader.onerror = reject;

        if (file.type.startsWith('image/')) {
            reader.readAsDataURL(file);
        } else {
            reader.readAsArrayBuffer(file);
        }
    });
}

function addTextAsDocument() {
    const text = document.getElementById('ai-text-input').value.trim();
    console.log('Add text as document clicked, text length:', text.length);
    if (!text) {
        showToast('Please enter some text first', 'warning');
        return;
    }
    const doc = {
        id: Date.now() + Math.random(),
        name: `Pasted Text - ${new Date().toLocaleTimeString()}`,
        type: 'text/plain',
        content: text,
        status: 'done'
    };
    documentsForAi.push(doc);
    console.log('Document added, total documents:', documentsForAi.length);
    renderDocumentList();
    document.getElementById('ai-text-input').value = '';
    showToast('Text added successfully', 'success');
}

function removeDocument(index) {
    documentsForAi.splice(index, 1);
    renderDocumentList();
}
async function processAllDocuments() {
    if (documentsForAi.length === 0) {
        showToast("Please add at least one document.", "error");
        return;
    }

    if (!isOnline) {
        showToast("You are offline. AI generation requires internet.", "error");
        return;
    }

    const processBtn = document.getElementById('process-btn');
    const btnText = document.getElementById('process-text');
    const processIcon = document.getElementById('process-icon');
    const loaderIcon = document.getElementById('loader-icon');
    processBtn.disabled = true;
    btnText.textContent = 'Processing...';
    processIcon.classList.add('hidden');
    loaderIcon.classList.remove('hidden');
    document.getElementById('flashcard-summary').classList.add('hidden');

    try {
        const timeoutPromise = new Promise((_, reject) => setTimeout(() => reject(new Error("Request timed out")), 30000));

        // Get values from new dropdowns
        const selectedType = document.getElementById('aiCardType') ? document.getElementById('aiCardType').value : 'auto';
        const selectedCount = document.getElementById('aiCardCount') ? document.getElementById('aiCardCount').value : 'auto';
        const selectedLanguage = document.getElementById('aiLanguage') ? document.getElementById('aiLanguage').value : 'auto';

        let apiPromise;

        console.log('[AI Generation] isElectron:', isElectron);
        console.log('[AI Generation] window.electronAPI:', window.electronAPI);

        const payload = {
            documents: documentsForAi,
            cardType: selectedType,
            cardCount: selectedCount,
            language: selectedLanguage
        };

        if (isElectron) {
            console.log('[AI Generation] Using Electron IPC');
            apiPromise = window.electronAPI.generateDeck(payload);
        } else {
            console.log('[AI Generation] Using Netlify function');
            apiPromise = fetch('/.netlify/functions/getAiCompletion', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            }).then(response => {
                if (!response.ok) {
                    throw new Error(`Server function error: ${response.status}`);
                }
                return response.json();
            });
        }
        const generatedCards = await Promise.race([timeoutPromise, apiPromise]);

        console.log('[AI Generation] Response received:', generatedCards);

        // Handle offline response
        if (generatedCards?.offline) {
            throw new Error(generatedCards.message || "Cannot generate cards offline");
        }

        const normalizedDeck = normalizeAiDeckResponse(generatedCards);
        renderAiGeneratedCards(normalizedDeck);
        document.getElementById('flashcard-summary').classList.remove('hidden');
    } catch (error) {
        console.error("Deck generation failed:", error);
        const errorMsg = error.message || "Unknown error";
        if (errorMsg.includes('offline')) {
            showToast("Cannot generate cards while offline. Try again when you have internet.", "error");
        } else {
            showToast("Sorry, the AI failed to generate cards. Please try again or check your connection.", "error");
        }
    } finally {

        processBtn.disabled = false;
        btnText.textContent = 'Process All';
        processIcon.classList.remove('hidden');
        loaderIcon.classList.add('hidden');
    }
}

function renderAiGeneratedCards(cardsData) {
    const listContainer = document.getElementById('flashcard-list');

    // Handle both array (legacy) and object with deckName/deckNotes
    let cards = [];
    let deckName = null;
    let deckNotes = null;
    let deckLanguage = '';
    let deckType = 'flashcard';

    if (Array.isArray(cardsData)) {
        cards = cardsData;
    } else if (cardsData && (cardsData.cards || cardsData.sequences)) {
        cards = cardsData.cards || cardsData.sequences;
        deckName = cardsData.deckName;
        deckNotes = cardsData.deckNotes;
        deckLanguage = cardsData.language || '';
        deckType = cardsData.type || deckType;
    } else if (cardsData && typeof cardsData === 'object' && !Array.isArray(cardsData)) {
        // Fallback in case of normalized object with unexpected keys
        cards = cardsData.cards || cardsData.sequences || [];
        deckName = cardsData.deckName;
        deckNotes = cardsData.deckNotes;
        deckLanguage = cardsData.language || '';
        deckType = cardsData.type || deckType;
    }

    listContainer.dataset.cards = JSON.stringify(cards);
    if (deckName) {
        listContainer.dataset.deckName = deckName;
    }
    if (deckNotes) {
        listContainer.dataset.deckNotes = deckNotes;
    }
    listContainer.dataset.language = deckLanguage || '';
    listContainer.dataset.deckType = deckType || 'flashcard';

    listContainer.innerHTML = '';
    if (cards.length === 0) {
        const empty = document.createElement('div');
        empty.id = 'empty-flashcard-list';
        empty.className = 'list-empty-state';
        const icon = document.createElement('div');
        icon.className = 'list-empty-state-icon';
        icon.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M9.813 15.904 9 18.75l-.813-2.846a4.5 4.5 0 0 0-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 0 0 3.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 0 0 3.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 0 0-3.09 3.09ZM18.259 8.715 18 9.75l-.259-1.035a3.375 3.375 0 0 0-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 0 0 2.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 0 0 2.456 2.456L21.75 6l-1.035.259a3.375 3.375 0 0 0-2.456 2.456Z" /></svg>';
        const p = document.createElement('p');
        p.textContent = 'Generated cards will appear here after processing.';
        empty.appendChild(icon);
        empty.appendChild(p);
        listContainer.appendChild(empty);
        return;
    }

    cards.forEach((card, index) => {
        if (card._isSequence) {
            const wrapper = document.createElement('div');
            wrapper.className = 'generated-sequence';
            wrapper.dataset.index = String(index);

            const header = document.createElement('div');
            header.style.cssText = 'display:flex; justify-content:space-between; align-items:center; gap:12px;';
            const title = document.createElement('div');
            title.style.fontWeight = '700';
            title.style.fontSize = '1.05rem';
            title.textContent = card.title || 'Sequence';
            const actions = document.createElement('div');
            actions.className = 'generated-card-actions';
            const delBtn = document.createElement('button');
            delBtn.className = 'generated-card-action-btn delete';
            delBtn.title = 'Delete Sequence';
            delBtn.innerHTML = '&times;';
            delBtn.addEventListener('click', () => deleteGeneratedCard(index));
            actions.appendChild(delBtn);
            header.appendChild(title);
            header.appendChild(actions);
            wrapper.appendChild(header);

            if (card.description) {
                const desc = document.createElement('div');
                desc.style.color = 'var(--secondary-text)';
                desc.style.marginTop = '6px';
                desc.textContent = String(card.description);
                wrapper.appendChild(desc);
            }
            const ol = document.createElement('ol');
            ol.style.cssText = 'margin-top:8px; padding-left:18px; color:var(--text-color);';
            (card.steps || []).forEach(s => {
                const li = document.createElement('li');
                li.textContent = String(s);
                ol.appendChild(li);
            });
            wrapper.appendChild(ol);
            listContainer.appendChild(wrapper);
        } else {
            const wrapper = document.createElement('div');
            wrapper.className = 'generated-card';
            wrapper.dataset.index = String(index);

            const q = document.createElement('div');
            q.className = 'question';
            q.textContent = String(card.question || '');
            const a = document.createElement('div');
            a.className = 'answer';
            a.textContent = String(card.answer || '');

            const actions = document.createElement('div');
            actions.className = 'generated-card-actions';
            const delBtn = document.createElement('button');
            delBtn.className = 'generated-card-action-btn delete';
            delBtn.title = 'Delete Card';
            delBtn.innerHTML = '&times;';
            delBtn.addEventListener('click', () => deleteGeneratedCard(index));
            actions.appendChild(delBtn);

            wrapper.appendChild(q);
            wrapper.appendChild(a);
            wrapper.appendChild(actions);
            listContainer.appendChild(wrapper);
        }
    });

    const heading = document.getElementById('flashcard-count');
    const deckTypeFromData = listContainer.dataset.deckType || '';
    const isSequence = deckTypeFromData.toLowerCase() === 'sequence' || (cards.length > 0 && cards[0]._isSequence);
    if (isSequence) {
        const totalSteps = cards.reduce((count, card) => count + (Array.isArray(card.steps) ? card.steps.length : 0), 0) || cards.length;
        heading.textContent = `Generated Sequence${totalSteps === 1 ? '' : 's'} (${totalSteps} steps)`;
    } else {
        heading.textContent = `Generated Flashcards (${cards.length})`;
    }
}

function deleteGeneratedCard(index) {
    const listContainer = document.getElementById('flashcard-list');
    const cards = JSON.parse(listContainer.dataset.cards);
    cards.splice(index, 1);
    renderAiGeneratedCards(cards);
}

async function saveAiGeneratedDeck() {
    const listContainer = document.getElementById('flashcard-list');
    const cards = JSON.parse(listContainer.dataset.cards);
    // Use the deckName from the dataset if available, otherwise fallback to doc name or default
    const aiDeckName = listContainer.dataset.deckName;
    const aiDeckNotes = listContainer.dataset.deckNotes || '';
    const deckName = aiDeckName || (documentsForAi.length > 0 ? documentsForAi[0].name.split('.')[0] : "New AI Deck");

    if (cards.length === 0) {
        showToast("There are no cards to save.", "error");
        return;
    }

    const deckTypeFromDataset = (listContainer.dataset.deckType || 'flashcard').toLowerCase();
    const isSequenceType = deckTypeFromDataset === 'sequence' || (cards[0] && cards[0]._isSequence);


    if (isSequenceType) {
        const finalCards = [];
        let orderCounter = 0;
        cards.forEach(sequence => {
            const steps = splitSteps(sequence.steps || sequence.sequence || sequence.items);
            const question = sequence.description || sequence.title || '';
            steps.forEach(step => {
                orderCounter += 1;
                finalCards.push({
                    id: crypto.randomUUID(),
                    question,
                    answer: step,
                    order: orderCounter,
                    isNew: true,
                    questionImage: '',
                    answerImage: ''
                });
            });
        });

        if (!finalCards.length) {
            showToast("No sequence steps were detected to save.", "error");
            return;
        }

        await createNewDeck(deckName, 'Other', finalCards, aiDeckNotes, 'Sequence');
        showToast(`Sequence deck "${deckName}" created successfully with ${finalCards.length} steps!`, 'success');
        backToDashboard();
        return;
    }


    const finalCards = cards.map((c, idx) => ({
        id: crypto.randomUUID(),
        question: c.question || '',
        answer: c.answer || '',
        questionImage: '',
        answerImage: '',
        order: 0,
        isNew: true
    }));

    await createNewDeck(deckName, 'Other', finalCards, aiDeckNotes);
    showToast(`Deck "${deckName}" created successfully!`, 'success');
    backToDashboard();
}

function setupDragDropView(chunk) {
    const list = document.getElementById('dragDropList');
    const shuffledChunk = shuffleArray([...chunk]);


    studyState.correctDragDropOrder = chunk.map(card => String(card.id));

    list.innerHTML = shuffledChunk.map((card, idx) => `
                <div class="deck-card-item drag-item" data-id="${String(card.id)}" style="
                    cursor: grab;
                    padding: 20px;
                    margin-bottom: 12px;
                    background: var(--card-bg);
                    border: 2px solid var(--border-color);
                    border-radius: 12px;
                    display: flex;
                    align-items: center;
                    gap: 15px;
                    transition: all 0.3s;
                ">
                    <div style="flex-grow: 1;">
                        <div style="font-weight: 600; font-size: 1.1rem; margin-bottom: 4px;">${card.answer}</div>
                    </div>
                    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" fill="currentColor" viewBox="0 0 16 16" style="color: var(--secondary-text); flex-shrink: 0;">
                        <path d="M7 2a1 1 0 1 1-2 0 1 1 0 0 1 2 0zm3 0a1 1 0 1 1-2 0 1 1 0 0 1 2 0zM7 5a1 1 0 1 1-2 0 1 1 0 0 1 2 0zm3 0a1 1 0 1 1-2 0 1 1 0 0 1 2 0zM7 8a1 1 0 1 1-2 0 1 1 0 0 1 2 0zm3 0a1 1 0 1 1-2 0 1 1 0 0 1 2 0zm-3 3a1 1 0 1 1-2 0 1 1 0 0 1 2 0zm3 0a1 1 0 1 1-2 0 1 1 0 0 1 2 0z"/>
                    </svg>
                </div>
            `).join('');

    if (sortableInstance) {
        try {
            sortableInstance.destroy();
        } catch (error) {
            console.warn('Failed to destroy Sortable instance:', error);
            // Continue execution even if destroy fails
        }
        sortableInstance = null;
    }
    sortableInstance = new Sortable(list, {
        animation: 150,
        ghostClass: 'drag-ghost',
        chosenClass: 'drag-chosen',
        handle: '.deck-card-item',
        onStart: function (evt) {
            evt.item.style.cursor = 'grabbing';
        },
        onEnd: function (evt) {
            evt.item.style.cursor = 'grab';
        }
    });
}

function checkDragDropOrder() {
    const listItems = document.querySelectorAll('#dragDropList .deck-card-item');
    const correctOrder = studyState.correctDragDropOrder;
    let isCorrect = true;
    let incorrectCount = 0;


    const currentOrder = Array.from(listItems).map(item => item.dataset.id);
    console.log('Correct order:', correctOrder);
    console.log('Current order:', currentOrder);

    listItems.forEach((item, index) => {
        const cardId = item.dataset.id;

        console.log(`Position ${index}: cardId="${cardId}" vs correctId="${correctOrder[index]}" - Match: ${cardId === correctOrder[index]}`);

        if (cardId !== correctOrder[index]) {
            isCorrect = false;
            incorrectCount++;
            item.style.borderColor = 'var(--danger-color)';
            item.style.backgroundColor = '#fff5f5';
        } else {
            item.style.borderColor = 'var(--success-color)';
            item.style.backgroundColor = '#f0fff4';
        }
    });

    if (document.body.classList.contains('dark-mode')) {
        listItems.forEach((item, index) => {
            const cardId = item.dataset.id;
            if (cardId !== correctOrder[index]) {
                item.style.backgroundColor = '#c5303030';
            } else {
                item.style.backgroundColor = '#2c7a7b';
            }
        });
    }

    if (isCorrect) {
        showToast("Perfect Order!", "success");
        const recallPool = studyState.sequenceChunks[studyState.currentChunkIndex] || [];
        const recallCount = Math.min(Math.max(1, recallPool.length >= 3 ? 3 : recallPool.length), recallPool.length);
        studyState.roundCards = shuffleArray(recallPool).slice(0, recallCount);
        studyState.currentCardIndex = 0;
        studyState.sequencePhase = 'Post-Drag Recall';
        setTimeout(() => {
            showNextCard();
        }, 800);
    } else {
        showToast(`${incorrectCount} item${incorrectCount > 1 ? 's' : ''} in wrong position. Try again!`, "error");

        setTimeout(() => {
            listItems.forEach(item => {
                item.style.borderColor = 'var(--border-color)';
                item.style.backgroundColor = 'var(--card-bg)';
            });
        }, 2000);
    }
}

function checkSequenceAnswer() {
    const userInput = document.getElementById('writeAnswerInput');
    const currentChunk = studyState.sequenceActiveChunkOverride || studyState.sequenceChunks[studyState.currentChunkIndex];
    const cardPhasesUsingRoundCards = ['Weakest Link', 'InterChunkReview', 'Passive Review Quiz', 'Post-Drag Recall'];
    let card = null;
    if (studyState.sequencePhase === 'Forward Chaining' && studyState.sequenceForwardQueue?.length) {
        const forwardId = studyState.sequenceForwardQueue[studyState.currentCardIndex];
        card = currentChunk ? (currentChunk.find(c => c.id === forwardId) || currentChunk[studyState.currentCardIndex]) : null;
    } else if (cardPhasesUsingRoundCards.includes(studyState.sequencePhase)) {
        card = studyState.roundCards?.[studyState.currentCardIndex];
    } else {
        card = currentChunk ? currentChunk[studyState.currentCardIndex] : null;
    }

    if (!card || userInput.value.trim() === '') return;

    const userAnswer = userInput.value.trim();
    const correctAnswer = card.answer.trim();


    const stripHTML = (str) => {
        const div = document.createElement('div');
        div.innerHTML = str;
        return div.textContent || div.innerText || '';
    };

    const normalizedUserAnswer = stripHTML(userAnswer).toLowerCase();
    const normalizedCorrectAnswer = stripHTML(correctAnswer).toLowerCase();

    const isCorrect = (normalizedUserAnswer === normalizedCorrectAnswer);

    const responseTime = studyState.sequenceQuestionStartTime ? Date.now() - studyState.sequenceQuestionStartTime : null;
    logInteraction({ cardID: card.id, wasCorrect: isCorrect, userAnswer: userAnswer, questionType: 'Sequence', responseTime });

    userInput.classList.toggle('correct', isCorrect);
    userInput.classList.toggle('incorrect', !isCorrect);
    userInput.disabled = true;
    showAnswer();
    const delay = isCorrect ? 800 : 2000;
    setTimeout(() => {
        moveCard(card, isCorrect, 'Sequence');
    }, delay);
}

function dontKnowSequenceAnswer() {
    const currentChunk = studyState.sequenceActiveChunkOverride || studyState.sequenceChunks[studyState.currentChunkIndex];
    const cardPhasesUsingRoundCards = ['Weakest Link', 'InterChunkReview', 'Passive Review Quiz', 'Post-Drag Recall'];
    let card = null;
    if (studyState.sequencePhase === 'Forward Chaining' && studyState.sequenceForwardQueue?.length) {
        const forwardId = studyState.sequenceForwardQueue[studyState.currentCardIndex];
        card = currentChunk ? (currentChunk.find(c => c.id === forwardId) || currentChunk[studyState.currentCardIndex]) : null;
    } else if (cardPhasesUsingRoundCards.includes(studyState.sequencePhase)) {
        card = studyState.roundCards?.[studyState.currentCardIndex];
    } else {
        card = currentChunk ? currentChunk[studyState.currentCardIndex] : null;
    }

    if (!card) return;

    const responseTime = studyState.sequenceQuestionStartTime ? Date.now() - studyState.sequenceQuestionStartTime : null;
    logInteraction({ cardID: card.id, wasCorrect: false, userAnswer: "[Don't Know]", questionType: 'Sequence', responseTime });
    showAnswer();
    document.querySelector('#cardView .flashcard').classList.add('is-flipped');
    document.getElementById('cardAnswerContent').classList.remove('hidden');
    document.getElementById('writeAnswerInput').disabled = true;

    showToast("The correct answer is shown above.", "error");

    setTimeout(() => {
        moveCard(card, false, 'Sequence');
    }, 2000);
}

async function showInsightsView() {

    const setupInsights = async () => {
        const deckSelect = document.getElementById('insightsDeckSelect');
        deckSelect.innerHTML = '<option value="">-- Select a Deck --</option>';
        Object.values(decks).forEach(deck => {
            const opt = document.createElement('option');
            opt.value = String(deck.id);
            opt.textContent = String(deck.name);
            deckSelect.appendChild(opt);
        });

        const allKnowledgeStates = await getAllDataFromDB('userKnowledgeState');
        const knowledgeMap = new Map(allKnowledgeStates.map(item => [String(item.cardID), item]));


        document.getElementById('insightsContent').classList.add('hidden');
        document.getElementById('insightsPlaceholder').classList.remove('hidden');


        const handleDeckSelection = (deckId) => {
            if (!deckId) {
                document.getElementById('insightsContent').classList.add('hidden');
                document.getElementById('insightsPlaceholder').classList.remove('hidden');
                return;
            }
            renderMasteryBreakdownChart(deckId, knowledgeMap);

            updateCardDetailListForInsights(deckId, knowledgeMap);
            renderForgettingCurveChart(null, deckId);
            document.getElementById('insightsContent').classList.remove('hidden');
            document.getElementById('insightsPlaceholder').classList.add('hidden');
        };


        const newDeckSelect = deckSelect.cloneNode(true);
        deckSelect.parentNode.replaceChild(newDeckSelect, deckSelect);


        newDeckSelect.addEventListener('change', () => {
            handleDeckSelection(newDeckSelect.value);
        });
    };

    transitionView('insightsView', false, setupInsights);
}

function updateCardDetailListForInsights(deckId, knowledgeMap) {
    const list = document.getElementById('insightsCardList');
    const deck = decks[deckId];
    const examDate = deck.settings?.examDate ? new Date(deck.settings.examDate) : null;
    const targetDate = examDate || new Date();
    list.innerHTML = '';

    deck.cards.forEach(card => {
        const state = knowledgeMap.get(String(card.id));
        const retention = calculateRetentionAtDate(state, targetDate);
        if (globalSettings.devMode) {
            console.log("[FSRS insights] retention used:", retention);
        }
        const retentionPercent = state && Number.isFinite(retention) ? Math.round(retention * 100) : null;
        const stabilityText = Number.isFinite(state?.stability) ? `${state.stability.toFixed(1)}d` : 'N/A';

        const cardItem = document.createElement('div');
        cardItem.className = 'deck-card-item';

        const qDiv = document.createElement('div');
        qDiv.style.flexGrow = '1';
        qDiv.textContent = card.question || '';
        const metaDiv = document.createElement('div');
        metaDiv.style.color = 'var(--secondary-text)';
        metaDiv.style.fontWeight = '500';
        metaDiv.textContent = `Retention: ${retentionPercent === null ? 'N/A' : retentionPercent + '%'} | Stability: ${stabilityText}`;
        cardItem.appendChild(qDiv);
        cardItem.appendChild(metaDiv);


        if (state) {
            cardItem.style.cursor = 'pointer';
            cardItem.addEventListener('click', () => {

                renderForgettingCurveChart(state, deckId);
            });
        }
        list.appendChild(cardItem);
    });
}

function calculateFSRSRetrievability(stability, lastReviewedISO, futureDate) {
    if (!lastReviewedISO || !stability || stability <= 0) return 1.0;
    const lastReviewed = new Date(lastReviewedISO);
    const targetDate = futureDate ? new Date(futureDate) : new Date();
    const elapsed_days = (targetDate.getTime() - lastReviewed.getTime()) / (1000 * 3600 * 24);
    if (elapsed_days < 0) return 1.0;
    const retention = Math.exp((Math.log(0.9) * elapsed_days) / stability);
    return Math.max(0, Math.min(1, retention));
}

function renderForgettingCurveChart(cardState, deckId) {
    const canvasId = 'forgettingCurveChart';
    const cardDetailP = document.getElementById('cardDetailForCurve');
    if (chartInstances[canvasId]) chartInstances[canvasId].destroy();
    const ctx = getCanvasContextById(canvasId);
    if (!ctx) {
        console.warn('renderForgettingCurveChart: canvas not found', canvasId);
        return;
    }

    if (!cardState || !cardState.stability || !deckId) {
        cardDetailP.textContent = 'Select a card from the list to see its predicted curve.';
        chartInstances[canvasId] = new Chart(ctx, { data: { labels: [], datasets: [] }, options: { plugins: { legend: { display: false } } } });
        return;
    }

    const card = decks[deckId]?.cards.find(c => String(c.id) === String(cardState.cardID));
    if (!card) {
        cardDetailP.textContent = 'Error: Could not find card details.';
        return;
    }
    cardDetailP.textContent = `Predicted curve for: "${card.question}"`;

    const stability = cardState.stability;
    const lastReviewed = cardState.lastReviewed;
    const labels = [];
    const data = [];
    const today = new Date();
    const forecastDays = Math.max(30, Math.ceil(stability * 3));

    for (let t = 0; t <= forecastDays; t++) {
        const futureDate = new Date(today);
        futureDate.setDate(today.getDate() + t);
        labels.push(t);
        const pRecall = calculateFSRSRetrievability(stability, lastReviewed, futureDate);
        data.push(pRecall * 100);
    }

    chartInstances[canvasId] = new Chart(ctx, {
        type: 'line',
        data: {
            labels: labels,
            datasets: [{
                label: 'Probability of Recall (%)',
                data: data,
                borderColor: 'var(--primary-color)',
                backgroundColor: 'rgba(102, 126, 234, 0.1)',
                fill: true,
                tension: 0.4
            }]
        },
        options: {
            scales: {
                y: { min: 0, max: 100, title: { display: true, text: 'Recall Probability (%)' } },
                x: { title: { display: true, text: 'Days From Today' } }
            },
            plugins: { legend: { display: false } }
        }
    });
}

function renderMasteryBreakdownChart(deckId, knowledgeMap) {
    const canvasId = 'masteryBreakdownChart';
    if (chartInstances[canvasId]) chartInstances[canvasId].destroy();

    const deck = decks[deckId];
    const examDate = deck.settings?.examDate ? new Date(deck.settings.examDate) : null;
    const targetDate = examDate || new Date();
    let counts = { weak: 0, medium: 0, strong: 0 };
    deck.cards.forEach(card => {
        const retention = calculateRetentionAtDate(knowledgeMap.get(String(card.id)), targetDate);
        if (globalSettings.devMode) {
            console.log("[FSRS insights] retention used:", retention);
        }
        if (retention < 0.4) counts.weak++;
        else if (retention < 0.75) counts.medium++;
        else counts.strong++;
    });

    const ctx = getCanvasContextById(canvasId);
    if (!ctx) {
        console.warn('renderMasteryBreakdownChart: canvas not found', canvasId);
        return;
    }
    chartInstances[canvasId] = new Chart(ctx, {
        type: 'doughnut',
        data: {
            labels: ['Weak (<40%)', 'Medium (40-75%)', 'Strong (75%+)'],
            datasets: [{
                data: [counts.weak, counts.medium, counts.strong],
                backgroundColor: ['#fc8181', '#f6ad55', '#68d391'],
                borderColor: 'var(--card-bg)',
                borderWidth: 4
            }]
        },
        options: { responsive: true, cutout: '70%', plugins: { legend: { display: false } } }
    });

    const legend = document.getElementById('masteryLegend');
    legend.innerHTML = `
                <div style="display:flex; align-items:center; margin-bottom: 5px;"><div style="width:12px; height:12px; background-color:#fc8181; border-radius:50%; margin-right:8px;"></div>Weak: ${counts.weak} cards</div>
                <div style="display:flex; align-items:center; margin-bottom: 5px;"><div style="width:12px; height:12px; background-color:#f6ad55; border-radius:50%; margin-right:8px;"></div>Medium: ${counts.medium} cards</div>
                <div style="display:flex; align-items:center;"><div style="width:12px; height:12px; background-color:#68d391; border-radius:50%; margin-right:8px;"></div>Strong: ${counts.strong} cards</div>
            `;
}

function checkAnswerForgivingly(userAnswer, correctAnswer, settings) {
    let processedUserAnswer = userAnswer.trim();
    let processedCorrectAnswer = correctAnswer.trim();

    if (!settings.caseSensitive) {
        processedUserAnswer = processedUserAnswer.toLowerCase();
        processedCorrectAnswer = processedCorrectAnswer.toLowerCase();
    }
    if (!settings.punctuation) {
        const punc = /[.,/#!$%^&*;:{}=\-_`~()]/g;
        processedUserAnswer = processedUserAnswer.replace(punc, "").replace(/\s+/g, ' ');
        processedCorrectAnswer = processedCorrectAnswer.replace(punc, "").replace(/\s+/g, ' ');
    }

    if (processedUserAnswer === processedCorrectAnswer) {
        return { result: 'CORRECT', distance: 0 };
    }

    if (settings.forgivingAutomarking) {
        const distance = levenshteinDistance(processedUserAnswer, processedCorrectAnswer);
        const threshold = Math.max(1, Math.floor(processedCorrectAnswer.length / 5));

        if (distance <= threshold) {
            return { result: 'TYPO', distance: distance };
        }
    }

    return { result: 'INCORRECT', distance: levenshteinDistance(processedUserAnswer, processedCorrectAnswer) };
}

async function generateDailySessionForPlan(planId) {
    const plans = await getAllDataFromDB('examPlans');
    const plan = plans.find(p => p.id === planId);
    if (!plan) {
        console.error("Exam plan not found!");
        return [];
    }

    const allCards = [];
    for (const deckId of plan.deckIds) {
        if (decks[deckId]) {
            const cardsWithOrigin = decks[deckId].cards.map(c => ({ ...c, deckId: deckId }));
            allCards.push(...cardsWithOrigin);
        }
    }

    const knowledgeStates = await getAllDataFromDB('userKnowledgeState');
    const knowledgeMap = new Map(knowledgeStates.map(item => [item.cardID, item]));
    const now = new Date();
    const examDate = new Date(plan.examDate);
    const totalDaysRemaining = Math.max(1, (examDate - now) / (1000 * 3600 * 24));

    const prioritizedCards = allCards.map(card => {
        const state = knowledgeMap.get(card.id) || { fsrs: card.fsrs, stability: card.fsrs?.stability, lastReviewed: card.fsrs?.last_review };
        const targetRetention = decks[card.deckId]?.settings?.targetRetention || 0.8;
        const retention = calculateRetentionAtDate(state, examDate);
        return { ...card, projectedRetention: retention, targetRetention };
    });

    let needsReview = prioritizedCards.filter(c => (c.projectedRetention ?? 0) < (c.targetRetention ?? 0.8));
    if (needsReview.length === 0) {
        needsReview = [...prioritizedCards];
    }
    needsReview.sort((a, b) => (a.projectedRetention ?? 0) - (b.projectedRetention ?? 0));

    const minSessionSize = 15;
    const maxSessionSize = 50;
    const highIntensityDays = 30;

    let sessionSize;

    if (totalDaysRemaining >= highIntensityDays) {
        sessionSize = minSessionSize;
    } else {
        const progress = (highIntensityDays - totalDaysRemaining) / (highIntensityDays - 1);
        sessionSize = Math.round(minSessionSize + (maxSessionSize - minSessionSize) * progress);
    }

    return needsReview.slice(0, sessionSize);
}

function showExamPlanModal() {
    const deckSelector = document.getElementById('examPlanDeckSelector');
    deckSelector.innerHTML = '';

    const deckIds = Object.keys(decks);

    if (deckIds.length === 0) {
        deckSelector.innerHTML = '<p style="text-align:center; color:var(--secondary-text);">You need to create at least one deck before making a plan.</p>';
    } else {
        deckIds.forEach(deckId => {
            const deck = decks[deckId];
            const checkboxHTML = `
                        <div class="checkbox-group">
                            <input type="checkbox" id="deck-check-${deck.id}" name="planDecks" value="${deck.id}">
                            <label for="deck-check-${deck.id}">${deck.name}</label>
                        </div>
                    `;
            deckSelector.innerHTML += checkboxHTML;
        });
    }

    const today = new Date().toISOString().split('T')[0];
    document.getElementById('examPlanDate').setAttribute('min', today);

    currentEditingPlanId = null;
    document.getElementById('examPlanModal').classList.add('show');
}

function closeExamPlanModal() {
    document.getElementById('examPlanModal').classList.remove('show');
    document.getElementById('examPlanName').value = '';
    document.getElementById('examPlanDate').value = '';
    document.getElementById('examPlanDeckSelector').innerHTML = '';
}

async function saveExamPlan() {
    const name = document.getElementById('examPlanName').value.trim();
    const examDate = document.getElementById('examPlanDate').value;
    const selectedDecks = Array.from(document.querySelectorAll('#examPlanDeckSelector input:checked')).map(el => el.value);

    if (!name || !examDate || selectedDecks.length === 0) {
        showToast('Please fill out all fields.', 'error');
        return;
    }

    if (currentEditingPlanId) {
        const updatedPlan = {
            id: currentEditingPlanId,
            name: name,
            examDate: examDate,
            deckIds: selectedDecks,
            lastModified: new Date().toISOString()
        };
        await saveDataToDB('examPlans', updatedPlan);
        showToast(`Plan "${name}" updated!`, 'success');
    } else {
        const newPlan = {
            id: Date.now().toString(),
            name: name,
            examDate: examDate,
            deckIds: selectedDecks,
            lastModified: new Date().toISOString()
        };
        await saveDataToDB('examPlans', newPlan);
        showToast(`Exam Plan "${name}" created!`, 'success');
    }

    closeExamPlanModal();
    await updateDashboard();
}

async function startExamPlanSession(planId) {
    showToast('Building your optimal study session...', 'info');

    currentMode = 'exam';
    resetSessionState();

    dailyPriorityQueue = await generateDailySessionForPlan(planId);

    if (dailyPriorityQueue.length === 0) {
        showToast("You're all caught up on this plan for today! Great work.", 'success');
        return;
    }

    studyState.currentCardIndex = 0;
    studyState.currentRound = 1;
    studyState.startTime = new Date();
    studyState.incorrectInThisRound = [];
    studyState.roundCards = [];
    studyState.originPlanId = planId;
    const knowledgeStates = await getAllDataFromDB('userKnowledgeState');
    studyState.knowledgeStates = new Map(knowledgeStates.map(item => [item.cardID, item]));

    const allPlans = await getAllDataFromDB('examPlans');
    const currentPlan = allPlans.find(p => p.id === planId);
    studyState.examDate = currentPlan ? new Date(currentPlan.examDate) : null;
    studyState.targetRetention = currentPlan?.targetRetention || 0.8;

    transitionView('studyMode');
    document.getElementById('studyTitle').textContent = 'Exam Plan Session';
    document.getElementById('studySubtitle').textContent = currentPlan ? currentPlan.name : 'Studying';

    showProgress();
}

async function hideExamPlanBanner(event) {
    event.stopPropagation();

    globalSettings.hideExamPlanBanner = true;

    await saveDataToDB('appData', { key: 'userSettings', ...globalSettings });

    document.getElementById('examPlanCtaContainer').classList.add('hidden');
    document.getElementById('createExamPlanFooterBtn').classList.remove('hidden');

    showToast('Banner hidden. You can create plans from the button below.', 'info');
}

async function showPlanDetails(planId) {
    const allPlans = await getAllDataFromDB('examPlans');
    const plan = allPlans.find(p => p.id === planId);
    if (!plan) { console.error("Plan not found"); return; }

    const knowledgeStates = await getAllDataFromDB('userKnowledgeState');
    const knowledgeMap = new Map(knowledgeStates.map(item => [item.cardID, item]));

    document.getElementById('planDetailTitle').textContent = plan.name;
    const now = new Date();
    const examDate = new Date(plan.examDate);
    const timeDiff = examDate.getTime() - now.getTime();
    const daysRemaining = Math.ceil(timeDiff / (1000 * 3600 * 24));
    document.getElementById('planDetailCountdown').textContent = `${daysRemaining} days remaining until exam.`;

    document.getElementById('planDetailStartBtn').onclick = () => startExamPlanSession(plan.id);
    document.getElementById('planDetailEditBtn').onclick = () => editPlan(plan.id);
    document.getElementById('planDetailDeleteBtn').onclick = () => deletePlan(plan.id);

    renderPlanAnalytics(plan, knowledgeMap);

    transitionView('planDetailView');
}

function renderPlanAnalytics(plan, knowledgeMap) {
    const allCardsInPlan = [];
    plan.deckIds.forEach(deckId => {
        if (decks[deckId]) {
            allCardsInPlan.push(...decks[deckId].cards.map(c => ({ ...c, deckId })));
        }
    });
    if (allCardsInPlan.length === 0) {
        const analyticsContent = document.getElementById('planAnalyticsContent');
        analyticsContent.innerHTML = `
                    <div class="no-decks" style="padding: 40px;">
                        <p>This plan has no cards to analyze.</p>
                        <p style="font-size: 0.9rem; margin-top: 10px;">Edit the plan to add some decks.</p>
                    </div>
                `;
        if (chartInstances['planMasteryChart']) chartInstances['planMasteryChart'].destroy();
        if (chartInstances['planDeckProgressChart']) chartInstances['planDeckProgressChart'].destroy();
        return;
    }
    const planExamDate = new Date(plan.examDate);
    const cardStatesInPlan = allCardsInPlan.map(card => {
        return knowledgeMap.get(card.id) || { cardID: card.id, fsrs: card.fsrs, stability: card.fsrs?.stability, lastReviewed: card.fsrs?.last_review };
    });

    let counts = { novice: 0, learning: 0, mastered: 0 };
    cardStatesInPlan.forEach((state, idx) => {
        const card = allCardsInPlan[idx];
        const targetRetention = decks[card.deckId]?.settings?.targetRetention || 0.8;
        const retention = calculateRetentionAtDate(state, planExamDate);
        if (retention < 0.6) counts.novice++;
        else if (retention < targetRetention) counts.learning++;
        else counts.mastered++;
    });

    const masteryCanvasId = 'planMasteryChart';
    if (chartInstances[masteryCanvasId]) chartInstances[masteryCanvasId].destroy();
    const ctxMastery = getCanvasContextById(masteryCanvasId);
    if (!ctxMastery) {
        console.warn('renderPlanAnalytics: mastery canvas not found', masteryCanvasId);
        return;
    }
    chartInstances[masteryCanvasId] = new Chart(ctxMastery, {
        type: 'doughnut',
        data: {
            labels: ['Novice', 'Learning', 'Mastered'],
            datasets: [{
                data: [counts.novice, counts.learning, counts.mastered],
                backgroundColor: ['#fc8181', '#f6ad55', '#68d391'],
                borderColor: 'var(--card-bg)',
                borderWidth: 4
            }]
        },
        options: { responsive: true, cutout: '70%', plugins: { legend: { display: false } } }
    });
    document.getElementById('planMasteryLegend').innerHTML = `
                <div style="display:flex; align-items:center; margin-bottom: 5px;"><div style="width:12px; height:12px; background-color:#fc8181; border-radius:50%; margin-right:8px;"></div>Novice: ${counts.novice} cards</div>
                <div style="display:flex; align-items:center; margin-bottom: 5px;"><div style="width:12px; height:12px; background-color:#f6ad55; border-radius:50%; margin-right:8px;"></div>Learning: ${counts.learning} cards</div>
                <div style="display:flex; align-items:center;"><div style="width:12px; height:12px; background-color:#68d391; border-radius:50%; margin-right:8px;"></div>Mastered: ${counts.mastered} cards</div>
            `;

    const deckProgressData = { labels: [], data: [] };
    plan.deckIds.forEach(deckId => {
        const deck = decks[deckId];
        if (deck) {
            deckProgressData.labels.push(deck.name);
            let deckMasterySum = 0;
            deck.cards.forEach(card => {
                const state = knowledgeMap.get(card.id);
                deckMasterySum += calculateRetentionAtDate(state, planExamDate);
            });
            const deckProgress = deck.cards.length > 0 ? (deckMasterySum / deck.cards.length) * 100 : 0;
            deckProgressData.data.push(deckProgress);
        }
    });

    const deckCanvasId = 'planDeckProgressChart';
    if (chartInstances[deckCanvasId]) chartInstances[deckCanvasId].destroy();
    const ctxDeck = getCanvasContextById(deckCanvasId);
    if (!ctxDeck) {
        console.warn('renderPlanAnalytics: deck progress canvas not found', deckCanvasId);
        return;
    }
    chartInstances[deckCanvasId] = new Chart(ctxDeck, {
        type: 'bar',
        data: {
            labels: deckProgressData.labels,
            datasets: [{
                label: 'Mastery %',
                data: deckProgressData.data,
                backgroundColor: 'rgba(102, 126, 234, 0.6)'
            }]
        },
        options: { scales: { y: { beginAtZero: true, max: 100 } }, plugins: { legend: { display: false } } }
    });

    const hardestCardsList = document.getElementById('planHardestCardsList');
    const sortedCards = allCardsInPlan
        .map(card => ({
            ...card,
            projectedRetention: calculateRetentionAtDate(knowledgeMap.get(card.id), planExamDate)
        }))
        .sort((a, b) => (a.projectedRetention ?? 0) - (b.projectedRetention ?? 0))
        .slice(0, 10);

    hardestCardsList.innerHTML = '';
    sortedCards.forEach(card => {
        const cardEl = document.createElement('div');
        cardEl.className = 'deck-card-item';
        const q = document.createElement('div'); q.textContent = card.question || '';
        const retentionEl = document.createElement('div'); retentionEl.style.color = 'var(--danger-color)'; retentionEl.style.fontWeight = '500'; retentionEl.textContent = `${Math.round((card.projectedRetention ?? 0) * 100)}% Retention`;
        cardEl.appendChild(q);
        cardEl.appendChild(retentionEl);
        hardestCardsList.appendChild(cardEl);
    });
}

function updateExamProgress() {
    const totalInQueue = dailyPriorityQueue.length + studyState.roundCards.length;
    const completedThisSession = totalInQueue - dailyPriorityQueue.length;
    const progressPercent = totalInQueue > 0 ? (completedThisSession / totalInQueue) * 100 : 0;

    document.getElementById('progressTitle').textContent = `Today's Session Progress`;

    document.getElementById('deckMasteryProgress').style.width = `${progressPercent}%`;
    document.getElementById('deckMasteryValue').textContent = `${Math.round(progressPercent)}%`;
    document.getElementById('masteredCardCount').textContent = dailyPriorityQueue.length;
    document.getElementById('learningCardCount').textContent = completedThisSession;
    document.querySelector('#masteredCardCount + .stat-label').textContent = "Cards Remaining";
    document.querySelector('#learningCardCount + .stat-label').textContent = "Cards Reviewed";

    const poolList = document.getElementById('activePoolList');
    poolList.innerHTML = `<p style="text-align: center; color: var(--secondary-text);">Click 'Continue' to start the next round!</p>`;

    const continueBtn = document.getElementById('continueBtn');
    if (dailyPriorityQueue.length === 0 && studyState.roundCards.length === 0) {
        document.getElementById('progressTitle').textContent = "Today's Session Complete!";
        continueBtn.textContent = 'Finish Session';
        continueBtn.classList.add('btn-success');
        continueBtn.onclick = endSession;
    } else {
        continueBtn.textContent = studyState.currentRound === 1 ? 'Start First Round' : 'Start Next Round';
        continueBtn.classList.remove('btn-success');
        continueBtn.onclick = continueStudy;
    }
}

async function deletePlan(planId) {
    const allPlans = await getAllDataFromDB('examPlans');
    const plan = allPlans.find(p => p.id === planId);
    if (!plan) return;

    showConfirmModal(`Are you sure you want to permanently delete the plan "${plan.name}"?`, async () => {
        await deleteDataFromDB('examPlans', planId);
        showToast(`Plan "${plan.name}" deleted.`);
        backToDashboard();
    });
}

async function editPlan(planId) {
    const allPlans = await getAllDataFromDB('examPlans');
    const plan = allPlans.find(p => p.id === planId);
    if (!plan) return;

    currentEditingPlanId = planId;

    document.getElementById('examPlanName').value = plan.name;
    document.getElementById('examPlanDate').value = plan.examDate;

    showExamPlanModal();

    plan.deckIds.forEach(deckId => {
        const checkbox = document.getElementById(`deck-check-${deckId}`);
        if (checkbox) {
            checkbox.checked = true;
        }
    });
}

async function updateUIAfterLogin(user) {
    document.getElementById('guestSignupBtn').classList.add('hidden');
    document.getElementById('userProfileMenu').classList.remove('hidden');
    document.getElementById('userEmail').textContent = user.email;
    const username = user.user_metadata?.full_name ||
        user.email?.split('@')[0] ||
        'Friend';
    document.getElementById('welcomeMessage').textContent =
        `Welcome back, ${username} !`;

    const authView = document.getElementById('authView');
    if (authView) {
        authView.classList.remove('is-visible');
    }

    document.getElementById('loggedInView').classList.remove('hidden');
    await loadUserDataAndSync();
    initializeAccentModules();

    loadCookieConsent();

    transitionView('dashboard', false, null, false);
}

function updateUIAfterLogout() {
    document.getElementById('userProfileMenu').classList.add('hidden');
    document.getElementById('userProfileDropdown').classList.add('hidden');
    document.getElementById('welcomeMessage').textContent = `Lagiote Revise`;
    document.getElementById('loggedInView').classList.remove('hidden');

    decks = {};
    analyticsData = {};
    updateDashboard();

    transitionView('dashboard', false, null, false);
}

async function clearLocalData() {
    decks = {};
    analyticsData = {};

    await clearStoreInDB('decks');
    await clearStoreInDB('userKnowledgeState');
    await clearStoreInDB('examPlans');

    updateDashboard();
}

function getOrCreateGuestID() {
    let guestId = localStorage.getItem('guestID');
    if (!guestId) {
        guestId = crypto.randomUUID();
        localStorage.setItem('guestID', guestId);
    }
    return guestId;
}

async function loadUserDataAndSync() {
    if (!isOnline) {
        console.log("Offline. Skipping sync.");
        await updateDashboard();
        return;
    }

    // Check for Auth0 session OR Guest Mode
    const savedSession = localStorage.getItem('auth0Session');
    const isGuest = !savedSession;

    if (isGuest) {
        console.log("Syncing as Guest...");
    }

    showToast('Syncing your data...', 'info');

    try {
        const lastSynced = localStorage.getItem('lastSynced');

        const allDecks = await getAllDataFromDB('decks');
        const allKnowledge = await getAllDataFromDB('userKnowledgeState');
        const allExamPlans = await getAllDataFromDB('examPlans');
        const allInteractionLogs = await getAllDataFromDB('interactionLogs');
        const userSettings = await getDataFromDB('appData', 'userSettings');

        const dirtyDecks = lastSynced
            ? allDecks.filter(deck => deck.lastModified && new Date(deck.lastModified) > new Date(lastSynced))
            : allDecks;

        const dirtyKnowledgeStates = lastSynced
            ? allKnowledge.filter(state => state.lastModified && new Date(state.lastModified) > new Date(lastSynced))
            : allKnowledge;

        const dirtyExamPlans = lastSynced
            ? allExamPlans.filter(plan => plan.lastModified && new Date(plan.lastModified) > new Date(lastSynced))
            : allExamPlans;

        const dirtyInteractionLogs = lastSynced
            ? allInteractionLogs.filter(log => log.timestamp && new Date(log.timestamp) > new Date(lastSynced))
            : allInteractionLogs;

        // Get token from Auth0 session
        let token = null;
        let guestId = null;

        if (savedSession) {
            try {
                const session = JSON.parse(savedSession);
                // Fix: Support both Electron auth (accessToken/token) and web auth (access_token/id_token)
                token = session.accessToken || session.token || session.access_token || session.id_token;
                console.log('Auth session found for sync. Token present:', !!token);
                if (!token) {
                    console.warn('Session structure:', Object.keys(session));
                }
            } catch (e) {
                console.error('Error parsing auth session for sync:', e);
            }
        } else {
            guestId = getOrCreateGuestID();
            console.log('No auth session, using guest ID:', guestId);
        }

        if (!token && !guestId) {
            console.warn('No auth token or guest ID found for sync. Aborting.');
            return;
        }

        // Use Electron IPC handler instead of direct fetch
        let syncResult;
        const syncPayload = {
            lastSynced: lastSynced,
            dirtyDecks: dirtyDecks,
            dirtyKnowledgeStates: dirtyKnowledgeStates,
            dirtyExamPlans: dirtyExamPlans,
            dirtyInteractionLogs: dirtyInteractionLogs,
            userSettings: userSettings
        };

        if (window.electronAPI && window.electronAPI.syncData) {
            // Electron app - use IPC
            syncResult = await window.electronAPI.syncData({
                ...syncPayload,
                token: token,
                guestId: guestId
            });

            if (syncResult.error === 'auth_error' || syncResult.statusCode === 401) {
                throw new Error('Sync failed with status 401');
            }

            if (syncResult.error) {
                throw new Error(syncResult.message || 'Sync failed');
            }
        } else {
            // Web app fallback - direct fetch to HuggingFace proxy
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 25000);

            const syncUrl = 'https://tj7755-lagiote-proxy.hf.space/api/sync';
            console.log('Syncing to:', syncUrl);

            const headers = {
                'Content-Type': 'application/json'
            };
            if (token) {
                headers['Authorization'] = `Bearer ${token}`;
            } else if (guestId) {
                headers['X-Guest-ID'] = guestId;
            }

            const response = await fetch(syncUrl, {
                method: 'POST',
                signal: controller.signal,
                headers: headers,
                body: JSON.stringify(syncPayload)
            });

            if (!response.ok) {
                const errorText = await response.text();
                throw new Error(`Sync failed: ${response.status} ${errorText}`);
            }

            syncResult = await response.json();
            clearTimeout(timeoutId);
        }

        if (!syncResult) throw new Error("No sync result received.");

        console.log('Sync result received:', {
            updatedDecks: syncResult.updatedDecks?.length || 0,
            updatedKnowledgeStates: syncResult.updatedKnowledgeStates?.length || 0
        });

        // Log decks before sync for debugging
        console.log('Before sync - Local decks:', Object.keys(decks));
        console.log('Server returned deck IDs:', syncResult.updatedDecks?.map(d => d.id) || []);

        // Improved conflict resolution: merge decks intelligently
        const deckTransaction = db.transaction(['decks'], 'readwrite');
        const deckStore = deckTransaction.objectStore('decks');

        // Get all local decks first for comparison
        const localDecksMap = new Map();
        allDecks.forEach(deck => localDecksMap.set(deck.id, deck));

        let conflictsResolved = 0;
        const skipStats = { decks: 0, knowledgeStates: 0, examPlans: 0 };
        const updatedDecks = Array.isArray(syncResult.updatedDecks) ? syncResult.updatedDecks : [];
        for (const serverDeck of updatedDecks) {
            const normalizedDeck = normalizeDeckRecord(serverDeck);
            if (!normalizedDeck) {
                logSyncSkip('deck', 'missing identifier', serverDeck);
                skipStats.decks += 1;
                continue;
            }
            const localDeck = localDecksMap.get(normalizedDeck.id);

            if (localDeck) {
                // Conflict resolution: compare timestamps
                const serverTime = normalizedDeck.lastModified ? new Date(normalizedDeck.lastModified) : new Date(0);
                const localTime = localDeck.lastModified ? new Date(localDeck.lastModified) : new Date(0);

                if (localTime > serverTime) {
                    // Local version is newer, keep it
                    console.log(`Conflict: Local version of "${localDeck.name}" is newer, keeping local`);
                    conflictsResolved++;
                    continue;  // Skip this server deck
                } else if (serverTime.getTime() === localTime.getTime()) {
                    // Same timestamp, check if content is actually different
                    if (JSON.stringify(localDeck) === JSON.stringify(serverDeck)) {
                        continue; // Identical, no need to update
                    }
                }
            }

            deckStore.put(normalizedDeck);
        }

        // CRITICAL FIX: Reload all decks from IndexedDB after sync
        // This ensures local-only decks (not returned by server) are preserved
        await new Promise(resolve => deckTransaction.oncomplete = resolve);
        const allDecksAfterSync = await getAllDataFromDB('decks');
        decks = {};
        allDecksAfterSync.forEach(deck => {
            decks[deck.id] = deck;
        });

        // Ensure all cards have a deckId after sync
        const fsrsEngine = await getFsrsEngine();
        for (const deck of Object.values(decks)) {
            for (const card of deck.cards) {
                if (!card.fsrs) {
                    card.fsrs = serializeFsrsCard(fsrsEngine.prepareCard());
                }
                // Ensure each card has a reference to its deck
                if (!card.deckId) {
                    card.deckId = deck.id;
                }
            }
        }

        console.log('After reload - All decks:', Object.keys(decks));

        if (conflictsResolved > 0) {
            showToast(`Sync complete. ${conflictsResolved} local change(s) preserved.`, 'info');
        }

        const knowledgeTransaction = db.transaction(['userKnowledgeState'], 'readwrite');
        const knowledgeStore = knowledgeTransaction.objectStore('userKnowledgeState');
        const updatedStates = Array.isArray(syncResult.updatedKnowledgeStates) ? syncResult.updatedKnowledgeStates : [];
        for (const serverState of updatedStates) {
            const normalizedState = prepareKnowledgeRecord(serverState);
            if (normalizedState) {
                knowledgeStore.put(normalizedState);
            } else {
                logSyncSkip('knowledge state', 'missing card or user id', serverState);
                skipStats.knowledgeStates += 1;
            }
        }

        if (syncResult.updatedExamPlans) {
            const planTransaction = db.transaction(['examPlans'], 'readwrite');
            const planStore = planTransaction.objectStore('examPlans');
            for (const serverPlan of syncResult.updatedExamPlans) {
                const normalizedPlan = normalizeExamPlanRecord(serverPlan);
                if (normalizedPlan) {
                    planStore.put(normalizedPlan);
                } else {
                    logSyncSkip('exam plan', 'missing id', serverPlan);
                    skipStats.examPlans += 1;
                }
            }
        }

        const skippedTotal = Object.values(skipStats).reduce((sum, count) => sum + count, 0);
        if (skippedTotal > 0) {
            console.warn('[SYNC] Skipped records summary:', skipStats);
            showToast(`Sync skipped ${skippedTotal} invalid record(s). Check console for details.`, 'warning');
        }

        if (syncResult.updatedSettings) {
            await saveDataToDB('appData', { key: 'userSettings', ...syncResult.updatedSettings });
            globalSettings = syncResult.updatedSettings;
        }

        if (syncResult.deletedDeckIds && syncResult.deletedDeckIds.length > 0) {
            const deleteDeckTrans = db.transaction(['decks'], 'readwrite');
            syncResult.deletedDeckIds.forEach(id => {
                deleteDeckTrans.objectStore('decks').delete(id);
                delete decks[id];
            });
        }

        localStorage.setItem('lastSynced', syncResult.timestamp || new Date().toISOString());
        showToast('Sync complete!', 'success');

    } catch (error) {
        console.error('Sync Error:', error);
        if (error.message.includes('401')) {
            showToast('Session expired. Logging out.', 'error');
            logout();
        } else if (error.name === 'AbortError') {
            showToast('Sync timed out. Data is saved locally.', 'info');
        } else {
            showToast('Could not sync data. Working in offline mode.', 'error');
        }
    } finally {
        await updateDashboard();
    }
}

async function initOfflineAuth() {
    if (!isElectron) return;

    const savedSession = await getDataFromDB('appData', 'userSession');
    if (savedSession && new Date(savedSession.expires_at) > new Date()) {
        console.log("Found valid offline session. Logging in locally.");
        // TODO: Implement Auth0 offline session handling
        updateUIAfterLogin(savedSession.user);
    } else {
        console.log("No offline session found.");
        updateUIAfterLogout();
    }
}

async function showCurriculaLibrary() {
    if (!isOnline) {
        showToast("You must be online to browse the Curricula Library.", "error");
        return;
    }
    transitionView('libraryView');
    const grid = document.getElementById('libraryGrid');
    grid.innerHTML = '<p>Loading courses...</p>';

    try {
        const response = await fetch('/.netlify/functions/getPublicCurricula');
        if (!response.ok) throw new Error('Failed to load the library.');

        const curricula = await response.json();

        if (curricula.length === 0) {
            grid.innerHTML = '<p>No published curricula found yet. Check back soon!</p>';
            return;
        }

        grid.innerHTML = curricula.map(curriculum => `
                                < div class= "deck-card" style="border-color: var(--success-color);" >
                                <div class="deck-card-main-clickable">
                                    <div class="deck-header">
                                        <div class="deck-category" style="background-color: #e6fffa; color: #317b75;">Curriculum</div>
                                        <div class="deck-name">${curriculum.title}</div>
                                        <div class="deck-info">${curriculum.description || 'No description.'}</div>
                                    </div>
                                </div>
                    </div >
                        `).join('');

    } catch (error) {
        console.error('Library Error:', error);
        grid.innerHTML = '<p style="color: var(--danger-color);">Could not load the library. Please try again later.</p>';
    }
}

function loadCookieConsent() {
    const termlyScript = document.getElementById('termly-script');

    if (termlyScript && !termlyScript.hasAttribute('src')) {
        console.log("Loading cookie consent banner...");
        termlyScript.setAttribute('src', termlyScript.getAttribute('data-src'));
    }
}

function escapeRegExp(string) {
    return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function generateDiffHTML(s1, s2) {
    const escape = (str) => str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    return `<span style="background-color: #ffcdd2; text-decoration: line-through;">${escape(s1)}</span> <span style="background-color: #c8e6c9;">${escape(s2)}</span>`;
}


function showLoadingScreen(message) {
    const loadingView = document.getElementById('loadingView');
    document.getElementById('loadingMessage').textContent = message;
    loadingView.classList.remove('hidden');
    loadingView.style.display = 'flex';
}

function hideLoadingScreen() {
    const loadingView = document.getElementById('loadingView');
    loadingView.classList.add('hidden');
    loadingView.style.display = 'none';
}

function toggleEditorView(deckType) {
    const container = document.getElementById('flashcardsContainer');
    const cards = [];

    document.querySelectorAll('#editorView .flashcard-item').forEach(el => {
        const isSequence = el.querySelector('.sequence-term-input');
        cards.push({
            question: isSequence ? el.querySelector('.sequence-desc-input').value.trim() : el.querySelector('.question-input').value.trim(),
            answer: isSequence ? el.querySelector('.sequence-term-input').value.trim() : el.querySelector('.solution-input').value.trim(),
            questionImage: el.querySelector('.question-image-input')?.value.trim() || '',
            answerImage: el.querySelector('.answer-image-input')?.value.trim() || ''
        });
    });

    container.innerHTML = '';

    if (deckType === 'Sequence') {
        const addBtn = document.querySelector('.add-question-btn');
        addBtn.textContent = '+ Add Sequence Item';
        addBtn.onclick = () => editorAddNewCard('Sequence');
        document.querySelector('.add-question-btn').onclick = () => editorAddNewCard('Sequence');
        cards.forEach(card => editorAddNewCard('Sequence', card));
        if (sortableInstance) {
            try {
                sortableInstance.destroy();
            } catch (error) {
                console.warn('Failed to destroy Sortable instance:', error);
                // Continue execution even if destroy fails
            }
            sortableInstance = null;
        }
        sortableInstance = new Sortable(container, {
            animation: 150,
            handle: '.drag-handle',
            ghostClass: 'drag-ghost',
            onEnd: editorRenumberCards
        });
    } else {
        document.querySelector('.add-question-btn').onclick = () => editorAddNewCard('Standard');
        cards.forEach(card => editorAddNewCard('Standard', card));
        if (sortableInstance) {
            try {
                sortableInstance.destroy();
            } catch (error) {
                console.warn('Failed to destroy Sortable instance:', error);
                // Continue execution even if destroy fails
            }
            sortableInstance = null;
        }
    }
    editorRenumberCards();
}

function toggleExamSettingsVisibility() {
    const isEnabled = document.getElementById('deckSettingsExamModeToggle').checked;
    const container = document.getElementById('deckSettingsExamContainer');

    if (isEnabled) {
        container.classList.remove('hidden');
    } else {
        container.classList.add('hidden');
    }
}

async function generateFullDataExport(evt) {
    // 1. Notify user it started
    const btn = evt?.target?.closest('button');
    const originalText = btn?.innerHTML || '';
    if (btn) {
        btn.innerHTML = '<span class="spinner" style="width:16px; height:16px; border-width:2px;"></span> Collecting...';
        btn.disabled = true;
    }

    try {
        showToast("Gathering all application data...", "info");

        // 2. Fetch all data stores in parallel
        const [
            decks,
            knowledgeStates,
            interactionLogs,
            examPlans,
            userSettings,
            analytics
        ] = await Promise.all([
            getAllDataFromDB('decks'),
            getAllDataFromDB('userKnowledgeState'),
            getAllDataFromDB('interactionLogs'), // This is the most valuable data for analysis
            getAllDataFromDB('examPlans'),
            getDataFromDB('appData', 'userSettings'),
            getDataFromDB('appData', 'analytics')
        ]);

        // 3. Construct the Research Object
        const researchData = {
            meta: {
                exportDate: new Date().toISOString(),
                appVersion: document.querySelector('#welcomeMessage + span')?.textContent || 'Unknown',
                platform: navigator.platform,
                userAgent: navigator.userAgent,
                screenResolution: `${window.screen.width}x${window.screen.height} `,
                username: userSettings?.username || 'Anonymous'
            },
            stats: {
                totalDecks: decks.length,
                totalLogs: interactionLogs.length,
                totalKnowledgeStates: knowledgeStates.length
            },
            // Actual Data
            settings: userSettings,
            analytics: analytics,
            decks: decks,
            examPlans: examPlans,
            knowledgeStates: knowledgeStates,
            interactionLogs: interactionLogs
        };

        // 4. Convert to Text (Pretty printed JSON)
        const dataStr = JSON.stringify(researchData, null, 2);

        // 5. Create Filename with Date and Username
        const safeName = (userSettings?.username || 'User').replace(/[^a-z0-9]/gi, '_');
        const dateStr = new Date().toISOString().split('T')[0];
        const fileName = `Lagiote_Data_${safeName}_${dateStr}.json`;

        // 6. Trigger Download
        const blob = new Blob([dataStr], { type: "text/plain;charset=utf-8" });
        const url = URL.createObjectURL(blob);

        const link = document.createElement("a");
        link.setAttribute("href", url);
        link.setAttribute("download", fileName);
        document.body.appendChild(link);
        link.click();

        // Cleanup
        document.body.removeChild(link);
        URL.revokeObjectURL(url);

        showToast("Data export complete! Please email this file.", "success");

    } catch (error) {
        console.error("Export failed:", error);
        showToast("Failed to export data. See console.", "error");
    } finally {
        if (btn) {
            btn.innerHTML = originalText;
            btn.disabled = false;
        }
    }
}

async function resetSpecificDeck(deckId) {
    const deck = decks[deckId];
    if (!deck) return;

    showConfirmModal(`Are you sure you want to reset all learning progress for "${deck.name}"? This cannot be undone.`, async () => {
        const transaction = db.transaction(['userKnowledgeState'], 'readwrite');
        const store = transaction.objectStore('userKnowledgeState');

        // Create reset promises for all cards in this deck
        const resetPromises = deck.cards.map(card => {
            return new Promise((resolve, reject) => {
                const defaultState = createDefaultKnowledgeState({ id: card.id, deckID: deck.id }, {
                    userID: 'default_user',
                    deckID: deck.id,
                    stability: 1.0,
                    lastReviewed: new Date().toISOString(),
                    fsrs: null
                });

                if (!defaultState) {
                    console.warn('[DB] Skipped reset for card due to missing identifiers', card);
                    resolve();
                    return;
                }

                const request = store.put(defaultState);
                request.onsuccess = resolve;
                request.onerror = (e) => reject(e.target ? e.target.error : e);
            });
        });

        await Promise.all(resetPromises);

        // Also reset internal FSRS data if it exists on the deck object
        const fsrsEngine = await getFsrsEngine();
        deck.cards.forEach(card => {
            card.fsrs = serializeFsrsCard(fsrsEngine.prepareCard());
        });

        await saveDataToDB('decks', deck);

        showToast(`Progress for "${deck.name}" has been reset.`, "success");

        // Refresh the current view to show 0% progress
        if (currentViewingDeckId === deckId) {
            showDeckDetail(deckId);
        } else {
            updateDashboard();
        }
    });
}

// Fix: Add event listener for profile button
document.addEventListener('DOMContentLoaded', () => {
    const profileBtn = document.getElementById('userProfileBtn');
    if (profileBtn) {
        profileBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            const dropdown = document.getElementById('userProfileDropdown');
            dropdown.classList.toggle('hidden');
        });
    }

    // Close dropdown when clicking outside
    document.addEventListener('click', (e) => {
        const dropdown = document.getElementById('userProfileDropdown');
        const btn = document.getElementById('userProfileBtn');
        if (dropdown && !dropdown.classList.contains('hidden') && !dropdown.contains(e.target) && !btn.contains(e.target)) {
            dropdown.classList.add('hidden');
        }
    });
});

async function renderGlobalAnalytics() {
    try {
        transitionView('globalAnalyticsView');

        const allDecks = Object.values(decks || {});
        const allKnowledgeStates = await getAllDataFromDB('userKnowledgeState').catch(error => {
            console.warn('Failed to load user knowledge states for analytics', error);
            return [];
        });
        const normalizedStates = [];
        const normalizationTasks = [];
        for (const rawState of allKnowledgeStates) {
            const normalized = prepareKnowledgeRecord(rawState);
            if (!normalized) continue;
            normalizedStates.push(normalized);
            if (shouldPersistNormalizedState(rawState, normalized)) {
                normalizationTasks.push(
                    saveDataToDB('userKnowledgeState', normalized).catch(error => {
                        console.warn('Failed to persist normalized knowledge state', normalized?.id, error);
                    })
                );
            }
        }
        if (normalizationTasks.length) {
            await Promise.all(normalizationTasks);
        }
        const knowledgeMap = new Map(normalizedStates.map(state => [String(state.cardID), state]));
        const now = new Date();
        const cortex = await getCortexEngine();
        const knowledgeStateUtils = getKnowledgeStateUtils();
        const cardDeckPairs = allDecks.flatMap(deck => {
            if (!deck || !Array.isArray(deck.cards)) return [];
            return deck.cards.map(card => ({ card, deck }));
        });

        const analyticsStats = {
            totalCards: cardDeckPairs.length,
            reviewedCards: 0,
            unreviewedCards: 0,
            missingFsrs: 0,
            lastReviewedButZero: 0
        };
        for (const { card } of cardDeckPairs) {
            const knowledgeState = knowledgeMap.get(String(card.id));
            if (!knowledgeState) {
                analyticsStats.unreviewedCards++;
                continue;
            }
            if (!knowledgeState.fsrs) {
                analyticsStats.missingFsrs++;
            }
            const isReviewed = knowledgeStateUtils.isKnowledgeStateReviewed(knowledgeState);
            analyticsStats[isReviewed ? 'reviewedCards' : 'unreviewedCards']++;
            const lastReviewedIso = ensureIsoString(knowledgeState.lastReviewed || knowledgeState.fsrs?.last_review, '');
            const stabilityValue = knowledgeStateUtils.coerceFsrsNumber(knowledgeState.fsrs?.stability ?? knowledgeState.stability);
            const repsValue = knowledgeStateUtils.coerceFsrsNumber(knowledgeState.fsrs?.reps ?? knowledgeState.reps);
            if (lastReviewedIso && (stabilityValue <= 0 || repsValue <= 0)) {
                analyticsStats.lastReviewedButZero++;
            }
        }
        if (studyState.cortexDebugEnabled) {
            console.info('[Cortex Debug] Global analytics summaries', analyticsStats);
        }

        const forecastCanvasId = 'globalForecastGraphCanvas';
        const forecastCanvas = document.getElementById(forecastCanvasId);
        const forecastParent = forecastCanvas?.parentElement || null;
        const forecastMessageId = 'globalForecastNoReviewDataMessage';

        const forecastEligible = [];
        for (const pair of cardDeckPairs) {
            const knowledgeState = knowledgeMap.get(String(pair.card.id));
            if (!knowledgeState || !knowledgeStateUtils.isKnowledgeStateReviewed(knowledgeState)) continue;
            forecastEligible.push({ pair, knowledgeState });
        }

        const chartContext = getCanvasContextById(forecastCanvasId);
        if (chartInstances[forecastCanvasId]) {
            try {
                chartInstances[forecastCanvasId].destroy();
            } catch (err) {
                console.warn('Failed to destroy previous global forecast chart', err);
            }
            delete chartInstances[forecastCanvasId];
        }

        const showForecastMessage = (text) => {
            if (!forecastParent) return;
            let messageEl = document.getElementById(forecastMessageId);
            if (!messageEl) {
                messageEl = document.createElement('div');
                messageEl.id = forecastMessageId;
                messageEl.style.cssText = 'text-align: center; color: var(--secondary-text); padding: 24px 0;';
                forecastParent.appendChild(messageEl);
            }
            messageEl.textContent = text;
        };

        const removeForecastMessage = () => {
            const existing = document.getElementById(forecastMessageId);
            if (existing) {
                existing.remove();
            }
        };

        if (!forecastEligible.length || !chartContext) {
            if (forecastCanvas) {
                forecastCanvas.style.display = 'none';
            }
            showForecastMessage('No review data yet. Complete a study session to generate insights.');
        } else {
            if (forecastCanvas) {
                forecastCanvas.style.display = '';
            }
            removeForecastMessage();

            const horizonDeadline = (() => {
                const futureExamDates = allDecks
                    .map(deck => deck?.settings?.examDate)
                    .map(value => (value ? new Date(value) : null))
                    .filter(date => date instanceof Date && !Number.isNaN(date.getTime()) && date > now);
                if (!futureExamDates.length) return null;
                return futureExamDates.reduce((latest, date) => (date > latest ? date : latest));
            })();

            let horizonDays = 30;
            if (horizonDeadline) {
                const dayDiff = Math.round((horizonDeadline - now) / (24 * 60 * 60 * 1000));
                horizonDays = Math.min(60, Math.max(7, dayDiff || 7));
            }

            const labels = [];
            const data = [];
            const baseDate = new Date(now);
            baseDate.setHours(0, 0, 0, 0);

            for (let dayOffset = 0; dayOffset <= horizonDays; dayOffset++) {
                const targetDate = new Date(baseDate);
                targetDate.setDate(baseDate.getDate() + dayOffset);
                labels.push(targetDate.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' }));
                let retentionSum = 0;
                let retentionCount = 0;
                for (const entry of forecastEligible) {
                    const retention = calculateRetentionAtDate(entry.knowledgeState, targetDate);
                    if (typeof retention === 'number' && !Number.isNaN(retention)) {
                        retentionSum += retention;
                        retentionCount += 1;
                    }
                }
                const average = retentionCount ? (retentionSum / retentionCount) : 0;
                data.push(average * 100);
            }

            chartInstances[forecastCanvasId] = new Chart(chartContext, {
                type: 'line',
                data: {
                    labels,
                    datasets: [{
                        label: 'Average retrievability (%)',
                        data,
                        borderColor: 'rgb(102, 126, 234)',
                        backgroundColor: 'rgba(102, 126, 234, 0.25)',
                        fill: true,
                        tension: 0.25,
                        pointRadius: 2,
                        borderWidth: 2
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: {
                        tooltip: {
                            callbacks: {
                                label(context) {
                                    const value = typeof context.parsed?.y === 'number' ? context.parsed.y : 0;
                                    return `Average retrievability: ${value.toFixed(0)}%`;
                                }
                            }
                        },
                        legend: { display: false }
                    },
                    scales: {
                        x: {
                            title: {
                                display: true,
                                text: 'Days from today'
                            }
                        },
                        y: {
                            title: {
                                display: true,
                                text: 'Retrievability (%)'
                            },
                            min: 0,
                            max: 100
                        }
                    }
                }
            });
        }

        const heatmapContainer = document.getElementById('globalKnowledgeHeatmapContainer');
        if (heatmapContainer) {
            heatmapContainer.innerHTML = '';
            const fragment = document.createDocumentFragment();
            const heatmapLimit = 1000;
            const totalCards = cardDeckPairs.length;
            const cardsForHeatmap = cardDeckPairs.slice(0, heatmapLimit);
            for (const { card, deck } of cardsForHeatmap) {
                const knowledgeState = knowledgeMap.get(String(card.id));
                const isReviewed = knowledgeStateUtils.isKnowledgeStateReviewed(knowledgeState);
                let level = 'unreviewed';
                let retentionPercent = 'Not reviewed';
                let lastReviewedText = 'Never reviewed';

                if (isReviewed) {
                    const retentionValue = calculateRetentionAtDate(knowledgeState, now);
                    const numericRetention = Number.isFinite(retentionValue) ? retentionValue : 0;
                    level = 'very-high';
                    if (numericRetention < 0.40) {
                        level = 'low';
                    } else if (numericRetention < 0.75) {
                        level = 'medium';
                    } else if (numericRetention < 0.90) {
                        level = 'high';
                    }
                    retentionPercent = `${Math.round(numericRetention * 100)}%`;
                    const lastReviewedValue = knowledgeState?.fsrs?.last_review || knowledgeState?.lastReviewed;
                    if (lastReviewedValue) {
                        const date = new Date(lastReviewedValue);
                        if (!Number.isNaN(date.getTime())) {
                            lastReviewedText = `Last reviewed ${date.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}`;
                        }
                    }
                }

                const deckName = deck?.name || 'Untitled deck';
                const trimmedQuestion = (card.question || 'Untitled card').replace(/\s+/g, ' ').trim().substring(0, 80);
                const cell = document.createElement('div');
                cell.className = 'heatmap-cell';
                cell.setAttribute('data-stability-level', level);
                cell.title = `${deckName} • ${trimmedQuestion} • Retention: ${retentionPercent} • ${lastReviewedText}`;
                fragment.appendChild(cell);
            }
            heatmapContainer.appendChild(fragment);

            const summaryText = totalCards > heatmapContainer.childElementCount
                ? `Showing ${Math.min(totalCards, heatmapLimit).toLocaleString('en-GB')} of ${totalCards.toLocaleString('en-GB')} cards`
                : '';
            const summaryId = 'globalHeatmapSummaryCaption';
            const existingSummary = document.getElementById(summaryId);
            if (summaryText) {
                if (existingSummary) {
                    existingSummary.textContent = summaryText;
                } else if (heatmapContainer.parentElement) {
                    const summaryEl = document.createElement('div');
                    summaryEl.id = summaryId;
                    summaryEl.style.cssText = 'text-align: center; font-size: 0.85rem; color: var(--secondary-text); margin-top: 8px;';
                    summaryEl.textContent = summaryText;
                    heatmapContainer.parentElement.appendChild(summaryEl);
                }
            } else if (existingSummary) {
                existingSummary.remove();
            }
        }

        const problemCardsContainer = document.getElementById('globalProblemCardsListContainer');
        if (problemCardsContainer) {
            problemCardsContainer.innerHTML = '';
            const problemEntries = [];
            for (const { card, deck } of cardDeckPairs) {
                const knowledgeState = knowledgeMap.get(String(card.id));
                if (!knowledgeState || !knowledgeStateUtils.isKnowledgeStateReviewed(knowledgeState)) continue;
                const targetDate = cortex.buildTargetDate(deck, now);
                const retentionNow = calculateRetentionAtDate(knowledgeState, now);
                const retentionTarget = calculateRetentionAtDate(knowledgeState, targetDate);
                problemEntries.push({
                    card,
                    deck,
                    targetDate,
                    retentionNow: Number.isFinite(retentionNow) ? retentionNow : 0,
                    retentionTarget: Number.isFinite(retentionTarget) ? retentionTarget : 0
                });
            }

            problemEntries.sort((a, b) => {
                if (a.retentionTarget !== b.retentionTarget) {
                    return a.retentionTarget - b.retentionTarget;
                }
                return a.retentionNow - b.retentionNow;
            });

            const topProblems = problemEntries.slice(0, 15);
            if (!topProblems.length) {
                const message = document.createElement('p');
                message.style.cssText = 'text-align: center; color: var(--secondary-text); padding: 20px 0;';
                message.textContent = 'No problem cards yet…';
                problemCardsContainer.appendChild(message);
            } else {
                const fragment = document.createDocumentFragment();
                for (const entry of topProblems) {
                    const cardItem = document.createElement('div');
                    cardItem.className = 'card-item';
                    cardItem.tabIndex = 0;
                    cardItem.style.cursor = (typeof showDeckDetail === 'function') ? 'pointer' : 'default';

                    const questionEl = document.createElement('div');
                    questionEl.className = 'question';
                    const questionText = (entry.card.question || 'Untitled card').replace(/\s+/g, ' ').trim();
                    questionEl.textContent = questionText;
                    questionEl.title = questionText;

                    const difficultyEl = document.createElement('div');
                    difficultyEl.className = 'difficulty';
                    const nowPercent = Math.round(entry.retentionNow * 100);
                    const targetPercent = Math.round(entry.retentionTarget * 100);
                    const targetLabel = entry.targetDate?.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' }) || '';
                    const deckName = entry.deck?.name || 'Untitled deck';
                    difficultyEl.textContent = `${deckName} • Now: ${nowPercent}% • By target: ${targetPercent}% (${targetLabel})`;

                    if (typeof showDeckDetail === 'function') {
                        cardItem.addEventListener('click', () => showDeckDetail(entry.deck.id));
                        cardItem.addEventListener('keydown', (event) => {
                            if (event.key === 'Enter' || event.key === ' ') {
                                showDeckDetail(entry.deck.id);
                            }
                        });
                    }

                    cardItem.appendChild(questionEl);
                    cardItem.appendChild(difficultyEl);
                    fragment.appendChild(cardItem);
                }
                problemCardsContainer.appendChild(fragment);
            }
        }

        showToast('Global Analytics loaded', 'info');
    } catch (error) {
        console.error('Error rendering global analytics:', error);
        showToast('Failed to load analytics', 'error');
    }
}

function normalizeCardRecord(entry, type) {
    const questionValue = (entry.question || entry.q || entry.term || entry.prompt || '').toString().trim();
    const answerValue = (entry.answer || entry.a || entry.definition || entry.response || '').toString().trim();
    let question = questionValue;
    if (type === 'vocab' && !question && entry.term) {
        question = `Define: ${entry.term}`;
    }
    return { question, answer: answerValue };
}

const DEFAULT_SEQUENCE_TITLE = 'Sequence';
const SEQUENCE_STEP_SOURCES = ['steps', 'sequence', 'items'];
const STEP_PREFIX_REGEX = /^\s*(?:\d+[\.\)]|\(\d+\)|[-\u2013\u2014\u2022\u2023\u2024\u25E6])\s*/;

function convertStepToString(value) {
    if (value === null || value === undefined) return '';
    if (typeof value === 'string' || typeof value === 'number') return String(value);
    if (typeof value === 'object') {
        return String(value.answer || value.term || value.step || value.text || value.label || value.value || value.question || '');
    }
    return '';
}

function cleanStepText(value) {
    const text = convertStepToString(value);
    const sanitized = text.replace(STEP_PREFIX_REGEX, '');
    return sanitized.trim();
}

function splitSteps(value) {
    if (Array.isArray(value)) {
        return value.map(item => cleanStepText(item)).filter(Boolean);
    }
    if (typeof value === 'string') {
        return value.split(/\r?\n/).map(line => cleanStepText(line)).filter(Boolean);
    }
    return [];
}

function hasSequenceSources(entry) {
    if (!entry || typeof entry !== 'object') return false;
    return SEQUENCE_STEP_SOURCES.some(key => entry[key] !== undefined && entry[key] !== null);
}

function hasStepText(entry) {
    if (!entry || typeof entry !== 'object') return false;
    return Boolean(cleanStepText(entry.answer || entry.term || entry.step || entry.text || entry.description || entry.question));
}

function isStepCardShape(entry) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return false;
    if (hasSequenceSources(entry)) return false;
    return hasStepText(entry);
}

function extractSequenceSteps(entry) {
    for (const key of SEQUENCE_STEP_SOURCES) {
        if (entry[key] !== undefined && entry[key] !== null) {
            const steps = splitSteps(entry[key]);
            if (steps.length) return steps;
        }
    }
    return [];
}

function normalizeSequenceObject(entry) {
    if (!entry || typeof entry !== 'object') return null;
    const steps = extractSequenceSteps(entry);
    if (!steps.length) return null;
    const title = (entry.title || entry.name || entry.term || DEFAULT_SEQUENCE_TITLE).toString().trim() || DEFAULT_SEQUENCE_TITLE;
    const description = (entry.description || entry.desc || entry.note || entry.summary || '').toString().trim();
    return {
        _isSequence: true,
        title,
        description,
        steps
    };
}

function createSequenceFromStepCards(entries) {
    const orderedSteps = entries
        .map((entry, idx) => {
            const text = cleanStepText(entry.answer || entry.term || entry.step || entry.text || entry.description);
            if (!text) return null;
            const order = Number.isFinite(entry.order) ? entry.order : idx;
            return { order, text };
        })
        .filter(Boolean)
        .sort((a, b) => a.order - b.order)
        .map(item => item.text);

    if (!orderedSteps.length) return null;
    const meta = entries.find(entry => entry) || {};
    const title = (meta.title || meta.name || DEFAULT_SEQUENCE_TITLE).toString().trim() || DEFAULT_SEQUENCE_TITLE;
    const description = (meta.description || meta.desc || meta.note || '').toString().trim();
    return {
        _isSequence: true,
        title,
        description,
        steps: orderedSteps
    };
}

function normalizeSequenceEntries(entries) {
    if (!Array.isArray(entries)) return [];
    const validEntries = entries.filter(entry => entry !== null && entry !== undefined);
    if (!validEntries.length) return [];

    const simpleStringsOnly = validEntries.every(item => typeof item === 'string' || typeof item === 'number');
    if (simpleStringsOnly) {
        const steps = splitSteps(validEntries);
        if (!steps.length) return [];
        return [{
            _isSequence: true,
            title: DEFAULT_SEQUENCE_TITLE,
            description: '',
            steps
        }];
    }

    const onlyStepCards = validEntries.every(entry => isStepCardShape(entry));
    if (onlyStepCards) {
        const sequence = createSequenceFromStepCards(validEntries);
        return sequence ? [sequence] : [];
    }

    const sequences = validEntries
        .map(entry => normalizeSequenceObject(entry))
        .filter(Boolean);
    return sequences;
}

function normalizeAiDeckResponse(response) {
    if (!response) {
        throw new Error('AI did not return any data.');
    }
    if (Array.isArray(response)) {
        const cards = response
            .map(card => normalizeCardRecord(card, 'flashcard'))
            .map(entry => ({ question: entry.question || '', answer: entry.answer || '' }))
            .filter(card => card.question && card.answer);
        if (!cards.length) {
            throw new Error('AI response did not include usable cards.');
        }
        return { type: 'flashcard', deckName: 'AI Generated Deck', deckNotes: '', language: '', cards };
    }
    if (response.error) {
        throw new Error(response.message || 'AI server error.');
    }
    const type = (response.type || 'flashcard').toLowerCase();
    const deckName = response.deckName || 'AI Generated Deck';
    const deckNotes = response.deckNotes || '';
    const language = response.language || '';

    if (type === 'sequence') {
        const sequenceSources = [response.sequences, response.cards, response.steps, response.items];
        let rawSequenceEntries = null;
        for (const source of sequenceSources) {
            if (Array.isArray(source) && source.length > 0) {
                rawSequenceEntries = source;
                break;
            }
        }
        if (!rawSequenceEntries) {
            throw new Error('AI response did not include usable sequence steps.');
        }
        const sequences = normalizeSequenceEntries(rawSequenceEntries);
        if (!sequences.length) {
            throw new Error('AI response did not include usable sequence steps.');
        }
        return { type, deckName, deckNotes, language, sequences };
    }

    if (type === 'flashcard-legacy' && typeof response.flashcardText === 'string') {
        const cards = response.flashcardText.split('\n').map(line => {
            const parts = line.split('\t');
            if (parts.length !== 2) return null;
            const question = parts[0].trim();
            const answer = parts[1].trim();
            if (!question || !answer) return null;
            return { question, answer };
        }).filter(Boolean);
        if (!cards.length) {
            throw new Error('AI response did not include valid flashcards.');
        }
        return { type: 'flashcard', deckName, deckNotes, language, cards };
    }

    const cardsSource = Array.isArray(response.cards)
        ? response.cards
        : Array.isArray(response.vocab)
            ? response.vocab
            : [];
    if (!cardsSource.length) {
        throw new Error('AI response did not include cards.');
    }
    const cards = cardsSource
        .map(entry => normalizeCardRecord(entry, type))
        .map(card => ({ question: card.question || '', answer: card.answer || '' }))
        .filter(card => card.question && card.answer);
    if (!cards.length) {
        throw new Error('AI response did not include valid cards.');
    }

    return { type: type === 'vocab' ? 'vocab' : 'flashcard', deckName, deckNotes, language, cards };
}

window.toggleCortexDebug = async function () {
    studyState.cortexDebugEnabled = !studyState.cortexDebugEnabled;
    const cortex = await getCortexEngine();
    if (cortex && cortex.setDebug) {
        cortex.setDebug(studyState.cortexDebugEnabled);
    }
    console.log('[Cortex Debug]', studyState.cortexDebugEnabled ? 'ENABLED' : 'DISABLED');
    return studyState.cortexDebugEnabled;
};
