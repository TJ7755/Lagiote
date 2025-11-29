import { state, DEFAULT_DECK_SETTINGS, resetStudyState, resetPracticeTestState, setCurrentDeck, setCurrentMode, updateGlobalSettings, getDeck, getAllDecks, updateDeck, deleteDeck, updateAnalytics } from './state.js';
import { showToast, showView, transitionView, transitionSubView } from './ui.js';
import { initDB, saveDataToDB, getDataFromDB, getAllDataFromDB, deleteDataFromDB, clearStoreInDB } from './db.js';(function () {
    const applyTheme = (isDark) => {
        const target = document.documentElement;
        if (isDark) {
            target.classList.add('dark-mode');
            if (document.body) document.body.classList.add('dark-mode');
        } else {
            target.classList.remove('dark-mode');
            if (document.body) document.body.classList.remove('dark-mode');
        }
    };

    const systemDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;

    applyTheme(systemDark);
})();
function loadCDNScript(src, onload) {
    if (!navigator.onLine) {
        console.warn('Offline: Skipping CDN script', src);
        if (onload) onload();
        return;
    }
    const script = document.createElement('script');
    script.src = src;
    script.onerror = () => {
        console.warn('Failed to load CDN script:', src);
        if (onload) onload();
    };
    if (onload && !src.includes('module')) {
        script.onload = onload;
    }
    document.head.appendChild(script);
}
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
                    await store.put({
                        id: 'pending_events',
                        events: this.eventQueue,
                        lastUpdated: new Date().toISOString()
                    });
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
                    const fetchOptions = {
                        method: 'POST',
                        headers: headers,
                        body: JSON.stringify({ events: eventsToSend })
                    };

                    if (sync) {
                        // Use sendBeacon for synchronous unload
                        const blob = new Blob([JSON.stringify({ events: eventsToSend })], { type: 'application/json' });
                        navigator.sendBeacon(endpoint, blob);
                    } else {
                        const response = await fetch(endpoint, fetchOptions);

                        if (!response.ok) {
                            console.warn(`Analytics batch failed: ${response.status}`);
                            // Re-queue events on failure
                            this.eventQueue.unshift(...eventsToSend);
                        } else {
                            // Clear persisted queue on success
                            await this.clearPersistedQueue();
                        }
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
                    await store.delete('pending_events');
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

                return function (quality) {
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
                setupEventListeners();
                document.getElementById('appHeader').classList.remove('hidden');
                document.getElementById('loggedInView').classList.remove('hidden');
                showView('dashboard', true);
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
            console.log('🔧 handleGuestToUserTransition called – no migration logic defined yet.');
        }

        );
                                if (deckNeedsUpdate) {
                                    deckStore.put(deck);
                                }
                            });
                            console.log("Cognitive engine migration complete.");
                        };
                    }
                };
            });
        }

        let currentInteractionLog = {};

        function startInteractionLog(cardID) {
            currentInteractionLog = {
                cardID: cardID,
                questionLoadTime: performance.now(),
                firstKeyPressTime: null,
                backspaceCount: 0,
                deleteCount: 0,
                attemptCount: (studyState.isRetypingIncorrect ? 2 : 1),
                awayDuration: accumulatedAwayDuration
            };

            accumulatedAwayDuration = 0;
        }

        function handleInteractionLogging(e) {
            if (currentInteractionLog.firstKeyPressTime === null && e.key.length === 1) {
                currentInteractionLog.firstKeyPressTime = performance.now();
            }

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
                    synced: false
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
                const timeToFirstKeystroke = currentInteractionLog.firstKeyPressTime
                    ? Math.round(currentInteractionLog.firstKeyPressTime - currentInteractionLog.questionLoadTime)
                    : null;

                const typingDuration = currentInteractionLog.firstKeyPressTime
                    ? performance.now() - currentInteractionLog.firstKeyPressTime
                    : 0;

                const typingSpeed = logData.userAnswer && typingDuration > 0
                    ? (logData.userAnswer.length / (typingDuration / 1000))
                    : 0;

                analyticsManager.trackCardAttempt(logData.cardID, {
                    timeToFirstKeystroke,
                    typingSpeed,
                    pauseCount: 0, // TODO: Track pauses in typing
                    backspaceCount: currentInteractionLog.backspaceCount || 0,
                    deleteCount: currentInteractionLog.deleteCount || 0,
                    hintUsed: false, // TODO: Track hint usage
                    attemptNumber: logData.attemptCount || 1,
                    wasCorrect: logData.wasCorrect,
                    partialAnswer: logData.userAnswer,
                    questionType: logData.questionType || 'flashcard'
                });

                // Track error pattern if incorrect
                if (!logData.wasCorrect && logData.userAnswer && logData.correctAnswer) {
                    const similarity = levenshteinDistance(logData.userAnswer, logData.correctAnswer);
                    const maxLen = Math.max(logData.userAnswer.length, logData.correctAnswer.length);
                    const similarityScore = maxLen > 0 ? 1 - (similarity / maxLen) : 0;

                    let errorType = 'complete_miss';
                    if (similarityScore > 0.8) errorType = 'typo';
                    else if (similarityScore > 0.5) errorType = 'partial';
                    else if (similarity === 1) errorType = 'substitution';

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

        async function showInternalAnalytics() {
            showView('internalAnalyticsView');

            try {
                const [allLogs, allKnowledgeStates] = await Promise.all([
                    getAllDataFromDB('interactionLogs'),
                    getAllDataFromDB('userKnowledgeState')
                ]);


                if (!allLogs || allLogs.length === 0) {
                    console.warn("No interaction logs found to generate analytics.");
                    document.getElementById('latencyHistogram').parentNode.innerHTML = '<p style="text-align: center; color: var(--secondary-text);">No interaction data available yet.</p>';
                    document.getElementById('fluencyHistogram').parentNode.innerHTML = '<p style="text-align: center; color: var(--secondary-text);">No interaction data available yet.</p>';
                    document.getElementById('correctionsHistogram').parentNode.innerHTML = '<p style="text-align: center; color: var(--secondary-text);">No interaction data available yet.</p>';
                    document.getElementById('latencyScatterPlot').parentNode.innerHTML = '<p style="text-align: center; color: var(--secondary-text);">No interaction data available yet.</p>';
                    document.getElementById('deckStatisticsResult').innerHTML = '<p>No interaction data available yet.</p>';
                    return;
                }

                renderHistograms(allLogs);
                renderLatencyScatterPlot(allLogs);
                renderInteractionsTimeSeries(allLogs);

                setupErrorAnalysisAndDeckStats(allLogs, allKnowledgeStates);

            } catch (error) {
                console.error("Failed to fetch data for analytics:", error);

                showToast("Error loading analytics data. Please try again later.", "error");
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

            const isSequence = selectedDeck.typeHint === 'Sequence';

            const cardStats = selectedDeck.cards.map(card => {
                const knowledgeState = knowledgeMap.get(String(card.id));
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
                    masteryScore: knowledgeState?.masteryScore,
                    lastReviewed: knowledgeState?.lastReviewed ? new Date(knowledgeState.lastReviewed).toLocaleDateString() : 'Never',
                    order: card.order || Infinity
                };
                console.log('[Test 3] Final calculated stat object:', stat);
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
                            <th>Mastery</th>
                            <th>Last Reviewed</th>
                            <th>Interactions</th>
                        </tr>
                    </thead>
                    <tbody>
            `;

            cardsForStats.forEach(stat => {
                const stabilityText = typeof stat.stability === 'number' ? stat.stability.toFixed(2) : 'N/A';
                const masteryText = typeof stat.masteryScore === 'number' ? stat.masteryScore.toFixed(2) : 'N/A';

                tableHTML += `
                    <tr>
                        ${isSequence ? `<td>${stat.order}</td>` : ''}
                        <td title="${stat.question}">${stat.question}</td>
                        <td>${stat.correctPercentage.toFixed(1)}%</td>
                        <td>${(stat.avgIQS).toFixed(2)}</td>
                        <td>${stabilityText}</td>
                        <td>${masteryText}</td>
                        <td>${stat.lastReviewed}</td>
                        <td>${stat.totalInteractions}</td>
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

            const ctx = document.getElementById(canvasId).getContext('2d');

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
                const ctx = document.getElementById(canvasId).getContext('2d');
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
                document.getElementById(canvasId).parentNode.innerHTML += '<p style="text-align: center; color: var(--secondary-text); margin-top: 10px;">No data available for scatter plot.</p>';
                return;
            }

            const ctx = document.getElementById(canvasId).getContext('2d');
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

            const ctx = document.getElementById(canvasId).getContext('2d');
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

        
        }

        
        }

        
        }

        
        }

        
        }

        function setupEventListeners() {
            console.log('[DEBUG] setupEventListeners called - attaching all event listeners');

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

                const appHeader = document.getElementById('appHeader');
                if (appHeader) {
                    appHeader.classList.remove('hidden');
                }
                showView('dashboard');
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
            
            // Deck detail buttons
            const deleteBtn = document.getElementById('deckDetailDeleteBtn');
            console.log('[DEBUG] deckDetailDeleteBtn element found:', !!deleteBtn);
            if (deleteBtn) {
                deleteBtn.addEventListener('click', () => {
                    console.log('[DEBUG] Delete deck button clicked, currentViewingDeckId:', currentViewingDeckId);
                    deleteDeck(currentViewingDeckId);
                });
                console.log('[DEBUG] Delete button listener attached');
            }
            
            document.getElementById('deckDetailTestBtn').addEventListener('click', () => openPracticeTestModal(currentViewingDeckId));
            document.getElementById('deckDetailEditBtn').addEventListener('click', () => editDeck(currentViewingDeckId));
            document.getElementById('deckDetailSettingsBtn').addEventListener('click', () => openDeckSettingsModal(currentViewingDeckId));
            document.getElementById('headerBackBtn').addEventListener('click', goBack);
            const nameForm = document.getElementById('nameForm');
            if (nameForm) {
                nameForm.addEventListener('submit', saveName);
            }
            document.getElementById('darkModeToggle').addEventListener('change', toggleDarkMode);
            document.getElementById('deckDetailResetBtn').addEventListener('click', () => resetSpecificDeck(currentViewingDeckId));
            document.getElementById('continueBtn').addEventListener('click', continueStudy);
            document.getElementById('instructionsBtn').addEventListener('click', () => document.getElementById('instructionsModal').classList.add('show'));
            document.getElementById('accentToggleBtn').addEventListener('click', toggleAccentButtons);
            document.getElementById('testAccentToggleBtn').addEventListener('click', toggleTestAccentButtons);
            document.getElementById('switchStudyModeBtn').addEventListener('click', toggleStudyMode);
            document.getElementById('editStudyCardBtn').addEventListener('click', editCurrentStudyCard);
            document.getElementById('writeAnswerInput').addEventListener('keydown', (e) => {
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
            document.addEventListener('keydown', function (event) {
                const practiceTestView = document.getElementById('practiceTestView');
                if (practiceTestView.classList.contains('hidden')) {
                    return;
                }

                if (event.key === 'Enter' || event.key === 'ArrowUp') {
                    const nextBtn = document.getElementById('testNextBtn');
                    const checkBtn = document.getElementById('testCheckAnswerBtn');
                    const showAnswerBtn = document.getElementById('testShowAnswerBtn');
                    if (!nextBtn.classList.contains('hidden')) {
                        event.preventDefault();
                        nextBtn.click();
                    }
                    else if (!checkBtn.classList.contains('hidden')) {
                        if (event.target === document.getElementById('testAnswerInput')) {
                            event.preventDefault();
                        }
                        checkBtn.click();
                    }
                    else if (!showAnswerBtn.classList.contains('hidden')) {
                        event.preventDefault();
                        showAnswerBtn.click();
                    }
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
            document.getElementById('flashcardsContainer').addEventListener('keydown', async function (event) {
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
            document.addEventListener('keydown', function (event) {
                const practiceTestView = document.getElementById('practiceTestView');
                if (practiceTestView.classList.contains('hidden')) {
                    return;
                }

                if (event.key === 'Enter' || 'ArrowUp') {
                    const nextBtn = document.getElementById('testNextBtn');
                    const checkBtn = document.getElementById('testCheckAnswerBtn');
                    const showAnswerBtn = document.getElementById('testShowAnswerBtn');
                    if (!nextBtn.classList.contains('hidden')) {
                        event.preventDefault();
                        nextBtn.click();
                    }
                    else if (!checkBtn.classList.contains('hidden')) {
                        if (event.target === document.getElementById('testAnswerInput')) {
                            event.preventDefault();
                        }
                        checkBtn.click();
                    }
                    else if (!showAnswerBtn.classList.contains('hidden')) {
                        event.preventDefault();
                        showAnswerBtn.click();
                    }
                }
            });
            document.getElementById('testInstructionsBtn').addEventListener('click', () => {
                showToast("Practice test instructions would appear here", "info");
            });

            ['deckCategory'].forEach(id => {
                document.getElementById(id).addEventListener('change', handleCategoryChange);
            });

            document.getElementById('importFileInput').addEventListener('change', function () {
                const fileNameDisplay = document.getElementById('fileNameDisplay');
                if (this.files.length > 0) {
                    fileNameDisplay.textContent = this.files[0].name;
                } else {
                    fileNameDisplay.textContent = 'No file chosen';
                }
            });
            document.getElementById('writeAnswerInput').addEventListener('keydown', handleInteractionLogging);

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

            dropZone.addEventListener('dragover', (e) => { e.preventDefault(); dropZone.classList.add('dragover'); });
            dropZone.addEventListener('dragleave', () => dropZone.classList.remove('dragover'));
            dropZone.addEventListener('drop', (e) => {
                e.preventDefault();
                dropZone.classList.remove('dragover');
                handleAiFiles(e.dataTransfer.files);
            });
            selectFileBtn.addEventListener('click', () => fileInput.click());
            fileInput.addEventListener('change', () => handleAiFiles(fileInput.files));
            document.getElementById('add-text-btn').addEventListener('click', addTextAsDocument);
            document.getElementById('process-btn').addEventListener('click', processAllDocuments);

            // Profile button handler using event delegation
            document.addEventListener('click', (e) => {
                const btn = e.target.closest('#userProfileBtn');
                if (btn) {
                    console.log('Profile button clicked (delegated)!');
                    e.stopPropagation();
                    const dropdown = document.getElementById('userProfileDropdown');
                    if (dropdown) {
                        dropdown.classList.toggle('hidden');
                        console.log('Dropdown toggled, hidden:', dropdown.classList.contains('hidden'));
                    }
                } else {
                    // Close dropdown when clicking outside
                    const dropdown = document.getElementById('userProfileDropdown');
                    if (dropdown && !dropdown.classList.contains('hidden') && !e.target.closest('#userProfileDropdown')) {
                        dropdown.classList.add('hidden');
                    }
                }
            });

            /* 
            // Old direct listener removed in favor of delegation
            const profileBtn = document.getElementById('userProfileBtn');
            const profileDropdown = document.getElementById('userProfileDropdown');
            if (profileBtn) { ... } 
            */

            const logoutBtn = document.getElementById('logoutBtn');
            console.log('[DEBUG] logoutBtn element found:', !!logoutBtn);
            if (logoutBtn) {
                logoutBtn.addEventListener('click', async (e) => {
                    e.preventDefault();
                    console.log('[DEBUG] Logout button clicked, e.type:', e.type);
                    console.log('[DEBUG] Logout button element:', e.target);
                    try {
                        console.log('[DEBUG] Calling logout function');
                        await logout();
                        console.log('[DEBUG] Logout completed successfully');
                    } catch (error) {
                        console.error('[DEBUG] Logout error:', error);
                        console.error('[DEBUG] Logout error stack:', error.stack);
                        showToast('Logout failed. Please try again.', 'error');
                    }
                });
                console.log('[DEBUG] Logout button listener attached');
            }

            // Sync button handler
            const syncBtn = document.getElementById('syncBtn');
            console.log('[DEBUG] syncBtn element found:', !!syncBtn);
            if (syncBtn) {
                syncBtn.addEventListener('click', async (e) => {
                    e.preventDefault();
                    console.log('[DEBUG] Sync button clicked, e.type:', e.type);
                    console.log('[DEBUG] Sync button element:', e.target);
                    console.log('[DEBUG] isOnline:', isOnline);
                    try {
                        if (isOnline) {
                            console.log('[DEBUG] Online detected, starting sync');
                            showToast('Syncing your data...', 'info');
                            console.log('[DEBUG] Calling loadUserDataAndSync');
                            await loadUserDataAndSync();
                            console.log('[DEBUG] Sync completed successfully');
                        } else {
                            console.log('[DEBUG] App is offline');
                            showToast('You are offline. Please connect to the internet to sync.', 'warning');
                        }
                    } catch (error) {
                        console.error('[DEBUG] Manual sync error:', error);
                        console.error('[DEBUG] Sync error stack:', error.stack);
                        showToast('Sync failed. Please try again.', 'error');
                    }
                });
                console.log('[DEBUG] Sync button listener attached');
            }

            document.getElementById('deckTypeHint').addEventListener('change', (e) => {
                toggleEditorView(e.target.value);
            });

            window.addEventListener('click', (e) => {
                const dropdown = document.getElementById('userProfileDropdown');
                if (!dropdown.classList.contains('hidden') && !e.target.closest('#userProfileMenu')) {
                    dropdown.classList.add('hidden');
                }
            });

            // Setup system theme detection
            setupSystemThemeListener();
        }

        
            }
            toastQueue.push({ message, type, duration, icon });
            if (!isToastVisible) {
                processToastQueue();
            }
        }

        function handleNextCard() {
            const card = studyState.roundCards[studyState.currentCardIndex];
            document.getElementById('nextBtn').classList.add('hidden');
            document.getElementById('feedbackMessage').innerHTML = '';

            const questionTypeForLog = document.getElementById('mcqView').classList.contains('hidden') ? 'Type' : 'MultipleChoice';
            moveCard(card, false, questionTypeForLog);
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
                    const masteredCount = knowledgeStates.filter(s => cardIdsInDeck.has(s.cardID) && s.masteryScore >= 0.95).length;

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

        

            if (isInitial) {
                nextView.classList.remove('hidden');
                nextView.classList.add('is-visible');
                activeView = viewId;
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
            window.scrollTo(0, 0);

            if (callback) callback();
        }

        
            if (!isInitial && activeView !== viewId && viewId !== 'dashboard') {
                if (viewHistory[viewHistory.length - 1] !== activeView) {
                    viewHistory.push(activeView);
                }
            }

            const currentView = document.getElementById(activeView);
            const nextView = document.getElementById(viewId);

            const isDashboard = viewId === 'dashboard';
            document.querySelector('.search-bar').style.display = isDashboard ? 'flex' : 'none';
            document.getElementById('headerSettingsBtn').style.display = isDashboard ? 'flex' : 'none';
            document.getElementById('headerBackBtn').classList.toggle('hidden', viewHistory.length === 0 || isDashboard);
            document.getElementById('headerHomeBtn').classList.toggle('hidden', isDashboard);

            document.getElementById('headerHomeBtn').classList.toggle('hidden', isDashboard);

            if (isInitial) {
                if (currentView) currentView.classList.remove('fade-in', 'fade-out', 'animating');
                nextView.classList.add('fade-in', 'animating');
                activeView = viewId;
                if (callback) callback();
                return;
            }

            if (currentView) {
                currentView.classList.add('fade-out', 'animating');
                currentView.classList.remove('fade-in');

                setTimeout(() => {
                    currentView.style.display = 'none';
                    currentView.classList.remove('fade-out', 'animating');
                    nextView.style.display = 'block';
                    nextView.classList.add('fade-in', 'animating');
                    activeView = viewId;
                    window.scrollTo(0, 0);
                    if (callback) callback();
                }, 400);
            }
        }

        
                }, 400);
            } else if (nextElem) {
                nextElem.classList.remove('hidden');
                nextElem.classList.add('sub-view-fade-in', 'animating');
            }
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
                transitionView(previousView);
            } else {
                backToDashboard(true);
            }
        }

        function showEditor() {
            showView('editorView');
            editorInitialise();

            const container = document.getElementById('flashcardsContainer');
            if (sortableInstance) {
                sortableInstance.destroy();
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
            showView('settingsView');
        }

        async function backToDashboard(isFromLogo = false) {
            if (activeView === 'editorView' && !isEditorClean()) {
                showConfirmModal(
                    'You have unsaved changes. Are you sure you want to leave?',
                    async () => {

                        if (isFromLogo) {

                            if (currentDeckId && currentMode) endSession();

                            window.location.reload();
                            return;
                        }
                        transitionView('dashboard');
                        if (currentDeckId && currentMode) endSession();
                        resetDashboardState(true);
                    }
                );
                return;
            }

            if (activeView !== 'dashboard') {
                if (currentDeckId && currentMode) await endSession();
                if (isFromLogo) {

                    if (currentDeckId && currentMode) await endSession();
                    window.location.reload();
                    return;
                } else {
                    showView('dashboard', false, () => resetDashboardState(isFromLogo));
                }
            } else {
                if (isFromLogo) {

                    window.location.reload();
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

            document.getElementById('headerBackBtn').classList.toggle('hidden', viewHistory.length === 0);
        }

        async function loadSavedData() {
            const settings = await getDataFromDB('appData', 'userSettings');
            globalSettings = settings || {};
            if (globalSettings.showAccents === undefined) {
                globalSettings.showAccents = true;
            }
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
            const sm2 = new SM2Algorithm();
            savedDecks.forEach(deck => {
                deck.cards.forEach(card => {
                    if (!card.sm2Data) {
                        card.sm2Data = sm2.calculateNextReview(card)(3);
                    }
                    // Ensure each card has a reference to its deck
                    if (!card.deckId) {
                        card.deckId = deck.id;
                    }
                });
                decks[deck.id] = deck;
            });

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

            if (globalSettings.hideExamPlanBanner === true) {
                ctaContainer.classList.add('hidden');
                footerBtn.classList.remove('hidden');
            } else {
                ctaContainer.classList.remove('hidden');
                footerBtn.classList.add('hidden');
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
                categoryFolder.innerHTML = `<h3 class="category-title">${category}</h3><div class="decks-grid"></div>`;
                const decksGrid = categoryFolder.querySelector('.decks-grid');

                const sortedDecks = groupedDecks[category].sort((a, b) => new Date(b.created) - new Date(a.created));

                decksGrid.innerHTML = sortedDecks.map(deck => {
                    const totalCards = deck.cards.length;
                    let progressPercent = 0;
                    if (totalCards > 0) {
                        const hasExamDate = deck.settings && deck.settings.examDate;
                        const targetRetention = (deck.settings && deck.settings.targetRetention) || 0.8;
                        const examDate = hasExamDate ? new Date(deck.settings.examDate) : null;

                        let totalScore = 0;
                        deck.cards.forEach(card => {
                            const state = knowledgeMap.get(card.id);
                            if (hasExamDate) {
                                // Use retention for exam mode
                                const retention = calculateRetentionAtDate(state, examDate);
                                const score = retention / targetRetention;
                                totalScore += Math.min(1, score);
                            } else {
                                // Use standard mastery score
                                const mastery = state?.masteryScore || 0.5;
                                totalScore += mastery;
                            }
                        });
                        progressPercent = (totalScore / totalCards) * 100;
                    }

                    let actionButtonsHTML;
                    if (deck.typeHint === 'Sequence') {
                        actionButtonsHTML = `
                        <button class="action-btn learn-btn" style="grid-column: 1 / 3;" onclick="event.stopPropagation(); startSequenceSession('${deck.id}')">
                            Learn Sequence
                        </button>
                    `;
                    } else {
                        actionButtonsHTML = `
                        <button class="action-btn learn-btn" onclick="event.stopPropagation(); configureStudy('learn', '${deck.id}')">Learn</button>
                        <button class="action-btn review-btn" onclick="event.stopPropagation(); configureStudy('review', '${deck.id}')">Review</button>
                    `;
                    }

                    return `<div class="deck-card" data-category="${category}" data-deck-id="${deck.id}">
                    <div class="deck-card-main-clickable" onclick="showDeckDetail('${deck.id}', this.parentElement)">
                        <div class="deck-header">
                            <div class="deck-category">${category}</div>
                            <div class="deck-name">${deck.name}</div>
                            <div class="deck-info"><span>${totalCards} cards</span></div>
                        </div>
                        <div class="deck-progress-container">
                            <div class="deck-progress-label"><span>Progress</span><span>${Math.round(progressPercent)}%</span></div>
                            <div class="deck-progress-bar-outer"><div class="deck-progress-bar-inner" style="width: ${progressPercent}%;"></div></div>
                        </div>
                        <div class="deck-date">Created: ${formatDate(deck.created)}</div>
                    </div>
                    <div class="deck-actions">
                        ${actionButtonsHTML}
                        <button class="action-btn export-btn" title="Export Deck" onclick="exportDeck('${deck.id}', event)">
                            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" width="18" height="18"><path stroke-linecap="round" stroke-linejoin="round" d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5M16.5 12 12 16.5m0 0L7.5 12m4.5 4.5V3" /></svg>
                        </button>
                    </div>
                </div>`;
                }).join('');
                decksContainer.appendChild(categoryFolder);
            }

            updateDueCardCounts();

            const internalBtn = document.getElementById('internalDashboardBtn');
            if (globalSettings.devMode === true) {
                internalBtn.classList.remove('hidden');
            } else {
                internalBtn.classList.add('hidden');
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
            showView('dashboard');

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
                    const newBadge = card.isNew ? '<span class="new-badge">New</span>' : '';

                    const questionImageHTML = card.questionImage ? `<img src="${card.questionImage}" class="card-image">` : '';
                    const answerImageHTML = card.answerImage ? `<img src="${card.answerImage}" class="card-image">` : '';

                    const orderText = card.order ? `${card.order}. ` : `${index + 1}. `;

                    cardItem.innerHTML = `<div class="deck-card-content">
                        <div class="deck-card-question">${orderText}${card.question} ${newBadge}</div>
                        ${questionImageHTML}
                        <div class="deck-card-answer">${card.answer}</div>
                        ${answerImageHTML}
                    </div>
                    <div class="deck-card-actions">
                        <button class="deck-card-action-btn edit" title="Edit Card" onclick="editCard('${deckId}', ${originalIndex}, 'detail')"><svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" width="16" height="16"><path stroke-linecap="round" stroke-linejoin="round" d="m16.862 4.487 1.687-1.688a1.875 1.875 0 1 1 2.652 2.652L10.582 16.07a4.5 4.5 0 0 1-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 0 1 1.13-1.897l8.932-8.931Zm0 0L19.5 7.125M18 14v4.75A2.25 2.25 0 0 1 15.75 21H5.25A2.25 2.25 0 0 1 3 18.75V8.25A2.25 2.25 0 0 1 5.25 6H10" /></svg></button>
                        <button class="deck-card-action-btn delete" title="Delete Card" onclick="deleteCardFromDetail('${deckId}', ${originalIndex})"><svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" width="16" height="16"><path stroke-linecap="round" stroke-linejoin="round" d="m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0" /></svg></button>
                    </div>`;
                    cardsList.appendChild(cardItem);
                });
            }

            document.getElementById('decksSection').classList.add('hidden');
            document.querySelector('.create-section').classList.add('hidden');
            document.getElementById('deckDetailView').classList.remove('hidden');

            document.getElementById('headerBackBtn').classList.remove('hidden');
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
            const newQuestion = document.getElementById('editCardQuestion').value.trim();
            const newAnswer = document.getElementById('editCardAnswer').value.trim();

            if (newQuestion && newAnswer) {
                const originalCard = deck.cards[cardIndex];
                originalCard.question = newQuestion;
                originalCard.answer = newAnswer;

                if (from === 'study') {
                    const updateCardInArray = (arr) => {
                        const idx = arr.findIndex(c => c.id === originalCard.id);
                        if (idx > -1) arr[idx] = { ...arr[idx], question: newQuestion, answer: newAnswer };
                    };

                    if (currentMode === 'learn') {
                        studyState.buckets.forEach(bucket => updateCardInArray(bucket));
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
            console.log('[DEBUG] deleteCardFromDetail called with deckId:', deckId, 'cardIndex:', cardIndex);
            const deck = decks[deckId];
            console.log('[DEBUG] Deck found:', !!deck);
            if (!deck || !deck.cards[cardIndex]) {
                console.log('[DEBUG] Deck or card not found, returning');
                return;
            }

            showConfirmModal('Are you sure you want to delete this card?', async () => {
                console.log('[DEBUG] deleteCardFromDetail confirm callback executed');
                try {
                    console.log('[DEBUG] Splicing card at index:', cardIndex);
                    deck.cards.splice(cardIndex, 1);
                    console.log('[DEBUG] Card spliced, saving to database');
                    await saveDataToDB('decks', deck);
                    console.log('[DEBUG] Deck saved to database');
                    
                    if (isOnline) {
                        const auth0Session = localStorage.getItem('auth0Session');
                        console.log('[DEBUG] isOnline:', isOnline, 'auth0Session:', !!auth0Session);
                        if (auth0Session) {
                            console.log('[DEBUG] Syncing after card deletion');
                            await loadUserDataAndSync();
                            console.log('[DEBUG] Sync completed after card deletion');
                        }
                    }
                    console.log('[DEBUG] Showing deck detail and updating dashboard');
                    showDeckDetail(deckId);
                    updateDashboard();
                    showToast('Card deleted.', 'success');
                    console.log('[DEBUG] Card deletion completed successfully');
                } catch (error) {
                    console.error('[DEBUG] Error deleting card:', error);
                    console.error('[DEBUG] Error stack:', error.stack);
                    showToast(`Failed to delete card: ${error.message}`, 'error');
                    throw error;
                }
            });
        }

        function setupSearch() {
            document.getElementById('searchInput').addEventListener('input', function () {
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
            });
        }

        async function createNewDeck(name, category, cards, notes = '', typeHint = 'General') {
            const deckId = Date.now().toString();

            const settings = {
                ...DEFAULT_DECK_SETTINGS,
                learnMode: 'write',
                reviewMode: 'flashcard',
                adaptiveModes: { auto: true, mcq: true, cloze: true }
            };

            const tempDeck = { name, category, cards, notes, typeHint };
            showToast("Analysing new deck content…", "info", 2000);
            await processDeckContent(tempDeck);

            const sm2 = new SM2Algorithm();
            const processedCards = tempDeck.cards.map(c => ({
                ...c,
                deckId: deckId,
                sm2Data: sm2.calculateNextReview(c)(3)
            }));

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
                stateStore.put({
                    userID: 'default_user',
                    cardID: card.id,
                    masteryScore: 0.5,
                    stability: 1.0,
                    lastReviewed: new Date().toISOString(),
                    recallHistory: []
                });
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
            showView('editorView');
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
            console.log('[DEBUG] deleteDeck called with deckId:', deckId);
            console.log('[DEBUG] decks object keys:', Object.keys(decks));
            console.log('[DEBUG] currentViewingDeckId:', currentViewingDeckId);
            
            const deckName = decks[deckId]?.name || 'this deck';
            console.log('[DEBUG] deckName:', deckName);
            
            showConfirmModal(`Are you sure you want to permanently delete the deck "${deckName}"? This action cannot be undone.`, async () => {
                console.log('[DEBUG] Confirm callback for deleteDeck executed');
                try {
                    console.log('[DEBUG] Starting deck deletion process for:', deckId);
                    console.log('[DEBUG] Deck exists in decks object:', deckId in decks);
                    
                    delete decks[deckId];
                    console.log('[DEBUG] Deleted from decks object, remaining decks:', Object.keys(decks));
                    
                    await deleteDataFromDB('decks', deckId);
                    console.log('[DEBUG] Deleted from database');

                    // Navigate back to dashboard if viewing deleted deck
                    if (currentViewingDeckId === deckId) {
                        console.log('[DEBUG] Was viewing deleted deck, going back to dashboard');
                        backToDashboard();
                    } else {
                        console.log('[DEBUG] Updating dashboard after deletion');
                        updateDashboard();
                    }

                    console.log('[DEBUG] About to show success toast');
                    showToast(`Deck "${deckName}" deleted.`, 'success');

                    // Sync if online and authenticated (check auth0Session instead of userToken)
                    const auth0Session = localStorage.getItem('auth0Session');
                    console.log('[DEBUG] isOnline:', isOnline, 'auth0Session:', !!auth0Session);
                    if (isOnline && auth0Session) {
                        console.log('[DEBUG] Syncing after deck deletion');
                        await loadUserDataAndSync();
                        console.log('[DEBUG] Sync completed after deck deletion');
                    }
                    console.log('[DEBUG] Deck deletion completed successfully');
                } catch (error) {
                    console.error('[DEBUG] Error deleting deck:', error);
                    console.error('[DEBUG] Error stack:', error.stack);
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

            const questionImagePreview = questionImage ? `<img src="${questionImage}">` : '';
            const answerImagePreview = answerImage ? `<img src="${answerImage}">` : '';

            const deckType = document.getElementById('deckTypeHint').value;
            const cardNumber = document.querySelectorAll('.flashcard-editor-row').length + 1;

            const orderInputHTML = (deckType === 'Sequence')
                ? `<input type="number" class="card-order-input" value="${order || cardNumber}" style="width: 60px; margin-right: 10px; padding: 5px 8px; text-align: center;">`
                : '';

            newRow.innerHTML = `<div class="flashcard-item" data-original-id="${id || ''}">
                <div class="flashcard-number" style="display: flex; align-items: center;">
                    ${orderInputHTML}
                    <span>${cardNumber}.</span>
                </div>
                
                <textarea class="question-input" placeholder="Question (e.g., The event or item in the sequence)" data-card-id="${editorCardCounter}">${question}</textarea>
                <div class="editor-accent-buttons accent-buttons" style="margin-top: 8px;"></div>
                <div class="image-controls">
                    <button class="btn btn-secondary" style="padding: 5px 10px; font-size: 12px;" onclick="triggerImageUpload(this)" tabindex="-1">Upload Image</button>
                </div>
                <div class="question-image-preview image-preview">${questionImagePreview}</div>
                <input type="file" class="image-upload-input" accept="image/*" style="display:none;" onchange="handleImageFile(this)">
                <input type="hidden" class="question-image-input" value="${questionImage}">
                
                <textarea class="solution-input" placeholder="Answer (e.g., The name of the event or item)" style="margin-top:20px;" data-card-id="${editorCardCounter}">${answer}</textarea>
                <div class="editor-accent-buttons accent-buttons" style="margin-top: 8px;"></div>
                <div class="image-controls">
                    <button class="btn btn-secondary" style="padding: 5px 10px; font-size: 12px;" onclick="triggerImageUpload(this)" tabindex="-1">Upload Image</button>
                </div>
                <div class="answer-image-preview image-preview">${answerImagePreview}</div>
                <input type="file" class="image-upload-input" accept="image/*" style="display:none;" onchange="handleImageFile(this)">
                <input type="hidden" class="answer-image-input" value="${answerImage}">
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
                        value="${answer}" 
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
                    >${question}</textarea>
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
                    preview.innerHTML = `<img src="${compressedUrl}">`;
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
                        preview.innerHTML = `<img src="${dataUrl}">`;
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
                            id: originalId || Date.now() + Math.random(),
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
                            id: originalId ? originalId : Date.now() + Math.random(),
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
                                stateStore.put({
                                    userID: 'default_user',
                                    cardID: card.id,
                                    masteryScore: 0.5,
                                    stability: 1.0,
                                    lastReviewed: new Date().toISOString(),
                                    recallHistory: []
                                });
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
                categories.forEach(cat => dropdown.innerHTML += `<option value="${cat}">${cat}</option>`);
                dropdown.innerHTML += `<option value="add_new_category" style="font-style: italic;">+ Add New Category...</option>`;
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
                if (playPauseBtn) playPauseBtn.textContent = '▶ Start';
            } else {
                pomodoroState.isRunning = true;
                if (playPauseBtn) playPauseBtn.textContent = '⏸ Pause';
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
            if (playPauseBtn) playPauseBtn.textContent = '▶ Start';
            document.getElementById('pomodoroTimer').style.background = 'rgba(0,0,0,0.05)';
        }

        function completePomodoroPhase() {
            clearInterval(pomodoroState.intervalId);
            pomodoroState.isRunning = false;
            const playPauseBtn = document.getElementById('pomodoroPlayPause');
            if (playPauseBtn) playPauseBtn.textContent = '▶ Start';

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

        }

        async function startLearnMode(deckId) {
            currentMode = 'learn';
            currentDeckId = deckId;
            const deck = decks[deckId];

            // Ensure defaults
            deck.settings = { ...DEFAULT_DECK_SETTINGS, ...(deck.settings || {}) };

            // Show/Hide Edit Button based on settings
            const editBtn = document.getElementById('editStudyCardBtn');
            if (globalSettings.enableInStudyEditing) {
                editBtn.classList.remove('hidden');
            } else {
                editBtn.classList.add('hidden');
            }

            // Fetch latest knowledge states
            const allKnowledge = await getAllDataFromDB('userKnowledgeState');
            studyState.knowledgeStates = new Map(allKnowledge.map(k => [k.cardID, k]));

            const allCards = deck.cards;
            let candidates = [];

            // Check for Exam Mode
            const examDateObj = deck.settings.examDate ? new Date(deck.settings.examDate) : null;
            if (examDateObj) examDateObj.setHours(23, 59, 59, 999);

            const isExamInFuture = examDateObj && (examDateObj > new Date());

            if (deck.settings.examDate && isExamInFuture) {
                const examDate = new Date(deck.settings.examDate);
                const targetRetention = deck.settings.targetRetention || 0.8;

                candidates = allCards.filter(c => {
                    const state = studyState.knowledgeStates.get(c.id);
                    if (!state) return true;

                    // Force review if mastery is very low
                    if (state.masteryScore < 0.5) return true;

                    const retention = calculateRetentionAtDate(state, examDate);
                    c.projectedRetention = retention;
                    return retention < targetRetention;
                });

                // --- FIX: Overlearning Fallback for Exam Mode ---
                if (candidates.length === 0 && allCards.length > 0) {
                    showToast("Target retention met! Reviewing all cards (Overlearning).", "success");
                    candidates = [...allCards];
                }
                // ------------------------------------------------

                // Shuffle then sort
                candidates = shuffleArray(candidates);
                candidates.sort((a, b) => {
                    const rA = a.projectedRetention !== undefined ? a.projectedRetention : 0;
                    const rB = b.projectedRetention !== undefined ? b.projectedRetention : 0;
                    return rA - rB;
                });

            } else {
                // Standard Mode
                candidates = allCards.filter(c => {
                    const mastery = studyState.knowledgeStates.get(c.id)?.masteryScore ?? 0.5;
                    return mastery < 0.90;
                });

                // Overlearning Fallback for Standard Mode
                if (candidates.length === 0 && allCards.length > 0) {
                    showToast("Deck Mastered! Entering over-learning mode.", "success");
                    candidates = [...allCards];
                }

                // Shuffle then sort
                candidates = shuffleArray(candidates);
                candidates.sort((a, b) => {
                    const mA = studyState.knowledgeStates.get(a.id)?.masteryScore ?? 0.5;
                    const mB = studyState.knowledgeStates.get(b.id)?.masteryScore ?? 0.5;
                    return mA - mB;
                });
            }

            // Determine Session Size
            let sessionSize = 20;
            if (deck.settings.learnModeMaxCards) {
                sessionSize = parseInt(deck.settings.learnModeMaxCards);
            } else if (deck.settings.examDate && isExamInFuture) {
                sessionSize = candidates.length;
                if (sessionSize < 5 && candidates.length >= 5) sessionSize = 5;
            }

            studyState.roundCards = candidates.slice(0, sessionSize);
            studyState.sessionCardIds = studyState.roundCards.map(c => c.id);

            if (studyState.roundCards.length === 0) {
                showToast("No cards available to study.", "info");
                return;
            }

            assignQuestionTypesToCards(studyState.roundCards, deckId);

            showView('studyMode');
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

            transitionSubView(document.getElementById('progressView'), document.getElementById('preGenerationView'));

            const updateProgressUI = (completed, total) => {
                const percent = total > 0 ? (completed / total) * 100 : 100;
                document.getElementById('preGenerationProgress').style.width = `${percent}%`;
                document.getElementById('preGenerationProgressText').textContent = `Generating smart questions... ${completed}/${total}`;
            };

            await preGenerateAdaptiveQuestions(studyState.roundCards, updateProgressUI);

            studyState.currentCardIndex = 0;
            studyState.startTime = new Date();

            transitionSubView(document.getElementById('preGenerationView'), document.getElementById('cardView'));
            showNextCard();
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

            const allStates = await getAllDataFromDB('userKnowledgeState');
            const stateMap = new Map(allStates.map(s => [s.cardID, s]));
            const deck = decks[currentDeckId];
            const hasExamDate = deck.settings && deck.settings.examDate;
            const targetRetention = (deck.settings && deck.settings.targetRetention) || 0.8;
            const examDate = hasExamDate ? new Date(deck.settings.examDate) : null;

            let totalScore = 0;

            studyState.sessionCardIds.forEach(id => {
                const state = stateMap.get(id);
                if (hasExamDate) {
                    // If exam date is set, "mastery" for this session means meeting the retention target
                    const retention = calculateRetentionAtDate(state, examDate);
                    // We want the progress bar to fill up as cards meet the target
                    // If retention >= target, score is 1.0. 
                    // If retention < target, we can scale it, but simpler is just binary for "done" vs "not done" in this context?
                    // Actually, let's use the projected retention itself, scaled to the target.
                    // If retention is 0.8 (target), score should be 1.0 (mastered).
                    // If retention is 0.4, score is 0.5.
                    let score = retention / targetRetention;
                    if (score > 1) score = 1;
                    totalScore += score;
                } else {
                    // Standard mastery score
                    const score = state ? state.masteryScore : 0.5;
                    totalScore += score;
                }
            });

            const avgScore = totalScore / studyState.sessionCardIds.length;

            let visualPercent;
            if (hasExamDate) {
                // For exam mode, avgScore is already 0-1 relative to target
                visualPercent = avgScore * 100;
            } else {
                // For standard mode, scale 0.5-0.9 to 0-100%
                const floor = 0.5;
                const ceiling = 0.9;
                visualPercent = ((avgScore - floor) / (ceiling - floor)) * 100;
            }

            visualPercent = Math.max(0, Math.min(100, visualPercent));

            const bar = document.getElementById('sessionProgressBar');
            const text = document.getElementById('sessionCounter');

            if (bar) bar.style.width = `${visualPercent}%`;

            if (text) {
                const current = Math.round(visualPercent);
                text.innerHTML = `Progress: <span style="color: var(--primary-color);">${current}%</span>`;
            }
        }


        }

        async function startReviewMode(deckId) {
            currentMode = 'review';
            currentDeckId = deckId;
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

            showView('studyMode');
            document.getElementById('studyTitle').textContent = 'Review Mode';
            document.getElementById('studySubtitle').textContent = deck.name;

            transitionSubView(document.getElementById('progressView'), document.getElementById('cardView'));
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
                    sequencePhase: studyState.sequencePhase
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

            const knowledgeStates = await getAllDataFromDB('userKnowledgeState');
            const knowledgeMap = new Map(knowledgeStates.map(item => [item.cardID, item]));

            let masteredCount = 0;
            let totalMasteryScore = 0;

            const examDate = deck.settings?.examDate ? new Date(deck.settings.examDate) : null;
            const targetRetention = deck.settings?.targetRetention || 0.8;

            allCards.forEach(card => {
                const state = knowledgeMap.get(card.id);
                let isMastered = false;
                let score = 0;

                if (examDate) {
                    const retention = calculateRetentionAtDate(state, examDate);
                    score = retention;
                    if (retention >= targetRetention) isMastered = true;
                } else {
                    score = state?.masteryScore || 0.5;
                    if (score >= 0.95) isMastered = true;
                }

                if (isMastered) masteredCount++;
                totalMasteryScore += score;
            });

            const deckMasteryPercent = (totalMasteryScore / totalCards) * 100;
            const learningCount = totalCards - masteredCount;

            document.getElementById('deckMasteryProgress').style.width = `${deckMasteryPercent}%`;
            document.getElementById('deckMasteryValue').textContent = `${Math.round(deckMasteryPercent)}%`;
            document.getElementById('masteredCardCount').textContent = masteredCount;
            document.getElementById('learningCardCount').textContent = learningCount;

            const poolList = document.getElementById('activePoolList');
            if (studyState.activeLearningPool && studyState.activeLearningPool.length > 0) {
                poolList.innerHTML = studyState.activeLearningPool.map(card =>
                    `<div class="deck-card-item" style="padding: 10px; border: none;">${card.question}</div>`
                ).join('');
            } else {
                poolList.innerHTML = `<p style="text-align: center; color: var(--secondary-text);">Click 'Continue' to start!</p>`;
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
                notesContainer.innerHTML = `<h3>Notes for this deck:</h3><div>${deck.notes}</div>`;
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
            document.getElementById('bucketsContainer').innerHTML = `<div class="bucket"><div class="bucket-number">Still Learning</div><div class="bucket-count">${remaining}</div></div><div class="bucket"><div class="bucket-number">Correct</div><div class="bucket-count">${mastered}</div></div>`;
            const progress = total > 0 ? (mastered / total) * 100 : 0;
            document.getElementById('progressBarFill').style.width = `${progress}%`;
            document.getElementById('statsContainer').innerHTML = `<div class="stat"><div class='stat-value'>${mastered}</div><div class='stat-label'>Total Mastered</div></div><div class='stat'><div class='stat-value'>${remaining}</div><div class='stat-label'>Remaining</div></div>`;
        }



        async function continueStudy() {
            const continueBtn = document.getElementById('continueBtn');
            continueBtn.disabled = true;
            continueBtn.innerHTML = '<span class="spinner" style="border-width:2px; width:16px; height:16px;"></span> Loading...';

            if (currentMode === 'learn') {
                const allCards = decks[currentDeckId].cards;
                const knowledgeStates = await getAllDataFromDB('userKnowledgeState');
                studyState.knowledgeStates = new Map(knowledgeStates.map(item => [item.cardID, item]));
                const knowledgeMap = new Map(knowledgeStates.map(item => [item.cardID, item]));
                const nonMasteredCards = allCards.map(card => ({
                    ...card,
                    deckId: currentDeckId,
                    mastery: knowledgeMap.get(card.id)?.masteryScore || 0.5
                })).filter(card => card.mastery < 0.95);
                nonMasteredCards.sort((a, b) => a.mastery - b.mastery);

                let poolSize;
                if (lastKnownFocusScore >= 0.85) poolSize = 7;
                else if (lastKnownFocusScore >= 0.65) poolSize = 5;
                else poolSize = 3;

                studyState.activeLearningPool = nonMasteredCards.slice(0, poolSize);
                const poolList = document.getElementById('activePoolList');
                if (studyState.activeLearningPool.length > 0) {
                    poolList.innerHTML = studyState.activeLearningPool.map(card =>
                        `<div class="deck-card-item" style="padding: 10px; border: none;">${card.question}</div>`
                    ).join('');
                } else {
                    poolList.innerHTML = `<p style="text-align: center; color: var(--secondary-text);">No more cards to learn in this session!</p>`;
                }
                studyState.roundCards = shuffleArray(studyState.activeLearningPool);

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
                studyState.roundCards = sortedCards;
            } else if (currentMode === 'exam') {
                let roundSize = 7;
                if (dailyPriorityQueue.length > 0) {
                    const firstCardDeckId = dailyPriorityQueue[0].deckId;
                    if (decks[firstCardDeckId] && decks[firstCardDeckId].settings) {
                        roundSize = decks[firstCardDeckId].settings.cardsPerRound || 7;
                    }
                }
                studyState.roundCards = dailyPriorityQueue.splice(0, roundSize);
            }

            studyState.currentCardIndex = 0;

            studyState.roundCards.forEach(card => {
                card.questionTypeToShow = selectOptimalQuestionType(card);
            });

            if (studyState.roundCards.length > 0) {
                const cardsRequiringGeneration = studyState.roundCards.filter(
                    card => card.questionTypeToShow === 'MultipleChoice' && isOnline
                );

                if (cardsRequiringGeneration.length > 0) {
                    transitionSubView(document.getElementById('progressView'), document.getElementById('preGenerationView'));

                    const updateProgressUI = (completed, total) => {
                        const percent = total > 0 ? (completed / total) * 100 : 100;
                        document.getElementById('preGenerationProgress').style.width = `${percent}%`;
                        document.getElementById('preGenerationProgressText').textContent = `${completed} / ${total}`;
                    };

                    await preGenerateAdaptiveQuestions(studyState.roundCards, updateProgressUI);

                    transitionSubView(document.getElementById('preGenerationView'), document.getElementById('cardView'));

                } else {

                    transitionSubView(document.getElementById('progressView'), document.getElementById('cardView'));
                }

                showNextCard();

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

        function assignQuestionTypesToCards(cards, deckId) {
            const deck = decks[deckId];
            if (!deck) return;

            deck.settings = {
                ...DEFAULT_DECK_SETTINGS,
                ...(deck.settings || {})
            };

            const adaptive = deck.settings.adaptiveModes || {
                auto: true,
                mcq: true,
                cloze: true
            };

            cards.forEach(card => {
                if (deck.settings.learnMode === 'write') {
                    card.questionTypeToShow = 'Type';
                    return;
                }

                const mastery = studyState.knowledgeStates?.get(card.id)?.masteryScore ?? 0.5;

                if (adaptive.auto) {
                    if (mastery < 0.6 && adaptive.mcq && canGenerateQuestionType('MultipleChoice', card, deck.cards)) {
                        card.questionTypeToShow = 'MultipleChoice';
                        return;
                    }
                    if (mastery < 0.85 && adaptive.cloze && canGenerateQuestionType('Cloze', card, deck.cards)) {
                        card.questionTypeToShow = 'Cloze';
                        return;
                    }
                }

                card.questionTypeToShow = 'Flashcard';
            });
        }

        async function showNextCard() {
            if (currentMode === 'learn' && (!studyState.roundCards || studyState.roundCards.length === 0)) {
                showComplete();
                return;
            }
            studyState.cardStartTime = new Date();

            const cardStatsInfo = document.getElementById('cardStatsInfo');
            if (cardStatsInfo) cardStatsInfo.innerHTML = '';
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

                        document.getElementById('cardStatsInfo').innerHTML = `
                            <div style="font-weight: 500;">Mastery: <span style="color: var(--primary-color);">${masteryPercent}%</span></div>
                            <div style="font-size: 0.8rem; color: var(--secondary-text);">Urgency: ${urgency.toFixed(0)}%</div>
                        `;
                    }
                }

                document.getElementById('flashcardViewContainer').classList.remove('hidden');
                document.getElementById('cardQuestion').innerHTML = card.question;
                document.getElementById('cardAnswer').innerHTML = card.answer;

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
                const currentChunk = studyState.sequenceChunks[studyState.currentChunkIndex];
                if (!currentChunk) {
                    showToast("Sequence chunk not found", "error");
                    endSession();
                    return;
                }
                const card = currentChunk ? currentChunk[studyState.currentCardIndex] : null;

                document.getElementById('cardRoundInfo').textContent = `Chunk ${studyState.currentChunkIndex + 1} - Item ${studyState.currentCardIndex + 1} of ${currentChunk.length}`;

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
                    case 'Forward Chaining':
                    case 'Backward Chaining':
                        document.getElementById('flashcardViewContainer').classList.remove('hidden');
                        document.getElementById('writeAnswerInput').classList.remove('hidden');
                        document.getElementById('checkAnswerBtn').classList.remove('hidden');
                        document.getElementById('dontKnowBtn').classList.remove('hidden');

                        const qElement = document.getElementById('cardQuestion');

                        if (studyState.sequencePhase === 'Forward Chaining') {
                            if (studyState.currentCardIndex === 0) {
                                qElement.innerHTML = `
                                    <div style="text-align: center;">
                                        <div style="color: var(--primary-color); font-size: 1rem; font-weight: 600; margin-bottom: 15px;">Forward Chaining</div>
                                        <div style="font-size: 1.3rem;">What is the <strong>first item</strong> in this sequence?</div>
                                    </div>
                                `;
                            } else {
                                const prevCard = currentChunk[studyState.currentCardIndex - 1];
                                qElement.innerHTML = `
                                    <div style="text-align: center;">
                                        <div style="color: var(--primary-color); font-size: 1rem; font-weight: 600; margin-bottom: 15px;">Forward Chaining </div>
                                        <div style="font-size: 1.1rem; margin-bottom: 20px;">What comes <strong>after</strong>:</div>
                                        <div style="
                                            background: var(--input-bg);
                                            padding: 20px;
                                            border-radius: 12px;
                                            border-left: 4px solid var(--primary-color);
                                            font-size: 1.3rem;
                                            font-weight: 600;
                                        ">${prevCard.answer}</div>
                                        ${prevCard.question ? `<div style="color: var(--secondary-text); margin-top: 10px; font-size: 0.95rem;">${prevCard.question}</div>` : ''}
                                    </div>
                                `;
                            }
                        } else {
                            if (studyState.currentCardIndex === currentChunk.length - 1) {
                                qElement.innerHTML = `
                                    <div style="text-align: center;">
                                        <div style="color: var(--primary-color); font-size: 1rem; font-weight: 600; margin-bottom: 15px;">Backward Chaining</div>
                                        <div style="font-size: 1.3rem;">What is the <strong>last item</strong> in this sequence?</div>
                                    </div>
                                `;
                            } else {
                                const nextCard = currentChunk[studyState.currentCardIndex + 1];
                                qElement.innerHTML = `
                                    <div style="text-align: center;">
                                        <div style="color: var(--primary-color); font-size: 1rem; font-weight: 600; margin-bottom: 15px;">Backward Chaining</div>
                                        <div style="font-size: 1.1rem; margin-bottom: 20px;">What comes <strong>before</strong>:</div>
                                        <div style="
                                            background: var(--input-bg);
                                            padding: 20px;
                                            border-radius: 12px;
                                            border-left: 4px solid var(--primary-color);
                                            font-size: 1.3rem;
                                            font-weight: 600;
                                        ">${nextCard.answer}</div>
                                        ${nextCard.question ? `<div style="color: var(--secondary-text); margin-top: 10px; font-size: 0.95rem;">${nextCard.question}</div>` : ''}
                                    </div>
                                `;
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
                        document.getElementById('cardQuestion').innerHTML = weakestCard.question;
                        document.getElementById('cardAnswer').innerHTML = weakestCard.answer;
                        document.getElementById('cardRoundInfo').textContent = `Weakest Link - Card ${studyState.currentCardIndex + 1} of ${studyState.roundCards.length}`;
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
                        document.getElementById('cardQuestion').innerHTML = reviewCard.question;
                        document.getElementById('cardAnswer').innerHTML = reviewCard.answer;
                        document.getElementById('cardRoundInfo').textContent = `Quick Review - Card ${studyState.currentCardIndex + 1} of ${studyState.roundCards.length}`;
                        startInteractionLog(reviewCard.id);
                        break;

                }
                document.querySelector('#cardView .flashcard').classList.remove('is-flipped');
                if (card) document.getElementById('cardAnswer').innerHTML = card.answer;
                document.getElementById('cardAnswerContent').classList.add('hidden');
                const writeInput = document.getElementById('writeAnswerInput');
                writeInput.value = '';
                writeInput.disabled = false;
                writeInput.classList.remove('correct', 'incorrect');
                if (!writeInput.classList.contains('hidden')) setTimeout(() => writeInput.focus(), 100);
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

            document.getElementById('accentToggleBtn').classList.add('hidden');
            document.getElementById('accentButtonsContainer').classList.add('hidden');

            switch (questionType) {
                case 'MultipleChoice':
                    document.getElementById('mcqView').classList.remove('hidden');
                    document.getElementById('mcqQuestion').innerHTML = card.question;
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

                    document.getElementById('cardQuestion').innerHTML = clozeText;

                    document.getElementById('writeAnswerInput').classList.remove('hidden');
                    document.getElementById('checkAnswerBtn').classList.remove('hidden');
                    document.getElementById('dontKnowBtn').classList.remove('hidden');

                    document.getElementById('accentToggleBtn').classList.remove('hidden');
                    updateAccentButtonsVisibility();

                    startInteractionLog(card.id);
                    break;

                case 'Type':
                    document.getElementById('flashcardViewContainer').classList.remove('hidden');
                    document.getElementById('cardQuestion').innerHTML = card.question;

                    document.getElementById('writeAnswerInput').classList.remove('hidden');
                    document.getElementById('checkAnswerBtn').classList.remove('hidden');
                    document.getElementById('dontKnowBtn').classList.remove('hidden');

                    document.getElementById('accentToggleBtn').classList.remove('hidden');
                    updateAccentButtonsVisibility();

                    startInteractionLog(card.id);
                    break;

                default:
                    document.getElementById('flashcardViewContainer').classList.remove('hidden');
                    document.getElementById('cardQuestion').innerHTML = card.question;
                    document.getElementById('showAnswerBtn').classList.remove('hidden');
                    break;
            }

            const flashcardElem = document.querySelector('#cardView .flashcard');
            flashcardElem.classList.remove('is-flipped');
            document.getElementById('cardAnswer').innerHTML = card.answer;
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
                showComplete();
                return;
            }
            let nextPhase = null;


            const isShortSequence = currentChunk.length <= 2;

            switch (studyState.sequencePhase) {
                case null:
                    nextPhase = 'Passive Review';
                    break;
                case 'Passive Review':

                    if (isShortSequence) {
                        nextPhase = 'Drag and Drop';
                    } else {
                        nextPhase = 'Forward Chaining';
                        studyState.currentCardIndex = 0;
                    }
                    break;
                case 'Forward Chaining':
                    nextPhase = 'Backward Chaining';
                    studyState.currentCardIndex = currentChunk.length - 1;
                    break;
                case 'Backward Chaining':
                    if (isShortSequence) {
                        showComplete();
                        return;
                    } else {
                        nextPhase = 'Drag and Drop';
                    }
                    break;
                case 'Drag and Drop':
                    if (studyState.currentChunkIndex > 0) {
                        const reviewPool = studyState.sequenceChunks.slice(0, studyState.currentChunkIndex).flat();
                        const reviewCard = reviewPool[Math.floor(Math.random() * reviewPool.length)];

                        nextPhase = 'InterChunkReview';
                        studyState.roundCards = [reviewCard];
                        studyState.currentCardIndex = 0;
                        studyState.nextPhaseAfterReview = (studyState.currentChunkIndex + 1 < studyState.sequenceChunks.length) ? 'Passive Review' : 'CheckWeakest';

                        showToast(`Chunk ${studyState.currentChunkIndex + 1} complete! Quick checkup...`, "success");
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
                    const weakestCards = studyState.sequenceCards
                        .map(card => ({ ...card, mastery: knowledgeMap.get(card.id)?.masteryScore || 0.5 }))
                        .filter(card => card.mastery < 0.90)
                        .sort((a, b) => a.mastery - b.mastery)
                        .slice(0, 5);

                    if (weakestCards.length > 0) {
                        nextPhase = 'Weakest Link';
                        studyState.roundCards = weakestCards;
                        studyState.currentCardIndex = 0;
                        showToast("All chunks practiced! Now for a quick review of the tricky items.", "info");
                    } else {
                        const deck = decks[currentDeckId];
                        if (deck.sequenceState) delete deck.sequenceState;
                        await saveDataToDB('decks', deck);
                        showComplete();
                        return;
                    }
                    break;

                case 'Weakest Link':
                    const deck = decks[currentDeckId];
                    if (deck.sequenceState) delete deck.sequenceState;
                    await saveDataToDB('decks', deck);
                    showComplete();
                    return;
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
                console.log('[DEBUG] Starting logout process');
                
                // Clear local storage
                localStorage.removeItem('auth0Session');
                console.log('[DEBUG] Auth0 session cleared from localStorage');
                
                // Clear user data
                decks = {};
                analyticsData = {};
                console.log('[DEBUG] User data cleared');
                
                // Update UI - hide logged in view, show dashboard
                document.getElementById('userProfileMenu').classList.add('hidden');
                document.getElementById('userProfileDropdown').classList.add('hidden');
                document.getElementById('guestSignupBtn').classList.remove('hidden');
                document.getElementById('loggedInView').classList.add('hidden');
                document.getElementById('appHeader').classList.remove('hidden');
                console.log('[DEBUG] UI updated for logged out state');
                
                // Navigate to dashboard (guest mode)
                showView('dashboard', true);
                updateOnlineStatusUI();
                console.log('[DEBUG] Navigated to guest dashboard');
                
                showToast('You have been logged out', 'success');
                console.log('[DEBUG] Logout completed successfully');
            } catch (error) {
                console.error('[DEBUG] Logout error:', error);
                console.error('[DEBUG] Logout error stack:', error.stack);
                // Fallback: just clear session and show dashboard
                localStorage.removeItem('auth0Session');
                decks = {};
                analyticsData = {};
                document.getElementById('userProfileMenu').classList.add('hidden');
                document.getElementById('loggedInView').classList.add('hidden');
                document.getElementById('appHeader').classList.remove('hidden');
                showView('dashboard', true);
                showToast('Logged out (with errors)', 'warning');
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
            const card = studyState.roundCards[studyState.currentCardIndex];
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
            const relevantLogs = allLogs.filter(log => log.wasCorrect && log.latency !== null && log.fluency > 0);

            if (relevantLogs.length < 20) return;

            const totalLatency = relevantLogs.reduce((sum, log) => sum + log.latency, 0);
            const totalFluency = relevantLogs.reduce((sum, log) => sum + log.fluency, 0);

            const avgLatency = totalLatency / relevantLogs.length;
            const avgFluency = totalFluency / relevantLogs.length;

            globalSettings.userBaseline = {
                latency: Math.max(3000, avgLatency * 1.5),
                fluency: avgFluency * 0.8
            };

            await saveDataToDB('appData', { key: 'userSettings', ...globalSettings });
            console.log("User baseline updated:", globalSettings.userBaseline);
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
            const userBaseline = globalSettings.userBaseline || { latency: 3000, fluency: 3.0 };

            const iqs = calculateIQS({
                recallLatency: lastLog.recallLatency || 2000,
                answerFluency: lastLog.answerFluency || 5,
                totalCorrections: lastLog.backspaceCount + lastLog.deleteCount,
                attemptCount: lastLog.attemptCount || 1
            }, userBaseline);

            const sm2 = new SM2Algorithm();
            const quality = correct ? 4 : 1;

            const newSm2Data = sm2.calculateNextReview(cardInDeck || card)(quality);

            if (cardInDeck) cardInDeck.sm2Data = newSm2Data;

            const newStability = newSm2Data.interval;

            await updateKnowledgeState(card, correct, iqs, questionType, newStability);

            if (currentMode === 'sequence') {
                const currentChunk = studyState.sequenceChunks[studyState.currentChunkIndex];

                if (studyState.sequencePhase === 'Forward Chaining') {
                    if (correct) {
                        studyState.currentCardIndex++;
                        if (studyState.currentCardIndex >= currentChunk.length) {
                            moveToNextSequencePhase();
                        } else {
                            showNextCard();
                        }
                    } else {
                        showToast("Let's try that one again.", "error");
                        showNextCard(); // Stay on card
                    }
                } else if (studyState.sequencePhase === 'Backward Chaining') {
                    if (correct) {
                        studyState.currentCardIndex--;
                        if (studyState.currentCardIndex < 0) {
                            moveToNextSequencePhase();
                        } else {
                            showNextCard();
                        }
                    } else {
                        showToast("Let's try that one again.", "error");
                        showNextCard(); // Stay on card
                    }
                } else if (studyState.sequencePhase === 'InterChunkReview') {
                    studyState.sequencePhase = studyState.nextPhaseAfterReview;
                    studyState.nextPhaseAfterReview = null;
                    moveToNextSequencePhase();
                } else if (studyState.sequencePhase === 'Weakest Link') {
                    studyState.currentCardIndex++;
                    if (studyState.currentCardIndex >= studyState.roundCards.length) {
                        moveToNextSequencePhase();
                    } else {
                        showNextCard();
                    }
                }
                await saveDataToDB('decks', decks[currentDeckId]);
                return;
            }

            if (currentMode === 'learn') {
                const updatedState = await getDataFromDB('userKnowledgeState', ['default_user', card.id]);

                const streak = updatedState ? (updatedState.consecutiveCorrect || 0) : 0;
                const score = updatedState ? updatedState.masteryScore : 0;
                const isMastered = score >= 0.95 || (score >= 0.90 && streak >= 3);

                if (isMastered) {
                    studyState.roundCards.splice(studyState.currentCardIndex, 1);

                    studyState.currentCardIndex--;

                    showToast("Card Mastered!", "success", 1000);
                } else {
                    const currentCard = studyState.roundCards.splice(studyState.currentCardIndex, 1)[0];

                    // --- DYNAMIC OFFSET CALCULATION ---
                    // Calculates exactly how many cards to wait before showing this again.
                    let insertOffset;

                    if (!correct) {

                        insertOffset = Math.max(1, Math.floor(1 + (iqs * 4)));
                    } else {
                        let performanceGap = 4 + (iqs * 8);
                        let streakMultiplier = 1 + (streak * 0.5);
                        insertOffset = Math.floor(performanceGap * streakMultiplier);
                    }

                    const fuzz = Math.floor(insertOffset * 0.15);
                    const randomFuzz = Math.floor(Math.random() * (fuzz * 2 + 1)) - fuzz;
                    insertOffset = Math.max(1, insertOffset + randomFuzz);

                    const insertIndex = studyState.currentCardIndex + insertOffset;

                    if (insertIndex >= studyState.roundCards.length) {
                        studyState.roundCards.push(currentCard);
                    } else {
                        studyState.roundCards.splice(insertIndex, 0, currentCard);
                    }

                    studyState.currentCardIndex--;
                }

                await updateSessionProgress();

                if (studyState.roundCards.length === 0) {
                    showComplete();
                    return;
                }

                if (!correct) {
                    studyState.incorrectInThisRound.push({ ...card });
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
            await saveDataToDB('decks', decks[currentDeckId]);
        }

        function dontKnowAnswer() {
            const card = studyState.roundCards[studyState.currentCardIndex];
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

                feedbackMessage.innerHTML = `<strong>The correct answer is:</strong> <span style="color:var(--primary-color)">${card.answer}</span>`;

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






        function markCorrect(isAutomated = false) {
            if (!isAutomated && !isActionAllowed()) return;

            const btn = document.getElementById('correctBtn');
            btn.classList.add('feedback-correct');
            setTimeout(() => {
                btn.classList.remove('feedback-correct');
                moveCard(studyState.roundCards[studyState.currentCardIndex], true);
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
                moveCard(studyState.roundCards[studyState.currentCardIndex], false);
            }, 200);
        }

        function populateAccentButtons() {
            const accents = ['à', 'â', 'é', 'è', 'ê', 'ë', 'î', 'ï', 'ô', 'ù', 'û', 'ü', 'ç', 'ñ', 'ß', 'ä', 'ö'];
            const container = document.getElementById('accentButtonsContainer');
            if (!container) return;

            container.innerHTML = accents.map(char =>
                `<button type="button" class="accent-btn" onmousedown="event.preventDefault(); insertAccent('${char}', 'writeAnswerInput')">${char}</button>`
            ).join('');
        }


        function insertAccent(char, targetId) {
            const textarea = document.getElementById(targetId);
            if (!textarea) {
                console.error(`[Accents] Target textarea #${targetId} not found`);
                return;
            }

            // Check if hidden
            if (textarea.classList.contains('hidden') || textarea.style.display === 'none') {
                console.warn(`[Accents] Target textarea #${targetId} is hidden. Cannot insert.`);
                return;
            }

            console.log(`[Accents] Inserting ${char} into ${targetId}`);

            const start = textarea.selectionStart;
            const end = textarea.selectionEnd;

            textarea.value = textarea.value.substring(0, start) + char + textarea.value.substring(end);

            // Move cursor after the inserted character
            textarea.selectionStart = textarea.selectionEnd = start + 1;
            textarea.focus();
        }


        async function toggleAccentButtons() {
            console.log('[Accents] Toggle button clicked. Current state:', globalSettings.showAccents);

            globalSettings.showAccents = !globalSettings.showAccents;

            await saveDataToDB('appData', { key: 'userSettings', ...globalSettings });

            console.log('[Accents] New state saved:', globalSettings.showAccents);
            updateAccentButtonsVisibility();
        }


        function updateAccentButtonsVisibility() {
            const container = document.getElementById('accentButtonsContainer');
            if (!container) {
                console.error('[Accents] Container #accentButtonsContainer not found in DOM');
                return;
            }

            if (globalSettings.showAccents) {
                console.log('[Accents] Showing buttons...');
                if (container.innerHTML.trim() === '') {
                    populateAccentButtons();
                }
                container.classList.remove('hidden');

                container.style.display = 'flex';
            } else {
                console.log('[Accents] Hiding buttons...');
                container.classList.add('hidden');
                container.style.display = 'none';
            }
        }



        function populateAccentButtons() {
            const accents = ['à', 'â', 'é', 'è', 'ê', 'ë', 'î', 'ï', 'ô', 'ù', 'û', 'ü', 'ç', 'ñ', 'ß', 'ä', 'ö'];
            const container = document.getElementById('accentButtonsContainer');
            if (!container) return;

            console.log('[Accents] Populating button HTML');

            container.innerHTML = accents.map(char =>
                `<button type="button" 
                        class="accent-btn" 
                        style="background: var(--button-secondary-bg); border: 1px solid var(--border-color); color: var(--button-secondary-text); padding: 8px 12px; border-radius: 8px; cursor: pointer; font-size: 1.1rem; min-width: 32px;"
                        onmousedown="event.preventDefault(); insertAccent('${char}', 'writeAnswerInput')">
                    ${char}
                </button>`
            ).join('');
        }

        async function toggleTestAccentButtons() {
            globalSettings.showAccents = !globalSettings.showAccents;
            await saveDataToDB('appData', { key: 'userSettings', ...globalSettings });
            updateTestAccentButtonsVisibility();
        }

        function updateTestAccentButtonsVisibility() {
            const container = document.getElementById('testAccentButtonsContainer');
            if (globalSettings.showAccents) {
                populateTestAccentButtons();
                container.classList.remove('hidden');
            } else {
                container.classList.add('hidden');
            }
        }

        function populateEditorAccentButtons(container, textarea) {
            if (!container || !textarea) return;
            const accents = ['à', 'â', 'é', 'è', 'ê', 'ë', 'î', 'ï', 'ô', 'ù', 'û', 'ü', 'ç', 'ñ', 'ß', 'ä', 'ö'];
            container.innerHTML = accents.map(char =>
                `<button onclick="insertAccentIntoEditor('${char}', this)" style="background: var(--button-secondary-bg); border: 1px solid var(--border-color); color: var(--button-secondary-text); padding: 5px 12px; border-radius: 8px; cursor: pointer; font-size: 1rem;">${char}</button>`
            ).join('');
            // Show accent buttons by default in editor
            container.classList.remove('hidden');
        }

        function insertAccentIntoEditor(char, button) {
            const container = button.parentElement;
            const textarea = container.previousElementSibling;
            if (!textarea || !textarea.classList.contains('question-input') && !textarea.classList.contains('solution-input')) return;
            const start = textarea.selectionStart;
            const end = textarea.selectionEnd;
            textarea.value = textarea.value.substring(0, start) + char + textarea.value.substring(end);
            textarea.selectionStart = textarea.selectionEnd = start + 1;
            textarea.focus();
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
            document.getElementById('preGenerationView').classList.add('hidden');

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
                const masteryCountBefore = knowledgeStates.filter(s => cardIdsInDeck.has(s.cardID) && s.masteryScore >= 0.95).length;

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
                backToDashboard();
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
                const transaction = db.transaction(['userKnowledgeState'], 'readwrite');
                const store = transaction.objectStore('userKnowledgeState');

                const resetPromises = deck.cards.map(card => {
                    return new Promise((resolve, reject) => {

                        const defaultState = {
                            userID: 'default_user',
                            cardID: card.id,
                            masteryScore: 0.5,
                            stability: 1.0,
                            lastReviewed: new Date().toISOString(),
                            recallHistory: []
                        };

                        const request = store.put(defaultState);
                        request.onsuccess = resolve;
                        request.onerror = reject;
                    });
                });

                await Promise.all(resetPromises);

                if (currentMode === 'learn') {
                } else if (currentMode === 'review') {
                    deck.reviewState = { stillLearning: [...deck.cards], correct: [], currentRound: 1, lastRoundIncorrect: [] };
                    await saveDataToDB('decks', deck);


                showToast("Progress has been reset.", "success");

                if (currentMode === 'learn') startLearnMode(currentDeckId);
                else if (currentMode === 'review') startReviewMode(currentDeckId);
            }

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

            document.getElementById('deckSettingsCardsPerRound').value = settings.cardsPerRound || 10;

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
            const isExamEnabled = document.getElementById('deckSettingsExamModeToggle').checked;

            if (isExamEnabled) {
                const examDateInput = document.getElementById('deckSettingsExamDate').value;
                // For now, if empty, we save it as null effectively disabling it logic-wise, or save what's there.
                deck.settings.examDate = examDateInput || null;
            } else {
                deck.settings.examDate = null;
            }

            const retentionInput = document.getElementById('deckSettingsRetention').value;
            deck.settings.targetRetention = parseInt(retentionInput) / 100;

            deck.settings.cardsPerRound = parseInt(document.getElementById('deckSettingsCardsPerRound').value);
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
            categories.forEach(cat => dropdown.innerHTML += `<option value="${cat}">${cat}</option>`);
            dropdown.innerHTML += `<option value="add_new_category" style="font-style: italic;">+ Add New Category...</option>`;
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
                                    const newId = Date.now() + Math.random();
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
                                    const newCardId = oldIdToNewIdMap.get(state.cardID);
                                    if (newCardId) {
                                        state.cardID = newCardId;
                                        store.put(state);
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
                        id: Date.now() + Math.random(),
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

        async function compressImage(dataUrl, maxSizeMB = 1) {
            return new Promise((resolve) => {
                const img = new Image();
                img.onload = () => {
                    const canvas = document.createElement('canvas');
                    const ctx = canvas.getContext('2d');
                    canvas.width = img.width;
                    canvas.height = img.height;
                    ctx.drawImage(img, 0, 0);

                    let quality = 0.9;
                    let compressedDataUrl = canvas.toDataURL('image/jpeg', quality);

                    while (compressedDataUrl.length > maxSizeMB * 1024 * 1024 && quality > 0.1) {
                        quality -= 0.1;
                        compressedDataUrl = canvas.toDataURL('image/jpeg', quality);
                    }
                    resolve(compressedDataUrl);
                };
                img.onerror = () => resolve(dataUrl);
                img.src = dataUrl;
            });
        }

        function compressImage(dataUrl, quality = 0.7, maxSizeKB = 150) {
            return new Promise((resolve) => {
                const img = new Image();
                img.onload = () => {
                    const canvas = document.createElement('canvas');
                    const ctx = canvas.getContext('2d');

                    let width = img.width;
                    let height = img.height;
                    const MAX_WIDTH = 1024;
                    const MAX_HEIGHT = 1024;

                    if (width > height) {
                        if (width > MAX_WIDTH) {
                            height *= MAX_WIDTH / width;
                            width = MAX_WIDTH;
                        }
                    } else {
                        if (height > MAX_HEIGHT) {
                            width *= MAX_HEIGHT / height;
                            height = MAX_HEIGHT;
                        }
                    }
                    canvas.width = width;
                    canvas.height = height;
                    ctx.drawImage(img, 0, 0, width, height);

                    let compressedDataUrl = canvas.toDataURL('image/jpeg', quality);


                    const head = 'data:image/jpeg;base64,';
                    const imageSizeKB = Math.round((compressedDataUrl.length - head.length) * 3 / 4 / 1024);

                    if (imageSizeKB > maxSizeKB) {
                        console.log(`Image too large (${imageSizeKB}KB), further compression needed.`);
                    }

                    resolve(compressedDataUrl);
                };
                img.onerror = () => resolve(dataUrl);
                img.src = dataUrl;
            });
        }

        function showConfirmModal(text, onConfirm, title = "Confirm Action") {
            console.log('[DEBUG] showConfirmModal called with title:', title);
            const modal = document.getElementById('confirmActionModal');
            console.log('[DEBUG] Modal element found:', !!modal);
            
            document.getElementById('confirmActionTitle').textContent = title;
            document.getElementById('confirmActionText').textContent = text;
            console.log('[DEBUG] Modal content set');

            const confirmBtn = document.getElementById('confirmActionConfirmBtn');
            console.log('[DEBUG] Original confirm button found:', !!confirmBtn);
            
            const newConfirmBtn = confirmBtn.cloneNode(true);
            confirmBtn.parentNode.replaceChild(newConfirmBtn, confirmBtn);
            console.log('[DEBUG] Button cloned and replaced');

            newConfirmBtn.addEventListener('click', async () => {
                console.log('[DEBUG] Confirm button clicked');
                // Disable button to prevent multiple clicks
                newConfirmBtn.disabled = true;
                newConfirmBtn.textContent = 'Processing...';
                console.log('[DEBUG] Button disabled, showing Processing state');
                try {
                    console.log('[DEBUG] Calling onConfirm callback');
                    await onConfirm();
                    console.log('[DEBUG] onConfirm callback completed successfully');
                    cancelAction();
                } catch (error) {
                    console.error('[DEBUG] Error in confirm action:', error);
                    console.error('[DEBUG] Error stack:', error.stack);
                    showToast('An error occurred. Please try again.', 'error');
                    newConfirmBtn.disabled = false;
                    newConfirmBtn.textContent = 'Confirm';
                    console.log('[DEBUG] Button re-enabled after error');
                }
            });

            modal.classList.add('show');
            console.log('[DEBUG] Modal shown');
        }

        function cancelAction() {
            document.getElementById('confirmActionModal').classList.remove('show');
        }

        function openPracticeTestModal(deckId) {
            practiceTestState.deckId = deckId;
            document.getElementById('numQuestions').max = decks[deckId].cards.length;
            document.getElementById('numQuestions').value = Math.min(10, decks[deckId].cards.length);
            document.getElementById('practiceTestModal').classList.add('show');
        }

        function closePracticeTestModal() {
            document.getElementById('practiceTestModal').classList.remove('show');
        }

        function startPracticeTest() {
            const deckId = practiceTestState.deckId;
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

            showView('practiceTestView');
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

            const card = practiceTestState.cards[practiceTestState.currentCardIndex];
            let currentTestType = testType;
            if (testType === 'mixed') {
                currentTestType = Math.random() > 0.5 ? 'multiple_choice' : 'type';
            }

            document.querySelector('#testCardView .flashcard').classList.remove('is-flipped');
            document.getElementById('testQuestion').innerHTML = card.question;
            document.getElementById('testAnswer').innerHTML = card.answer;
            document.getElementById('testAnswerContent').classList.add('hidden');
            document.getElementById('testOptions').classList.add('hidden');
            document.getElementById('testAnswerInput').classList.add('hidden');
            document.getElementById('testShowAnswerBtn').classList.add('hidden');
            document.getElementById('testCheckAnswerBtn').classList.add('hidden');
            document.getElementById('testCorrectBtn').classList.add('hidden');
            document.getElementById('testIncorrectBtn').classList.add('hidden');
            document.getElementById('testNextBtn').classList.add('hidden');
            document.getElementById('testAccentToggleBtn').classList.add('hidden');
            testAnswerInput.classList.remove('correct', 'incorrect');
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

                document.getElementById('testAccentToggleBtn').classList.remove('hidden');
                updateTestAccentButtonsVisibility();

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
            showView('dashboard');
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
                    return `<div class="deck-card-item">${date}: Studied "${s.deckName}" for ${duration}</div>`;
                }).join('');
            } else {
                sessionList.innerHTML = '<p style="color: var(--secondary-text); text-align: center;">No study sessions recorded yet.</p>';
            }

            showView('analyticsView', false, () => {
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
            const ctx = document.getElementById(canvasId).getContext('2d');
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
            const ctx = document.getElementById(canvasId).getContext('2d');

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

        function showDownloadsModal() {
            document.getElementById('downloadsModal').classList.add('show');
            fetchLatestDownloads();
        }

        async function fetchLatestDownloads() {
            const repo = 'TJ7755/Lagiote-Revise';
            const apiUrl = `https://api.github.com/repos/${repo}/releases`;
            const container = document.getElementById('download-buttons-container');

            container.innerHTML = `<p style="color: var(--secondary-text);">Loading latest downloads...</p>`;

            try {
                const response = await fetch(apiUrl);
                if (!response.ok) throw new Error(`GitHub API error: ${response.status}`);
                const data = await response.json();

                if (!Array.isArray(data) || data.length === 0) {
                    container.innerHTML = `<p style="color: var(--secondary-text);">No releases found for this repository.</p>`;
                    return;
                }
                const latestRelease = data[0];

                if (latestRelease && latestRelease.assets && latestRelease.assets.length > 0) {
                    container.innerHTML = '';

                    const winAsset = latestRelease.assets.find(a => a.name.endsWith('.exe'));
                    const macAsset = latestRelease.assets.find(a => a.name.endsWith('.dmg'));

                    if (winAsset) {
                        const winBtn = document.createElement('a');
                        winBtn.href = winAsset.browser_download_url;
                        winBtn.className = 'btn';
                        winBtn.innerHTML = `Download for Windows`;
                        container.appendChild(winBtn);
                    }

                    if (macAsset) {
                        const macBtn = document.createElement('a');
                        macBtn.href = macAsset.browser_download_url;
                        macBtn.className = 'btn';
                        macBtn.innerHTML = `Download for Mac`;
                        container.appendChild(macBtn);
                    }

                    if (!winAsset && !macAsset) {
                        container.innerHTML = `<p style="color: var(--secondary-text);">No compatible downloads found in the latest release.</p>`;
                    }

                } else {
                    container.innerHTML = `<p style="color: var(--secondary-text);">Could not find any download files in the latest release.</p>`;
                }
            } catch (error) {
                console.error('Failed to fetch downloads:', error);
                container.innerHTML = `<p style="color: var(--secondary-text);">Failed to load downloads. Please try again later.</p>`;
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
            const recallLatency = (typeof logData.recallLatency === 'number') ? logData.recallLatency : userBaseline.latency;
            const answerFluency = (typeof logData.answerFluency === 'number') ? logData.answerFluency : 0;
            const totalCorrections = (typeof logData.totalCorrections === 'number') ? logData.totalCorrections : 0;
            const attemptCount = (typeof logData.attemptCount === 'number' && logData.attemptCount > 0) ? logData.attemptCount : 1;
            const v_latency = 1 - (Math.min(recallLatency / userBaseline.latency, 2) / 2);
            const v_fluency = Math.min(answerFluency / userBaseline.fluency, 1.5) / 1.5;
            const v_corrections = 1 / (1 + totalCorrections);
            const v_attempts = 1 / attemptCount;
            const W_latency = 0.15;
            const W_fluency = 0.15;
            const W_corrections = 0.40;
            const W_attempts = 0.30;
            const iqs = (W_latency * v_latency) + (W_fluency * v_fluency) + (W_corrections * v_corrections) + (W_attempts * v_attempts);

            return isNaN(iqs) ? 0.5 : Math.max(0, Math.min(1, iqs));
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

        async function updateKnowledgeState(card, wasCorrect, iqs = 0.5, questionType = 'Flashcard', newStability = null) {
            if (!db) return;

            return new Promise((resolve, reject) => {
                const transaction = db.transaction(['userKnowledgeState'], 'readwrite');
                const store = transaction.objectStore('userKnowledgeState');

                transaction.oncomplete = () => resolve();
                transaction.onerror = (event) => reject(event.target.result);

                const request = store.get(['default_user', card.id]);

                request.onsuccess = () => {
                    let state = request.result || {
                        userID: 'default_user', cardID: card.id,
                        masteryScore: 0.5,
                        consecutiveCorrect: 0,
                        stability: 1.0, // Default
                        lastReviewed: new Date().toISOString(),
                        recallHistory: []
                    };

                    const learningRate = 0.2;
                    const penaltyRate = 0.3;

                    if (wasCorrect) {
                        const performanceBonus = (iqs > 0.8) ? 1.5 : (iqs < 0.4 ? 0.5 : 1.0);
                        state.masteryScore += (1 - state.masteryScore) * learningRate * performanceBonus;
                        state.consecutiveCorrect = (state.consecutiveCorrect || 0) + 1;

                        if (state.consecutiveCorrect < 3 && state.masteryScore > 0.85) {
                            state.masteryScore = 0.85;
                        }
                    } else {
                        state.masteryScore -= state.masteryScore * penaltyRate;
                        state.consecutiveCorrect = 0;
                    }

                    state.masteryScore = Math.max(0.01, Math.min(0.99, state.masteryScore));

                    if (newStability !== null) {
                        state.stability = newStability;
                    } else if (wasCorrect && state.stability < 100) {
                        state.stability *= 1.1;
                    } else if (!wasCorrect) {
                        state.stability = 1.0; // Reset on failure
                    }

                    state.lastReviewed = new Date().toISOString();
                    state.lastModified = new Date().toISOString();
                    state.recallHistory.push({ date: state.lastReviewed, wasCorrect, iqs });

                    store.put(state);
                };
            });
        }

        function calculatePRecall(stability, lastReviewedISO) {
            if (!lastReviewedISO || !stability) return 0.5;
            const now = new Date();
            const lastReviewed = new Date(lastReviewedISO);
            const elapsedDays = (now.getTime() - lastReviewed.getTime()) / (1000 * 3600 * 24);

            return Math.pow(2, -elapsedDays / stability);
        }

        function calculateRetentionAtDate(state, targetDate) {
            if (!state || !state.stability || !state.lastReviewed) return 0;
            const lastReviewed = new Date(state.lastReviewed);
            const target = new Date(targetDate);
            const elapsedDays = (target.getTime() - lastReviewed.getTime()) / (1000 * 3600 * 24);

            if (elapsedDays <= 0) return 1.0;

            return Math.pow(2, -elapsedDays / state.stability);
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

            const chunkSize = 5;
            studyState.sequenceChunks = [];
            for (let i = 0; i < sequenceCards.length; i += chunkSize) {
                studyState.sequenceChunks.push(sequenceCards.slice(i, i + chunkSize));
            }

            studyState.settings = deck.settings;
            studyState.sequenceCards = sequenceCards;
            studyState.currentRound = 1;
            studyState.startTime = new Date();
            studyState.originPlanId = null;

            if (deck.sequenceState && deck.sequenceState.currentChunkIndex < studyState.sequenceChunks.length) {
                studyState.currentChunkIndex = deck.sequenceState.currentChunkIndex;
                studyState.sequencePhase = deck.sequenceState.sequencePhase;
                showToast(`Resuming from Chunk ${studyState.currentChunkIndex + 1}...`, "info");
            } else {
                studyState.currentChunkIndex = 0;
                studyState.sequencePhase = null;
            }

            showView('studyMode');
            document.getElementById('studyTitle').textContent = 'Sequence Learner';
            document.getElementById('studySubtitle').textContent = deck.name;

            document.getElementById('progressView').classList.add('hidden');
            transitionSubView(null, document.getElementById('cardView'));

            if (studyState.sequencePhase) {
                showNextCard();
            } else {
                moveToNextSequencePhase();
            }
        }

        function selectOptimalQuestionType(card) {
            const deckIdForThisCard = card.deckId;
            const deckForThisCard = decks[deckIdForThisCard];

            if (!deckForThisCard) {
                console.error(`Could not find deck with ID ${deckIdForThisCard} for card "${card.question}". Defaulting to Flashcard.`);
                return 'Flashcard';
            }

            const allCardsInDeck = deckForThisCard.cards;
            const settings = deckForThisCard.settings?.adaptiveModes || { auto: true, mcq: true, cloze: true };

            const mastery = studyState.knowledgeStates.get(card.id)?.masteryScore || 0.5;

            if (!settings.auto) {
                if (settings.cloze && canGenerateQuestionType('Cloze', card, allCardsInDeck)) return 'Cloze';
                if (settings.mcq && canGenerateQuestionType('MultipleChoice', card, allCardsInDeck)) return 'MultipleChoice';
                return deckForThisCard.settings?.learnMode === 'write' ? 'Type' : 'Flashcard';
            }

            if (mastery < 0.6) {
                if (canGenerateQuestionType('MultipleChoice', card, allCardsInDeck)) {
                    return 'MultipleChoice';
                }
            }

            if (mastery < 0.85) {
                if (canGenerateQuestionType('Cloze', card, allCardsInDeck)) {
                    return 'Cloze';
                }
            }

            if (canGenerateQuestionType('Type', card, allCardsInDeck)) {
                return 'Type';
            }

            return 'Flashcard';
        }

        async function generateAndDisplayMCQ(correctCard) {
            const optionsContainer = document.getElementById('mcqOptions');
            const deckForThisCard = decks[correctCard.deckId];

            if (!deckForThisCard) {
                console.error("Deck not found for card:", correctCard.id, "DeckID:", correctCard.deckId);
                console.log("Available decks:", Object.keys(decks));
                // Fallback to simple flashcard if deck is missing (shouldn't happen)
                return;
            }

            if (correctCard.distractors && correctCard.distractors.length >= 3) {
                console.log("Using cached distractors for card:", correctCard.id);
                const finalOptions = shuffleArray([correctCard.answer, ...correctCard.distractors]);
                displayMCQButtons(finalOptions, correctCard);
                return;
            }

            if (isOnline) {
                console.log("No cached data. Calling API to generate distractors for card:", correctCard.id);
                try {
                    const requestBody = { question: correctCard.question, answer: correctCard.answer };
                    let generatedDistractors;

                    if (isElectron) {
                        generatedDistractors = await window.electronAPI.generateDistractors(requestBody);
                    } else {
                        const response = await fetch('/.netlify/functions/generateDistractors', {
                            method: 'POST',
                            body: JSON.stringify(requestBody)
                        });
                        if (!response.ok) throw new Error('Server function for distractors failed.');
                        const result = await response.json();
                        generatedDistractors = result.distractors;
                    }


                    if (generatedDistractors?.offline) {
                        throw new Error("Offline: " + (generatedDistractors.message || "Cannot generate distractors"));
                    }

                    if (generatedDistractors && generatedDistractors.length >= 3) {
                        const cardInDeck = deckForThisCard.cards.find(c => c.id === correctCard.id);
                        if (cardInDeck) {
                            cardInDeck.distractors = generatedDistractors;
                            await saveDataToDB('decks', deckForThisCard);
                            console.log("Distractors cached successfully for card:", correctCard.id);
                        }

                        const finalOptions = shuffleArray([correctCard.answer, ...generatedDistractors]);
                        displayMCQButtons(finalOptions, correctCard);
                        return;
                    }
                } catch (error) {
                    console.error("Failed to generate/cache distractors, falling back to random.", error);
                    const errorMsg = error.message || "Error generating options";
                    if (errorMsg.includes('Offline')) {
                        console.log("Offline mode detected, using random distractors");
                    } else {
                        showToast("Couldn't generate smart options, using random.", "warning");
                    }
                }
            }

            console.warn("Falling back to random distractors for card:", correctCard.id);
            const allCardsInDeck = deckForThisCard.cards;
            const options = new Set([correctCard.answer]);
            const randomFill = shuffleArray(allCardsInDeck.filter(card => card.id !== correctCard.id));
            for (const randomCard of randomFill) {
                if (options.size < 4) options.add(randomCard.answer);
                else break;
            }
            const finalOptions = shuffleArray(Array.from(options));
            displayMCQButtons(finalOptions, correctCard);
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
            updateCountdown(); // Initial update

            // Phase 1: Initial preloading with time limit
            for (let i = 0; i < cardsToGenerate.length; i += BATCH_SIZE) {
                // Check if we've exceeded time limit
                if (Date.now() - startTime > MAX_PRELOAD_TIME) {
                    console.log(`Preload time limit reached. Generated ${completedJobs}/${totalJobs} distractors. Remaining will generate in background.`);
                    showToast(`Pre-loaded ${completedJobs} questions. Others loading in background...`, 'info');

                    // Clear countdown interval
                    clearInterval(countdownInterval);

                    // Phase 2: Continue generation in background while user studies
                    const remainingCards = cardsToGenerate.slice(i);
                    if (remainingCards.length > 0) {
                        // Start background generation (non-blocking)
                        setTimeout(() => {
                            continueBackgroundGeneration(remainingCards, completedJobs, totalJobs, progressCallback);
                        }, 2000); // Start after 2 seconds to let study session begin
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

                // Add delay if there are more batches
                if (i + BATCH_SIZE < cardsToGenerate.length) {
                    await new Promise(resolve => setTimeout(resolve, DELAY_BETWEEN_BATCHES));
                }
            }

            // Clear countdown interval when preload completes
            clearInterval(countdownInterval);
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
            showView('aiGenerator');
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
                                <span class="document-status-icon">${doc.status === 'processing' ? '<div class="spinner"></div>' : (doc.status === 'done' ? '✓' : '📄')}</span>
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
                    }).then(result => {

                        if (!result) throw new Error('Empty response from server function.');

                        // Normalize response to include deckName if missing
                        const deckName = result.deckName || "AI Generated Deck";

                        if (result.type === 'flashcard' && Array.isArray(result.cards)) {
                            return { cards: result.cards.map(c => ({ question: c.question || c.q || '', answer: c.answer || c.a || '' })), deckName };
                        }

                        if (result.type === 'flashcard-legacy' && result.flashcardText) {
                            const cards = result.flashcardText.split('\n').map(line => {
                                const parts = line.split('\t');
                                return parts.length === 2 && parts[0].trim() && parts[1].trim()
                                    ? { question: parts[0].trim(), answer: parts[1].trim() }
                                    : null;
                            }).filter(Boolean);
                            return { cards, deckName };
                        }

                        if (result.type === 'sequence' && Array.isArray(result.sequences)) {
                            return {
                                sequences: result.sequences.map(s => ({ _isSequence: true, title: s.title || s.term || s.name || '', description: s.description || s.desc || s.note || '', steps: s.steps || [] })),
                                deckName
                            };
                        }

                        throw new Error('Unexpected response format from AI function.');
                    });
                }
                const generatedCards = await Promise.race([timeoutPromise, apiPromise]);

                console.log('[AI Generation] Response received:', generatedCards);

                // Handle offline response
                if (generatedCards?.offline) {
                    throw new Error(generatedCards.message || "Cannot generate cards offline");
                }

                // Ensure we have an array
                let cardsArray;
                if (Array.isArray(generatedCards)) {
                    cardsArray = generatedCards;
                } else if (generatedCards && Array.isArray(generatedCards.cards)) {
                    // Server returned {cards: [...]}
                    cardsArray = generatedCards.cards;
                } else if (generatedCards && Array.isArray(generatedCards.sequences)) {
                    // Server returned {sequences: [...]}
                    cardsArray = generatedCards.sequences;
                } else {
                    console.error('[AI Generation] Unexpected response format:', generatedCards);
                    throw new Error("AI returned data in an unexpected format.");
                }

                if (!cardsArray || cardsArray.length === 0) {
                    console.error('[AI Generation] Empty cards array. Full response:', JSON.stringify(generatedCards, null, 2));
                    throw new Error("AI did not return any cards. Check console for full response.");
                }

                // Pass the full object to preserve deckName and deckNotes
                renderAiGeneratedCards(generatedCards);
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

            if (Array.isArray(cardsData)) {
                cards = cardsData;
            } else if (cardsData && (cardsData.cards || cardsData.sequences)) {
                cards = cardsData.cards || cardsData.sequences;
                deckName = cardsData.deckName;
                deckNotes = cardsData.deckNotes;
            }

            listContainer.dataset.cards = JSON.stringify(cards);
            if (deckName) {
                listContainer.dataset.deckName = deckName;
            }
            if (deckNotes) {
                listContainer.dataset.deckNotes = deckNotes;
            }

            if (cards.length === 0) {
                listContainer.innerHTML = `
                    <div id="empty-flashcard-list" class="list-empty-state">
                        <div class="list-empty-state-icon"><svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M9.813 15.904 9 18.75l-.813-2.846a4.5 4.5 0 0 0-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 0 0 3.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 0 0 3.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 0 0-3.09 3.09ZM18.259 8.715 18 9.75l-.259-1.035a3.375 3.375 0 0 0-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 0 0 2.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 0 0 2.456 2.456L21.75 6l-1.035.259a3.375 3.375 0 0 0-2.456 2.456Z" /></svg></div>
                        <p>Generated cards will appear here after processing.</p>
                    </div>`;
            } else {

                listContainer.innerHTML = cards.map((card, index) => {
                    if (card._isSequence) {
                        const stepsHtml = (card.steps || []).map(s => `<li>${s}</li>`).join('');
                        return `
                            <div class="generated-sequence" data-index="${index}">
                                <div style="display:flex; justify-content:space-between; align-items:center; gap:12px;">
                                    <div style="font-weight:700; font-size:1.05rem;">${card.title || 'Sequence'}</div>
                                    <div class="generated-card-actions">
                                        <button class="generated-card-action-btn delete" title="Delete Sequence" onclick="deleteGeneratedCard(${index})">&times;</button>
                                    </div>
                                </div>
                                ${card.description ? `<div style="color:var(--secondary-text); margin-top:6px;">${card.description}</div>` : ''}
                                <ol style="margin-top:8px; padding-left:18px; color:var(--text-color);">${stepsHtml}</ol>
                            </div>
                        `;
                    } else {
                        return `
                            <div class="generated-card" data-index="${index}">
                                <div class="question">${card.question}</div>
                                <div class="answer">${card.answer}</div>
                                <div class="generated-card-actions">
                                    <button class="generated-card-action-btn delete" title="Delete Card" onclick="deleteGeneratedCard(${index})">&times;</button>
                                </div>
                            </div>
                        `;
                    }
                }).join('');
            }

            const heading = document.getElementById('flashcard-count');
            const isSequence = cards.length > 0 && cards[0]._isSequence;
            heading.textContent = isSequence ? `Generated Sequences (${cards.length})` : `Generated Flashcards (${cards.length})`;
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


            if (cards[0] && cards[0]._isSequence) {
                const finalCards = cards.map((s, idx) => ({
                    id: Date.now() + Math.random() + idx,
                    question: s.description || '',
                    answer: s.title || '',
                    order: idx + 1,
                    isNew: true,
                    questionImage: '',
                    answerImage: ''
                }));

                await createNewDeck(deckName, 'Other', finalCards, aiDeckNotes, 'Sequence');
                showToast(`Sequence deck "${deckName}" created successfully!`, 'success');
                backToDashboard();
                return;
            }


            const finalCards = cards.map((c, idx) => ({
                id: Date.now() + Math.random() + idx,
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
                sortableInstance.destroy();
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
                setTimeout(moveToNextSequencePhase, 1500);
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
            const currentChunk = studyState.sequenceChunks[studyState.currentChunkIndex];
            const card = (studyState.sequencePhase === 'Weakest Link')
                ? studyState.roundCards[studyState.currentCardIndex]
                : currentChunk[studyState.currentCardIndex];

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

            logInteraction({ cardID: card.id, wasCorrect: isCorrect, userAnswer: userAnswer, questionType: 'Sequence' });

            userInput.classList.toggle('correct', isCorrect);
            userInput.classList.toggle('incorrect', !isCorrect);
            userInput.disabled = true;
            showAnswer();
            const delay = isCorrect ? 800 : 2000;
            setTimeout(() => {
                moveCard(card, isCorrect);
            }, 800);
        }

        function dontKnowSequenceAnswer() {
            const currentChunk = studyState.sequenceChunks[studyState.currentChunkIndex];
            const card = (studyState.sequencePhase === 'Weakest Link')
                ? studyState.roundCards[studyState.currentCardIndex]
                : currentChunk[studyState.currentCardIndex];

            if (!card) return;

            logInteraction({ cardID: card.id, wasCorrect: false, userAnswer: "[Don't Know]", questionType: 'Sequence' });
            showAnswer();
            document.querySelector('#cardView .flashcard').classList.add('is-flipped');
            document.getElementById('cardAnswerContent').classList.remove('hidden');
            document.getElementById('writeAnswerInput').disabled = true;

            showToast("The correct answer is shown above.", "error");

            setTimeout(() => {
                moveCard(card, false);
            }, 2000);
        }

        async function showInsightsView() {

            const setupInsights = async () => {
                const deckSelect = document.getElementById('insightsDeckSelect');
                deckSelect.innerHTML = '<option value="">-- Select a Deck --</option>';
                Object.values(decks).forEach(deck => {
                    deckSelect.innerHTML += `<option value="${deck.id}">${deck.name}</option>`;
                });

                const allKnowledgeStates = await getAllDataFromDB('userKnowledgeState');
                const knowledgeMap = new Map(allKnowledgeStates.map(item => [item.cardID, item]));


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

            showView('insightsView', false, setupInsights);
        }

        function updateCardDetailListForInsights(deckId, knowledgeMap) {
            const list = document.getElementById('insightsCardList');
            const deck = decks[deckId];
            list.innerHTML = '';

            deck.cards.forEach(card => {
                const state = knowledgeMap.get(card.id);
                const masteryPercent = Math.round((state?.masteryScore || 0.5) * 100);
                const stability = state?.stability?.toFixed(1) || 'N/A';

                const cardItem = document.createElement('div');
                cardItem.className = 'deck-card-item';

                cardItem.innerHTML = `
                    <div style="flex-grow: 1;">${card.question}</div>
                    <div style="color:var(--secondary-text); font-weight:500;">Mastery: ${masteryPercent}% | Stability: ${stability}d</div>
                `;


                if (state) {
                    cardItem.style.cursor = 'pointer';
                    cardItem.addEventListener('click', () => {

                        renderForgettingCurveChart(state, deckId);
                    });
                }
                list.appendChild(cardItem);
            });
        }

        function renderForgettingCurveChart(cardState, deckId) {
            const canvasId = 'forgettingCurveChart';
            const cardDetailP = document.getElementById('cardDetailForCurve');
            if (chartInstances[canvasId]) chartInstances[canvasId].destroy();
            const ctx = document.getElementById(canvasId).getContext('2d');

            if (!cardState || !cardState.stability || !deckId) {
                cardDetailP.textContent = 'Select a card from the list to see its predicted curve.';
                chartInstances[canvasId] = new Chart(ctx, { data: { labels: [], datasets: [] }, options: { plugins: { legend: { display: false } } } });
                return;
            }

            const card = decks[deckId]?.cards.find(c => c.id === cardState.cardID);
            if (!card) {
                cardDetailP.textContent = 'Error: Could not find card details.';
                return;
            }
            cardDetailP.textContent = `Predicted curve for: "${card.question}"`;

            const stability = cardState.stability;
            const labels = [];
            const data = [];
            for (let t = 0; t <= stability * 3; t += Math.max(1, Math.round(stability / 10))) {
                labels.push(t);
                const pRecall = Math.pow(2, -t / stability);
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
                        x: { title: { display: true, text: 'Days Since Last Review' } }
                    },
                    plugins: { legend: { display: false } }
                }
            });
        }

        function renderMasteryBreakdownChart(deckId, knowledgeMap) {
            const canvasId = 'masteryBreakdownChart';
            if (chartInstances[canvasId]) chartInstances[canvasId].destroy();

            const deck = decks[deckId];
            let counts = { novice: 0, learning: 0, mastered: 0 };
            deck.cards.forEach(card => {
                const mastery = knowledgeMap.get(card.id)?.masteryScore || 0.5;
                if (mastery < 0.6) counts.novice++;
                else if (mastery < 0.95) counts.learning++;
                else counts.mastered++;
            });

            const ctx = document.getElementById(canvasId).getContext('2d');
            chartInstances[canvasId] = new Chart(ctx, {
                type: 'doughnut',
                data: {
                    labels: ['Novice (0-60%)', 'Learning (60-95%)', 'Mastered (95%+)'],
                    datasets: [{
                        data: [counts.novice, counts.learning, counts.mastered],
                        backgroundColor: ['#fc8181', '#f6ad55', '#68d391'],
                        borderColor: 'var(--card-bg)',
                        borderWidth: 4
                    }]
                },
                options: { responsive: true, cutout: '70%', plugins: { legend: { display: false } } }
            });

            const legend = document.getElementById('masteryLegend');
            legend.innerHTML = `
                <div style="display:flex; align-items:center; margin-bottom: 5px;"><div style="width:12px; height:12px; background-color:#fc8181; border-radius:50%; margin-right:8px;"></div>Novice: ${counts.novice} cards</div>
                <div style="display:flex; align-items:center; margin-bottom: 5px;"><div style="width:12px; height:12px; background-color:#f6ad55; border-radius:50%; margin-right:8px;"></div>Learning: ${counts.learning} cards</div>
                <div style="display:flex; align-items:center;"><div style="width:12px; height:12px; background-color:#68d391; border-radius:50%; margin-right:8px;"></div>Mastered: ${counts.mastered} cards</div>
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
                const state = knowledgeMap.get(card.id) || { masteryScore: 0.5 };

                const cardDueDate = (card.sm2Data && card.sm2Data.dueDate)
                    ? card.sm2Data.dueDate
                    : new Date(0).toISOString();
                const dueDate = new Date(cardDueDate);

                const daysOverdue = (now - dueDate) / (1000 * 3600 * 24);
                const dueFactor = daysOverdue > 0 ? 1 + Math.log(1 + daysOverdue) : 0;

                const masteryFactor = 1 - state.masteryScore;

                const urgencyFactor = 1 / totalDaysRemaining;

                const priorityScore = (dueFactor * 0.6) + (masteryFactor * 0.3) + (urgencyFactor * 0.1);

                return { ...card, priorityScore };
            });

            prioritizedCards.sort((a, b) => b.priorityScore - a.priorityScore);

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

            return prioritizedCards.slice(0, sessionSize);
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

            const allPlans = await getAllDataFromDB('examPlans');
            const currentPlan = allPlans.find(p => p.id === planId);

            showView('studyMode');
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

            showView('planDetailView');
        }

        function renderPlanAnalytics(plan, knowledgeMap) {
            const allCardsInPlan = [];
            plan.deckIds.forEach(deckId => {
                if (decks[deckId]) {
                    allCardsInPlan.push(...decks[deckId].cards);
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
            const cardStatesInPlan = allCardsInPlan.map(card => {
                return knowledgeMap.get(card.id) || { cardID: card.id, masteryScore: 0.5 };
            });

            let counts = { novice: 0, learning: 0, mastered: 0 };
            cardStatesInPlan.forEach(state => {
                if (state.masteryScore < 0.6) counts.novice++;
                else if (state.masteryScore < 0.95) counts.learning++;
                else counts.mastered++;
            });

            const masteryCanvasId = 'planMasteryChart';
            if (chartInstances[masteryCanvasId]) chartInstances[masteryCanvasId].destroy();
            const ctxMastery = document.getElementById(masteryCanvasId).getContext('2d');
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
                        deckMasterySum += (knowledgeMap.get(card.id)?.masteryScore || 0.5);
                    });
                    const deckProgress = deck.cards.length > 0 ? (deckMasterySum / deck.cards.length) * 100 : 0;
                    deckProgressData.data.push(deckProgress);
                }
            });

            const deckCanvasId = 'planDeckProgressChart';
            if (chartInstances[deckCanvasId]) chartInstances[deckCanvasId].destroy();
            const ctxDeck = document.getElementById(deckCanvasId).getContext('2d');
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
                .map(card => ({ ...card, masteryScore: (knowledgeMap.get(card.id)?.masteryScore || 0.5) }))
                .sort((a, b) => a.masteryScore - b.masteryScore)
                .slice(0, 10);

            hardestCardsList.innerHTML = sortedCards.map(card => `
                <div class="deck-card-item">
                    <div>${card.question}</div>
                    <div style="color:var(--danger-color); font-weight:500;">${Math.round(card.masteryScore * 100)}% Mastery</div>
                </div>
            `).join('');
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
            console.log('[DEBUG] updateUIAfterLogin called with user:', user.email);
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

            document.getElementById('loggedOutView').classList.add('hidden');
            document.getElementById('loggedInView').classList.remove('hidden');
            
            console.log('[DEBUG] Setting up event listeners for logged in user');
            setupEventListeners();
            
            await loadUserDataAndSync();

            loadCookieConsent();

            transitionView('dashboard');
        }

        function updateUIAfterLogout() {
            document.getElementById('userProfileMenu').classList.add('hidden');
            document.getElementById('userProfileDropdown').classList.add('hidden');
            document.getElementById('appHeader').classList.add('hidden');
            document.getElementById('welcomeMessage').textContent = `Lagiote Revise`;
            document.getElementById('loggedInView').classList.add('hidden');
            document.getElementById('loggedOutView').classList.remove('hidden');

            decks = {};
            analyticsData = {};
            updateDashboard();

            showView('authView');
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
                for (const serverDeck of syncResult.updatedDecks) {
                    const localDeck = localDecksMap.get(serverDeck.id);

                    if (localDeck) {
                        // Conflict resolution: compare timestamps
                        const serverTime = serverDeck.lastModified ? new Date(serverDeck.lastModified) : new Date(0);
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

                    // Update with server version
                    deckStore.put(serverDeck);
                }

                // CRITICAL FIX: Reload all decks from IndexedDB after sync
                // This ensures local-only decks (not returned by server) are preserved
                await new Promise(resolve => deckTransaction.oncomplete = resolve);
                const allDecksAfterSync = await getAllDataFromDB('decks');
                decks = {};
                allDecksAfterSync.forEach(deck => {
                    decks[deck.id] = deck;
                });

                console.log('After reload - All decks:', Object.keys(decks));

                if (conflictsResolved > 0) {
                    showToast(`Sync complete. ${conflictsResolved} local change(s) preserved.`, 'info');
                }

                const knowledgeTransaction = db.transaction(['userKnowledgeState'], 'readwrite');
                const knowledgeStore = knowledgeTransaction.objectStore('userKnowledgeState');
                for (const serverState of syncResult.updatedKnowledgeStates) {
                    knowledgeStore.put(serverState);
                }

                if (syncResult.updatedExamPlans) {
                    const planTransaction = db.transaction(['examPlans'], 'readwrite');
                    const planStore = planTransaction.objectStore('examPlans');
                    for (const serverPlan of syncResult.updatedExamPlans) {
                        planStore.put(serverPlan);
                    }
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
                    console.log('Session expired or invalid. Clearing session.');
                    localStorage.removeItem('auth0Session');
                    showToast('Session expired. Please log in again.', 'warning');
                    // Optional: trigger logout UI update if needed
                    // updateUIAfterLogout(); 
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
            showView('libraryView');
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
                if (sortableInstance) sortableInstance.destroy();
                sortableInstance = new Sortable(container, {
                    animation: 150,
                    handle: '.drag-handle',
                    ghostClass: 'drag-ghost',
                    onEnd: editorRenumberCards
                });
            } else {
                document.querySelector('.add-question-btn').onclick = () => editorAddNewCard('Standard');
                cards.forEach(card => editorAddNewCard('Standard', card));
                if (sortableInstance) sortableInstance.destroy();
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

        async function generateFullDataExport() {
            // 1. Notify user it started
            const btn = event.target.closest('button');
            const originalText = btn.innerHTML;
            btn.innerHTML = '<span class="spinner" style="width:16px; height:16px; border-width:2px;"></span> Collecting...';
            btn.disabled = true;

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
                // Restore button
                btn.innerHTML = originalText;
                btn.disabled = false;
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
                        const defaultState = {
                            userID: 'default_user',
                            cardID: card.id,
                            masteryScore: 0.5,
                            stability: 1.0,
                            lastReviewed: new Date().toISOString(),
                            recallHistory: []
                        };
                        const request = store.put(defaultState);
                        request.onsuccess = resolve;
                        request.onerror = reject;
                    });
                });

                await Promise.all(resetPromises);

                // Also reset internal SM2 data if it exists on the deck object
                const sm2 = new SM2Algorithm();
                deck.cards.forEach(card => {
                    // Reset to default SM2 state (interval 0, factor 2.5)
                    card.sm2Data = sm2.calculateNextReview({})(3);
                    // The '3' passed above is just to trigger the default structure generation in the helper
                    // Manually reset specific fields to be sure
                    card.sm2Data.interval = 0;
                    card.sm2Data.repetition = 0;
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





