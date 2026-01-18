import { isTestMode, getTestConfig, getTestSession } from '../../src/platform/shared/test-mode.js';
import { getTestFixtures } from '../../src/platform/shared/test-fixtures.js';
import {
    CARD_TYPES,
    CARD_TYPE_LABELS,
    normalizeCardType,
    detectCardType,
    expandCard,
    normalizeCardFromImport,
    parseTextToCards,
    parseClozeText,
    renderClozeText,
    getClozeAnswer,
    gradeTypedAnswer,
    requiresTypedInput,
    getInputMode
} from '../core/card-types.js';

console.log('Test 1: Script is starting!');
const pdfWorkerSrc = isTestMode() ? '' : 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/2.11.338/pdf.worker.min.js';
if (pdfjsLib?.GlobalWorkerOptions) {
    pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerSrc;
}

const isElectron = typeof window.electronAPI !== 'undefined';
const authApi = window.authSession || (window.lagiote && window.lagiote.authSession) || null;
const learnModeAdapterFactory = window.createLearnModeAdapter || null;
const reviewModeAdapterFactory = window.createReviewModeAdapter || null;
let toastQueue = [];
let currentEditingPlanId = null;
let dailyPriorityQueue = [];
let isToastVisible = false;
let sortableInstance = null;
let sequenceSortable = null;
let sequenceStepSortables = new Map();
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
    evalExposureLogged: { cardId: null, token: null },
    preGenerationCountdownInterval: null,
    preGeneratedDistractors: new Map(),
    examDate: null,
    targetRetention: 0.8,
    cortexDebugEnabled: false,
    pendingMCQToken: 0,
    pendingMCQCardId: null,
    mcqPipeline: null,
    spacedQueue: [],
    spacedMeta: new Map(),
    spacedAnswerShown: false,
    spacedCounts: { dueRemaining: 0, newRemaining: 0 },
    sequenceSession: null,
    sequenceAccuracy: [],
    mcqRemediation: {
        queue: [],
        cooldownUntil: 0,
        cooldownMs: 60000,
        maxQueue: 20,
        pendingSteps: 0,
        activeTask: null
    }
};
let eventListenersInitialized = false;

function getStoredSessionRaw() {
    if (authApi && typeof authApi.getStoredSessionRaw === 'function') {
        return authApi.getStoredSessionRaw();
    }
    return localStorage.getItem('auth0Session');
}

function getStoredSession() {
    if (authApi && typeof authApi.getStoredSession === 'function') {
        return authApi.getStoredSession();
    }
    const raw = getStoredSessionRaw();
    if (!raw) return null;
    try {
        return JSON.parse(raw);
    } catch (e) {
        return null;
    }
}

function getAuthTokenFromSession(session) {
    if (authApi && typeof authApi.getAccessToken === 'function') {
        return authApi.getAccessToken(session);
    }
    if (!session || typeof session !== 'object') return null;
    return session.accessToken || session.token || session.access_token || session.id_token || session.idToken || null;
}

function saveAuthSession(session) {
    if (authApi && typeof authApi.saveSession === 'function') {
        authApi.saveSession(session);
        return;
    }
    localStorage.setItem('auth0Session', JSON.stringify(session));
}

function clearAuthSession() {
    if (authApi && typeof authApi.clearSession === 'function') {
        authApi.clearSession();
        return;
    }
    localStorage.removeItem('auth0Session');
}

function getGuestIdFromSession() {
    if (authApi && typeof authApi.getOrCreateGuestID === 'function') {
        return authApi.getOrCreateGuestID();
    }
    let guestId = localStorage.getItem('guestID');
    if (!guestId) {
        guestId = crypto.randomUUID();
        localStorage.setItem('guestID', guestId);
    }
    return guestId;
}

function isGuestModeEnabled() {
    if (authApi && typeof authApi.isGuestMode === 'function') {
        return authApi.isGuestMode();
    }
    return localStorage.getItem('guestMode') === 'true' || sessionStorage.getItem('guestMode') === 'true';
}

function getDevSyncToken() {
    if (isElectron) return null;
    const env = import.meta.env || {};
    const token = typeof env.VITE_DEV_SYNC_BEARER_TOKEN === 'string' ? env.VITE_DEV_SYNC_BEARER_TOKEN.trim() : '';
    if (!env.DEV || !token) return null;
    const hostname = window.location?.hostname;
    const isLocalhost = hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]';
    return isLocalhost ? token : null;
}

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

function formatIntervalFromNow(dueDate, now = new Date()) {
    if (!dueDate) return '';
    const target = dueDate instanceof Date ? dueDate : new Date(dueDate);
    if (Number.isNaN(target.getTime())) return '';
    const diffMs = Math.max(0, target.getTime() - now.getTime());
    const minutes = Math.round(diffMs / 60000);
    if (minutes < 60) return `${Math.max(1, minutes)}m`;
    const hours = Math.round(diffMs / 3600000);
    if (hours < 48) return `${hours}h`;
    const days = Math.round(diffMs / 86400000);
    if (days < 365) return `${days}d`;
    return `${Math.max(1, Math.round(days / 365))}y`;
}

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

function normalizeMetricValue(value) {
    const num = Number(value);
    if (!Number.isFinite(num)) return 0;
    const normalized = num > 1 ? num : num * 100;
    return Math.max(0, Math.min(100, normalized));
}

function getMetricLevel(percent) {
    if (percent >= 70) return 'high';
    if (percent >= 40) return 'mid';
    return 'low';
}

function renderVisualMetric({ label = 'Metric', value = 0, kind = 'metric' } = {}) {
    const percent = normalizeMetricValue(value);
    const level = getMetricLevel(percent);
    const wrapper = document.createElement('span');
    const labelText = String(label || 'Metric').trim() || 'Metric';
    wrapper.className = `metric-chip metric--${level}`;
    wrapper.setAttribute('role', 'img');
    wrapper.setAttribute('aria-label', `${labelText} ${percent.toFixed(0)} percent`);
    wrapper.title = `${labelText}: ${percent.toFixed(0)}%`;
    wrapper.dataset.metricKind = kind;
    wrapper.tabIndex = 0;

    const dot = document.createElement('span');
    dot.className = 'metric-dot';
    wrapper.appendChild(dot);

    const labelEl = document.createElement('span');
    labelEl.className = 'metric-label';
    labelEl.textContent = labelText;
    wrapper.appendChild(labelEl);

    const bar = document.createElement('span');
    bar.className = 'metric-bar';
    const fill = document.createElement('span');
    fill.className = 'metric-bar-fill';
    fill.style.setProperty('--metric-fill', `${percent}%`);
    bar.appendChild(fill);
    wrapper.appendChild(bar);

    return wrapper;
}

function renderMetricInto(target, options = {}, extraClasses = []) {
    const el = typeof target === 'string' ? document.getElementById(target) : target;
    if (!el) return null;
    el.innerHTML = '';
    const metric = renderVisualMetric(options);
    if (Array.isArray(extraClasses) && extraClasses.length) {
        metric.classList.add(...extraClasses.filter(Boolean));
    }
    el.appendChild(metric);
    return metric;
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
    forgivingAutomarking: true,
    spacedNewPerDay: 20,
    spacedMaxReviewsPerDay: 200,
    spacedOrder: 'dueThenNew',
    spacedRequeueAgain: true,
    spacedShowIntervals: true,
    sequenceChunkMin: 2,
    sequenceChunkMax: 8,
    sequenceStartChunk: 4,
    sequenceMixingThreshold: 0.8,
    sequenceAllowMixed: true
};
function normalizeTestDeckFixture(fixture, seededAt) {
    const deckId = String(fixture.id || crypto.randomUUID());
    const cards = Array.isArray(fixture.cards) ? fixture.cards.map((card, index) => {
        const cardId = card.id || crypto.randomUUID();
        const normalized = {
            ...card,
            id: cardId,
            deckId
        };
        if (typeof normalized.order !== 'number') {
            normalized.order = index;
        }
        return normalized;
    }) : [];

    const normalized = {
        id: deckId,
        name: fixture.name || 'Test Deck',
        category: fixture.category || 'Other',
        notes: fixture.notes || '',
        cards,
        created: fixture.created || seededAt,
        lastModified: fixture.lastModified || seededAt,
        analysisVersion: CURRENT_ANALYSIS_VERSION,
        settings: { ...DEFAULT_DECK_SETTINGS, ...(fixture.settings || {}) }
    };

    if (fixture.typeHint) normalized.typeHint = fixture.typeHint;
    if (fixture.sequenceMeta) normalized.sequenceMeta = fixture.sequenceMeta;
    if (fixture.sequenceSteps) normalized.sequenceSteps = fixture.sequenceSteps;

    return normalized;
}

async function deleteDatabase(name) {
    return new Promise((resolve, reject) => {
        const request = indexedDB.deleteDatabase(name);
        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error || new Error('Failed to delete database'));
        request.onblocked = () => resolve();
    });
}

async function resetDatabaseForTests() {
    if (db) {
        try {
            db.close();
        } catch (error) {
            console.warn('Failed to close DB before reset', error);
        }
    }
    await deleteDatabase(DB_NAME);
    await initDB();
}

async function seedTestData() {
    const fixtures = getTestFixtures();
    if (!fixtures || !Array.isArray(fixtures.decks)) return;
    const seededAt = fixtures.seededAt || new Date().toISOString();
    const categoriesToUse = Array.isArray(fixtures.categories) && fixtures.categories.length
        ? fixtures.categories
        : categories;
    categories = categoriesToUse;
    await saveDataToDB('appData', { key: 'categories', data: categoriesToUse });
    for (const fixture of fixtures.decks) {
        const normalized = normalizeTestDeckFixture(fixture, seededAt);
        await saveDataToDB('decks', normalized);
        for (const card of normalized.cards) {
            const record = createDefaultKnowledgeState({ id: card.id, deckID: normalized.id }, {
                userID: 'default_user',
                deckID: normalized.id,
                stability: 1.0,
                lastReviewed: seededAt,
                fsrs: card.fsrs || null
            });
            if (record) {
                await saveDataToDB('userKnowledgeState', record);
            }
        }
    }
}

async function applyTestModeSetup() {
    if (!isTestMode()) return;
    const config = getTestConfig();
    if (config.reset) await resetDatabaseForTests();
    if (config.seed) await seedTestData();
    if (window.lagiote?.db?.initDB) {
        try {
            await window.lagiote.db.initDB();
        } catch (error) {
        }
    }
    if (typeof window.Sortable !== 'function') {
        window.Sortable = class {
            constructor() {}
            destroy() {}
        };
    }
    if (config.auth === 'user') {
        saveAuthSession(getTestSession());
        localStorage.removeItem('guestMode');
        sessionStorage.removeItem('guestMode');
    } else if (config.auth === 'guest') {
        clearAuthSession();
        localStorage.setItem('guestMode', 'true');
        sessionStorage.setItem('guestMode', 'true');
    } else {
        clearAuthSession();
        localStorage.removeItem('guestMode');
        sessionStorage.removeItem('guestMode');
    }
    window.generateDeckAdapter = async () => ({
        type: 'flashcard',
        deckName: 'AI Test Deck',
        deckNotes: 'Generated in test mode',
        language: 'English',
        cards: [
            { question: 'AI Question 1', answer: 'AI Answer 1' },
            { question: 'AI Question 2', answer: 'AI Answer 2' },
            { question: 'AI Question 3', answer: 'AI Answer 3' }
        ]
    });
    window.__TEST_READY__ = true;
}

function assignTestId(element, testId) {
    if (!element || !testId) return;
    element.dataset.testid = testId;
}

function assignTestIdIn(containerSelector, selector, testId) {
    const container = document.querySelector(containerSelector);
    if (!container) return;
    const el = container.querySelector(selector);
    assignTestId(el, testId);
}

function assignTestIds() {
    const explicitMap = {
        authSignupBtn: 'auth-signup',
        authLoginBtn: 'auth-login',
        continueAsGuestBtn: 'auth-continue-guest',
        rememberGuestCheckbox: 'auth-remember-guest',
        headerBackBtn: 'nav-back',
        headerHomeBtn: 'nav-home',
        headerSettingsBtn: 'nav-settings',
        guestSignupBtn: 'nav-signup',
        userProfileBtn: 'nav-profile',
        searchInput: 'search-decks',
        syncBtn: 'profile-sync',
        checkUpdatesBtn: 'profile-check-updates',
        logoutBtn: 'profile-logout',
        deckDetailSequenceBtn: 'mode-sequence-start',
        deckDetailSpacedBtn: 'mode-spaced-start',
        deckDetailTestBtn: 'mode-practice-start',
        deckDetailResetBtn: 'deck-reset',
        deckDetailSettingsBtn: 'deck-settings',
        deckDetailExportBtn: 'deck-export',
        deckDetailEditBtn: 'deck-edit',
        deckDetailDeleteBtn: 'deck-delete',
        continueBtn: 'study-continue-round',
        resetBtn: 'study-reset-progress',
        showAnswerBtn: 'answer-show',
        showQuestionBtn: 'answer-show-question',
        checkAnswerBtn: 'answer-check',
        dontKnowBtn: 'answer-dont-know',
        nextBtn: 'answer-next',
        incorrectBtn: 'answer-incorrect',
        correctBtn: 'answer-correct',
        spacedAgainBtn: 'rating-again',
        spacedHardBtn: 'rating-hard',
        spacedGoodBtn: 'rating-good',
        spacedEasyBtn: 'rating-easy',
        sequenceSubmitBtn: 'sequence-submit',
        sequenceContinueBtn: 'sequence-continue',
        writeAnswerInput: 'answer-input',
        mcqOptions: 'mcq-options',
        testInstructionsBtn: 'test-instructions',
        testShowAnswerBtn: 'test-show-answer',
        testCheckAnswerBtn: 'test-check-answer',
        testIncorrectBtn: 'test-incorrect',
        testCorrectBtn: 'test-correct',
        testNextBtn: 'test-next',
        testReviewBtn: 'test-review',
        testApplyLearningBtn: 'test-apply-learning',
        importTabPaste: 'import-tab-paste',
        importTabFile: 'import-tab-file',
        importDeckName: 'import-deck-name',
        importDeckCategory: 'import-deck-category',
        importDeckTypeHint: 'import-deck-type',
        importPastedText: 'import-paste-text',
        importFileInput: 'import-file-input',
        examPlanName: 'exam-plan-name',
        examPlanDate: 'exam-plan-date',
        examPlanDeckSelector: 'exam-plan-decks',
        confirmActionCancelBtn: 'confirm-cancel',
        confirmActionConfirmBtn: 'confirm-confirm',
        resumeStudyBtn: 'resume-study',
        editStudyCardBtn: 'study-edit-card',
        switchStudyModeBtn: 'study-switch-mode',
        instructionsBtn: 'study-instructions',
        pomodoroPlayPause: 'pomodoro-toggle',
        deckAccentToggle: 'accent-toggle',
        testAccentToggle: 'test-accent-toggle',
        aiCardType: 'ai-card-type',
        aiCardCount: 'ai-card-count',
        aiLanguage: 'ai-language',
        'select-file-btn': 'ai-select-files',
        'add-text-btn': 'ai-add-text',
        'process-btn': 'ai-process',
        'save-deck-btn': 'ai-save-deck',
        'file-drop-zone': 'ai-drop-zone',
        deckTitle: 'deck-title',
        deckCategory: 'deck-category',
        deckTypeHint: 'deck-type',
        deckNotes: 'deck-notes',
        testDuration: 'test-duration',
        testTotalMarks: 'test-total-marks',
        testQuestionCount: 'test-question-count',
        optAllowBack: 'test-allow-back',
        optShowTimer: 'test-show-timer',
        optStrictMarking: 'test-strict-marking',
        optConfidence: 'test-confidence',
        insightsDeckSelect: 'insights-deck-select',
        darkModeToggle: 'settings-dark-mode',
        enableInStudyEditing: 'settings-editing',
        enableToastsToggle: 'settings-toasts',
        toggleExamPlanBanner: 'settings-exam-banner',
        enablePomodoroToggle: 'settings-pomodoro',
        adaptiveAutoToggle: 'settings-adaptive-auto',
        adaptiveMcqToggle: 'settings-adaptive-mcq',
        adaptiveClozeToggle: 'settings-adaptive-cloze',
        caseSensitiveToggle: 'settings-case-sensitive',
        punctuationToggle: 'settings-punctuation',
        retypeIncorrectToggle: 'deck-settings-retype-incorrect',
        deckSettingsExamModeToggle: 'deck-settings-exam-toggle',
        deckSettingsExamDate: 'deck-settings-exam-date',
        deckSettingsRetention: 'deck-settings-retention',
        deckSettingsCardsPerRound: 'deck-settings-cards-per-round',
        deckSettingsLearnHorizon: 'deck-settings-learn-horizon',
        deckSettingsStudyModeFlashcard: 'deck-settings-mode-flashcard',
        deckSettingsStudyModeWrite: 'deck-settings-mode-write',
        deckSettingsSequenceChunkMin: 'deck-settings-sequence-chunk-min',
        deckSettingsSequenceChunkMax: 'deck-settings-sequence-chunk-max',
        deckSettingsSequenceStartChunk: 'deck-settings-sequence-start-chunk',
        deckSettingsSequenceMixingThreshold: 'deck-settings-sequence-mixing-threshold',
        deckSettingsSequenceAllowMixed: 'deck-settings-sequence-allow-mixed',
        reviewOrder: 'deck-settings-review-order',
        deckSettingsSpacedNewPerDay: 'deck-settings-spaced-new',
        deckSettingsSpacedMaxReviews: 'deck-settings-spaced-max',
        deckSettingsSpacedOrder: 'deck-settings-spaced-order',
        deckSettingsSpacedRequeueAgain: 'deck-settings-spaced-requeue',
        deckSettingsSpacedShowIntervals: 'deck-settings-spaced-intervals'
    };

    Object.entries(explicitMap).forEach(([id, testId]) => {
        const el = document.getElementById(id);
        if (el) assignTestId(el, testId);
    });

    document.querySelectorAll('button[id], input[id], select[id], textarea[id], a[id]').forEach(el => {
        if (!el.dataset.testid) {
            el.dataset.testid = el.id;
        }
    });

    const headerLogo = document.querySelector('#appHeader .logo');
    assignTestId(headerLogo, 'nav-logo');

    const createCards = Array.from(document.querySelectorAll('.create-card'));
    const createIds = ['deck-create-manual', 'deck-import', 'deck-create-ai'];
    createCards.forEach((card, index) => {
        const testId = createIds[index];
        if (testId) assignTestId(card, testId);
    });

    assignTestIdIn('#examPlanCtaContainer', '.close-btn', 'exam-plan-banner-close');
    assignTestIdIn('#examPlanCtaContainer', 'button[onclick="showExamPlanModal()"]', 'exam-plan-create');
    assignTestIdIn('#deckDetailActions', 'button[onclick="configureStudy(\'learn\')"]', 'mode-learn-start');
    assignTestIdIn('#deckDetailActions', 'button[onclick="configureStudy(\'review\')"]', 'mode-review-start');
    assignTestIdIn('#dashboard', '.dashboard-footer button[onclick="renderGlobalAnalytics()"]', 'nav-global-analytics');
    assignTestIdIn('#dashboard', '.dashboard-footer button[onclick="showInsightsView()"]', 'nav-insights');
    assignTestIdIn('#progressView', 'button[onclick="endSession()"]', 'study-end-session');
    assignTestIdIn('#completeView', 'button[onclick="restartStudy()"]', 'study-restart');
    assignTestIdIn('#completeView', 'button[onclick="endSession()"]', 'study-end-session-complete');
    assignTestIdIn('#pomodoroTimer', 'button[onclick="resetPomodoro()"]', 'pomodoro-reset');
    assignTestIdIn('#practiceTestView #testProgressView', 'button[onclick="startTest()"]', 'test-start');
    assignTestIdIn('#practiceTestView #testCompleteView', 'button[onclick="restartTest()"]', 'test-restart');
    assignTestIdIn('#practiceTestView #testCompleteView', 'button[onclick="endTest()"]', 'test-end');
    assignTestIdIn('#practiceTestModal', '.modal-actions .btn.btn-secondary', 'practice-test-cancel');
    assignTestIdIn('#practiceTestModal', '.modal-actions .btn.btn-success', 'practice-test-generate');
    assignTestIdIn('#importModal', '.modal-actions .btn.btn-success', 'import-confirm');
    assignTestIdIn('#examPlanModal', '.modal-actions .btn.btn-secondary', 'exam-plan-cancel');
    assignTestIdIn('#examPlanModal', '.modal-actions .btn.btn-success', 'exam-plan-save');
    assignTestIdIn('#settingsView', 'button[onclick="saveUsername()"]', 'settings-save-name');
    assignTestIdIn('#settingsView', 'button[onclick="saveStudySettings()"]', 'settings-save-study');
    assignTestIdIn('#settingsView', 'button[onclick^="generateFullDataExport"]', 'settings-export-data');
    assignTestIdIn('#settingsView', 'button[onclick="clearAllDecks()"]', 'settings-clear-decks');
    assignTestIdIn('#editorView', 'button[onclick="editorSaveDeck()"]', 'deck-save');
    assignTestIdIn('#editorView', '.add-question-btn', 'deck-add-card');
    assignTestIdIn('#editorView', 'button[onclick^="triggerNotesImageUpload"]', 'deck-notes-upload');
    assignTestIdIn('#importModal', 'button[onclick="importData()"]', 'import-create');
    assignTestIdIn('#learnModeSetupModal', 'button[onclick="closeLearnModeSetupModal()"]', 'learn-setup-cancel');
    assignTestIdIn('#learnModeSetupModal', 'button[onclick="startLearnModeWithSetup()"]', 'learn-setup-start');
    assignTestIdIn('#deckSettingsModal', 'button[onclick="closeDeckSettingsModal()"]', 'deck-settings-cancel');
    assignTestIdIn('#deckSettingsModal', 'button[onclick="saveDeckSettings()"]', 'deck-settings-save');
    assignTestIdIn('#editCardModal', 'button[onclick="saveEditedCard()"]', 'edit-card-save');
    assignTestIdIn('#editCardModal', 'button[onclick="closeEditCardModal()"]', 'edit-card-cancel');
    assignTestIdIn('#editAiCardModal', 'button[onclick="saveAiEditedCard()"]', 'edit-ai-card-save');
    assignTestIdIn('#editAiCardModal', 'button[onclick="closeEditAiCardModal()"]', 'edit-ai-card-cancel');
    assignTestIdIn('#takeABreakModal', 'button[onclick="endSession()"]', 'break-end-session');
    assignTestIdIn('#takeABreakModal', 'button[onclick^="document.getElementById(\'takeABreakModal\')"]', 'break-keep-going');
    assignTestIdIn('#addCategoryModal', 'button[onclick="saveNewCategory()"]', 'category-save');
    assignTestIdIn('#customPromptModal', 'button[onclick="saveCustomPrompt()"]', 'custom-prompt-save');
    assignTestIdIn('#practiceTestView', '#testAnswerInput', 'test-answer-input');
    assignTestIdIn('#practiceTestView', '#testOptions', 'test-options');
    assignTestIdIn('#aiGenerator', '#document-list', 'ai-document-list');
    assignTestIdIn('#aiGenerator', '#flashcard-list', 'ai-flashcard-list');

    document.querySelectorAll('.modal').forEach(modal => {
        const closeBtn = modal.querySelector('.close');
        if (closeBtn && modal.id) {
            assignTestId(closeBtn, `modal-close-${modal.id}`);
        }
    });
}
const SEQUENCE_TASK_TYPES = ['order', 'next', 'gap'];
const SEQUENCE_GRAPH_ALPHA = 0.18;
let sequenceGraphModulePromise = null;

async function getSequenceGraphModule() {
    if (!sequenceGraphModulePromise) {
        sequenceGraphModulePromise = import('../core/sequence-graph.js');
    }
    return sequenceGraphModulePromise;
}

function getSequenceGraphCardId(deckId, sequenceId) {
    return `sequenceGraph:${String(deckId)}:${String(sequenceId || 'default')}`;
}
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
if (typeof window !== 'undefined' && !('currentViewingDeckId' in window)) {
    Object.defineProperty(window, 'currentViewingDeckId', {
        get() {
            return currentViewingDeckId;
        },
        set(value) {
            currentViewingDeckId = value;
        }
    });
}

// Lightweight safe binder: no-ops if element missing
function bind(id, event, handler, options) {
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener(event, handler, options);
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

function buildSequenceGroups(cards = [], sequenceMeta = {}) {
    const groups = new Map();
    cards.forEach((card, idx) => {
        if (!card) return;
        const sequenceId = card.sequenceId || card.sequenceID || null;
        if (!sequenceId) return;
        const entry = groups.get(sequenceId) || [];
        entry.push({ card, idx });
        groups.set(sequenceId, entry);
    });
    return Array.from(groups.entries()).map(([sequenceId, items], index) => {
        const title = sequenceMeta?.[sequenceId]?.title || items[0]?.card?.sequenceTitle || `Sequence ${index + 1}`;
        const description = sequenceMeta?.[sequenceId]?.description || '';
        const sortedSteps = [...items].sort((a, b) => {
            const aOrder = typeof a.card.order === 'number' ? a.card.order : a.idx;
            const bOrder = typeof b.card.order === 'number' ? b.card.order : b.idx;
            const aStep = typeof a.card.stepIndex === 'number' ? a.card.stepIndex : aOrder;
            const bStep = typeof b.card.stepIndex === 'number' ? b.card.stepIndex : bOrder;
            if (aStep === bStep) return aOrder - bOrder;
            return aStep - bStep;
        }).map(entry => entry.card);
        return { sequenceId, title, description, steps: sortedSteps };
    });
}

function normalizeSequenceDeck(deck) {
    if (!deck || deck.typeHint !== 'Sequence') return false;
    let changed = false;
    const allowNumericIds = isTestMode();
    if (!deck.sequenceMeta || typeof deck.sequenceMeta !== 'object') {
        deck.sequenceMeta = {};
        changed = true;
    }
    const cards = Array.isArray(deck.cards) ? deck.cards : [];
    if (!cards.length) return changed;

    const existingSequenceIds = new Set();
    cards.forEach(card => {
        if (!card) return;
        if (Number.isFinite(card.id) && !allowNumericIds) {
            card.id = String(card.id);
            changed = true;
        }
        const rawSequenceId = card.sequenceId ?? card.sequenceID;
        if (rawSequenceId === undefined || rawSequenceId === null) return;
        const normalizedSequenceId = String(rawSequenceId).trim();
        if (!normalizedSequenceId) {
            if (card.sequenceId) {
                card.sequenceId = null;
                changed = true;
            }
            return;
        }
        if (card.sequenceId !== normalizedSequenceId) {
            card.sequenceId = normalizedSequenceId;
            changed = true;
        }
        existingSequenceIds.add(normalizedSequenceId);
    });
    const metaIds = Object.keys(deck.sequenceMeta || {});

    if (!existingSequenceIds.size) {
        const fallbackId = String(metaIds[0] || crypto.randomUUID());
        const title = deck.sequenceMeta?.[fallbackId]?.title || deck.name || 'Sequence';
        deck.sequenceMeta[fallbackId] = deck.sequenceMeta[fallbackId] || { title };
        cards.forEach((card, idx) => {
            card.sequenceId = fallbackId;
            card.sequenceTitle = card.sequenceTitle || title;
            card.stepIndex = idx;
            card.order = typeof card.order === 'number' ? card.order : idx;
        });
        changed = true;
    } else {
        const titleLookup = new Map();
        metaIds.forEach(id => {
            const title = deck.sequenceMeta[id]?.title;
            if (title) titleLookup.set(title.toLowerCase(), id);
        });
        const sequenceIdsArray = Array.from(existingSequenceIds);
        const primaryMetaId = metaIds[0] || sequenceIdsArray[0] || null;
        cards.forEach(card => {
            if (card.sequenceId && String(card.sequenceId).trim()) return;
            const titleKey = (card.sequenceTitle || '').trim().toLowerCase();
            let matchId = null;
            if (titleKey && titleLookup.has(titleKey)) {
                matchId = titleLookup.get(titleKey);
            } else if (titleKey) {
                const matchingCard = cards.find(c => c.sequenceId && (c.sequenceTitle || '').trim().toLowerCase() === titleKey);
                if (matchingCard?.sequenceId) {
                    matchId = String(matchingCard.sequenceId);
                }
            }
            const targetId = matchId || primaryMetaId || sequenceIdsArray[0] || null;
            if (targetId) {
                const normalizedTargetId = String(targetId);
                card.sequenceId = normalizedTargetId;
                if (!card.sequenceTitle && deck.sequenceMeta?.[normalizedTargetId]?.title) {
                    card.sequenceTitle = deck.sequenceMeta[normalizedTargetId].title;
                }
                changed = true;
            }
        });
    }

    const groups = new Map();
    cards.forEach((card, idx) => {
        const rawSequenceId = card.sequenceId;
        if (!rawSequenceId) return;
        const sequenceId = String(rawSequenceId).trim();
        if (!sequenceId) return;
        if (card.sequenceId !== sequenceId) {
            card.sequenceId = sequenceId;
            changed = true;
        }
        const arr = groups.get(sequenceId) || [];
        arr.push({ card, idx });
        groups.set(sequenceId, arr);
    });

    const grouped = Array.from(groups.entries());
    grouped.forEach(([sequenceId, items], groupIndex) => {
        const sorted = [...items].sort((a, b) => {
            const aOrder = typeof a.card.order === 'number' ? a.card.order : a.idx;
            const bOrder = typeof b.card.order === 'number' ? b.card.order : b.idx;
            return aOrder - bOrder;
        });
        sorted.forEach((entry, stepIndex) => {
            if (entry.card.stepIndex !== stepIndex) {
                entry.card.stepIndex = stepIndex;
                changed = true;
            }
            if (typeof entry.card.order !== 'number') {
                entry.card.order = stepIndex;
                changed = true;
            }
            const normalizedTitle = typeof entry.card.sequenceTitle === 'string'
                ? entry.card.sequenceTitle.trim()
                : (entry.card.sequenceTitle ? String(entry.card.sequenceTitle) : '');
            if (entry.card.sequenceTitle && normalizedTitle !== entry.card.sequenceTitle) {
                entry.card.sequenceTitle = normalizedTitle;
                changed = true;
            }
            if (!normalizedTitle) {
                const seqTitle = deck.sequenceMeta?.[sequenceId]?.title
                    || sorted[0]?.card?.sequenceTitle
                    || `${deck.name || 'Sequence'} ${grouped.length > 1 ? groupIndex + 1 : ''}`.trim();
                if (seqTitle) {
                    entry.card.sequenceTitle = String(seqTitle);
                    changed = true;
                }
            }
        });
        if (!deck.sequenceMeta[sequenceId]) {
            const inferredTitle = sorted[0]?.card?.sequenceTitle || `${deck.name || 'Sequence'} ${grouped.length > 1 ? groupIndex + 1 : ''}`.trim();
            deck.sequenceMeta[sequenceId] = { title: inferredTitle };
            changed = true;
        } else if (!deck.sequenceMeta[sequenceId].title && sorted[0]?.card?.sequenceTitle) {
            deck.sequenceMeta[sequenceId].title = sorted[0].card.sequenceTitle;
            changed = true;
        }
    });

    const usedIds = new Set(grouped.map(([sequenceId]) => String(sequenceId)));
    Object.keys(deck.sequenceMeta).forEach(id => {
        const normalizedId = String(id);
        if (!usedIds.has(normalizedId)) {
            delete deck.sequenceMeta[id];
            changed = true;
        }
    });

    if (changed) {
        deck.lastModified = new Date().toISOString();
    }
    return changed;
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

        const session = getStoredSession();
        const token = getAuthTokenFromSession(session);
        if (token) {
            headers['Authorization'] = `Bearer ${token}`;
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
    studyState.mcqRemediation = {
        queue: [],
        cooldownUntil: 0,
        cooldownMs: 60000,
        maxQueue: 20,
        pendingSteps: 0,
        activeTask: null
    };
    studyState.evalExposureLogged = { cardId: null, token: null };
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
    const mastered = (retention - (k * sigma)) >= targetRetention;
    if (!mastered) return false;

    if (knowledgeState && knowledgeState.mcqStats) {
        const stats = ensureMcqStats(knowledgeState.mcqStats);
        if (stats.recognitionDependenceEma > 0.35) return false;
        if (stats.mcqCorrect > 0 && stats.recallCorrect === 0) return false;
    }

    return true;
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

function createDefaultMcqStats() {
    return {
        attempts: 0,
        recallAttempts: 0,
        recallCorrect: 0,
        mcqAttempts: 0,
        mcqCorrect: 0,
        lureCounts: {},
        lastLureKey: null,
        recognitionDependenceEma: 0.0,
        remediationAttempts: 0,
        remediationCorrect: 0,
        lastRemediationAt: 0,
        lastUpdated: 0
    };
}

function normalizeMcqStats(raw) {
    if (!raw || typeof raw !== 'object') return null;
    const defaults = createDefaultMcqStats();
    const asInt = (value, fallback = 0) => {
        const num = Number(value);
        if (!Number.isFinite(num)) return fallback;
        return Math.max(0, Math.floor(num));
    };
    const asEma = (value) => {
        const num = Number(value);
        if (!Number.isFinite(num)) return 0.0;
        return Math.max(0, Math.min(1, num));
    };
    const lureCounts = {};
    const rawLures = raw.lureCounts && typeof raw.lureCounts === 'object' ? raw.lureCounts : {};
    Object.entries(rawLures).forEach(([key, value]) => {
        if (typeof key !== 'string' || !key) return;
        lureCounts[key] = asInt(value, 0);
    });
    const lastLureKey = typeof raw.lastLureKey === 'string' ? raw.lastLureKey : null;
    return {
        attempts: asInt(raw.attempts, defaults.attempts),
        recallAttempts: asInt(raw.recallAttempts, defaults.recallAttempts),
        recallCorrect: asInt(raw.recallCorrect, defaults.recallCorrect),
        mcqAttempts: asInt(raw.mcqAttempts, defaults.mcqAttempts),
        mcqCorrect: asInt(raw.mcqCorrect, defaults.mcqCorrect),
        lureCounts,
        lastLureKey,
        recognitionDependenceEma: asEma(raw.recognitionDependenceEma),
        remediationAttempts: asInt(raw.remediationAttempts, defaults.remediationAttempts),
        remediationCorrect: asInt(raw.remediationCorrect, defaults.remediationCorrect),
        lastRemediationAt: asInt(raw.lastRemediationAt, defaults.lastRemediationAt),
        lastUpdated: asInt(raw.lastUpdated, defaults.lastUpdated)
    };
}

function ensureMcqStats(raw) {
    const normalized = normalizeMcqStats(raw);
    return normalized || createDefaultMcqStats();
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
        responseTimeSec: typeof interactionLog?.responseTimeSec === 'number' ? interactionLog.responseTimeSec : null,
        iqs: typeof iqs === 'number' ? iqs : null
    };

    const context = {
        deck,
        sessionState: studyState.sessionState
    };
    if (options.calibrationTruth === true) {
        context.calibrationTruth = true;
    }
    if (typeof options.format === 'string' && options.format) {
        context.format = options.format;
    }
    if (typeof options.subformat === 'string' && options.subformat) {
        context.subformat = options.subformat;
    }

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

    const preservedMcqStats = (typeof options.mcqStats !== 'undefined')
        ? options.mcqStats
        : (typeof state?.mcqStats !== 'undefined' ? state.mcqStats : undefined);

    const normalizedRecord = prepareKnowledgeRecord({
        ...updatedState,
        ...(typeof preservedMcqStats !== 'undefined' ? { mcqStats: preservedMcqStats } : {}),
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
    attemptId: null,
    startedAt: null,
    finishedAt: null,
    blueprint: null,
    form: null,
    flatItems: [],
    responses: [],
    currentIndex: 0,
    mode: 'exam_indicative',
    showTimer: true,
    allowBack: true,
    strictMarking: true,
    confidenceIntervalEnabled: true,
    modeFlags: null,
    itemStartTime: null,
    applyLearningInProgress: false
};

window.onload = async function () {
    console.log('Script is starting! Online:', navigator.onLine);

    await initDB();
    await applyTestModeSetup();
    console.log('Database initialized.');

    // Initialize analytics manager
    analyticsManager = new AnalyticsManager();
    console.log('Analytics manager initialized.');

    // Handle Auth0 callback on web (if code/state in URL)
    if (!window.electronAPI && window.location.search.includes('code=') && window.location.search.includes('state=')) {
        console.log('Detected Auth0 callback in web environment');
        if (authApi && typeof authApi.handleWebRedirect === 'function') {
            try {
                await authApi.handleWebRedirect({ save: saveAuthSession });
            } catch (error) {
                console.error('Auth callback error:', error);
                console.error('Error stack:', error.stack);
                alert('Sign in failed: ' + error.message + '. Please check the console for details.');
            }
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
        window.__APP_READY__ = true;
    };

    const testConfig = getTestConfig();
    if (isTestMode() && testConfig.auth === 'none') {
        setupEventListeners();
        transitionView('authView', true, null, false);
        window.__APP_READY__ = true;
        return;
    }

    const isRememberedGuest = isGuestModeEnabled();
    const isSessionGuest = isRememberedGuest;

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
    const savedSession = getStoredSession();
    if (savedSession) {
        try {
            console.log('Found saved session, loading user data...');
            await updateUIAfterLogin(savedSession.user);
            // loadUserDataAndSync is called inside updateUIAfterLogin, no need to call again
            return;
        } catch (e) {
            console.error('Invalid session data:', e);
            clearAuthSession();
        }
    }

    // No session found, continue as guest
    console.log('No active session. Continuing as guest.');
    await handleOfflineOrGuest();
};

registerPracticeTestModeAdapter();
registerLearnModeAdapter();
registerReviewModeAdapter();
registerSpacedModeAdapter();
registerSequenceModeAdapter();

function handleGuestToUserTransition() {
    console.log('handleGuestToUserTransition called; migration not implemented yet.');
}

const DB_NAME = 'LagioteDB';
const DB_VERSION = 14;
const STORE_KEY_REQUIREMENTS = {
    decks: 'id',
    appData: 'key',
    examPlans: 'id',
    analyticsQueue: 'id',
    concepts: 'conceptID',
    userKnowledgeState: 'id',
    atoms: 'id',
    errorAtoms: 'id',
    questions: 'id',
    markSchemes: 'id',
    examSpecs: 'id',
    examPapers: 'id',
    examSittings: 'id',
    markingRecords: 'id',
    contentRevisions: 'id'
};
const EXAM_ENGINE_STORES = new Set([
    'atoms',
    'errorAtoms',
    'questions',
    'markSchemes',
    'examSpecs',
    'examPapers',
    'examSittings',
    'markingRecords',
    'contentRevisions'
]);

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
    const mcqStats = (typeof data.mcqStats !== 'undefined') ? ensureMcqStats(data.mcqStats) : undefined;

    const record = {
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
    if (typeof mcqStats !== 'undefined') {
        record.mcqStats = mcqStats;
    }
    return record;
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

function ensureAtomsIndexes(store) {
    if (!store.indexNames.contains('by_type')) store.createIndex('by_type', 'type', { unique: false });
    if (!store.indexNames.contains('by_updatedAt')) store.createIndex('by_updatedAt', 'updatedAt', { unique: false });
    if (!store.indexNames.contains('by_tag')) store.createIndex('by_tag', 'tags', { unique: false, multiEntry: true });
}

function ensureErrorAtomsIndexes(store) {
    if (!store.indexNames.contains('by_risk')) store.createIndex('by_risk', 'risk', { unique: false });
    if (!store.indexNames.contains('by_updatedAt')) store.createIndex('by_updatedAt', 'updatedAt', { unique: false });
    if (!store.indexNames.contains('by_tag')) store.createIndex('by_tag', 'tags', { unique: false, multiEntry: true });
}

function ensureQuestionsIndexes(store) {
    if (!store.indexNames.contains('by_type')) store.createIndex('by_type', 'type', { unique: false });
    if (!store.indexNames.contains('by_difficulty')) store.createIndex('by_difficulty', 'difficulty', { unique: false });
    if (!store.indexNames.contains('by_depth')) store.createIndex('by_depth', 'depth', { unique: false });
    if (!store.indexNames.contains('by_markScheme')) store.createIndex('by_markScheme', 'markSchemeId', { unique: false });
    if (!store.indexNames.contains('by_tag')) store.createIndex('by_tag', 'tags', { unique: false, multiEntry: true });
    if (!store.indexNames.contains('by_atomId')) store.createIndex('by_atomId', 'atomIds', { unique: false, multiEntry: true });
}

function ensureMarkSchemesIndexes(store) {
    if (!store.indexNames.contains('by_schemeType')) store.createIndex('by_schemeType', 'schemeType', { unique: false });
    if (!store.indexNames.contains('by_updatedAt')) store.createIndex('by_updatedAt', 'updatedAt', { unique: false });
}

function ensureExamSpecsIndexes(store) {
    if (!store.indexNames.contains('by_subject')) store.createIndex('by_subject', 'subject', { unique: false });
    if (!store.indexNames.contains('by_updatedAt')) store.createIndex('by_updatedAt', 'updatedAt', { unique: false });
}

function ensureExamPapersIndexes(store) {
    if (!store.indexNames.contains('by_examSpecId')) store.createIndex('by_examSpecId', 'examSpecId', { unique: false });
    if (!store.indexNames.contains('by_createdAt')) store.createIndex('by_createdAt', 'createdAt', { unique: false });
}

function ensureExamSittingsIndexes(store) {
    if (!store.indexNames.contains('by_examPaperId')) store.createIndex('by_examPaperId', 'examPaperId', { unique: false });
    if (!store.indexNames.contains('by_status')) store.createIndex('by_status', 'status', { unique: false });
    if (!store.indexNames.contains('by_startedAt')) store.createIndex('by_startedAt', 'startedAt', { unique: false });
    if (!store.indexNames.contains('by_updatedAt')) store.createIndex('by_updatedAt', 'updatedAt', { unique: false });
}

function ensureMarkingRecordsIndexes(store) {
    if (!store.indexNames.contains('by_examSittingId')) {
        store.createIndex('by_examSittingId', 'examSittingId', { unique: false });
    }
    if (!store.indexNames.contains('by_questionId')) {
        store.createIndex('by_questionId', 'questionId', { unique: false });
    }
    if (!store.indexNames.contains('by_createdAt')) store.createIndex('by_createdAt', 'createdAt', { unique: false });
}

function ensureContentRevisionsIndexes(store) {
    if (!store.indexNames.contains('by_entity')) store.createIndex('by_entity', ['entityType', 'entityId'], { unique: false });
    if (!store.indexNames.contains('by_timestamp')) store.createIndex('by_timestamp', 'timestamp', { unique: false });
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

    if (!db.objectStoreNames.contains('atoms')) {
        const atomStore = db.createObjectStore('atoms', { keyPath: 'id' });
        ensureAtomsIndexes(atomStore);
    } else {
        ensureAtomsIndexes(transaction.objectStore('atoms'));
    }
    if (!db.objectStoreNames.contains('errorAtoms')) {
        const errorAtomStore = db.createObjectStore('errorAtoms', { keyPath: 'id' });
        ensureErrorAtomsIndexes(errorAtomStore);
    } else {
        ensureErrorAtomsIndexes(transaction.objectStore('errorAtoms'));
    }
    if (!db.objectStoreNames.contains('questions')) {
        const questionStore = db.createObjectStore('questions', { keyPath: 'id' });
        ensureQuestionsIndexes(questionStore);
    } else {
        ensureQuestionsIndexes(transaction.objectStore('questions'));
    }
    if (!db.objectStoreNames.contains('markSchemes')) {
        const markSchemeStore = db.createObjectStore('markSchemes', { keyPath: 'id' });
        ensureMarkSchemesIndexes(markSchemeStore);
    } else {
        ensureMarkSchemesIndexes(transaction.objectStore('markSchemes'));
    }
    if (!db.objectStoreNames.contains('examSpecs')) {
        const examSpecStore = db.createObjectStore('examSpecs', { keyPath: 'id' });
        ensureExamSpecsIndexes(examSpecStore);
    } else {
        ensureExamSpecsIndexes(transaction.objectStore('examSpecs'));
    }
    if (!db.objectStoreNames.contains('examPapers')) {
        const examPaperStore = db.createObjectStore('examPapers', { keyPath: 'id' });
        ensureExamPapersIndexes(examPaperStore);
    } else {
        ensureExamPapersIndexes(transaction.objectStore('examPapers'));
    }
    if (!db.objectStoreNames.contains('examSittings')) {
        const examSittingStore = db.createObjectStore('examSittings', { keyPath: 'id' });
        ensureExamSittingsIndexes(examSittingStore);
    } else {
        ensureExamSittingsIndexes(transaction.objectStore('examSittings'));
    }
    if (!db.objectStoreNames.contains('markingRecords')) {
        const markingRecordStore = db.createObjectStore('markingRecords', { keyPath: 'id' });
        ensureMarkingRecordsIndexes(markingRecordStore);
    } else {
        ensureMarkingRecordsIndexes(transaction.objectStore('markingRecords'));
    }
    if (!db.objectStoreNames.contains('contentRevisions')) {
        const contentRevisionStore = db.createObjectStore('contentRevisions', { keyPath: 'id' });
        ensureContentRevisionsIndexes(contentRevisionStore);
    } else {
        ensureContentRevisionsIndexes(transaction.objectStore('contentRevisions'));
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
            errorType,
            similarityScore,
            responseTimeSec: typeof logData.responseTimeSec === 'number' ? logData.responseTimeSec : null
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

    if (isTestMode()) {
        return;
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
const hasValue = value => value !== undefined && value !== null && value !== '';
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

function nowIso() {
    return new Date().toISOString();
}

function isExamEngineStore(storeName) {
    return EXAM_ENGINE_STORES.has(storeName);
}

function parseExamVersion(value) {
    if (!Number.isFinite(value)) return null;
    const normalized = Math.trunc(value);
    return normalized >= 1 ? normalized : null;
}

function normalizeQuestionRecord(record) {
    if (!record || typeof record !== 'object') return record;
    let atomIds = [];
    if (Array.isArray(record.atomMap)) {
        atomIds = Array.from(new Set(record.atomMap
            .map(entry => entry?.atomId)
            .filter(id => id !== undefined && id !== null)
            .map(id => (typeof id === 'string' ? id : String(id)))
        ));
    } else if (Array.isArray(record.atomIds)) {
        atomIds = record.atomIds;
    }
    return { ...record, atomIds };
}

function normalizeExamEngineRecord(storeName, record, existingRecord = null) {
    if (!record || typeof record !== 'object') return record;
    const working = storeName === 'questions' ? normalizeQuestionRecord(record) : record;
    const existing = existingRecord && typeof existingRecord === 'object' ? existingRecord : null;
    const now = nowIso();
    const createdAt = hasValue(working.createdAt)
        ? working.createdAt
        : (hasValue(existing?.createdAt) ? existing.createdAt : now);
    const incomingVersion = parseExamVersion(working.version);
    const existingVersion = parseExamVersion(existing?.version);
    let version = incomingVersion;
    if (!incomingVersion) {
        if (existing) {
            version = existingVersion ? existingVersion + 1 : 1;
        } else {
            version = 1;
        }
    }
    const hasIsDeleted = typeof working.isDeleted === 'boolean';
    const isDeleted = hasIsDeleted ? working.isDeleted : (typeof existing?.isDeleted === 'boolean' ? existing.isDeleted : false);
    const deletedAt = hasValue(working.deletedAt)
        ? working.deletedAt
        : (hasValue(existing?.deletedAt) ? existing.deletedAt : null);

    return {
        ...working,
        version,
        createdAt,
        updatedAt: now,
        isDeleted,
        deletedAt
    };
}

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
            if (isExamEngineStore(storeName)) {
                const id = payload.id;
                const getRequest = store.get(id);
                getRequest.onsuccess = () => {
                    const normalized = normalizeExamEngineRecord(storeName, payload, getRequest.result);
                    store.put(normalized);
                };
                getRequest.onerror = event => reject("Error saving data: " + event.target.error);
            } else {
                store.put(payload);
            }
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

function getBrowserAuthConfig() {
    const config = window.auth0WebConfig || {};
    return {
        domain: config.domain || 'dev-tn0gt5rtacrg1qdw.uk.auth0.com',
        clientId: config.clientId || 'fFvjuKKem8V4mN6W5eD753fKmCVncT1H',
        audience: config.audience || undefined
    };
}

function setupEventListeners() {
    if (eventListenersInitialized) return;
    eventListenersInitialized = true;

    // Authentication event listeners will be handled by Auth0 (to be implemented)
    const authSignupBtn = document.getElementById('authSignupBtn');
    const authLoginBtn = document.getElementById('authLoginBtn');

    const runAuthFlow = async (screenHint) => {
        if (authApi && typeof authApi.startAuthFlow === 'function') {
            const result = await authApi.startAuthFlow({ screenHint });
            if (result && result.user) {
                saveAuthSession(result);
                await updateUIAfterLogin(result.user);
            }
            return;
        }

        if (window.electronAPI && window.electronAPI.openLoginWindow) {
            const authResult = await window.electronAPI.openLoginWindow();
            if (authResult && authResult.user) {
                saveAuthSession(authResult);
                await updateUIAfterLogin(authResult.user);
            }
            return;
        }

        const {
            domain: auth0Domain,
            clientId: auth0ClientId,
            audience: auth0Audience
        } = getBrowserAuthConfig();

        if (!window.auth0?.createAuth0Client) {
            throw new Error('Auth0 client not available');
        }

        const auth0Client = await window.auth0.createAuth0Client({
            domain: auth0Domain,
            clientId: auth0ClientId,
            authorizationParams: {
                redirect_uri: window.location.origin + '/',
                audience: auth0Audience,
                scope: 'openid profile email',
                ...(screenHint ? { screen_hint: screenHint } : {})
            }
        });

        await auth0Client.loginWithRedirect();
    };

    authSignupBtn?.addEventListener('click', async () => {
        console.log('Opening Auth0 signup window...');

        try {
            await runAuthFlow('signup');
        } catch (error) {
            console.error('Signup error:', error);
            const errorMessage = error.message || JSON.stringify(error);
            showToast(`Signup failed: ${errorMessage}`, 'error');
        }
    });
    authLoginBtn?.addEventListener('click', async () => {
        console.log('Opening Auth0 login window...');
        try {
            await runAuthFlow();
        } catch (error) {
            console.error('Login error:', error);
            const errorMessage = error.message || JSON.stringify(error);
            showToast(`Login failed: ${errorMessage}`, 'error');
        }
    });
    // Guest Signup Button in Header
    document.getElementById('guestSignupBtn')?.addEventListener('click', async () => {
        console.log('Opening Auth0 signup window from header...');

        try {
            await runAuthFlow('signup');
        } catch (error) {
            console.error('Signup error:', error);
            const errorMessage = error.message || JSON.stringify(error);
            showToast(`Signup failed: ${errorMessage}`, 'error');
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
    safeAddListener('spacedAgainBtn', 'click', () => gradeSpaced('Again'));
    safeAddListener('spacedHardBtn', 'click', () => gradeSpaced('Hard'));
    safeAddListener('spacedGoodBtn', 'click', () => gradeSpaced('Good'));
    safeAddListener('spacedEasyBtn', 'click', () => gradeSpaced('Easy'));
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
        // Global Shortcuts
        const isMeta = e.ctrlKey || e.metaKey;
        const isShift = !!e.shiftKey;
        const keyLower = (e.key || '').toLowerCase();
        const code = e.code || '';

        // Don't trigger non-meta shortcuts when typing in text inputs.
        // Meta shortcuts (Ctrl/Cmd+...) should still work everywhere so the app
        // remains fully keyboard-operable.
        if (!isMeta && e.target?.matches?.('input[type="text"], textarea, [contenteditable="true"]') && e.target.id !== 'searchInput') {
            return;
        }

        if (activeView === 'editorView' && isMeta && (keyLower === 's' || code === 'KeyS')) {
            return;
        }

        // Ctrl/Cmd + K: Search
        if (isMeta && (keyLower === 'k' || code === 'KeyK')) {
            e.preventDefault();
            const searchBarElem = document.querySelector('.search-bar');
            if (searchBarElem && searchBarElem.classList.contains('hidden') && typeof backToDashboard === 'function') {
                backToDashboard(true);
                setTimeout(() => {
                    document.getElementById('searchInput')?.focus();
                }, 50);
            } else {
                document.getElementById('searchInput')?.focus();
            }
            console.log('[Shortcut] Search activated');
        }

        // Ctrl/Cmd + Shift + A: Analytics
        if (isMeta && isShift && (keyLower === 'a' || code === 'KeyA')) {
            e.preventDefault();
            if (typeof showAnalyticsView === 'function') {
                showAnalyticsView();
            }
            console.log('[Shortcut] Analytics opened');
        }

        // Ctrl/Cmd + Shift + I: Insights
        if (isMeta && isShift && (keyLower === 'i' || code === 'KeyI')) {
            e.preventDefault();
            if (typeof showInsightsView === 'function') {
                showInsightsView();
            }
            console.log('[Shortcut] Insights opened');
        }

        // Ctrl/Cmd + Shift + G: Global analytics
        if (isMeta && isShift && (keyLower === 'g' || code === 'KeyG')) {
            e.preventDefault();
            if (typeof renderGlobalAnalytics === 'function') {
                renderGlobalAnalytics();
            }
            console.log('[Shortcut] Global analytics opened');
        }

        // Ctrl/Cmd + N: New Deck
        if (isMeta && (keyLower === 'n' || code === 'KeyN')) {
            e.preventDefault();
            showEditor();
            console.log('[Shortcut] New deck');
        }

        // Ctrl/Cmd + S: Sync
        if (isMeta && (keyLower === 's' || code === 'KeyS')) {
            e.preventDefault();
            if (isOnline && getStoredSession()) {
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

        // Study mode shortcuts are handled centrally in setupKeyboardControls.
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
    const sequenceView = document.getElementById('sequenceTaskView');
    if (sequenceView) sequenceView.classList.add('hidden');
    const sequenceBody = document.getElementById('sequenceTaskBody');
    if (sequenceBody) sequenceBody.innerHTML = '';
    const seqFeedback = document.getElementById('sequenceTaskFeedback');
    if (seqFeedback) seqFeedback.classList.add('hidden');
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

function destroyStandardSortableInstance() {
    if (sortableInstance) {
        try {
            sortableInstance.destroy();
        } catch (error) {
            console.warn('Failed to destroy Sortable instance:', error);
        }
        sortableInstance = null;
    }
}

function initStandardEditorSortable() {
    const container = document.getElementById('flashcardsContainer');
    if (!container) return;
    destroyStandardSortableInstance();
    sortableInstance = new Sortable(container, {
        animation: 150,
        handle: '.drag-handle',
        ghostClass: 'drag-ghost',
        onEnd: () => {
            editorRenumberCards();
        }
    });
}

function showEditor() {
    transitionView('editorView');
    editorInitialise();

    destroySequenceSortables();
    const deckType = document.getElementById('deckTypeHint')?.value;
    if (deckType !== 'Sequence') {
        initStandardEditorSortable();
    }
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

                    if (!skipEndSession && currentDeckId && currentMode) await endSession({ forceDashboard: true });

                    transitionView('dashboard', false, () => resetDashboardState(true), false);
                    return;
                }
                transitionView('dashboard', false, () => resetDashboardState(true), false);
                if (!skipEndSession && currentDeckId && currentMode) await endSession();
            }
        );
        return;
    }

    if (activeView !== 'dashboard') {
        if (!skipEndSession && currentDeckId && currentMode) await endSession({ forceDashboard: isFromLogo });
        if (isFromLogo) {
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
        let workingDeck = deck;
        if (workingDeck.typeHint !== 'Sequence') {
            const adapter = window.sequenceStepUtils?.adaptLegacySequenceDeck;
            if (typeof adapter === 'function') {
                const adapted = adapter(workingDeck);
                if (adapted?.deck && Array.isArray(adapted.cards) && adapted.cards.length >= 2) {
                    const updatedCards = adapted.cards.map(card => ({
                        ...card,
                        deckId: card.deckId || workingDeck.id
                    }));
                    workingDeck = {
                        ...workingDeck,
                        ...adapted.deck,
                        cards: updatedCards
                    };
                    deckUpdated = true;
                }
            }
        }
        if (workingDeck.typeHint === 'Sequence') {
            if (normalizeSequenceDeck(workingDeck)) {
                deckUpdated = true;
            }
        }
        for (const card of workingDeck.cards) {
            if (!card.id) {
                card.id = crypto.randomUUID();
                deckUpdated = true;
            }
            const prepared = await prepareFsrsCard(card);
            card.fsrs = serializeFsrsCard(prepared);
            // Ensure each card has a reference to its deck
            if (!card.deckId) {
                card.deckId = workingDeck.id;
                deckUpdated = true;
            }
        }
        if (deckUpdated) {
            workingDeck.lastModified = new Date().toISOString();
            await saveDataToDB('decks', workingDeck);
        }
        decks[workingDeck.id] = workingDeck;
        if (window.AccentUtils?.ensureDeckAccentMetadata) {
            window.AccentUtils.ensureDeckAccentMetadata(workingDeck);
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

    const deckKey = String(deckId);
    const knowledgeStateForDeck = allKnowledgeStates.filter(state => cardIdsInDeck.has(state.cardID));
    if (deck.typeHint === 'Sequence') {
        const graphStates = allKnowledgeStates.filter(state =>
            state
            && String(state.deckID || state.deckId || '') === deckKey
            && state.sequenceGraph
            && !cardIdsInDeck.has(state.cardID));
        if (graphStates.length) {
            knowledgeStateForDeck.push(...graphStates);
        }
    }

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

    if (deck.typeHint === 'Sequence') {
        const groups = buildSequenceGroups(deck.cards || [], deck.sequenceMeta || {});
        const tsvLines = [];
        groups.forEach(group => {
            group.steps.forEach(step => {
                tsvLines.push([group.title, step.question || '', step.answer || ''].map(field => field.replace(/\t/g, ' ')).join('\t'));
            });
        });
        if (tsvLines.length) {
            const tsvStr = tsvLines.join('\n');
            const tsvUri = 'data:text/tab-separated-values;charset=utf-8,' + encodeURIComponent(tsvStr);
            const tsvLink = document.createElement('a');
            tsvLink.setAttribute('href', tsvUri);
            tsvLink.setAttribute('download', `${deck.name.replace(/ /g, '_')}_sequence.tsv`);
            tsvLink.click();
        }
    }

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
                const cardIds = deck.cards.map(card => card.id);
                const { percent, counts } = computeRetentionProgressPercent({
                    cardIds,
                    deck,
                    stateMap: knowledgeMap
                });
                progressPercent = percent;
                if (globalSettings.devMode) {
                    console.log('[Progress] dashboardDeckProgress', {
                        deckId: deck.id,
                        percent,
                        counts
                    });
                }
            }

            let dueCount = 0;
            let newCount = 0;
            const nowMs = Date.now();
            for (const card of deck.cards) {
                const state = knowledgeMap.get(card.id);
                const reviewed = fallbackIsKnowledgeStateReviewed(state);
                const fsrs = fallbackNormalizeFsrsState(state?.fsrs);
                const reps = fsrs ? fsrs.reps : 0;

                if (!reviewed || reps === 0) {
                    newCount += 1;
                    continue;
                }

                if (fsrs?.due && fsrs.due.getTime() <= nowMs) {
                    dueCount += 1;
                }
            }

            const deckCard = document.createElement('div');
            deckCard.className = 'deck-card';
            deckCard.dataset.category = String(category);
            deckCard.dataset.deckId = String(deck.id);
            deckCard.dataset.testid = `deck-card-${deck.id}`;
            const isSequenceDeck = deck.typeHint === 'Sequence';

            const mainClickable = document.createElement('div');
            mainClickable.className = 'deck-card-main-clickable';
            mainClickable.dataset.testid = `deck-open-${deck.id}`;
            mainClickable.addEventListener('click', () => showDeckDetail(deck.id, mainClickable.parentElement));

            const deckTop = document.createElement('div');
            deckTop.className = 'deck-card-top';

            const deckCategoryEl = document.createElement('span');
            deckCategoryEl.className = 'deck-chip deck-chip--category';
            deckCategoryEl.textContent = String(category);
            deckTop.appendChild(deckCategoryEl);

            if (isSequenceDeck) {
                const typePill = document.createElement('span');
                typePill.className = 'deck-chip deck-chip--type deck-chip--sequence';
                typePill.textContent = 'Sequence';
                deckTop.appendChild(typePill);
            }

            const deckNameEl = document.createElement('div');
            deckNameEl.className = 'deck-name';
            deckNameEl.textContent = String(deck.name);

            const deckMetaRow = document.createElement('div');
            deckMetaRow.className = 'deck-meta';
            deckMetaRow.textContent = `${totalCards} cards`;
            const createdLabel = formatDate(deck.created);
            const updatedLabel = formatDate(deck.lastModified || deck.created);
            deckMetaRow.title = `Created: ${String(createdLabel)} • Updated: ${String(updatedLabel)}`;
            deckMetaRow.setAttribute('aria-label', `Deck metadata. ${totalCards} cards. Created ${String(createdLabel)}. Updated ${String(updatedLabel)}.`);

            const statusRow = document.createElement('div');
            statusRow.className = 'deck-status-row';

            const buildStatusChip = ({ variant, label, title, ariaLabel }) => {
                const chip = document.createElement('span');
                chip.className = `status-chip status-chip--${variant}`;
                chip.title = title;
                chip.setAttribute('aria-label', ariaLabel);

                const dot = document.createElement('span');
                dot.className = 'status-chip-dot';
                chip.appendChild(dot);

                const text = document.createElement('span');
                text.textContent = label;
                chip.appendChild(text);

                return chip;
            };

            if (dueCount > 0) {
                statusRow.appendChild(buildStatusChip({
                    variant: 'due',
                    label: 'Due',
                    title: `${dueCount} due card${dueCount === 1 ? '' : 's'}`,
                    ariaLabel: `Due: ${dueCount} card${dueCount === 1 ? '' : 's'} due.`
                }));
            }

            if (newCount > 0) {
                statusRow.appendChild(buildStatusChip({
                    variant: 'new',
                    label: 'New',
                    title: `${newCount} new card${newCount === 1 ? '' : 's'}`,
                    ariaLabel: `New: ${newCount} new card${newCount === 1 ? '' : 's'}.`
                }));
            }

            if (dueCount === 0 && newCount === 0) {
                statusRow.appendChild(buildStatusChip({
                    variant: 'ok',
                    label: 'On track',
                    title: 'No due or new cards',
                    ariaLabel: 'On track: no due or new cards.'
                }));
            }

            const progressContainer = document.createElement('div');
            progressContainer.className = 'deck-progress-container';
            const progressLabel = document.createElement('div');
            progressLabel.className = 'deck-progress-label';
            const progressText = document.createElement('span');
            progressText.textContent = 'Progress';
            progressLabel.appendChild(progressText);
            const progressPercentEl = document.createElement('span');
            progressPercentEl.textContent = `${Math.round(progressPercent)}%`;
            progressLabel.appendChild(progressPercentEl);
            const progressOuter = document.createElement('div');
            progressOuter.className = 'deck-progress-bar-outer';
            const progressInner = document.createElement('div');
            progressInner.className = 'deck-progress-bar-inner';
            progressInner.style.width = `${progressPercent}%`;
            progressOuter.appendChild(progressInner);
            progressContainer.appendChild(progressLabel);
            progressContainer.appendChild(progressOuter);

            mainClickable.appendChild(deckTop);
            mainClickable.appendChild(deckNameEl);
            mainClickable.appendChild(deckMetaRow);
            mainClickable.appendChild(statusRow);
            mainClickable.appendChild(progressContainer);

	            const actions = document.createElement('div');
	            actions.className = 'deck-actions';

            let primaryMode = 'review';
            let primaryLabel = 'Review';
            let secondaryMode = 'learn';
            let secondaryLabel = 'Learn';

            if (isSequenceDeck) {
                primaryMode = 'sequence';
                primaryLabel = 'Sequence';
                if (dueCount > 0) {
                    secondaryMode = 'spaced';
                    secondaryLabel = 'Spaced';
                } else if (newCount > 0) {
                    secondaryMode = 'learn';
                    secondaryLabel = 'Learn';
                } else {
                    secondaryMode = 'review';
                    secondaryLabel = 'Review';
                }
            } else if (dueCount > 0) {
                primaryMode = 'spaced';
                primaryLabel = 'Spaced';
                if (newCount > 0) {
                    secondaryMode = 'learn';
                    secondaryLabel = 'Learn';
                } else {
                    secondaryMode = 'review';
                    secondaryLabel = 'Review';
                }
            } else if (newCount > 0) {
                primaryMode = 'learn';
                primaryLabel = 'Learn';
                secondaryMode = 'review';
                secondaryLabel = 'Review';
            }

            const primaryBtn = document.createElement('button');
            primaryBtn.className = 'btn deck-action-primary';
            primaryBtn.type = 'button';
            primaryBtn.textContent = primaryLabel;
            primaryBtn.dataset.testid = `deck-action-${primaryMode}-${deck.id}`;
            primaryBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                configureStudy(primaryMode, deck.id);
            });
	            if (primaryMode === 'spaced') {
	                primaryBtn.title = dueCount > 0 ? `${dueCount} due` : 'Spaced review';
	                primaryBtn.setAttribute('aria-label', dueCount > 0 ? `Spaced review. ${dueCount} due.` : 'Spaced review.');
	            }
	            actions.appendChild(primaryBtn);

	            if (secondaryMode !== primaryMode) {
                const secondaryBtn = document.createElement('button');
                secondaryBtn.className = 'btn deck-action-secondary';
                secondaryBtn.type = 'button';
                secondaryBtn.textContent = secondaryLabel;
                secondaryBtn.dataset.testid = `deck-action-${secondaryMode}-${deck.id}`;
                secondaryBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    configureStudy(secondaryMode, deck.id);
                });
	                actions.appendChild(secondaryBtn);
	            }

            deckCard.appendChild(mainClickable);
            deckCard.appendChild(actions);
            decksGrid.appendChild(deckCard);
        });
        decksContainer.appendChild(categoryFolder);
    }

    rebuildDeckSelection();

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
    const category = deck.category || 'Other';
    categoryElement.textContent = category;
    categoryElement.className = `deck-detail-category ${category}`;
    document.documentElement.setAttribute('data-deck-category', category);

    const deckDetailActions = document.getElementById('deckDetailActions');
    if (!deckDetailActions) {
        console.error("Fatal Error: deckDetailActions element not found in the DOM.");
        return;
    }

    const deckDetailExportBtn = document.getElementById('deckDetailExportBtn');
    if (deckDetailExportBtn) {
        deckDetailExportBtn.onclick = (event) => {
            event?.stopPropagation?.();
            exportDeck(String(deckId), event);
        };
    }
    const sequenceActionBtn = document.getElementById('deckDetailSequenceBtn');
    if (sequenceActionBtn) {
        const isSequenceDeck = deck.typeHint === 'Sequence';
        sequenceActionBtn.classList.toggle('hidden', !isSequenceDeck);
        sequenceActionBtn.setAttribute('aria-hidden', (!isSequenceDeck).toString());
        sequenceActionBtn.onclick = () => configureStudy('sequence', deck.id);
    }

    const cardsList = document.getElementById('deckCardsList');
    cardsList.innerHTML = '';

    if (deck.cards.length === 0) {
        cardsList.innerHTML = '<p style="text-align: center; color: var(--secondary-text);">No cards in this deck yet.</p>';
    } else {
        const cardsToDisplay = deck.cards;

        cardsToDisplay.forEach((card, index) => {
            const cardItem = document.createElement('div');
            cardItem.className = 'deck-card-item';
            cardItem.dataset.testid = `deck-card-item-${card.id}`;
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
            editBtn.dataset.testid = `deck-card-edit-${card.id}`;
            editBtn.addEventListener('click', (e) => { e.stopPropagation(); editCard(deckId, originalIndex, 'detail'); });
            editBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" width="16" height="16"><path stroke-linecap="round" stroke-linejoin="round" d="m16.862 4.487 1.687-1.688a1.875 1.875 0 1 1 2.652 2.652L10.582 16.07a4.5 4.5 0 0 1-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 0 1 1.13-1.897l8.932-8.931Zm0 0L19.5 7.125M18 14v4.75A2.25 2.25 0 0 1 15.75 21H5.25A2.25 2.25 0 0 1 3 18.75V8.25A2.25 2.25 0 0 1 5.25 6H10" /></svg>`;

            const deleteBtn = document.createElement('button');
            deleteBtn.className = 'deck-card-action-btn delete';
            deleteBtn.title = 'Delete Card';
            deleteBtn.dataset.testid = `deck-card-delete-${card.id}`;
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

function closeEditAiCardModal() {
    const modal = document.getElementById('editAiCardModal');
    if (modal) modal.classList.remove('show');
    aiCardToEditIndex = null;
}

function saveAiEditedCard() {
    if (aiCardToEditIndex === null) {
        showToast('No AI card selected to edit.', 'error');
        return;
    }

    const listContainer = document.getElementById('flashcard-list');
    if (!listContainer || !listContainer.dataset.cards) {
        showToast('AI card list not available.', 'error');
        return;
    }

    if (listContainer.dataset.previewType === 'sequence') {
        showToast('Sequence steps cannot be edited here.', 'error');
        return;
    }

    const cards = JSON.parse(listContainer.dataset.cards || '[]');
    if (!cards[aiCardToEditIndex]) {
        showToast('AI card not found.', 'error');
        return;
    }

    const newQuestion = document.getElementById('editAiCardQuestion').value.trim();
    const newAnswer = document.getElementById('editAiCardAnswer').value.trim();

    if (!newQuestion || !newAnswer) {
        showToast('Question and Answer cannot be empty.', 'error');
        return;
    }

    cards[aiCardToEditIndex] = {
        ...cards[aiCardToEditIndex],
        question: newQuestion,
        answer: newAnswer
    };

    listContainer.dataset.cards = JSON.stringify(cards);
    renderAiGeneratedCards(cards);
    closeEditAiCardModal();
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

            if (currentMode === 'learn') {
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
            if (isOnline && getStoredSession()) {
                await loadUserDataAndSync();
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

async function createNewDeck(name, category, cards, notes = '', typeHint = 'General', extraDeckFields = {}) {
    const deckId = Date.now().toString();

    const settings = {
        ...DEFAULT_DECK_SETTINGS,
        learnMode: 'write',
        reviewMode: 'flashcard',
        adaptiveModes: { auto: true, mcq: true, cloze: true }
    };

    const normalizedCards = cards.map(card => ({
        ...card,
        id: card.id || crypto.randomUUID(),
        deckId: deckId
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
        settings: settings,
        ...extraDeckFields
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

    toggleEditorView(deck.typeHint || 'General', deck);
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
            if (isOnline && getStoredSession()) {
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

    document.getElementById('deckTitle').focus();
}

function isEditorClean() {



    const titleEl = document.getElementById('deckTitle');
    const title = titleEl ? (titleEl.value || '').trim() : '';
    if (title) return false;

    const cardItems = document.querySelectorAll('#editorView .flashcard-item');
    for (const item of cardItems) {

        const qEl = item.querySelector('.question-input');
        const aEl = item.querySelector('.solution-input');

        const q = qEl ? ((qEl.value || '').trim()) : '';
        const a = aEl ? ((aEl.value || '').trim()) : '';

        const qImgEl = item.querySelector('.question-image-input');
        const aImgEl = item.querySelector('.answer-image-input');
        const qImg = qImgEl ? ((qImgEl.value || '').trim()) : '';
        const aImg = aImgEl ? ((aImgEl.value || '').trim()) : '';

        if (q || a || qImg || aImg) return false;
    }

    const sequenceBlocks = document.querySelectorAll('#editorView .sequence-editor-block');
    for (const block of sequenceBlocks) {
        const title = block.querySelector('.sequence-title-input')?.value.trim();
        const desc = block.querySelector('.sequence-description-input')?.value.trim();
        if (title || desc) return false;
        const steps = block.querySelectorAll('.sequence-step');
        for (const step of steps) {
            const q = step.querySelector('.sequence-step-question')?.value.trim() || '';
            const a = step.querySelector('.sequence-step-notes')?.value.trim() || '';
            if (q || a) return false;
        }
    }
    return true;
}

function populateEditorAccentButtons(container, textarea) {
    if (!container || !textarea) return;
    const accents = [
        '\u00e0', '\u00e2', '\u00e9', '\u00e8', '\u00ea', '\u00eb', '\u00ee', '\u00ef',
        '\u00f4', '\u00f9', '\u00fb', '\u00fc', '\u00e7', '\u00f1', '\u00df', '\u00e4', '\u00f6'
    ];
    container.innerHTML = accents.map(char => (
        `<button onclick="insertAccentIntoEditor('${char}', this)" style="background: var(--button-secondary-bg); border: 1px solid var(--border-color); color: var(--button-secondary-text); padding: 5px 12px; border-radius: 8px; cursor: pointer; font-size: 1rem;">${char}</button>`
    )).join('');
    container.classList.remove('hidden');
}

function insertAccentIntoEditor(char, button) {
    const container = button?.parentElement;
    const textarea = container?.previousElementSibling;
    if (!textarea || !(textarea.classList.contains('question-input') || textarea.classList.contains('solution-input'))) return;
    const start = textarea.selectionStart ?? textarea.value.length;
    const end = textarea.selectionEnd ?? textarea.value.length;
    textarea.value = textarea.value.substring(0, start) + char + textarea.value.substring(end);
    const nextPos = start + 1;
    textarea.selectionStart = nextPos;
    textarea.selectionEnd = nextPos;
    textarea.focus();
}

// Cloze helper functions
let currentClozeNumber = 1;

function getClozeNumberForCard(cardId) {
    const textarea = document.querySelector(`.cloze-text-input[data-card-id="${cardId}"]`);
    if (!textarea) return 1;
    const text = textarea.value;
    const matches = text.match(/\{\{c(\d+)::/g);
    return matches ? Math.max(...matches.map(m => parseInt(m.match(/\d+/)[0]))) + 1 : 1;
}

function wrapSelectedInCloze(button, action) {
    const cardItem = button.closest('.flashcard-item');
    if (!cardItem) return;
    
    const textarea = cardItem.querySelector('.cloze-text-input');
    const hintInput = cardItem.querySelector('.cloze-hint-input');
    const counter = cardItem.querySelector('.cloze-counter strong');
    
    if (!textarea) return;

    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const selectedText = textarea.value.substring(start, end);

    if (action === 'add') {
        if (!selectedText) {
            alert('Please select text first');
            return;
        }
        const clozeNum = getClozeNumberForCard(textarea.dataset.cardId);
        const wrapped = `{{c${clozeNum}::${selectedText}}}`;
        textarea.value = textarea.value.substring(0, start) + wrapped + textarea.value.substring(end);
        textarea.selectionStart = start + wrapped.length;
        textarea.selectionEnd = start + wrapped.length;
        if (counter) counter.textContent = clozeNum + 1;
        if (hintInput) hintInput.focus();
    } else if (action === 'hint') {
        if (!selectedText.includes('::')) {
            alert('Please select a cloze deletion first (text between {{ }})');
            return;
        }
        const hint = hintInput?.value.trim();
        if (!hint) {
            alert('Please enter a hint first');
            return;
        }
        const updated = selectedText.replace(/::}}$/, `::${hint}}}`);
        textarea.value = textarea.value.substring(0, start) + updated + textarea.value.substring(end);
        textarea.selectionStart = start + updated.length;
        textarea.selectionEnd = start + updated.length;
        if (hintInput) hintInput.value = '';
    } else if (action === 'next') {
        const clozeNum = getClozeNumberForCard(textarea.dataset.cardId);
        if (counter) counter.textContent = clozeNum;
    }
    
    textarea.focus();
}

function openClozePreview(button) {
    const cardItem = button.closest('.flashcard-item');
    if (!cardItem) return;
    
    const textarea = cardItem.querySelector('.cloze-text-input');
    const preview = cardItem.querySelector('.cloze-preview');
    const previewContent = preview?.querySelector('.cloze-preview-content');
    
    if (!textarea || !preview || !previewContent) return;

    // Parse cloze text and show preview
    const text = textarea.value;
    const clozeRegex = /\{\{c\d+::([^}:]+)(?:::([^}]+))?\}\}/g;
    let previewText = text;
    let count = 0;
    
    previewText = previewText.replace(clozeRegex, () => {
        count++;
        return `<span class="cloze-blank">[${count}]</span>`;
    });

    previewContent.innerHTML = previewText;
    preview.classList.toggle('hidden');
}

function editorAddNewStandardCard(card = {}) {
    const { id = null, question = '', answer = '', questionImage = '', answerImage = '', order = '', cardType = 'basic', clozeText = '', addReverse = false } = card;
    editorCardCounter++;
    const container = document.getElementById('flashcardsContainer');

    const newRow = document.createElement('div');
    newRow.className = 'flashcard-editor-row';
    newRow.setAttribute('data-card-id', editorCardCounter);

    const questionImagePreview = questionImage ? `<img src="${escapeHtml(String(questionImage))}">` : '';
    const answerImagePreview = answerImage ? `<img src="${escapeHtml(String(answerImage))}">` : '';

    const deckType = document.getElementById('deckTypeHint').value;
    const cardNumber = document.querySelectorAll('.flashcard-editor-row').length + 1;

    const orderInputHTML = '';

    // Determine which card type to show
    const effectiveCardType = cardType || 'basic';
    
    newRow.innerHTML = `<div class="flashcard-item" data-original-id="${escapeHtml(String(id || ''))}" data-testid="editor-card-${editorCardCounter}">
                <div class="flashcard-header" style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px;">
                    <div class="flashcard-number" style="display: flex; align-items: center;">
                        ${orderInputHTML}
                        <span>${cardNumber}.</span>
                    </div>
                    <div class="card-type-selector">
                        <label style="font-size: 0.85rem; color: var(--secondary-text); margin-right: 8px;">Card Type:</label>
                        <select class="card-type-dropdown" onchange="handleCardTypeChange(this)" data-testid="editor-card-type-${editorCardCounter}">
                            <option value="basic" ${effectiveCardType === 'basic' ? 'selected' : ''}>Basic</option>
                            <option value="basic_reversed" ${effectiveCardType === 'basic_reversed' ? 'selected' : ''}>Basic (reversed)</option>
                            <option value="basic_optional_reversed" ${effectiveCardType === 'basic_optional_reversed' ? 'selected' : ''}>Basic (optional reversed)</option>
                            <option value="basic_type_answer" ${effectiveCardType === 'basic_type_answer' ? 'selected' : ''}>Basic (type answer)</option>
                            <option value="cloze" ${effectiveCardType === 'cloze' ? 'selected' : ''}>Cloze</option>
                            <option value="image_occlusion" ${effectiveCardType === 'image_occlusion' ? 'selected' : ''}>Image Occlusion</option>
                        </select>
                    </div>
                </div>
                
                <!-- Basic / Type Answer / Reversed template -->
                <div class="card-template template-basic">
                    <textarea class="question-input" placeholder="Question" data-card-id="${editorCardCounter}" data-testid="editor-card-question-${editorCardCounter}">${escapeHtml(String(question))}</textarea>
                    <div class="editor-accent-buttons accent-buttons" style="margin-top: 8px;"></div>
                    <div class="image-controls">
                        <button class="btn btn-secondary" style="padding: 5px 10px; font-size: 12px;" onclick="triggerImageUpload(this)" tabindex="-1" data-testid="editor-card-question-upload-${editorCardCounter}">Upload Image</button>
                    </div>
                    <div class="question-image-preview image-preview">${questionImagePreview}</div>
                    <input type="file" class="image-upload-input" accept="image/*" style="display:none;" onchange="handleImageFile(this)">
                    <input type="hidden" class="question-image-input" value="${escapeHtml(String(questionImage))}">
                    
                    <textarea class="solution-input" placeholder="Answer" style="margin-top:20px;" data-card-id="${editorCardCounter}" data-testid="editor-card-answer-${editorCardCounter}">${escapeHtml(String(answer))}</textarea>
                    <div class="editor-accent-buttons accent-buttons" style="margin-top: 8px;"></div>
                    <div class="image-controls">
                        <button class="btn btn-secondary" style="padding: 5px 10px; font-size: 12px;" onclick="triggerImageUpload(this)" tabindex="-1" data-testid="editor-card-answer-upload-${editorCardCounter}">Upload Image</button>
                    </div>
                    <div class="answer-image-preview image-preview">${answerImagePreview}</div>
                    <input type="file" class="image-upload-input" accept="image/*" style="display:none;" onchange="handleImageFile(this)">
                    <input type="hidden" class="answer-image-input" value="${escapeHtml(String(answerImage))}">
                    
                    <!-- Reversed card options (shown for reversed types) -->
                    <div class="reverse-options hidden" style="margin-top: 12px; padding: 10px; background: var(--surface-alt, #f5f5f5); border-radius: 8px;">
                        <label style="display: flex; align-items: center; gap: 8px; cursor: pointer;">
                            <input type="checkbox" class="add-reverse-checkbox" ${addReverse ? 'checked' : ''}>
                            <span>Also create reversed card (Answer → Question)</span>
                        </label>
                    </div>
                    
                    <!-- Type answer hint -->
                    <div class="type-answer-hint hidden" style="margin-top: 12px; padding: 10px; background: var(--accent-muted, rgba(102, 126, 234, 0.1)); border-radius: 8px; font-size: 0.85rem; color: var(--secondary-text);">
                        Users will type their answer. Keep answers short and specific for best results.
                    </div>
                </div>
                
                <!-- Cloze template -->
                <div class="card-template template-cloze hidden">
                    <div class="cloze-helper-section">
                        <div class="cloze-helper-title">
                            <strong>Create Cloze Deletions</strong>
                            <span class="cloze-counter">Cloze #: <strong>1</strong></span>
                        </div>
                        <div class="cloze-helper-controls">
                            <div class="cloze-button-group">
                                <button class="btn btn-small" onclick="wrapSelectedInCloze(this, 'add')" title="Wrap selected text in cloze deletion">
                                    <span>Add Cloze</span>
                                </button>
                                <button class="btn btn-small" onclick="wrapSelectedInCloze(this, 'hint')" title="Add hint to selected cloze">
                                    <span>Add Hint</span>
                                </button>
                                <button class="btn btn-small" onclick="wrapSelectedInCloze(this, 'next')" title="Increment cloze number">
                                    <span>Next Cloze #</span>
                                </button>
                                <button class="btn btn-small" onclick="openClozePreview(this)" title="Preview how cloze card will appear">
                                    <span>Preview</span>
                                </button>
                            </div>
                            <div class="cloze-hint-input-group">
                                <input type="text" class="cloze-hint-input" placeholder="Optional: Hint for current cloze" data-card-id="${editorCardCounter}">
                                <small class="cloze-help-text">Select text → Click Add Cloze → Optionally add hint → Click Next Cloze # for more</small>
                            </div>
                        </div>
                    </div>
                    <textarea class="cloze-text-input" placeholder="Type your text here. Select text and use buttons above to create cloze deletions..." style="min-height: 120px;" data-card-id="${editorCardCounter}" data-testid="editor-card-cloze-${editorCardCounter}">${escapeHtml(String(clozeText || question))}</textarea>
                    <div class="editor-accent-buttons accent-buttons" style="margin-top: 8px;"></div>
                    <div class="cloze-preview hidden" data-card-id="${editorCardCounter}">
                        <div class="cloze-preview-title">Preview (how it will appear to students)</div>
                        <div class="cloze-preview-content"></div>
                    </div>
                </div>
                
                <!-- Image Occlusion template -->
                <div class="card-template template-occlusion hidden">
                    <div style="margin-bottom: 12px; padding: 10px; background: var(--accent-muted, rgba(102, 126, 234, 0.1)); border-radius: 8px; font-size: 0.85rem;">
                        <strong>Image Occlusion:</strong> Upload an image and specify the hidden label.
                    </div>
                    <div class="image-controls" style="margin-bottom: 12px;">
                        <button class="btn btn-primary" style="padding: 8px 16px;" onclick="triggerImageUpload(this)">Upload Image</button>
                    </div>
                    <div class="occlusion-image-preview image-preview" style="margin-bottom: 12px;">${questionImagePreview}</div>
                    <input type="file" class="image-upload-input" accept="image/*" style="display:none;" onchange="handleImageFile(this)">
                    <input type="hidden" class="occlusion-image-input" value="${escapeHtml(String(questionImage))}">
                    
                    <input type="text" class="occlusion-label-input" placeholder="Hidden label (what's being tested)" style="width: 100%; padding: 10px; margin-bottom: 12px; border: 1px solid var(--border-color); border-radius: 8px;" value="${escapeHtml(String(question))}">
                    <input type="text" class="occlusion-answer-input" placeholder="Answer / Description" style="width: 100%; padding: 10px; border: 1px solid var(--border-color); border-radius: 8px;" value="${escapeHtml(String(answer))}">
                </div>
            </div>
            <button class="remove-card-btn" onclick="editorRemoveCard(${editorCardCounter})" data-testid="editor-card-remove-${editorCardCounter}"><svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor" style="width: 20px; height: 20px;"><path stroke-linecap="round" stroke-linejoin="round" d="m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0" /></svg></button>
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
    const questionAccentContainer = newRow.querySelector('.template-basic .question-input')?.nextElementSibling;
    const answerAccentContainer = newRow.querySelector('.template-basic .solution-input')?.nextElementSibling;
    const clozeAccentContainer = newRow.querySelector('.template-cloze .cloze-text-input')?.nextElementSibling;
    
    if (questionAccentContainer) populateEditorAccentButtons(questionAccentContainer, newRow.querySelector('.template-basic .question-input'));
    if (answerAccentContainer) populateEditorAccentButtons(answerAccentContainer, newRow.querySelector('.template-basic .solution-input'));
    if (clozeAccentContainer) populateEditorAccentButtons(clozeAccentContainer, newRow.querySelector('.template-cloze .cloze-text-input'));

    // Show the correct template based on card type
    const dropdown = newRow.querySelector('.card-type-dropdown');
    if (dropdown) {
        handleCardTypeChange(dropdown);
    }

    if (!question && !answer && !clozeText) {
        const firstInput = newRow.querySelector('.template-basic .question-input');
        if (firstInput) firstInput.focus();
    }
}

function handleCardTypeChange(select) {
    const cardItem = select.closest('.flashcard-item');
    if (!cardItem) return;
    
    const cardType = select.value;
    
    // Get all templates
    const templateBasic = cardItem.querySelector('.template-basic');
    const templateCloze = cardItem.querySelector('.template-cloze');
    const templateOcclusion = cardItem.querySelector('.template-occlusion');
    const reverseOptions = cardItem.querySelector('.reverse-options');
    const typeAnswerHint = cardItem.querySelector('.type-answer-hint');
    
    // Hide all templates first
    if (templateBasic) templateBasic.classList.add('hidden');
    if (templateCloze) templateCloze.classList.add('hidden');
    if (templateOcclusion) templateOcclusion.classList.add('hidden');
    if (reverseOptions) reverseOptions.classList.add('hidden');
    if (typeAnswerHint) typeAnswerHint.classList.add('hidden');
    
    // Show the appropriate template
    switch (cardType) {
        case 'cloze':
            if (templateCloze) templateCloze.classList.remove('hidden');
            break;
        case 'image_occlusion':
            if (templateOcclusion) templateOcclusion.classList.remove('hidden');
            break;
        case 'basic_reversed':
            if (templateBasic) templateBasic.classList.remove('hidden');
            if (reverseOptions) {
                reverseOptions.classList.remove('hidden');
                const checkbox = reverseOptions.querySelector('.add-reverse-checkbox');
                if (checkbox) {
                    checkbox.checked = true;
                    checkbox.disabled = true;
                }
                // Update label text
                const label = reverseOptions.querySelector('span');
                if (label) label.textContent = 'Reversed card will be created automatically';
            }
            break;
        case 'basic_optional_reversed':
            if (templateBasic) templateBasic.classList.remove('hidden');
            if (reverseOptions) {
                reverseOptions.classList.remove('hidden');
                const checkbox = reverseOptions.querySelector('.add-reverse-checkbox');
                if (checkbox) checkbox.disabled = false;
                // Update label text
                const label = reverseOptions.querySelector('span');
                if (label) label.textContent = 'Also create reversed card (Answer → Question)';
            }
            break;
        case 'basic_type_answer':
            if (templateBasic) templateBasic.classList.remove('hidden');
            if (typeAnswerHint) typeAnswerHint.classList.remove('hidden');
            break;
        default:
            // basic
            if (templateBasic) templateBasic.classList.remove('hidden');
            break;
    }
}

function setButtonDisabledState(button, isDisabled) {
    if (!button) return;
    button.disabled = isDisabled;
    button.classList.toggle('is-disabled', isDisabled);
}

function destroySequenceSortables() {
    if (sequenceSortable) {
        try {
            sequenceSortable.destroy();
        } catch (error) {
            console.warn('Failed to destroy sequence Sortable instance:', error);
        }
        sequenceSortable = null;
    }
    sequenceStepSortables.forEach((instance, el) => {
        try {
            instance.destroy();
        } catch (error) {
            console.warn('Failed to destroy sequence step Sortable instance:', error);
        }
        sequenceStepSortables.delete(el);
    });
}

function initSequenceBlockSortable() {
    const container = document.getElementById('flashcardsContainer');
    if (!container) return;
    if (sequenceSortable) {
        try {
            sequenceSortable.destroy();
        } catch (error) {
            console.warn('Failed to destroy sequence Sortable instance:', error);
        }
    }
    sequenceSortable = new Sortable(container, {
        animation: 150,
        handle: '.sequence-drag-handle',
        draggable: '.sequence-editor-block',
        ghostClass: 'drag-ghost',
        onEnd: () => {
            editorRenumberCards();
        }
    });
}

function initSequenceStepSortable(stepsContainer) {
    if (!stepsContainer) return;
    const existing = sequenceStepSortables.get(stepsContainer);
    if (existing) {
        try {
            existing.destroy();
        } catch (error) {
            console.warn('Failed to destroy existing sequence step Sortable:', error);
        }
    }
    const instance = new Sortable(stepsContainer, {
        animation: 150,
        handle: '.sequence-step-drag-handle',
        draggable: '.sequence-step',
        ghostClass: 'drag-ghost',
        onEnd: () => {
            editorRenumberCards();
        }
    });
    sequenceStepSortables.set(stepsContainer, instance);
}

function refreshSequenceSortables() {
    const deckType = document.getElementById('deckTypeHint')?.value;
    if (deckType !== 'Sequence') return;
    const container = document.getElementById('flashcardsContainer');
    if (!container) return;
    initSequenceBlockSortable();
    const stepContainers = Array.from(container.querySelectorAll('.sequence-steps'));
    const active = new Set();
    stepContainers.forEach(stepsContainer => {
        active.add(stepsContainer);
        initSequenceStepSortable(stepsContainer);
    });
    Array.from(sequenceStepSortables.keys()).forEach(key => {
        if (!active.has(key)) {
            const instance = sequenceStepSortables.get(key);
            if (instance) {
                try {
                    instance.destroy();
                } catch (error) {
                    console.warn('Failed to destroy stale sequence step Sortable:', error);
                }
            }
            sequenceStepSortables.delete(key);
        }
    });
}

function toggleSequenceCollapse(block) {
    if (!block) return;
    block.classList.toggle('is-collapsed');
    const btn = block.querySelector('.sequence-collapse-btn');
    if (btn) {
        btn.textContent = block.classList.contains('is-collapsed') ? 'Expand' : 'Collapse';
    }
}

function moveSequenceBlock(block, direction) {
    if (!block) return;
    const container = block.parentElement;
    if (!container) return;
    const siblings = Array.from(container.children);
    const index = siblings.indexOf(block);
    const targetIndex = index + direction;
    if (targetIndex < 0 || targetIndex >= siblings.length) return;
    const target = siblings[targetIndex];
    if (direction < 0) {
        container.insertBefore(block, target);
    } else {
        container.insertBefore(block, target.nextElementSibling);
    }
    editorRenumberCards();
}

function editorAddSequence(sequence = {}) {
    const sequenceId = sequence.sequenceId || sequence.id || crypto.randomUUID();
    const title = sequence.title || sequence.sequenceTitle || '';
    const description = sequence.description || '';
    const container = document.getElementById('flashcardsContainer');

    const block = document.createElement('div');
    block.className = 'sequence-editor-block';
    block.dataset.sequenceId = sequenceId;
    block.innerHTML = `
        <div class="sequence-editor-header">
            <div class="sequence-header-row">
                <div class="sequence-label">Sequence <span class="sequence-index"></span></div>
                <div class="sequence-header-actions">
                    <div class="sequence-drag-handle" title="Drag to reorder"></div>
                    <div class="sequence-editor-controls">
                        <button class="btn btn-secondary btn-compact sequence-move-up" type="button" aria-label="Move sequence up">↑</button>
                        <button class="btn btn-secondary btn-compact sequence-move-down" type="button" aria-label="Move sequence down">↓</button>
                        <button class="btn btn-secondary btn-compact sequence-collapse-btn" type="button">Collapse</button>
                        <button class="btn btn-danger btn-compact sequence-delete-btn" type="button">Delete</button>
                    </div>
                </div>
            </div>
            <div class="sequence-editor-meta">
                <div class="form-group">
                    <input type="text" class="sequence-title-input" value="${escapeHtml(String(title))}" placeholder="Sequence title">
                </div>
                <div class="form-group">
                    <input type="text" class="sequence-description-input" value="${escapeHtml(String(description || ''))}" placeholder="Description (optional)">
                </div>
            </div>
        </div>
        <div class="sequence-steps"></div>
        <button class="btn btn-secondary add-sequence-step-btn" type="button">+ Add Step</button>
    `;

    container.appendChild(block);
    const stepsContainer = block.querySelector('.sequence-steps');
    const addStepBtn = block.querySelector('.add-sequence-step-btn');
    if (addStepBtn) {
        addStepBtn.onclick = () => {
            editorAddSequenceStep(block);
        };
    }
    const deleteBtn = block.querySelector('.sequence-delete-btn');
    if (deleteBtn) {
        deleteBtn.onclick = () => removeSequenceBlock(block);
    }
    const collapseBtn = block.querySelector('.sequence-collapse-btn');
    if (collapseBtn) {
        collapseBtn.onclick = () => toggleSequenceCollapse(block);
    }
    const moveUpBtn = block.querySelector('.sequence-move-up');
    if (moveUpBtn) moveUpBtn.onclick = () => moveSequenceBlock(block, -1);
    const moveDownBtn = block.querySelector('.sequence-move-down');
    if (moveDownBtn) moveDownBtn.onclick = () => moveSequenceBlock(block, 1);

    const steps = sequence.steps || [];
    if (steps.length > 0) {
        steps.forEach(step => editorAddSequenceStep(block, step));
    } else if (stepsContainer) {
        editorAddSequenceStep(block);
    }
}

function editorAddSequenceStep(sequenceBlock, step = {}) {
    const stepsContainer = sequenceBlock.querySelector('.sequence-steps');
    if (!stepsContainer) return;
    const stepEl = document.createElement('div');
    stepEl.className = 'sequence-step';
    stepEl.dataset.originalId = step.id || step.cardId || step.cardID || '';
    stepEl.dataset.order = typeof step.order === 'number' ? step.order : stepsContainer.children.length;

    const question = step.question || step.stepText || '';
    const answer = step.answer || step.notes || '';

    stepEl.innerHTML = `
        <div class="sequence-step-header">
            <div class="sequence-step-number">Step <span class="step-index"></span></div>
            <div class="sequence-step-actions">
                <div class="sequence-step-drag-handle" title="Drag to reorder"></div>
                <div class="sequence-step-controls">
                    <button class="btn btn-secondary btn-compact step-move-up" type="button" aria-label="Move step up">↑</button>
                    <button class="btn btn-secondary btn-compact step-move-down" type="button" aria-label="Move step down">↓</button>
                    <button class="btn btn-danger btn-compact step-delete" type="button">Delete</button>
                </div>
            </div>
        </div>
        <div class="form-group">
            <textarea class="sequence-step-question" placeholder="Step">${escapeHtml(String(question))}</textarea>
        </div>
        <div class="form-group">
            <textarea class="sequence-step-notes" placeholder="Notes (optional)">${escapeHtml(String(answer))}</textarea>
        </div>
    `;

    const upBtn = stepEl.querySelector('.step-move-up');
    const downBtn = stepEl.querySelector('.step-move-down');
    const delBtn = stepEl.querySelector('.step-delete');
    if (upBtn) upBtn.onclick = () => moveSequenceStep(stepEl, -1);
    if (downBtn) downBtn.onclick = () => moveSequenceStep(stepEl, 1);
    if (delBtn) delBtn.onclick = () => removeSequenceStep(stepEl);

    stepsContainer.appendChild(stepEl);
    refreshSequenceSortables();
    editorRenumberCards();
}

function moveSequenceStep(stepEl, direction) {
    if (!stepEl) return;
    const parent = stepEl.parentElement;
    const siblings = Array.from(parent.children);
    const index = siblings.indexOf(stepEl);
    const targetIndex = index + direction;
    if (targetIndex < 0 || targetIndex >= siblings.length) return;
    const target = siblings[targetIndex];
    if (direction < 0) {
        parent.insertBefore(stepEl, target);
    } else {
        parent.insertBefore(stepEl, target.nextSibling);
    }
    editorRenumberCards();
}

function removeSequenceStep(stepEl) {
    if (!stepEl) return;
    const parent = stepEl.parentElement;
    stepEl.remove();
    if (!parent.children.length) {
        editorAddSequenceStep(parent.closest('.sequence-editor-block'));
    }
    refreshSequenceSortables();
    editorRenumberCards();
}

function removeSequenceBlock(block) {
    if (!block) return;
    block.remove();
    if (!document.querySelectorAll('#editorView .sequence-editor-block').length) {
        editorAddSequence();
    }
    refreshSequenceSortables();
    editorRenumberCards();
}

function collectSequenceEditorData(includeEmptySteps = false) {
    const blocks = Array.from(document.querySelectorAll('#flashcardsContainer .sequence-editor-block'));
    return blocks.map((block, seqIndex) => {
        const sequenceId = block.dataset.sequenceId || crypto.randomUUID();
        const titleInput = block.querySelector('.sequence-title-input');
        const descriptionInput = block.querySelector('.sequence-description-input');
        const sequenceTitle = titleInput ? titleInput.value.trim() : `Sequence ${seqIndex + 1}`;
        const description = descriptionInput ? descriptionInput.value.trim() : '';
        const steps = Array.from(block.querySelectorAll('.sequence-step')).map((el, stepIndex) => {
            const question = el.querySelector('.sequence-step-question')?.value.trim() || '';
            const answer = el.querySelector('.sequence-step-notes')?.value.trim() || '';
            const originalId = el.dataset.originalId;
            return {
                id: originalId || crypto.randomUUID(),
                question,
                answer,
                stepIndex,
                order: stepIndex,
                sequenceId,
                sequenceTitle: sequenceTitle || `Sequence ${seqIndex + 1}`
            };
        }).filter(step => includeEmptySteps ? true : Boolean(step.question));
        return {
            sequenceId,
            title: sequenceTitle || `Sequence ${seqIndex + 1}`,
            description,
            steps
        };
    }).filter(seq => includeEmptySteps ? true : seq.steps.length > 0);
}


function editorAddNewCard(type, card = {}) {
    if (type === 'Sequence') {
        editorAddSequence(card);
    } else {
        editorAddNewStandardCard(card);
    }
    editorRenumberCards();
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

function updateSequenceMoveButtons(sequenceBlocks) {
    sequenceBlocks.forEach((block, seqIndex) => {
        const upBtn = block.querySelector('.sequence-move-up');
        const downBtn = block.querySelector('.sequence-move-down');
        setButtonDisabledState(upBtn, seqIndex === 0);
        setButtonDisabledState(downBtn, seqIndex === sequenceBlocks.length - 1);
    });
}

function updateSequenceStepNumbers(stepsContainer) {
    const steps = Array.from(stepsContainer.querySelectorAll('.sequence-step'));
    steps.forEach((step, stepIndex) => {
        const numberSpan = step.querySelector('.step-index');
        const numberEl = step.querySelector('.sequence-step-number');
        if (numberSpan) {
            numberSpan.textContent = stepIndex + 1;
        } else if (numberEl) {
            numberEl.textContent = `Step ${stepIndex + 1}`;
        }
        const upBtn = step.querySelector('.step-move-up');
        const downBtn = step.querySelector('.step-move-down');
        setButtonDisabledState(upBtn, stepIndex === 0);
        setButtonDisabledState(downBtn, stepIndex === steps.length - 1);
    });
}

function editorRenumberCards() {
    const deckType = document.getElementById('deckTypeHint').value;
    if (deckType === 'Sequence') {
        const sequenceBlocks = Array.from(document.querySelectorAll('#editorView .sequence-editor-block'));
        sequenceBlocks.forEach((block, seqIndex) => {
            const label = block.querySelector('.sequence-label');
            const labelIndex = block.querySelector('.sequence-index');
            if (labelIndex) {
                labelIndex.textContent = seqIndex + 1;
            } else if (label) {
                label.textContent = `Sequence ${seqIndex + 1}`;
            }
            const stepsContainer = block.querySelector('.sequence-steps');
            if (stepsContainer) {
                updateSequenceStepNumbers(stepsContainer);
            }
        });
        updateSequenceMoveButtons(sequenceBlocks);
    } else {
        const cardRows = document.querySelectorAll('#editorView .flashcard-editor-row');
        cardRows.forEach((row, index) => {
            const numberElement = row.querySelector('.flashcard-number');
            if (numberElement) {
                numberElement.textContent = `${index + 1}.`;
            }
        });
    }
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
        let sequenceMeta = {};

        if (typeHint === 'Sequence') {
            const sequences = collectSequenceEditorData(false);
            if (!sequences.length) {
                showToast('Please add at least one sequence with steps.', 'error');
                saveBtn.innerHTML = originalText;
                saveBtn.disabled = false;
                return;
            }
            sequences.forEach((seq, seqIdx) => {
                const seqTitle = seq.title || `Sequence ${seqIdx + 1}`;
                sequenceMeta[seq.sequenceId] = { title: seqTitle, description: seq.description || '' };
                seq.steps.forEach((step, stepIdx) => {
                    cards.push({
                        id: step.id || crypto.randomUUID(),
                        question: step.question,
                        answer: step.answer || '',
                        sequenceId: seq.sequenceId,
                        sequenceTitle: seqTitle,
                        stepIndex: typeof step.stepIndex === 'number' ? step.stepIndex : stepIdx,
                        order: typeof step.order === 'number' ? step.order : stepIdx,
                        isNew: !step.id
                    });
                });
            });
        } else {
            cards = Array.from(document.querySelectorAll('#editorView .flashcard-item')).map(el => {
                const originalId = el.dataset.originalId;
                const cardTypeDropdown = el.querySelector('.card-type-dropdown');
                const cardType = cardTypeDropdown?.value || 'basic';
                
                const baseCard = {
                    id: originalId ? originalId : crypto.randomUUID(),
                    cardType: cardType,
                    order: 0,
                    isNew: !originalId
                };
                
                // Handle different card types
                if (cardType === 'cloze') {
                    const clozeText = el.querySelector('.cloze-text-input')?.value.trim() || '';
                    return {
                        ...baseCard,
                        question: clozeText,
                        answer: '', // Derived from cloze markers
                        text: clozeText,
                        clozeText: clozeText
                    };
                } else if (cardType === 'image_occlusion') {
                    return {
                        ...baseCard,
                        question: el.querySelector('.occlusion-label-input')?.value.trim() || 'Identify the hidden area',
                        answer: el.querySelector('.occlusion-answer-input')?.value.trim() || '',
                        questionImage: el.querySelector('.occlusion-image-input')?.value.trim() || '',
                        answerImage: ''
                    };
                } else if (cardType === 'basic_optional_reversed') {
                    const addReverseCheckbox = el.querySelector('.add-reverse-checkbox');
                    return {
                        ...baseCard,
                        question: el.querySelector('.question-input')?.value.trim() || '',
                        answer: el.querySelector('.solution-input')?.value.trim() || '',
                        questionImage: el.querySelector('.question-image-input')?.value.trim() || '',
                        answerImage: el.querySelector('.answer-image-input')?.value.trim() || '',
                        addReverse: addReverseCheckbox?.checked ? true : false
                    };
                } else {
                    // basic, basic_reversed, basic_type_answer
                    return {
                        ...baseCard,
                        question: el.querySelector('.question-input')?.value.trim() || '',
                        answer: el.querySelector('.solution-input')?.value.trim() || '',
                        questionImage: el.querySelector('.question-image-input')?.value.trim() || '',
                        answerImage: el.querySelector('.answer-image-input')?.value.trim() || ''
                    };
                }
            }).filter(c => {
                if (c.cardType === 'cloze') {
                    return c.clozeText || c.text || c.question;
                }
                if (c.cardType === 'image_occlusion') {
                    return c.questionImage || c.question;
                }
                return c.question || c.questionImage;
            });
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

        const tempDeck = { name, category, cards, notes, typeHint, sequenceMeta };
        showToast("Analysing deck content...", "info", 2000);
        await processDeckContent(tempDeck);

        if (currentDeckId) {
            const deck = decks[currentDeckId];
            deck.name = name;
            deck.category = category;
            deck.cards = tempDeck.cards;
            deck.notes = notes;
            deck.typeHint = typeHint;
            if (typeHint === 'Sequence') {
                deck.sequenceMeta = sequenceMeta;
            }
            deck.lastModified = new Date().toISOString();
            await saveDataToDB('decks', deck);
        } else {
            await createNewDeck(name, category, tempDeck.cards, notes, typeHint, typeHint === 'Sequence' ? { sequenceMeta } : {});
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
    deck.settings.learnModeMaxCards = parsePositiveInt(maxCards, null);

    await saveDataToDB('decks', deck);
    closeLearnModeSetupModal();
    startLearnMode(currentDeckId);
}

function configureStudy(mode, deckId) {
    currentDeckId = deckId || currentViewingDeckId;
    if (!currentDeckId) return;

    startMode(mode, currentDeckId);
}

async function buildDeckKnowledgeMap(deck) {
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

    for (const card of deck.cards) {
        let state = knowledgeMap.get(card.id);
        if (!state) {
            state = await getOrCreateKnowledgeState('default_user', card.id, deck.id);
            knowledgeMap.set(card.id, state);
        }
        if (state?.fsrs) card.fsrs = state.fsrs;
    }

    return knowledgeMap;
}

let evalModulesPromise = null;
async function getEvalModules() {
    if (!evalModulesPromise) {
        evalModulesPromise = Promise.all([
            import('../core/eval-router.js'),
            import('../core/eval-probes.js'),
            import('../core/eval-store.js'),
            import('../core/eval-integrity.js'),
            import('../core/eval-summary.js')
        ]).then(([router, probes, store, integrity, summary]) => ({ router, probes, store, integrity, summary }));
    }
    return evalModulesPromise;
}

let evalExposureDedupePromise = null;
async function getEvalExposureDedupeModule() {
    if (!evalExposureDedupePromise) {
        evalExposureDedupePromise = import('../core/eval-exposure-dedupe.js');
    }
    return evalExposureDedupePromise;
}

let practiceTestModulesPromise = null;
async function getPracticeTestModules() {
    if (!practiceTestModulesPromise) {
        practiceTestModulesPromise = Promise.all([
            import('../core/exam-blueprint.js'),
            import('../core/test-form.js')
        ]).then(([blueprints, testForm]) => ({
            validateBlueprint: blueprints.validateBlueprint,
            normaliseBlueprint: blueprints.normaliseBlueprint,
            DEFAULT_BLUEPRINT_EXAM_INDICATIVE: blueprints.DEFAULT_BLUEPRINT_EXAM_INDICATIVE,
            DEFAULT_BLUEPRINT_FREE_PRACTICE: blueprints.DEFAULT_BLUEPRINT_FREE_PRACTICE,
            getMcqDeckWarnings: blueprints.getMcqDeckWarnings,
            generateTestForm: testForm.generateTestForm
        }));
    }
    return practiceTestModulesPromise;
}

let practiceTestRuntimeModulesPromise = null;
async function getPracticeTestRuntimeModules() {
    if (!practiceTestRuntimeModulesPromise) {
        practiceTestRuntimeModulesPromise = import('../core/practice-test-runtime.js');
    }
    return practiceTestRuntimeModulesPromise;
}

function getBaselineChoice(candidates, knowledgeMap) {
    if (!candidates || candidates.length === 0) return null;

    // Baseline v1: FSRS/recency risk ordering
    const sorted = [...candidates].sort((a, b) => {
        const stateA = a.knowledgeState;
        const stateB = b.knowledgeState;
        
        const dueA = stateA?.fsrs?.due ? new Date(stateA.fsrs.due).getTime() : null;
        const dueB = stateB?.fsrs?.due ? new Date(stateB.fsrs.due).getTime() : null;
        
        if (dueA && dueB) return dueA - dueB;
        if (dueA) return -1;
        if (dueB) return 1;
        
        const lastA = stateA?.lastReviewed ? new Date(stateA.lastReviewed).getTime() : 0;
        const lastB = stateB?.lastReviewed ? new Date(stateB.lastReviewed).getTime() : 0;
        
        if (lastA !== lastB) return lastA - lastB;
        
        return Math.random() - 0.5;
    });
    
    return sorted[0].card;
}

function parsePositiveInt(value, fallback) {
    const parsed = Number.parseInt(value, 10);
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
    return fallback;
}

function buildLearnPool(deck, knowledgeMap, targetDate, maxCards) {
    if (!deck || !Array.isArray(deck.cards)) {
        return { activeLearningPool: [], sessionCardIds: [] };
    }

    const candidates = deck.cards.map(card => {
        const state = knowledgeMap.get(card.id);
        const retention = calculateRetentionAtDate(state, targetDate);
        return { card, knowledgeState: state, projectedRetention: typeof retention === 'number' ? retention : 0 };
    }).filter(entry => !isCardMasteredForLearn(entry.knowledgeState, deck, targetDate));

    candidates.sort((a, b) => (a.projectedRetention ?? 0) - (b.projectedRetention ?? 0));
    const poolLimit = Number.isFinite(maxCards) && maxCards > 0 ? maxCards : candidates.length;
    const activeLearningPool = candidates.slice(0, poolLimit).map(entry => entry.card);
    return { activeLearningPool, sessionCardIds: activeLearningPool.map(card => card.id) };
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

    // Initialize Evaluation Session
    try {
        const { router, store } = await getEvalModules();
        studyState.evalSessionId = router.makeSessionId();
        studyState.evalConfig = await store.loadEvalConfig('default_user');
        studyState.evalRng = router.makeRng(studyState.evalConfig.router.seed);
        studyState.pendingProbes = await store.loadPendingProbes('default_user');
        console.log('[Eval] Session started:', studyState.evalSessionId, studyState.evalConfig);
    } catch (err) {
        console.warn('[Eval] Failed to init evaluation session', err);
    }

    // Show/Hide Edit Button based on settings
    const editBtn = document.getElementById('editStudyCardBtn');
    if (globalSettings.enableInStudyEditing) {
        editBtn.classList.remove('hidden');
    } else {
        editBtn.classList.add('hidden');
    }

    const knowledgeMap = await buildDeckKnowledgeMap(deck);
    studyState.knowledgeStates = knowledgeMap;

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
    studyState.learnTargetDate = targetDate;
    const maxCards = parsePositiveInt(deck.settings.learnModeMaxCards, 40);
    const { activeLearningPool, sessionCardIds } = buildLearnPool(deck, knowledgeMap, targetDate, maxCards);
    studyState.activeLearningPool = activeLearningPool;
    studyState.roundCards = [];
    studyState.sessionCardIds = sessionCardIds;
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
    const cardsRequiringGeneration = activeLearningPool.filter(card => card.questionTypeToShow === 'MultipleChoice' && isOnline && !isTestMode());
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

    studyState.currentCard = await pickNextCardWithEval(cortex, deck);
    studyState.currentCardIndex = 0;
    studyState.startTime = new Date();

    transitionSubView(transitionSource, cardView);
    if (studyState.currentCard) {
        showNextCard();
    } else {
        showComplete();
    }
}

async function startSpacedMode(deckId) {
    currentMode = 'spaced';
    currentDeckId = deckId;
    resetSessionState();

    const deck = decks[deckId];
    if (!deck) {
        showToast('Deck not found.', 'error');
        return;
    }

    studyAccentModule?.refresh();

    deck.settings = { ...DEFAULT_DECK_SETTINGS, ...(deck.settings || {}) };
    studyState.settings = deck.settings;

    const editBtn = document.getElementById('editStudyCardBtn');
    if (globalSettings.enableInStudyEditing) {
        editBtn.classList.remove('hidden');
    } else {
        editBtn.classList.add('hidden');
    }

    const knowledgeMap = await buildDeckKnowledgeMap(deck);
    studyState.knowledgeStates = knowledgeMap;

    const now = new Date();
    const dueCards = [];
    const newCards = [];
    deck.cards.forEach(card => {
        const state = knowledgeMap.get(card.id);
        const fsrs = fallbackNormalizeFsrsState(state?.fsrs || state);
        const isReviewed = fallbackIsKnowledgeStateReviewed(state);
        const dueDate = fsrs?.due ? new Date(fsrs.due) : null;
        if (isReviewed && dueDate && dueDate <= now) {
            dueCards.push(card);
            return;
        }
        if (!isReviewed || (typeof fsrs?.reps === 'number' && fsrs.reps === 0)) {
            newCards.push(card);
        }
    });

    const maxReviews = Number.isFinite(deck.settings.spacedMaxReviewsPerDay)
        ? deck.settings.spacedMaxReviewsPerDay
        : DEFAULT_DECK_SETTINGS.spacedMaxReviewsPerDay;
    const newPerDay = Number.isFinite(deck.settings.spacedNewPerDay)
        ? deck.settings.spacedNewPerDay
        : DEFAULT_DECK_SETTINGS.spacedNewPerDay;

    const selectedDue = dueCards.slice(0, Math.max(0, maxReviews));
    const selectedNew = newCards.slice(0, Math.max(0, newPerDay));

    let sessionQueue = deck.settings.spacedOrder === 'random'
        ? shuffleArray([...selectedDue, ...selectedNew])
        : [...selectedDue, ...selectedNew];

    studyState.spacedMeta = new Map();
    selectedDue.forEach(card => studyState.spacedMeta.set(card.id, { type: 'due', seen: false, requeued: false }));
    selectedNew.forEach(card => studyState.spacedMeta.set(card.id, { type: 'new', seen: false, requeued: false }));

    studyState.spacedCounts = {
        dueRemaining: selectedDue.length,
        newRemaining: selectedNew.length
    };

    if (sessionQueue.length === 0) {
        showToast('No cards are due right now.', 'info');
        return;
    }

    studyState.roundCards = sessionQueue;
    studyState.currentCardIndex = 0;
    studyState.currentRound = 1;
    studyState.incorrectInThisRound = [];
    studyState.activeLearningPool = [];
    studyState.sessionCardIds = sessionQueue.map(c => c.id);
    studyState.startTime = new Date();
    studyState.spacedAnswerShown = false;

    transitionView('studyMode');
    resetStudySubViews();
    document.getElementById('studyTitle').textContent = 'Spaced Mode (FSRS)';
    document.getElementById('studySubtitle').textContent = deck.name;

    document.getElementById('pomodoroTimer').classList.add('hidden');

    const progressView = document.getElementById('progressView');
    const cardView = document.getElementById('cardView');
    progressView.classList.add('hidden');
    transitionSubView(progressView, cardView);
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

    let stateMap = studyState.knowledgeStates;
    if (!stateMap || stateMap.size === 0) {
        const allStates = await getAllDataFromDB('userKnowledgeState');
        stateMap = new Map(allStates.map(s => [s.cardID, s]));
        studyState.knowledgeStates = stateMap;
    }

    const deck = decks[currentDeckId];
    const learnTargetDate = studyState.learnTargetDate;
    const targetDateOverride = currentMode === 'learn'
        && learnTargetDate instanceof Date
        && !Number.isNaN(learnTargetDate.getTime())
        ? learnTargetDate
        : null;
    const scoringTargetOverride = currentMode === 'learn'
        ? (Number.isFinite(deck?.settings?.targetRetention)
            ? deck.settings.targetRetention
            : (Number.isFinite(studyState.targetRetention) ? studyState.targetRetention : 0.85))
        : null;

    const { percent, counts } = computeRetentionProgressPercent({
        cardIds: studyState.sessionCardIds,
        deck,
        stateMap,
        targetDateOverride,
        scoringTargetOverride
    });

    if (globalSettings.devMode) {
        console.log('[Progress] sessionProgress', { deckId: deck?.id, percent, counts });
    }

    const bar = document.getElementById('sessionProgressBar');
    const text = document.getElementById('sessionCounter');

    if (bar) bar.style.width = `${percent}%`;

    if (text) {
        const current = Math.round(percent);
        text.innerHTML = '';
        const label = document.createTextNode('Progress: ');
        const percentSpan = document.createElement('span');
        percentSpan.className = 'session-progress-percent';
        percentSpan.textContent = `${current}%`;
        text.appendChild(label);
        text.appendChild(percentSpan);
    }
}

function computeRetentionProgressPercent({ cardIds, deck, stateMap, targetDateOverride = null, scoringTargetOverride = null }) {
    const counts = {
        missingStateCount: 0,
        nonFiniteRetentionCount: 0,
        reviewedLikeCount: 0
    };

    if (!deck || !Array.isArray(cardIds) || cardIds.length === 0) {
        return { percent: 0, counts };
    }

    const settings = deck.settings || {};
    const hasExamDate = Boolean(settings.examDate);
    const targetRetention = Number.isFinite(settings.targetRetention) ? settings.targetRetention : 0.8;
    const overrideDateValid =
        targetDateOverride instanceof Date && !Number.isNaN(targetDateOverride.getTime());
    const examDateCandidate = hasExamDate ? new Date(settings.examDate) : null;
    const examTargetDate =
        examDateCandidate && !Number.isNaN(examDateCandidate.getTime()) ? examDateCandidate : null;
    const targetDate = overrideDateValid
        ? targetDateOverride
        : examTargetDate || new Date();

    const getState = id => {
        if (!stateMap) return undefined;
        if (typeof stateMap.get === 'function') return stateMap.get(id);
        return stateMap[id];
    };

    let totalScore = 0;
    const scoringTarget = Number.isFinite(scoringTargetOverride) && scoringTargetOverride > 0
        ? scoringTargetOverride
        : (hasExamDate ? targetRetention : 0.9);

    cardIds.forEach(id => {
        const state = getState(id);
        if (!state) {
            counts.missingStateCount += 1;
        } else if (state.lastReviewed || state.fsrs?.last_review) {
            counts.reviewedLikeCount += 1;
        }

        const retention = hasExamDate
            ? calculateExamRetention(state, targetDate)
            : calculateRetentionAtDate(state, targetDate);

        if (!Number.isFinite(retention)) {
            counts.nonFiniteRetentionCount += 1;
        }

        let score = scoringTarget ? retention / scoringTarget : retention;
        if (!Number.isFinite(score)) {
            score = 0;
        }
        score = Math.max(0, Math.min(1, score));
        totalScore += score;
    });

    const avgScore = cardIds.length ? totalScore / cardIds.length : 0;
    let percent = Number.isFinite(avgScore) ? avgScore * 100 : 0;
    percent = Math.max(0, Math.min(100, percent));
    return { percent, counts };
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
    renderMetricInto('deckMasteryValue', { label: 'Mastery', value: deckMasteryPercent, kind: 'mastery' }, ['compact']);
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
        studyState.learnTargetDate = targetDate;
        const maxCards = parsePositiveInt(deck.settings.learnModeMaxCards, 40);
        const { activeLearningPool, sessionCardIds } = buildLearnPool(deck, knowledgeMap, targetDate, maxCards);

        studyState.activeLearningPool = activeLearningPool;
        studyState.roundCards = [];
        studyState.sessionCardIds = sessionCardIds;
        studyState.examDate = deck.settings.examDate ? new Date(deck.settings.examDate) : null;
        studyState.targetRetention = deck.settings.targetRetention || studyState.targetRetention || 0.85;

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
            card => card.questionTypeToShow === 'MultipleChoice' && isOnline && !isTestMode()
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
            studyState.currentCard = await pickNextCardWithEval(cortex, deck);
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
        if (isTestMode() && typeof card.testQuestionType === 'string') {
            card.questionTypeToShow = card.testQuestionType;
            return;
        }
        const resolvedDeck = deckId ? decks[deckId] : decks[card.deckId || currentDeckId];
        card.questionTypeToShow = selectOptimalQuestionType(card, resolvedDeck, modeOverride);
    });
}

function getClozeStudyPayload(card) {
    const sourceText = card?.clozeText || card?.text || card?.question || '';
    const parsed = parseClozeText(sourceText);
    const indices = [...new Set(parsed.clozes.map(cloze => cloze.index))];
    const fallbackIndex = indices[0] || 1;
    let clozeIndex = Number.isFinite(card?.clozeIndex) ? card.clozeIndex : fallbackIndex;
    if (!indices.includes(clozeIndex)) clozeIndex = fallbackIndex;
    const normalizedText = parsed.text || sourceText;
    return {
        normalizedText,
        clozeIndex,
        displayText: renderClozeText(normalizedText, clozeIndex, { showHint: true, placeholder: '___________' }),
        answerText: getClozeAnswer(normalizedText, clozeIndex) || '',
        fullText: renderClozeText(normalizedText, -1, { showHint: false, placeholder: '___________' }),
        hasCloze: parsed.clozes.length > 0
    };
}

async function pickNextCardWithEval(cortex, deck) {
    try {
        const { router, probes, store, integrity } = await getEvalModules();
        const now = Date.now();
        
        // 1. Check for probes
        if (studyState.evalConfig?.probes?.enabled) {
            studyState.pendingProbes = probes.dropExpiredProbes(studyState.pendingProbes || [], now, studyState.evalConfig);
            
            let dueProbe = probes.nextDueProbe(studyState.pendingProbes, now, studyState.evalConfig);
            
            while (dueProbe) {
                let probeCard = null;
                const probeDeck = decks[dueProbe.deckId];
                if (probeDeck) {
                    probeCard = probeDeck.cards.find(c => c.id === dueProbe.cardId);
                }
                
                if (probeCard) {
                    // Check integrity
                    const { changed } = await integrity.checkAndUpdateFingerprint('default_user', dueProbe.cardId, probeCard);
                    
                    if (changed) {
                        // Invalidate and skip
                        const result = {
                            ...dueProbe,
                            completedAt: Date.now(),
                            outcome: null,
                            wasCorrect: null,
                            invalidated: true,
                            invalidReason: 'card_changed'
                        };
                        await store.appendCompletedProbe('default_user', result, studyState.evalConfig.probes.maxCompleted);
                        
                        // Remove from pending
                        studyState.pendingProbes = studyState.pendingProbes.filter(p => p.id !== dueProbe.id);
                        await store.savePendingProbes('default_user', studyState.pendingProbes);
                        
                        // Try next
                        dueProbe = probes.nextDueProbe(studyState.pendingProbes, now, studyState.evalConfig);
                        continue;
                    }

                    return { 
                        ...probeCard, 
                        isProbe: true, 
                        probeId: dueProbe.id, 
                        probeDelayHours: dueProbe.delayHours, 
                        probeSourcePolicy: dueProbe.sourcePolicy, 
                        probeArm: dueProbe.arm,
                        probeExperimentId: studyState.evalConfig?.experiment?.experimentId, // Or from probe if stored
                        probeScheduledAt: dueProbe.scheduledAt,
                        questionTypeToShow: 'Type'
                    };
                } else {
                    // Card missing? Invalidate
                    const result = {
                        ...dueProbe,
                        completedAt: Date.now(),
                        outcome: null,
                        wasCorrect: null,
                        invalidated: true,
                        invalidReason: 'card_missing'
                    };
                    await store.appendCompletedProbe('default_user', result, studyState.evalConfig.probes.maxCompleted);

                    studyState.pendingProbes = studyState.pendingProbes.filter(p => p.id !== dueProbe.id);
                    await store.savePendingProbes('default_user', studyState.pendingProbes);
                    
                    // Try next
                    dueProbe = probes.nextDueProbe(studyState.pendingProbes, now, studyState.evalConfig);
                }
            }
        }
        
        // 2. Normal selection
        let selected = null;
        let policy = null;
        let meta = {};

        const candidates = studyState.activeLearningPool.map(card => ({
            card,
            knowledgeState: studyState.knowledgeStates.get(card.id)
        }));

        if (studyState.evalConfig?.experiment?.mode === 'CARD_LEVEL_SPLIT') {
            const experimentId = studyState.evalConfig.experiment.experimentId;
            // Ensure assignment
            const cardMetas = studyState.activeLearningPool.map(c => ({
                cardId: c.id,
                deckId: c.deckId || 'default',
                difficulty: computeDifficultyProxy(c, studyState.knowledgeStates.get(c.id))
            }));
            const { assignment } = await store.ensureAssignment('default_user', experimentId, cardMetas, studyState.evalRng, {
                method: studyState.evalConfig.experiment.assignmentMethod || 'stratified_v1'
            });
            
            const groupA = studyState.activeLearningPool.filter(c => assignment[c.id] === 'A');
            const groupB = studyState.activeLearningPool.filter(c => assignment[c.id] === 'B');
            
            const cortexChoice = await cortex.pickNextCard(groupA, studyState.sessionState, deck, studyState.knowledgeStates);
            
            const candidatesB = groupB.map(card => ({
                card,
                knowledgeState: studyState.knowledgeStates.get(card.id)
            }));
            const baselineChoice = getBaselineChoice(candidatesB, studyState.knowledgeStates);

            // Choose arm (proportional balancing)
            const exposuresA = studyState.sessionState.exposuresA || 0;
            const exposuresB = studyState.sessionState.exposuresB || 0;
            
            let chosenArm = 'A';
            if (cortexChoice && baselineChoice) {
                if (exposuresA > exposuresB) chosenArm = 'B';
                else if (exposuresB > exposuresA) chosenArm = 'A';
                else chosenArm = studyState.evalRng() < 0.5 ? 'A' : 'B';
            } else if (cortexChoice) {
                chosenArm = 'A';
            } else if (baselineChoice) {
                chosenArm = 'B';
            } else {
                return null;
            }
            
            if (chosenArm === 'A') {
                selected = cortexChoice;
                policy = 'cortex';
                studyState.sessionState.exposuresA = exposuresA + 1;
            } else {
                selected = baselineChoice;
                policy = 'baseline';
                studyState.sessionState.exposuresB = exposuresB + 1;
            }
            
            meta = {
                mode: 'CARD_LEVEL_SPLIT',
                experimentId,
                chosenArm,
                candidateCountA: groupA.length,
                candidateCountB: groupB.length,
                cortexCardId: cortexChoice?.id,
                baselineCardId: baselineChoice?.id
            };

        } else {
            // STEP_LEVEL_ROUTER
            const cortexChoice = await cortex.pickNextCard(studyState.activeLearningPool, studyState.sessionState, deck, studyState.knowledgeStates);
            const baselineChoice = getBaselineChoice(candidates, studyState.knowledgeStates);
            policy = router.choosePolicy(studyState.sessionState, studyState.evalConfig, studyState.evalRng);
            selected = policy === 'cortex' ? cortexChoice : baselineChoice;
            
            meta = {
                mode: 'STEP_LEVEL_ROUTER',
                candidateCount: candidates.length,
                cortexCardId: cortexChoice?.id,
                baselineCardId: baselineChoice?.id
            };
        }
        
        if (selected) {
            await store.appendEvalEvent('default_user', {
                t: Date.now(),
                type: 'decision',
                sessionId: studyState.evalSessionId,
                deckId: deck.id,
                cardId: selected.id,
                policy: policy,
                meta: meta
            }, studyState.evalConfig.logging.maxEvents);
            
            selected.policy = policy;
            if (meta.chosenArm) selected.arm = meta.chosenArm;
            if (meta.experimentId) selected.experimentId = meta.experimentId;
        }
        
        return selected;
    } catch (err) {
        console.warn('[Eval] Error in pickNextCardWithEval, falling back to Cortex', err);
        return cortex.pickNextCard(studyState.activeLearningPool, studyState.sessionState, deck, studyState.knowledgeStates);
    }
}

async function showNextCard() {
    hidePreGenerationViewImmediately();
    const cardStatsInfo = document.getElementById('cardStatsInfo');
    if (cardStatsInfo) cardStatsInfo.innerHTML = '';

    document.getElementById('flashcardViewContainer').classList.add('hidden');
    document.getElementById('mcqView').classList.add('hidden');
    document.getElementById('writeAnswerInput').classList.add('hidden');
    studyState.mcqPipeline = null;
    const simpleButtons = document.getElementById('simpleAnswerButtons');
    simpleButtons.classList.remove('hidden');
    simpleButtons.querySelectorAll('button').forEach(btn => btn.classList.add('hidden'));

    const spacedButtons = document.getElementById('spacedRatingButtons');
    if (spacedButtons) spacedButtons.classList.add('hidden');
    studyState.spacedAnswerShown = false;

    const checkBtn = document.getElementById('checkAnswerBtn');
    const dontKnowBtn = document.getElementById('dontKnowBtn');
    checkBtn.onclick = autoCheckAnswer;
    dontKnowBtn.onclick = dontKnowAnswer;

    if (currentMode !== 'spaced' && shouldShowRemediation(Date.now())) {
        const task = popNextRemediation();
        if (task && renderLureRemediation(task)) {
            return;
        }
    }

    if (currentMode === 'learn' && !studyState.currentCard) {
        showComplete();
        return;
    }

    if (currentMode !== 'spaced') {
        decrementRemediationDelay();
    }

    if (currentMode === 'spaced') {
        if (studyState.currentCardIndex >= studyState.roundCards.length) {
            showToast('Spaced session complete!', 'success');
            await endSession();
            return;
        }

        const card = studyState.roundCards[studyState.currentCardIndex];
        if (!card) {
            showComplete();
            return;
        }

        startInteractionLog(card.id);

        document.getElementById('flashcardViewContainer').classList.remove('hidden');
        const cardQuestionEl = document.getElementById('cardQuestion');
        const cardAnswerEl = document.getElementById('cardAnswer');
        const cardType = detectCardType(card);
        if (cardType === CARD_TYPES.CLOZE) {
            const clozePayload = getClozeStudyPayload(card);
            card.clozeIndex = clozePayload.clozeIndex;
            card.answer = clozePayload.answerText || card.answer || '';
            card.clozeFullText = clozePayload.fullText || card.clozeFullText;
            if (cardQuestionEl) cardQuestionEl.textContent = clozePayload.displayText;
            if (cardAnswerEl) cardAnswerEl.textContent = clozePayload.fullText || card.answer || '';
        } else {
            if (cardQuestionEl) cardQuestionEl.textContent = card.question || '';
            if (cardAnswerEl) cardAnswerEl.textContent = card.answer || '';
        }

        document.getElementById('showAnswerBtn').classList.remove('hidden');
        document.querySelector('#cardView .flashcard').classList.remove('is-flipped');
        document.getElementById('cardAnswerContent').classList.add('hidden');

        const info = document.getElementById('cardRoundInfo');
        const counts = studyState.spacedCounts || { dueRemaining: 0, newRemaining: 0 };
        const remainingTotal = studyState.roundCards.length - studyState.currentCardIndex;
        if (info) {
            info.textContent = `Due: ${counts.dueRemaining} | New: ${counts.newRemaining} | Left: ${remainingTotal}`;
        }

        await renderSpacedIntervals(card);
        return;
    }

    if (currentMode === 'review') {
        if (studyState.currentCardIndex >= studyState.roundCards.length) {
            showToast("Review complete!", "success");
            await endSession();
            return;
        }

        const card = studyState.roundCards[studyState.currentCardIndex];
        startInteractionLog(card.id);

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
                    masterySpan.style.color = 'var(--deck-accent)';
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
        const cardType = detectCardType(card);
        if (cardType === CARD_TYPES.CLOZE) {
            const clozePayload = getClozeStudyPayload(card);
            card.clozeIndex = clozePayload.clozeIndex;
            card.answer = clozePayload.answerText || card.answer || '';
            card.clozeFullText = clozePayload.fullText || card.clozeFullText;
            if (cardQuestionEl) cardQuestionEl.textContent = clozePayload.displayText;
            if (cardAnswerEl) cardAnswerEl.textContent = clozePayload.fullText || card.answer || '';
        } else {
            if (cardQuestionEl) cardQuestionEl.textContent = card.question || '';
            if (cardAnswerEl) cardAnswerEl.textContent = card.answer || '';
        }

        document.getElementById('showAnswerBtn').classList.remove('hidden');

        document.querySelector('#cardView .flashcard').classList.remove('is-flipped');
        document.getElementById('cardAnswerContent').classList.add('hidden');
        document.getElementById('cardRoundInfo').textContent = `Card ${studyState.currentCardIndex + 1} of ${studyState.roundCards.length}`;

        return;
    }

    if (currentMode === 'learn') {
        const card = studyState.currentCard;
        if (!card) {
            showComplete();
            return;
        }
        await resetEvalExposureFlagForNewCard(card.id);
        studyState.isRetypingIncorrect = false;
        const questionType = card.questionTypeToShow || selectOptimalQuestionType(card, decks[currentDeckId], 'learn');
        card.questionTypeToShow = questionType;

        switch (questionType) {
            case 'MultipleChoice':
                document.getElementById('mcqView').classList.remove('hidden');
                {
                    const mcqQEl = document.getElementById('mcqQuestion');
                    if (mcqQEl) mcqQEl.textContent = card.question || '';
                }
                renderMcqOptionsPlaceholder();
                startInteractionLog(card.id);
                generateAndDisplayMCQ(card);
                simpleButtons.classList.add('hidden');
                break;

            case 'Cloze':
                document.getElementById('flashcardViewContainer').classList.remove('hidden');
                {
                    const clozePayload = getClozeStudyPayload(card);
                    card.clozeIndex = clozePayload.clozeIndex;
                    card.answer = clozePayload.answerText || card.answer || '';
                    card.clozeFullText = clozePayload.fullText || card.clozeFullText;
                    const clozeQEl = document.getElementById('cardQuestion');
                    if (clozeQEl) clozeQEl.textContent = clozePayload.displayText;
                }

                document.getElementById('writeAnswerInput').classList.remove('hidden');
                document.getElementById('checkAnswerBtn').classList.remove('hidden');
                document.getElementById('dontKnowBtn').classList.remove('hidden');

                updateAccentButtonsVisibility();

                startInteractionLog(card.id);
                break;

            case 'Type':
                document.getElementById('flashcardViewContainer').classList.remove('hidden');
                {
                    const typeQEl = document.getElementById('cardQuestion');
                    if (typeQEl) typeQEl.textContent = card.question || '';
                }

                document.getElementById('writeAnswerInput').classList.remove('hidden');
                document.getElementById('checkAnswerBtn').classList.remove('hidden');
                document.getElementById('dontKnowBtn').classList.remove('hidden');

                updateAccentButtonsVisibility();

                startInteractionLog(card.id);
                break;

            default:
                document.getElementById('flashcardViewContainer').classList.remove('hidden');
                {
                    const defQEl = document.getElementById('cardQuestion');
                    if (defQEl) defQEl.textContent = card.question || '';
                }
                document.getElementById('showAnswerBtn').classList.remove('hidden');
                startInteractionLog(card.id);
                break;
        }

        const flashcardElem = document.querySelector('#cardView .flashcard');
        flashcardElem.classList.remove('is-flipped');
        const cardAnswerEl = document.getElementById('cardAnswer');
        if (cardAnswerEl) {
            if (questionType === 'Cloze' && card.clozeFullText) {
                cardAnswerEl.textContent = card.clozeFullText;
            } else {
                cardAnswerEl.textContent = card.answer || '';
            }
        }
        document.getElementById('cardAnswerContent').classList.add('hidden');

        const writeInput = document.getElementById('writeAnswerInput');
        setActiveStudyInput(writeInput);
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
                {
                    const mqEl = document.getElementById('mcqQuestion');
                    if (mqEl) mqEl.textContent = card.question || '';
                }
                document.getElementById('writeAnswerInput').classList.remove('hidden');
                document.getElementById('checkAnswerBtn').classList.remove('hidden');
                document.getElementById('dontKnowBtn').classList.remove('hidden');
                {
                    const optionsContainer = document.getElementById('mcqOptions');
                    if (optionsContainer) {
                        optionsContainer.innerHTML = '';
                        optionsContainer.classList.add('hidden');
                    }
                }
                {
                    const feedbackMessage = document.getElementById('feedbackMessage');
                    if (feedbackMessage) feedbackMessage.innerHTML = '';
                }
                checkBtn.onclick = submitMcqRecallAttempt;
                dontKnowBtn.onclick = skipMcqRecallAttempt;
                startInteractionLog(card.id);
                startMcqPipeline(card);
                simpleButtons.classList.add('hidden');
                break;

        case 'Cloze':
            document.getElementById('flashcardViewContainer').classList.remove('hidden');
            {
                const clozePayload = getClozeStudyPayload(card);
                card.clozeIndex = clozePayload.clozeIndex;
                card.answer = clozePayload.answerText || card.answer || '';
                card.clozeFullText = clozePayload.fullText || card.clozeFullText;
                const cardQuestionEl = document.getElementById('cardQuestion');
                if (cardQuestionEl) cardQuestionEl.textContent = clozePayload.displayText;
            }

            document.getElementById('writeAnswerInput').classList.remove('hidden');
            document.getElementById('checkAnswerBtn').classList.remove('hidden');
            document.getElementById('dontKnowBtn').classList.remove('hidden');

            updateAccentButtonsVisibility();

            startInteractionLog(card.id);
            break;

        case 'Type':
            document.getElementById('flashcardViewContainer').classList.remove('hidden');
            {
                const typeQEl2 = document.getElementById('cardQuestion');
                if (typeQEl2) typeQEl2.textContent = card.question || '';
            }

            document.getElementById('writeAnswerInput').classList.remove('hidden');
            document.getElementById('checkAnswerBtn').classList.remove('hidden');
            document.getElementById('dontKnowBtn').classList.remove('hidden');

            updateAccentButtonsVisibility();

            startInteractionLog(card.id);
            break;

        default:
            document.getElementById('flashcardViewContainer').classList.remove('hidden');
            {
                const defQEl2 = document.getElementById('cardQuestion');
                if (defQEl2) defQEl2.textContent = card.question || '';
            }
            document.getElementById('showAnswerBtn').classList.remove('hidden');
            break;
    }

    const flashcardElem = document.querySelector('#cardView .flashcard');
    flashcardElem.classList.remove('is-flipped');
    const cardAnswerEl2 = document.getElementById('cardAnswer');
    if (cardAnswerEl2) {
        if (questionType === 'Cloze' && card.clozeFullText) {
            cardAnswerEl2.textContent = card.clozeFullText;
        } else {
            cardAnswerEl2.textContent = card.answer || '';
        }
    }
    document.getElementById('cardAnswerContent').classList.add('hidden');

    const writeInput = document.getElementById('writeAnswerInput');
    setActiveStudyInput(writeInput);
    writeInput.value = '';
    writeInput.disabled = false;
    writeInput.classList.remove('correct', 'incorrect');
    if (!writeInput.classList.contains('hidden')) setTimeout(() => writeInput.focus(), 100);

    if (currentMode !== 'learn') {
        document.getElementById('cardRoundInfo').textContent = `Round ${studyState.currentRound} - Card ${studyState.currentCardIndex + 1} of ${studyState.roundCards.length}`;
    }
}

async function renderSpacedIntervals(card) {
    const intervalEls = {
        Again: document.getElementById('spacedAgainInterval'),
        Hard: document.getElementById('spacedHardInterval'),
        Good: document.getElementById('spacedGoodInterval'),
        Easy: document.getElementById('spacedEasyInterval')
    };

    Object.values(intervalEls).forEach(el => { if (el) el.textContent = ''; });

    const settings = { ...DEFAULT_DECK_SETTINGS, ...(decks[currentDeckId]?.settings || {}), ...(studyState.settings || {}) };
    if (!settings.spacedShowIntervals) return;

    try {
        const engine = await getFsrsEngine();
        const prepared = await prepareFsrsCard(card);
        const repeatResult = await engine.repeat(prepared, new Date());
        const ratings = engine.getRatings();
        const ratingMap = [
            ['Again', ratings.Again],
            ['Hard', ratings.Hard],
            ['Good', ratings.Good],
            ['Easy', ratings.Easy]
        ];

        ratingMap.forEach(([label, value]) => {
            const target = intervalEls[label];
            if (!target) return;
            const outcome = Array.isArray(repeatResult)
                ? repeatResult[value]
                : (repeatResult?.[value] || repeatResult?.[label] || null);
            const dueRaw = outcome?.card?.due || outcome?.due || outcome?.log?.due || null;
            const intervalText = dueRaw ? formatIntervalFromNow(new Date(dueRaw)) : '';
            target.textContent = intervalText ? `(${intervalText})` : '';
        });
    } catch (error) {
        console.warn('Failed to compute spaced intervals preview', error);
    }
}

function showAnswer() {
    document.querySelector('#cardView .flashcard').classList.add('is-flipped');
    document.getElementById('cardAnswerContent').classList.remove('hidden');

    document.getElementById('showAnswerBtn').classList.add('hidden');
    document.getElementById('checkAnswerBtn').classList.add('hidden');

    if (currentMode === 'spaced') {
        studyState.spacedAnswerShown = true;
        document.getElementById('showQuestionBtn').classList.add('hidden');
        document.getElementById('correctBtn').classList.add('hidden');
        document.getElementById('incorrectBtn').classList.add('hidden');
        document.getElementById('dontKnowBtn').classList.add('hidden');
        const spacedButtons = document.getElementById('spacedRatingButtons');
        if (spacedButtons) spacedButtons.classList.remove('hidden');
        return;
    }

    document.getElementById('correctBtn').classList.remove('hidden');
    document.getElementById('incorrectBtn').classList.remove('hidden');
    document.getElementById('showQuestionBtn').classList.remove('hidden');
}
async function logout() {
    try {
        if (isTestMode()) {
            clearAuthSession();
            const userProfileMenu = document.getElementById('userProfileMenu');
            if (userProfileMenu) userProfileMenu.classList.add('hidden');
            const guestSignupBtn = document.getElementById('guestSignupBtn');
            if (guestSignupBtn) guestSignupBtn.classList.remove('hidden');
            const loggedInView = document.getElementById('loggedInView');
            if (loggedInView) loggedInView.classList.add('hidden');
            const loggedOutView = document.getElementById('loggedOutView');
            if (loggedOutView) loggedOutView.classList.remove('hidden');
            const appHeader = document.getElementById('appHeader');
            if (appHeader) appHeader.classList.add('hidden');
            transitionView('authView', false, null, false);
            window.__APP_READY__ = true;
            return;
        }
        const { domain: auth0Domain, clientId: auth0ClientId } = getBrowserAuthConfig();

        if (!window.auth0?.createAuth0Client) {
            throw new Error('Auth0 client not available');
        }

        const auth0Client = await window.auth0.createAuth0Client({
            domain: auth0Domain,
            clientId: auth0ClientId,
            authorizationParams: {
                redirect_uri: window.location.origin
            }
        });

        // Clear local storage first
        clearAuthSession();

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
        clearAuthSession();
        location.reload();
    }
}



function showQuestion() {
    document.querySelector('#cardView .flashcard').classList.remove('is-flipped');

    document.getElementById('showQuestionBtn').classList.add('hidden');
    document.getElementById('correctBtn').classList.add('hidden');
    document.getElementById('incorrectBtn').classList.add('hidden');

    const isWriteMode = (currentMode === 'learn' && studyState.settings.learnMode === 'write') || (currentMode === 'review' && studyState.settings.reviewMode === 'write');

    if (isWriteMode) {
        document.getElementById('checkAnswerBtn').classList.remove('hidden');
        document.getElementById('dontKnowBtn').classList.toggle('hidden', studyState.isRetypingIncorrect);
    } else {
        document.getElementById('showAnswerBtn').classList.remove('hidden');
    }
}

async function resetEvalExposureFlagForNewCard(cardId) {
    if (!cardId) return;
    const { resetEvalExposureState } = await getEvalExposureDedupeModule();
    studyState.evalExposureLogged = resetEvalExposureState(studyState.evalExposureLogged, cardId);
}

async function logEvalExposureOnce(card, wasCorrect, latencyMs, extraMeta = null) {
    if (currentMode !== 'learn' || !card || card.isProbe) return;
    if (studyState.mcqRemediation?.activeTask?.cardId === card.id) return;
    const { applyEvalExposureLog } = await getEvalExposureDedupeModule();
    const token = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const decision = applyEvalExposureLog(studyState.evalExposureLogged, card.id, token);
    studyState.evalExposureLogged = decision.state;
    if (!decision.shouldLog) return;
    await logAndScheduleProbe(card, wasCorrect, latencyMs, extraMeta);
}

async function logAndScheduleProbe(card, wasCorrect, latencyMs, extraMeta = null) {
    try {
        const { probes, store, integrity } = await getEvalModules();
        
        // Update fingerprint on exposure
        await integrity.checkAndUpdateFingerprint('default_user', card.id, card);

        const policy = card.policy || 'cortex';
        let arm = card.arm;
        if (!arm) {
            arm = policy === 'cortex' ? 'A' : 'B';
        }
        
        await store.appendEvalEvent('default_user', {
            t: Date.now(),
            type: 'exposure',
            sessionId: studyState.evalSessionId,
            deckId: card.deckId || currentDeckId,
            cardId: card.id,
            policy: policy,
            arm: arm,
            experimentId: card.experimentId || studyState.evalConfig?.experiment?.experimentId,
            meta: { wasCorrect, latencyMs, ...(extraMeta || {}) }
        }, studyState.evalConfig.logging.maxEvents);
        
        const probe = probes.scheduleProbeForExposure({
            userID: 'default_user',
            cardId: card.id,
            deckId: card.deckId || currentDeckId,
            policy: policy,
            arm: arm,
            now: Date.now(),
            config: studyState.evalConfig,
            rng: studyState.evalRng,
            pendingProbes: studyState.pendingProbes
        });
        
        if (probe) {
            studyState.pendingProbes.push(probe);
            await store.savePendingProbes('default_user', studyState.pendingProbes);
        }
    } catch (err) {
        console.warn('[Eval] Failed to log/schedule probe', err);
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
    let correctAnswer = card.answer.trim();
    if (detectCardType(card) === CARD_TYPES.CLOZE) {
        const clozePayload = getClozeStudyPayload(card);
        card.clozeIndex = clozePayload.clozeIndex;
        card.answer = clozePayload.answerText || card.answer || '';
        card.clozeFullText = clozePayload.fullText || card.clozeFullText;
        correctAnswer = card.answer.trim();
    }

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

    // Handle Probe
    if (card.isProbe) {
        const wasCorrect = checkResult.result === 'CORRECT' || checkResult.result === 'TYPO';
        try {
            const { store } = await getEvalModules();
            const probeResult = {
                id: card.probeId,
                userID: 'default_user',
                cardId: card.id,
                deckId: card.deckId || currentDeckId,
                delayHours: card.probeDelayHours,
                sourcePolicy: card.probeSourcePolicy,
                arm: card.probeArm,
                experimentId: card.probeExperimentId,
                scheduledAt: card.probeScheduledAt,
                answeredAt: Date.now(),
                wasCorrect: wasCorrect,
                latencyMs: recallLatency
            };
            
            await store.appendCompletedProbe('default_user', probeResult, studyState.evalConfig.probes.maxCompleted);
            
            studyState.pendingProbes = studyState.pendingProbes.filter(p => p.id !== card.probeId);
            await store.savePendingProbes('default_user', studyState.pendingProbes);
            
            await store.appendEvalEvent('default_user', {
                t: Date.now(),
                type: 'probe',
                sessionId: studyState.evalSessionId,
                deckId: card.deckId || currentDeckId,
                cardId: card.id,
                policy: null,
                meta: { probeId: card.probeId, wasCorrect }
            }, studyState.evalConfig.logging.maxEvents);
            
            showToast(wasCorrect ? "Probe recorded!" : "Probe recorded.", wasCorrect ? "success" : "info");
        } catch (err) {
            console.warn('[Eval] Failed to record probe', err);
        }

        userInput.value = '';
        userInput.disabled = false;
        userInput.classList.remove('correct', 'incorrect');
        document.querySelector('#cardView .flashcard').classList.remove('is-flipped');
        document.getElementById('cardAnswerContent').classList.add('hidden');
        
        showNextCard();
        return;
    }

    userInput.disabled = true;
    document.querySelector('#cardView .flashcard').classList.add('is-flipped');
    document.getElementById('cardAnswerContent').classList.remove('hidden');
    document.getElementById('checkAnswerBtn').classList.add('hidden');
    document.getElementById('dontKnowBtn').classList.add('hidden');
    let questionTypeForLog = document.getElementById('mcqView').classList.contains('hidden') ? 'Type' : 'MultipleChoice';
    if (detectCardType(card) === CARD_TYPES.CLOZE) {
        questionTypeForLog = 'Cloze';
    }

    switch (checkResult.result) {
        case 'CORRECT':
            userInput.classList.add('correct');
            showToast("Correct!", "success");
            logInteraction({ cardID: card.id, wasCorrect: true, userAnswer, recallLatency, answerFluency, totalCorrections: 0, attemptCount: 1, questionType: questionTypeForLog });
            
            await logEvalExposureOnce(card, true, recallLatency);

            setTimeout(() => moveCard(card, true, questionTypeForLog), 1200);
            break;

        case 'TYPO':
            userInput.classList.add('correct');
            feedbackMessage.textContent = `So close! The correct answer is: ${correctAnswer}`;
            feedbackMessage.style.color = 'var(--deck-accent)';

            logInteraction({ cardID: card.id, wasCorrect: true, userAnswer, recallLatency, answerFluency, totalCorrections: checkResult.distance, attemptCount: 1, questionType: questionTypeForLog });

            await logEvalExposureOnce(card, true, recallLatency);

            setTimeout(() => {
                feedbackMessage.textContent = '';
                moveCard(card, true, questionTypeForLog);
            }, 2500);
            break;

        case 'INCORRECT':
            userInput.classList.add('incorrect');
            logInteraction({ cardID: card.id, wasCorrect: false, userAnswer, recallLatency, answerFluency, totalCorrections: 0, attemptCount: 1, questionType: questionTypeForLog });

            await logEvalExposureOnce(card, false, recallLatency);

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
}

async function updateUserBaseline() {
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

async function moveCard(card, correct, questionType = 'Flashcard', reviewOptions = {}) {
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

    const lastLog = currentInteractionLog || {};
    const userBaseline = getFsrsBaseline();
    const backspaceCount = Number.isFinite(lastLog.backspaceCount) ? lastLog.backspaceCount : 0;
    const deleteCount = Number.isFinite(lastLog.deleteCount) ? lastLog.deleteCount : 0;
    const attemptCount = (Number.isFinite(lastLog.attemptCount) && lastLog.attemptCount > 0)
        ? lastLog.attemptCount
        : 1;
    const totalCorrections = backspaceCount + deleteCount;
    const safeInteractionLog = {
        ...lastLog,
        backspaceCount,
        deleteCount,
        attemptCount,
        totalCorrections
    };

    const iqs = calculateIQS({
        recallLatency: Number.isFinite(lastLog.recallLatency) ? lastLog.recallLatency : 2000,
        answerFluency: Number.isFinite(lastLog.answerFluency) ? lastLog.answerFluency : 5,
        totalCorrections,
        attemptCount
    }, userBaseline);

    const fsrsResult = await applyFsrsReviewUpdate(
        cardInDeck || card,
        deckIdForThisCard,
        correct,
        { ...safeInteractionLog, questionType },
        iqs,
        { ...reviewOptions, questionType }
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
        recallLatency: safeInteractionLog.recallLatency,
        totalCorrections,
        answerFluency: safeInteractionLog.answerFluency
    });

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

    if (currentMode === 'learn') {
        await saveDataToDB('decks', decks[deckIdForThisCard]);
        const deckForLearn = decks[currentDeckId] || deck;
        const cortex = await getCortexEngine();
        let targetDate = studyState.learnTargetDate;
        if (!(targetDate instanceof Date) || Number.isNaN(targetDate.getTime())) {
            const now = new Date();
            targetDate = cortex.buildTargetDate(deckForLearn, now);
            studyState.learnTargetDate = targetDate;
            logLearnTargetSource(deckForLearn, now, targetDate);
        }
        const pool = Array.isArray(studyState.activeLearningPool) ? studyState.activeLearningPool : [];
        studyState.activeLearningPool = pool.filter(poolCard => {
            const state = studyState.knowledgeStates?.get(poolCard.id);
            return !isCardMasteredForLearn(state, deckForLearn, targetDate);
        });
        await updateSessionProgress();
        if (studyState.activeLearningPool.length === 0) {
            studyState.currentCard = null;
            showComplete();
        } else {
            studyState.currentCard = await pickNextCardWithEval(cortex, deckForLearn);
            showNextCard();
        }
        updateFocusMeter();
        return;
    }

    // Advance to next card
    studyState.currentCardIndex++;
    showNextCard();
    updateFocusMeter();

    // Persist deck changes
    await saveDataToDB('decks', decks[deckIdForThisCard]);
}

async function dontKnowAnswer() {
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
    const recallLatency = (typeof currentInteractionLog?.questionLoadTime === 'number')
        ? Math.round(performance.now() - currentInteractionLog.questionLoadTime)
        : null;
    await logEvalExposureOnce(card, false, recallLatency, { action: 'dont_know' });

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

        const clozeReveal = (detectCardType(card) === CARD_TYPES.CLOZE)
            ? (card.clozeFullText || card.answer)
            : card.answer;
        feedbackMessage.innerHTML = `<strong>The correct answer is:</strong> <span style="color:var(--primary-color)">${escapeHtml(String(clozeReveal))}</span>`;

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
    setTimeout(async () => {
        btn.classList.remove('feedback-correct');
        const card = getActiveCard();
        if (!card) return;
        const responseLatency = (typeof currentInteractionLog?.questionLoadTime === 'number')
            ? Math.round(performance.now() - currentInteractionLog.questionLoadTime)
            : null;
        await logEvalExposureOnce(card, true, responseLatency, { action: 'manual_grade' });
        moveCard(card, true);
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
    setTimeout(async () => {
        btn.classList.remove('feedback-incorrect');
        const card = getActiveCard();
        if (!card) return;
        const responseLatency = (typeof currentInteractionLog?.questionLoadTime === 'number')
            ? Math.round(performance.now() - currentInteractionLog.questionLoadTime)
            : null;
        await logEvalExposureOnce(card, false, responseLatency, { action: 'manual_grade' });
        moveCard(card, false);
    }, 200);
}

function markAnswerCorrect(isAutomated = false) {
    markCorrect(isAutomated);
}

function markAnswerIncorrect(isAutomated = false) {
    markIncorrect(isAutomated);
}

async function gradeSpaced(ratingLabel) {
    if (currentMode !== 'spaced') return;
    const card = studyState.roundCards?.[studyState.currentCardIndex];
    if (!card) return;

    if (!studyState.spacedAnswerShown) {
        showAnswer();
        return;
    }

    const deckId = currentDeckId;
    const deck = decks[deckId];
    const spacedButtons = document.getElementById('spacedRatingButtons');
    if (spacedButtons) spacedButtons.classList.add('hidden');

    const engine = await getFsrsEngine();
    const ratings = engine.getRatings();
    const ratingValue = typeof ratingLabel === 'number' ? ratingLabel : (ratings?.[ratingLabel] ?? ratings?.Good ?? 2);
    const ratingName = typeof ratingLabel === 'string'
        ? ratingLabel
        : (Object.keys(ratings || {}).find(key => ratings[key] === ratingValue) || 'Good');

    const now = new Date();
    const recallLatency = typeof currentInteractionLog?.questionLoadTime === 'number'
        ? Math.round(performance.now() - currentInteractionLog.questionLoadTime)
        : null;
    const backspaceCount = Number.isFinite(currentInteractionLog?.backspaceCount)
        ? currentInteractionLog.backspaceCount
        : 0;
    const deleteCount = Number.isFinite(currentInteractionLog?.deleteCount)
        ? currentInteractionLog.deleteCount
        : 0;
    const attemptCount = (Number.isFinite(currentInteractionLog?.attemptCount) && currentInteractionLog.attemptCount > 0)
        ? currentInteractionLog.attemptCount
        : 1;
    const totalCorrections = backspaceCount + deleteCount;
    const baseLog = {
        ...currentInteractionLog,
        recallLatency,
        answerFluency: Number.isFinite(currentInteractionLog?.answerFluency) ? currentInteractionLog.answerFluency : null,
        totalCorrections,
        attemptCount,
        backspaceCount,
        deleteCount,
        questionType: 'Spaced'
    };

    await logInteraction({
        cardID: card.id,
        wasCorrect: ratingName !== 'Again',
        recallLatency,
        answerFluency: baseLog.answerFluency,
        totalCorrections,
        attemptCount: baseLog.attemptCount,
        questionType: 'Spaced',
        fsrsRating: ratingName
    });

    const userBaseline = getFsrsBaseline();
    const iqs = calculateIQS({
        recallLatency: baseLog.recallLatency || 2000,
        answerFluency: baseLog.answerFluency || 5,
        totalCorrections,
        attemptCount: baseLog.attemptCount
    }, userBaseline);

    const fsrsResult = await applyFsrsReviewUpdate(
        card,
        deckId,
        ratingName !== 'Again',
        baseLog,
        iqs,
        { explicitFsrsRating: ratingValue, nowOverride: now, questionType: 'Spaced' }
    );

    const fsrsSnapshot = fsrsResult?.fsrsSnapshot || null;
    const stability = fsrsResult?.state?.stability ?? null;
    if (deck?.cards) {
        const inDeck = deck.cards.find(c => c.id === card.id);
        if (inDeck && fsrsSnapshot) {
            inDeck.fsrs = fsrsSnapshot;
        }
    }
    if (fsrsResult?.state) {
        studyState.knowledgeStates?.set(card.id, fsrsResult.state);
    }

    if (analyticsManager) {
        analyticsManager.trackSystemMetric('fsrs_review', ratingName, {
            deckId,
            due: fsrsSnapshot?.due || null,
            stability,
            questionType: 'Spaced'
        }, 'info');
    }

    const meta = studyState.spacedMeta.get(card.id) || { type: 'due', seen: false, requeued: false };
    const counts = studyState.spacedCounts || { dueRemaining: 0, newRemaining: 0 };
    if (!meta.seen) {
        if (meta.type === 'new') counts.newRemaining = Math.max(0, counts.newRemaining - 1);
        else counts.dueRemaining = Math.max(0, counts.dueRemaining - 1);
        meta.seen = true;
    }

    const shouldRequeue = ratingName === 'Again' && studyState.settings?.spacedRequeueAgain && !meta.requeued;
    if (shouldRequeue) {
        studyState.roundCards.push(card);
        if (meta.type === 'new') counts.newRemaining += 1; else counts.dueRemaining += 1;
        meta.requeued = true;
    }
    studyState.spacedMeta.set(card.id, meta);
    studyState.spacedCounts = counts;

    studyState.currentCardIndex++;
    studyState.spacedAnswerShown = false;
    if (deck) {
        await saveDataToDB('decks', deck);
    }
    showNextCard();
}

let studyAccentModule = null;
let testAccentModule = null;
let activeStudyInput = null;

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
    this.getDeck = config.getDeck;
    this.getInputEl = typeof config.getInputEl === 'function'
        ? () => config.getInputEl()
        : () => (config.inputId ? document.getElementById(config.inputId) : null);
    this.priorityBase = null;
    this.isExpanded = false;
    this.lastDeckId = null;
    this.lastRenderedHtml = '';
    this.inputEl = null;
    this.inputChangeListener = null;
    this.visibilityObserver = null;
    this.isReady = Boolean(this.moduleEl && this.toggleBtn && this.buttonsContainer && this.getDeck);
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
    this.setInputEl(this.getInputEl());
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

AccentModule.prototype.setInputEl = function (inputEl) {
    if (this.inputEl === inputEl) {
        this.updateVisibility(this.shouldShowForInput(inputEl));
        return;
    }
    if (this.inputEl && this.inputChangeListener) {
        this.inputEl.removeEventListener('input', this.inputChangeListener);
    }
    if (this.visibilityObserver) {
        this.visibilityObserver.disconnect();
    }
    this.inputEl = inputEl || null;
    if (this.inputEl) {
        this.inputChangeListener = () => this.handleInputChange();
        this.inputEl.addEventListener('input', this.inputChangeListener);
        this.visibilityObserver = new MutationObserver(() => {
            this.updateVisibility(this.shouldShowForInput(this.inputEl));
        });
        this.visibilityObserver.observe(this.inputEl, { attributes: true, attributeFilter: ['class', 'disabled'] });
    } else {
        this.inputChangeListener = null;
        this.visibilityObserver = null;
    }
    this.updateVisibility(this.shouldShowForInput(this.inputEl));
};

AccentModule.prototype.shouldShowForInput = function (inputEl) {
    if (!inputEl) return false;
    if (inputEl.disabled) return false;
    return !inputEl.classList.contains('hidden');
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
    if (!this.inputEl && typeof this.getInputEl === 'function') {
        this.setInputEl(this.getInputEl());
    }
    const accentUtils = this.getAccentUtils();
    const deck = this.getDeck?.();
    const accentData = deck && accentUtils?.ensureDeckAccentMetadata ? accentUtils.ensureDeckAccentMetadata(deck) : { accents: [], baseMap: {} };
    const hasAccents = Array.isArray(accentData.accents) && accentData.accents.length > 0;
    const displayModule = shouldShow && hasAccents && !!this.inputEl;
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
    this.setInputEl(this.getInputEl());
};

function initializeAccentModules() {
    if (typeof window === 'undefined' || !window.AccentUtils) return;
    if (!studyAccentModule || !studyAccentModule.isReady) {
        const module = new AccentModule({
            moduleId: 'deckAccentModule',
            toggleId: 'deckAccentToggle',
            buttonsId: 'deckAccentButtons',
            getInputEl: () => activeStudyInput || document.getElementById('writeAnswerInput'),
            ariaLabel: 'Deck accent characters',
            getDeck: () => decks[currentDeckId]
        });
        studyAccentModule = module.isReady ? module : null;
    } else {
        studyAccentModule.refresh();
    }
    if (!activeStudyInput) {
        activeStudyInput = document.getElementById('writeAnswerInput');
    }
    studyAccentModule?.setInputEl(activeStudyInput);
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

function setActiveStudyInput(inputEl) {
    activeStudyInput = inputEl || null;
    if (studyAccentModule?.setInputEl) {
        const fallbackInput = document.getElementById('writeAnswerInput');
        studyAccentModule.setInputEl(activeStudyInput || fallbackInput);
    }
    updateAccentButtonsVisibility();
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
            const response = await fetch('/api/autocomplete', {
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


async function endSession(options = {}) {
    const forceDashboard = options.forceDashboard === true;
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
        let sessionAccuracy = null;
        if (currentMode === 'sequence' && studyState.sequenceSession?.accuracyLog?.length) {
            const accArr = studyState.sequenceSession.accuracyLog;
            sessionAccuracy = accArr.reduce((a, b) => a + b, 0) / accArr.length;
        }
        analyticsData.sessions.unshift({
            date: new Date().toISOString(),
            deckName: decks[currentDeckId]?.name || 'Unknown Deck',
            mode: currentMode,
            duration: duration,
            accuracy: sessionAccuracy
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
    if (currentMode === 'exam' && originPlanId && !forceDashboard) {
        showPlanDetails(originPlanId);
    } else {
        backToDashboard(forceDashboard, true);
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
        }

        showToast("Progress has been reset.", "success");

        if (currentMode === 'learn') startLearnMode(currentDeckId);
        else if (currentMode === 'review') startReviewMode(currentDeckId);

    } catch (error) {
        console.error("Failed to reset knowledge state:", error);
        showToast("An error occurred while resetting progress.", "error");
    }
}

function isActionAllowed() {
    if (activeView !== 'studyMode' || document.getElementById('cardView').classList.contains('hidden')) {
        return false;
    }
    const correctBtn = document.getElementById('correctBtn');
    const incorrectBtn = document.getElementById('incorrectBtn');
    const correctBtnVisible = correctBtn && !correctBtn.classList.contains('hidden');
    const incorrectBtnVisible = incorrectBtn && !incorrectBtn.classList.contains('hidden');
    return correctBtnVisible || incorrectBtnVisible;
}

/**
 * Check if an element is visible (not hidden, not display:none)
 */
function isElementVisible(element) {
    if (!element) return false;
    if (element.disabled) return false;
    if (element.classList.contains('hidden')) return false;
    const style = window.getComputedStyle(element);
    return style.display !== 'none' && style.visibility !== 'hidden';
}

/**
 * Check if user is currently typing in a text field
 */
function isUserTyping() {
    const active = document.activeElement;
    if (!active) return false;
    
    const tag = active.tagName.toUpperCase();
    if (tag === 'TEXTAREA') return true;
    if (tag === 'INPUT') {
        const type = (active.type || '').toLowerCase();
        return ['text', 'search', 'email', 'password', 'tel', 'url', 'number'].includes(type);
    }
    if (active.isContentEditable) return true;
    
    return false;
}

function setupKeyboardControls() {
    // === DIRECT INPUT HANDLERS ===
    // These handle Enter key specifically for text inputs without intercepting other keys
    
    // Learn mode write input - Enter to check/don't know
    const writeInput = document.getElementById('writeAnswerInput');
    if (writeInput) {
        writeInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                if (writeInput.value.trim() === '') {
                    // Empty input - call don't know
                    if (currentMode === 'learn') {
                        const handler = window.dontKnowAnswer || dontKnowAnswer;
                        handler();
                    } else {
                        showToast('Please enter an answer', 'error');
                    }
                } else {
                    // Has answer - check it
                    const handler = window.autoCheckAnswer || autoCheckAnswer;
                    handler();
                }
            }
            // All other keys (including Space) type naturally
        });
    }
    
    // Practice test input - Enter to check
    const testAnswerInput = document.getElementById('testAnswerInput');
    if (testAnswerInput) {
        testAnswerInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                const checkBtn = document.getElementById('testCheckAnswerBtn');
                if (isElementVisible(checkBtn)) {
                    checkBtn.click();
                }
            }
        });
    }
    
    // Sequence mode inputs - Enter to submit
    const sequenceNextInput = document.getElementById('sequenceNextInput');
    if (sequenceNextInput) {
        sequenceNextInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                const submitBtn = document.getElementById('sequenceSubmitBtn');
                if (isElementVisible(submitBtn)) {
                    submitBtn.click();
                }
            }
        });
    }

    // === GLOBAL KEYBOARD HANDLER ===
    // Only handles shortcuts when NOT typing
    document.addEventListener('keydown', (e) => {
        // Don't handle if a modal is open (let keyboard.js handle it)
        if (document.querySelector('.modal.show')) return;
        
        const isMeta = e.ctrlKey || e.metaKey;
        const keyLower = (e.key || '').toLowerCase();
        
        // === ESCAPE - Always works ===
        if (e.key === 'Escape') {
            if (isUserTyping()) {
                document.activeElement.blur();
                e.preventDefault();
            }
            return;
        }

        // === EDITOR VIEW SHORTCUTS ===
        if (activeView === 'editorView') {
            if (isMeta && keyLower === 's') {
                e.preventDefault();
                const handler = window.editorSaveDeck || editorSaveDeck;
                handler();
                return;
            }
            if (isMeta && e.key === 'Enter') {
                e.preventDefault();
                document.querySelector('#editorView .add-question-btn')?.click();
                return;
            }
        }
        
        // === IF TYPING, ONLY ALLOW CTRL/CMD SHORTCUTS ===
        if (isUserTyping()) {
            if (!isMeta) {
                return; // Let keys type naturally
            }
        }

        // === GLOBAL CTRL/CMD SHORTCUTS ===
        if (isMeta) {
            if (keyLower === 'k') {
                e.preventDefault();
                document.getElementById('searchInput')?.focus();
                return;
            }
            if (keyLower === 'n') {
                e.preventDefault();
                showEditor();
                return;
            }
            if (keyLower === ',') {
                e.preventDefault();
                showSettings();
                return;
            }
            if (e.shiftKey) {
                if (keyLower === 'a') {
                    e.preventDefault();
                    showAnalyticsView();
                    return;
                }
                if (keyLower === 'i') {
                    e.preventDefault();
                    showInsightsView();
                    return;
                }
                if (keyLower === 'g') {
                    e.preventDefault();
                    renderGlobalAnalytics();
                    return;
                }
            }
            return; // Don't process other shortcuts for meta combos
        }

        // === PRACTICE TEST VIEW SHORTCUTS ===
        const practiceTestView = document.getElementById('practiceTestView');
        if (practiceTestView && !practiceTestView.classList.contains('hidden')) {
            const nextBtn = document.getElementById('testNextBtn');
            const showBtn = document.getElementById('testShowAnswerBtn');
            const correctBtn = document.getElementById('testCorrectBtn');
            const incorrectBtn = document.getElementById('testIncorrectBtn');
            
            if (e.key === 'Enter' || e.key === ' ') {
                if (isElementVisible(nextBtn)) {
                    e.preventDefault();
                    nextBtn.click();
                    return;
                }
                if (isElementVisible(showBtn)) {
                    e.preventDefault();
                    showBtn.click();
                    return;
                }
            }
            if (e.key === '1' || e.key === 'ArrowLeft') {
                if (isElementVisible(incorrectBtn)) {
                    e.preventDefault();
                    incorrectBtn.click();
                }
                return;
            }
            if (e.key === '2' || e.key === 'ArrowRight') {
                if (isElementVisible(correctBtn)) {
                    e.preventDefault();
                    correctBtn.click();
                }
                return;
            }
            return;
        }

        // === STUDY MODE PROGRESS VIEW ===
        if (activeView === 'studyMode') {
            const progressView = document.getElementById('progressView');
            if (progressView && !progressView.classList.contains('hidden')) {
                if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    document.getElementById('continueBtn')?.click();
                }
                return;
            }
        }

        // === SEQUENCE MODE SHORTCUTS ===
        const sequenceTaskView = document.getElementById('sequenceTaskView');
        if (activeView === 'studyMode' && sequenceTaskView && !sequenceTaskView.classList.contains('hidden')) {
            const submitBtn = document.getElementById('sequenceSubmitBtn');
            const continueBtn = document.getElementById('sequenceContinueBtn');
            
            if (e.key === 'Enter' || e.key === ' ') {
                if (isElementVisible(submitBtn)) {
                    e.preventDefault();
                    submitBtn.click();
                    return;
                }
                if (isElementVisible(continueBtn)) {
                    e.preventDefault();
                    continueBtn.click();
                    return;
                }
            }
            return;
        }

        // === LEARN/REVIEW MODE CARD VIEW SHORTCUTS ===
        if (activeView !== 'studyMode') return;
        const cardView = document.getElementById('cardView');
        if (!cardView || cardView.classList.contains('hidden')) return;

        const simpleCorrectBtn = document.getElementById('correctBtn');
        const simpleIncorrectBtn = document.getElementById('incorrectBtn');
        const showAnswerBtn = document.getElementById('showAnswerBtn');
        const nextBtn = document.getElementById('nextBtn');
        
        // Spaced repetition rating buttons
        const spacedButtons = document.getElementById('spacedRatingButtons');
        if (currentMode === 'spaced' && spacedButtons && !spacedButtons.classList.contains('hidden')) {
            const ratingMap = { '1': 'Again', 'a': 'Again', '2': 'Hard', 'h': 'Hard', '3': 'Good', 'g': 'Good', '4': 'Easy', 'e': 'Easy' };
            if (ratingMap[keyLower]) {
                e.preventDefault();
                gradeSpaced(ratingMap[keyLower]);
                return;
            }
        }

        // Correct/Incorrect buttons visible
        if (isElementVisible(simpleCorrectBtn)) {
            if (e.key === '1' || e.key === 'ArrowLeft' || keyLower === 'x') {
                e.preventDefault();
                const handler = window.markIncorrect || markIncorrect;
                handler();
                return;
            }
            if (e.key === '2' || e.key === 'ArrowRight' || keyLower === 'c' || e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                const handler = window.markCorrect || markCorrect;
                handler();
                return;
            }
        }

        // Next button visible
        if (isElementVisible(nextBtn)) {
            if (keyLower === 'n' || e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                nextBtn.click();
                return;
            }
        }

        // Show answer button visible
        if (isElementVisible(showAnswerBtn)) {
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                const handler = window.showAnswer || showAnswer;
                handler();
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
    const isSequenceDeck = deck.typeHint === 'Sequence';
    const sequenceSection = document.getElementById('deckSettingsSequenceSection');
    if (sequenceSection) {
        sequenceSection.classList.toggle('hidden', !isSequenceDeck);
    }

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

    document.getElementById('deckSettingsSpacedNewPerDay').value = Number.isFinite(settings.spacedNewPerDay)
        ? settings.spacedNewPerDay
        : DEFAULT_DECK_SETTINGS.spacedNewPerDay;
    document.getElementById('deckSettingsSpacedMaxReviews').value = Number.isFinite(settings.spacedMaxReviewsPerDay)
        ? settings.spacedMaxReviewsPerDay
        : DEFAULT_DECK_SETTINGS.spacedMaxReviewsPerDay;
    document.getElementById('deckSettingsSpacedOrder').value = settings.spacedOrder || DEFAULT_DECK_SETTINGS.spacedOrder;
    document.getElementById('deckSettingsSpacedRequeueAgain').checked = settings.spacedRequeueAgain ?? DEFAULT_DECK_SETTINGS.spacedRequeueAgain;
    document.getElementById('deckSettingsSpacedShowIntervals').checked = settings.spacedShowIntervals ?? DEFAULT_DECK_SETTINGS.spacedShowIntervals;
    if (isSequenceDeck) {
        const seqMinInput = document.getElementById('deckSettingsSequenceChunkMin');
        const seqMaxInput = document.getElementById('deckSettingsSequenceChunkMax');
        const seqStartInput = document.getElementById('deckSettingsSequenceStartChunk');
        const seqMixInput = document.getElementById('deckSettingsSequenceMixingThreshold');
        const seqAllowInput = document.getElementById('deckSettingsSequenceAllowMixed');
        if (seqMinInput) seqMinInput.value = settings.sequenceChunkMin ?? DEFAULT_DECK_SETTINGS.sequenceChunkMin;
        if (seqMaxInput) seqMaxInput.value = settings.sequenceChunkMax ?? DEFAULT_DECK_SETTINGS.sequenceChunkMax;
        if (seqStartInput) seqStartInput.value = settings.sequenceStartChunk ?? DEFAULT_DECK_SETTINGS.sequenceStartChunk;
        if (seqMixInput) seqMixInput.value = settings.sequenceMixingThreshold ?? DEFAULT_DECK_SETTINGS.sequenceMixingThreshold;
        if (seqAllowInput) seqAllowInput.checked = settings.sequenceAllowMixed !== false;
    }

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

    const spacedNewPerDay = parseDeckNumericInput(
        document.getElementById('deckSettingsSpacedNewPerDay').value,
        DEFAULT_DECK_SETTINGS.spacedNewPerDay,
        0,
        500
    );
    const spacedMaxReviewsPerDay = parseDeckNumericInput(
        document.getElementById('deckSettingsSpacedMaxReviews').value,
        DEFAULT_DECK_SETTINGS.spacedMaxReviewsPerDay,
        1,
        10000
    );
    deck.settings.spacedNewPerDay = spacedNewPerDay;
    deck.settings.spacedMaxReviewsPerDay = spacedMaxReviewsPerDay;
    deck.settings.spacedOrder = document.getElementById('deckSettingsSpacedOrder').value || DEFAULT_DECK_SETTINGS.spacedOrder;
    deck.settings.spacedRequeueAgain = document.getElementById('deckSettingsSpacedRequeueAgain').checked;
    deck.settings.spacedShowIntervals = document.getElementById('deckSettingsSpacedShowIntervals').checked;
    if (deck.typeHint === 'Sequence') {
        const seqMin = parseDeckNumericInput(
            document.getElementById('deckSettingsSequenceChunkMin')?.value,
            deck.settings.sequenceChunkMin ?? DEFAULT_DECK_SETTINGS.sequenceChunkMin,
            1,
            999
        );
        const seqMaxRaw = parseDeckNumericInput(
            document.getElementById('deckSettingsSequenceChunkMax')?.value,
            deck.settings.sequenceChunkMax ?? DEFAULT_DECK_SETTINGS.sequenceChunkMax,
            seqMin,
            999
        );
        const seqMax = Math.max(seqMin, seqMaxRaw);
        const seqStartRaw = parseDeckNumericInput(
            document.getElementById('deckSettingsSequenceStartChunk')?.value,
            deck.settings.sequenceStartChunk ?? DEFAULT_DECK_SETTINGS.sequenceStartChunk,
            seqMin,
            seqMax
        );
        const seqStart = Math.min(Math.max(seqStartRaw, seqMin), seqMax);
        const thresholdInput = document.getElementById('deckSettingsSequenceMixingThreshold');
        const thresholdRaw = thresholdInput ? parseFloat(thresholdInput.value) : Number.NaN;
        const sequenceMixingThreshold = Number.isFinite(thresholdRaw)
            ? Math.min(1, Math.max(0, thresholdRaw))
            : (deck.settings.sequenceMixingThreshold ?? DEFAULT_DECK_SETTINGS.sequenceMixingThreshold);
        const allowMixedInput = document.getElementById('deckSettingsSequenceAllowMixed');

        deck.settings.sequenceChunkMin = seqMin;
        deck.settings.sequenceChunkMax = seqMax;
        deck.settings.sequenceStartChunk = seqStart;
        deck.settings.sequenceMixingThreshold = sequenceMixingThreshold;
        deck.settings.sequenceAllowMixed = allowMixedInput ? allowMixedInput.checked : deck.settings.sequenceAllowMixed;
    }

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
                        const resolvedType = deckData.typeHint || typeHint;
                        const extraFields = resolvedType === 'Sequence'
                            ? { sequenceMeta: deckData.sequenceMeta || {} }
                            : {};
                        if (resolvedType === 'Sequence') {
                            normalizeSequenceDeck(deckData);
                        }

                        const oldIdToNewIdMap = new Map();
                        deckData.cards.forEach((card, index) => {
                            const oldId = card.id;
                            const newId = crypto.randomUUID();
                            card.id = newId;
                            oldIdToNewIdMap.set(oldId, newId);

                            if (resolvedType === 'Sequence' && typeof card.order !== 'number') {
                                card.order = index + 1;
                            }
                        });

                        const newDeckId = await createNewDeck(name, category, deckData.cards, deckData.notes || '', resolvedType, extraFields);

                        const transaction = db.transaction(['userKnowledgeState'], 'readwrite');
                        const store = transaction.objectStore('userKnowledgeState');
                        let sequenceGraphModule = null;
                        const loadSequenceGraphModule = async () => {
                            if (sequenceGraphModule) return sequenceGraphModule;
                            sequenceGraphModule = await import('../core/sequence-graph.js');
                            return sequenceGraphModule;
                        };
                        const getSequenceSteps = (sequenceId) => {
                            const id = String(sequenceId || '');
                            const steps = (deckData.cards || []).filter(c => String(c.sequenceId || '') === id);
                            steps.sort((a, b) => {
                                const aIdx = typeof a.stepIndex === 'number' ? a.stepIndex : (a.order || 0);
                                const bIdx = typeof b.stepIndex === 'number' ? b.stepIndex : (b.order || 0);
                                return aIdx - bIdx;
                            });
                            return steps;
                        };
                        const mapSequenceGraphRecord = async (graph, idMap, newSteps) => {
                            if (!graph || typeof graph !== 'object') return null;
                            const module = await loadSequenceGraphModule();
                            const mappedEdges = {};
                            const mappedNodes = {};
                            const edges = graph.edges && typeof graph.edges === 'object' ? graph.edges : {};
                            const nodes = graph.nodes && typeof graph.nodes === 'object' ? graph.nodes : {};
                            Object.entries(edges).forEach(([key, value]) => {
                                if (typeof key !== 'string' || !key) return;
                                const parts = key.split('->');
                                if (parts.length !== 2) {
                                    mappedEdges[key] = value;
                                    return;
                                }
                                const from = idMap.get(parts[0]) || parts[0];
                                const to = idMap.get(parts[1]) || parts[1];
                                mappedEdges[`${from}->${to}`] = value;
                            });
                            Object.entries(nodes).forEach(([key, value]) => {
                                if (typeof key !== 'string' || !key) return;
                                const mapped = idMap.get(key) || key;
                                mappedNodes[mapped] = value;
                            });
                            const stepsHash = module.hashSequenceSteps(newSteps);
                            return {
                                ...graph,
                                version: 1,
                                stepsHash,
                                edges: mappedEdges,
                                nodes: mappedNodes,
                                updatedAt: Date.now()
                            };
                        };

                        for (const state of knowledgeData) {
                            if (state && state.sequenceGraph && typeof state.sequenceGraph === 'object') {
                                const sequenceId = state.sequenceId || state.sequenceID || null;
                                const steps = getSequenceSteps(sequenceId);
                                const mappedGraph = steps.length
                                    ? await mapSequenceGraphRecord(state.sequenceGraph, oldIdToNewIdMap, steps)
                                    : null;
                                const graphCardId = `sequenceGraph:${newDeckId}:${String(sequenceId || 'default')}`;
                                const normalizedState = prepareKnowledgeRecord({
                                    ...state,
                                    cardID: graphCardId,
                                    deckID: newDeckId,
                                    sequenceId: String(sequenceId || 'default'),
                                    kind: 'sequenceGraph',
                                    sequenceGraph: mappedGraph || state.sequenceGraph,
                                    fsrs: null,
                                    lastModified: new Date().toISOString()
                                });
                                if (normalizedState) {
                                    store.put(normalizedState);
                                } else {
                                    console.warn('[IMPORT] Skipped malformed sequence graph state', state);
                                }
                                continue;
                            }

                            const newCardId = oldIdToNewIdMap.get(state.cardID || state.cardId);
                            if (!newCardId) continue;
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

                        showToast(`Deck "${name}" and its learning progress restored!`, 'success');

                    } else if (importedData.type === 'sequence' && Array.isArray(importedData.sequences)) {
                        const converted = convertExternalSequenceJson(importedData);
                        const newDeckId = await createNewDeck(
                            name || importedData.title || 'Sequence Deck',
                            category,
                            converted.cards,
                            importedData.deckNotes || '',
                            'Sequence',
                            { sequenceMeta: converted.sequenceMeta }
                        );
                        const deckRecord = decks[newDeckId];
                        if (deckRecord) {
                            deckRecord.sequenceMeta = converted.sequenceMeta;
                            await saveDataToDB('decks', deckRecord);
                        }
                        showToast(`Sequence deck "${name || importedData.title || 'New Sequence'}" imported!`, 'success');
                    } else {
                        if (!importedData.name || !Array.isArray(importedData.cards)) throw new Error('Invalid JSON format.');

                        await createNewDeck(name, category, importedData.cards, importedData.notes || '', typeHint);
                        showToast(`Deck "${name}" imported successfully with ${importedData.cards.length} cards!`);
                    }

                } else if (file.name.endsWith('.csv') || file.name.endsWith('.txt')) {
                    const parsed = parseTextData(e.target.result, file.name.endsWith('.csv') ? ',' : '\t', typeHint);
                    const cards = Array.isArray(parsed) ? parsed : parsed.cards;
                    const sequenceMeta = parsed.sequenceMeta || {};
                    if (cards && cards.length > 0) {
                        await createNewDeck(name, category, cards, '', typeHint, typeHint === 'Sequence' ? { sequenceMeta } : {});
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
            const parsed = parseTextData(pastedText.trim(), '\t', typeHint);
            const cards = Array.isArray(parsed) ? parsed : parsed.cards;
            const sequenceMeta = parsed.sequenceMeta || {};
            if (cards && cards.length > 0) {
                await createNewDeck(name, category, cards, '', typeHint, typeHint === 'Sequence' ? { sequenceMeta } : {});
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

function convertExternalSequenceJson(payload) {
    const title = typeof payload.title === 'string' ? payload.title.trim() : 'Sequence Deck';
    const sequences = Array.isArray(payload.sequences) ? payload.sequences : [];
    const cards = [];
    const sequenceMeta = {};

    sequences.forEach((seq, seqIndex) => {
        const seqTitle = (seq.title || `Sequence ${seqIndex + 1}`).toString().trim() || `Sequence ${seqIndex + 1}`;
        const steps = Array.isArray(seq.steps) ? seq.steps : [];
        const sequenceId = crypto.randomUUID();
        sequenceMeta[sequenceId] = { title: seqTitle, description: seq.description || seq.notes || '' };

        steps.forEach((stepText, stepIndex) => {
            const text = (typeof stepText === 'string'
                ? stepText
                : (stepText?.text || stepText?.question || stepText?.prompt || '')).toString().trim();
            const notes = stepText?.notes || stepText?.answer || seq.notes || '';
            if (!text) return;
            cards.push({
                id: crypto.randomUUID(),
                question: text,
                answer: notes || '',
                sequenceId,
                sequenceTitle: seqTitle,
                stepIndex,
                order: stepIndex,
                isNew: true
            });
        });
    });

    return { title, cards, sequenceMeta };
}

function parseTextData(text, separator, typeHint = 'General') {
    if (typeHint === 'Sequence') {
        const lines = text.split('\n').map(line => line.trim()).filter(Boolean);
        const sequenceMap = new Map();
        lines.forEach((line) => {
            const parts = line.split(separator);
            if (parts.length >= 2 && parts[0].trim() && parts[1].trim()) {
                const seqTitle = parts[0].trim();
                const stepText = parts[1].trim();
                const notes = parts[2] ? parts[2].trim() : '';
                if (!stepText) return;
                if (!sequenceMap.has(seqTitle)) {
                    sequenceMap.set(seqTitle, { id: crypto.randomUUID(), steps: [] });
                }
                sequenceMap.get(seqTitle).steps.push({ question: stepText, answer: notes });
            }
        });
        const cards = [];
        const sequenceMeta = {};
        Array.from(sequenceMap.entries()).forEach(([title, data], seqIdx) => {
            sequenceMeta[data.id] = { title: title || `Sequence ${seqIdx + 1}` };
            data.steps.forEach((step, stepIdx) => {
                cards.push({
                    id: crypto.randomUUID(),
                    question: step.question,
                    answer: step.answer || '',
                    sequenceId: data.id,
                    sequenceTitle: sequenceMeta[data.id].title,
                    stepIndex: stepIdx,
                    order: stepIdx,
                    cardType: CARD_TYPES.SEQUENCE,
                    isNew: true
                });
            });
        });
        return { cards, sequenceMeta };
    }

    // Use card-types module for advanced parsing with card type detection
    const lines = text.split('\n').map(line => line.trim()).filter(Boolean);
    if (lines.length === 0) return [];

    // Check for header row to detect Anki-style imports
    const normalizeHeader = (value) => value.replace(/\s+/g, '').toLowerCase();
    const headerKeys = new Set(['front', 'back', 'question', 'answer', 'type', 'cloze', 'addreverse']);
    const firstRowHeaders = lines[0].split(separator).map(h => h.trim());
    const matchedHeaders = firstRowHeaders
        .map(h => normalizeHeader(h))
        .filter(h => headerKeys.has(h));
    const hasHeader = matchedHeaders.length >= 2;

    let headers = null;
    let dataStartIndex = 0;

    if (hasHeader) {
        headers = lines[0].split(separator).map(h => h.trim().toLowerCase());
        dataStartIndex = 1;
    }

    const allCards = [];

    for (let i = dataStartIndex; i < lines.length; i++) {
        const parts = lines[i].split(separator);
        if (parts.length < 2) continue;

        let rawCard = {};

        if (headers) {
            // Map by header names
            headers.forEach((header, idx) => {
                if (parts[idx] !== undefined) {
                    // Normalize header names
                    const normalizedHeader = header.replace(/\s+/g, '').toLowerCase();
                    rawCard[normalizedHeader] = parts[idx].trim();
                }
            });
            // Map common Anki headers to our format
            rawCard.front = rawCard.front || rawCard.question || '';
            rawCard.back = rawCard.back || rawCard.answer || rawCard.definition || '';
            rawCard.addReverse = rawCard.addreverse || rawCard['add reverse'] || '';
        } else {
            // Standard format: Front, Back, [Type], [AddReverse]
            rawCard.front = parts[0]?.trim() || '';
            rawCard.back = parts[1]?.trim() || '';
            if (parts[2]) rawCard.type = parts[2].trim();
            if (parts[3]) rawCard.addReverse = parts[3].trim();
        }

        if (!rawCard.front && !rawCard.back) continue;

        // Detect card type from explicit type column or content
        let cardType = rawCard.type ? normalizeCardType(rawCard.type) : null;
        if (!cardType) {
            // Check typeHint mapping
            if (typeHint === 'Cloze' || typeHint === 'cloze') {
                cardType = CARD_TYPES.CLOZE;
            } else if (typeHint === 'Basic (and reversed card)' || typeHint === 'BasicReversed') {
                cardType = CARD_TYPES.BASIC_REVERSED;
            } else if (typeHint === 'Basic (type in the answer)' || typeHint === 'TypeAnswer') {
                cardType = CARD_TYPES.BASIC_TYPE_ANSWER;
            } else {
                // Auto-detect from content
                cardType = detectCardType({ question: rawCard.front, answer: rawCard.back, addReverse: rawCard.addReverse });
            }
        }

        const baseCard = {
            id: crypto.randomUUID(),
            question: rawCard.front,
            answer: rawCard.back,
            front: rawCard.front,
            back: rawCard.back,
            cardType: cardType,
            addReverse: rawCard.addReverse || '',
            isNew: true,
            order: 0
        };

        // Expand cards for reversed and cloze types
        const expandedCards = expandCard(baseCard);
        allCards.push(...expandedCards);
    }

    return allCards;
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
    const deck = decks[deckId];
    const maxQ = deck?.cards?.length || 0;
    
    // Default to Exam Mode
    selectTestPreset('exam_indicative');

    const qInput = document.getElementById('testQuestionCount');
    if (qInput) {
        qInput.max = maxQ;
        qInput.value = Math.min(20, maxQ || 20);
    }
    
    const deckTag = document.querySelector('#testDeckSelection .tag');
    if (deckTag) deckTag.textContent = deck?.name || 'Current Deck';

    document.getElementById('practiceTestModal').classList.add('show');
    clearTestValidityWarning();

    // Attach listeners for validation
    ['testDuration', 'testTotalMarks', 'testQuestionCount', 'optAllowBack', 'optShowTimer', 'optStrictMarking', 'optConfidence'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.onchange = validateCurrentConfig;
    });
    validateCurrentConfig();
}

function closePracticeTestModal() {
    document.getElementById('practiceTestModal').classList.remove('show');
}

function selectTestPreset(mode) {
    const isExam = mode === 'exam_indicative';
    practiceTestState.mode = isExam ? 'exam_indicative' : 'free_practice';
    
    const presetExam = document.getElementById('presetExam');
    const presetFree = document.getElementById('presetFree');
    const presetDescription = document.getElementById('presetDescription');
    
    if (presetExam) presetExam.classList.toggle('active', isExam);
    if (presetFree) presetFree.classList.toggle('active', !isExam);
    if (presetDescription) {
        presetDescription.textContent = isExam 
            ? "Strict exam conditions. No feedback during test. Timed."
            : "Relaxed practice. Feedback allowed. Flexible timing.";
    }

    const durationInput = document.getElementById('testDuration');
    const marksInput = document.getElementById('testTotalMarks');
    const strictInput = document.getElementById('optStrictMarking');
    const confidenceInput = document.getElementById('optConfidence');
    
    if (durationInput) durationInput.value = isExam ? 60 : 30;
    if (marksInput) marksInput.value = 100;
    if (strictInput) strictInput.checked = isExam;
    if (confidenceInput) confidenceInput.checked = isExam;
    validateCurrentConfig();
}

function validateCurrentConfig() {
    const startButton = getPracticeTestStartButton();
    buildPracticeTestValidation().then(result => {
        const errors = result.validation?.errors || [];
        const warnings = result.warnings || [];
        const message = formatTestValidityMessage(errors, warnings);
        if (message) {
            showTestValidityWarning(message);
        } else {
            clearTestValidityWarning();
        }
        if (startButton) startButton.disabled = errors.length > 0;
    }).catch(error => {
        console.error('Failed to validate practice test config', error);
    });
}

function clearTestValidityWarning() {
    const warningEl = document.getElementById('testValidityWarning');
    if (warningEl) warningEl.classList.add('hidden');
}

function showTestValidityWarning(messages) {
    const warningEl = document.getElementById('testValidityWarning');
    const messageEl = document.getElementById('validityMessage');
    if (!warningEl || !messageEl) return;
    const content = Array.isArray(messages)
        ? messages.filter(Boolean).join(' ')
        : String(messages || '');
    messageEl.textContent = content;
    warningEl.classList.toggle('hidden', !content);
}

function parseNumberInput(id, fallback = null) {
    const value = Number(document.getElementById(id)?.value);
    return Number.isFinite(value) ? value : fallback;
}

function getSelectedTestPresetMode() {
    const presetExam = document.getElementById('presetExam');
    if (presetExam && presetExam.classList.contains('active')) return 'exam_indicative';
    return 'free_practice';
}

function getPracticeTestUiSettings() {
    return {
        mode: getSelectedTestPresetMode(),
        durationMinutes: parseNumberInput('testDuration', 60),
        totalMarks: parseNumberInput('testTotalMarks', 100),
        questionCount: parseNumberInput('testQuestionCount', null),
        allowBack: document.getElementById('optAllowBack')?.checked ?? true,
        showTimer: document.getElementById('optShowTimer')?.checked ?? true,
        strictMarking: document.getElementById('optStrictMarking')?.checked ?? true,
        confidenceIntervalEnabled: document.getElementById('optConfidence')?.checked ?? true
    };
}

function getPracticeTestStartButton() {
    return document.querySelector('#practiceTestModal .modal-actions .btn.btn-success');
}

function formatTestValidityMessage(errors, warnings) {
    const parts = [];
    if (errors.length) {
        parts.push(`Errors: ${errors.join(' ')}`);
    }
    if (warnings.length) {
        parts.push(`Warnings: ${warnings.join(' ')}`);
    }
    return parts.join(' ');
}

async function buildPracticeTestValidation(seedOverride = null) {
    const settings = getPracticeTestUiSettings();
    if (seedOverride !== null) {
        settings.seed = seedOverride;
    }
    settings.deckId = practiceTestState.deckId;
    const { buildPracticeTestBlueprint } = await getPracticeTestRuntimeModules();
    const { validateBlueprint, normaliseBlueprint, getMcqDeckWarnings } = await getPracticeTestModules();
    const blueprint = buildPracticeTestBlueprint(settings);
    const normalizedBlueprint = normaliseBlueprint(blueprint);
    const validation = validateBlueprint(normalizedBlueprint);
    const mcqWarnings = typeof getMcqDeckWarnings === 'function'
        ? getMcqDeckWarnings(normalizedBlueprint, decks)
        : [];
    return {
        blueprint: normalizedBlueprint,
        validation,
        warnings: [...validation.warnings, ...mcqWarnings]
    };
}

function createPracticeTestAttemptId() {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
        return crypto.randomUUID();
    }
    return `attempt_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

function createPracticeTestSeed() {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
        return crypto.randomUUID();
    }
    return `seed_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

function resolvePracticeTestUserId() {
    const session = getStoredSession();
    const userId = session?.user?.sub || session?.user?.id || session?.user?.user_id;
    if (userId) return String(userId);
    return getGuestIdFromSession();
}

async function startPracticeTestInternal() {
    try {
        const deckId = practiceTestState.deckId;
        testAccentModule?.refresh();
        const deck = decks[deckId];
        if (deck) {
            document.documentElement.setAttribute('data-deck-category', deck.category || 'Other');
        }
        if (!deck || !Array.isArray(deck.cards) || deck.cards.length === 0) {
            showToast('Deck has no cards.', 'error');
            return;
        }

        const attemptId = createPracticeTestAttemptId();
        const seed = createPracticeTestSeed();

        const { flattenTestForm, getPracticeTestModeFlags } = await getPracticeTestRuntimeModules();
        const { generateTestForm } = await getPracticeTestModules();
        const { blueprint: normalizedBlueprint, validation, warnings } = await buildPracticeTestValidation(seed);

        if (!validation.ok) {
            showTestValidityWarning(validation.errors);
            showToast('Test configuration is invalid.', 'error');
            return;
        }
        if (warnings.length) {
            showTestValidityWarning(warnings);
        } else {
            clearTestValidityWarning();
        }

        const knowledgeState = studyState.knowledgeStates || {};
        const userId = resolvePracticeTestUserId();
        const form = await generateTestForm(normalizedBlueprint, decks, knowledgeState, userId);
        const flatItems = flattenTestForm(form);

        if (!flatItems.length) {
            showToast('Unable to generate test items.', 'error');
            return;
        }

        practiceTestState.attemptId = attemptId;
        practiceTestState.startedAt = null;
        practiceTestState.finishedAt = null;
        practiceTestState.blueprint = normalizedBlueprint;
        practiceTestState.form = form;
        practiceTestState.flatItems = flatItems;
        practiceTestState.responses = new Array(flatItems.length).fill(null);
        practiceTestState.currentIndex = 0;
        practiceTestState.mode = normalizedBlueprint.mode;
        practiceTestState.showTimer = normalizedBlueprint.navigation?.showTimer ?? true;
        practiceTestState.allowBack = normalizedBlueprint.navigation?.allowBack ?? true;
        practiceTestState.strictMarking = normalizedBlueprint.scoring?.strictMarking ?? true;
        practiceTestState.confidenceIntervalEnabled = normalizedBlueprint.scoring?.confidenceInterval?.enabled ?? true;
        practiceTestState.modeFlags = getPracticeTestModeFlags(normalizedBlueprint.mode);
        practiceTestState.itemStartTime = null;
        practiceTestState.applyLearningInProgress = false;

        closePracticeTestModal();

        transitionView('practiceTestView');
        document.getElementById('testSubtitle').textContent = deck.name;

        resetPracticeTestCompletionUI();
        updateTestProgress();
        document.getElementById('testProgressView').classList.remove('hidden');
        document.getElementById('testCardView').classList.add('hidden');
        document.getElementById('testCompleteView').classList.add('hidden');
    } catch (error) {
        console.error('Failed to start practice test', error);
        showToast('Unable to start practice test.', 'error');
    }
}

function startPracticeTest() {
    const adapter = window.modeRegistry?.get && window.modeRegistry.get('practice-test');
    if (adapter && typeof adapter.start === 'function') {
        return adapter.start();
    }
    return startPracticeTestInternal();
}

function startMode(mode, deckId) {
    const deck = decks[deckId];
    if (deck) {
        document.documentElement.setAttribute('data-deck-category', deck.category || 'Other');
    }
    const adapter = window.modeRegistry?.get && window.modeRegistry.get(mode);
    if (adapter && typeof adapter.start === 'function') {
        return adapter.start(deckId);
    }

    const fallback = {
        'learn': startLearnMode,
        'review': startReviewMode,
        'spaced': startSpacedMode,
        'practice-test': startPracticeTestInternal,
        'sequence': startSequenceMode
    };

    const fn = fallback[mode];
    if (typeof fn === 'function') {
        return fn(deckId);
    }
}

function getPracticeTestCounts() {
    const responses = Array.isArray(practiceTestState.responses) ? practiceTestState.responses : [];
    let correct = 0;
    let incorrect = 0;
    let answered = 0;
    responses.forEach(response => {
        if (!response || typeof response.wasCorrect !== 'boolean') return;
        answered += 1;
        if (response.wasCorrect) correct += 1;
        else incorrect += 1;
    });
    return { correct, incorrect, answered };
}

function getCurrentPracticeTestItem() {
    return practiceTestState.flatItems[practiceTestState.currentIndex] || null;
}

function resolvePracticeTestItemType(item) {
    const rawType = String(item?.type || '').toLowerCase();
    if (rawType.includes('mcq') || rawType.includes('multiple')) return 'mcq';
    if (rawType.includes('type') || rawType.includes('short') || rawType.includes('long') || rawType.includes('write')) return 'type';
    if (Array.isArray(item?.options) && item.options.length) return 'mcq';
    return 'type';
}

function resetPracticeTestCompletionUI() {
    const applyBtn = document.getElementById('testApplyLearningBtn');
    if (applyBtn) {
        applyBtn.classList.add('hidden');
        applyBtn.disabled = false;
        applyBtn.textContent = 'Apply Learning Updates';
        applyBtn.onclick = applyPracticeTestLearningUpdates;
    }
    const ciEl = document.getElementById('testConfidenceInterval');
    if (ciEl) {
        ciEl.textContent = '';
        const stat = ciEl.closest('.stat');
        if (stat) stat.classList.add('hidden');
    }
}

function resetTestCardUI() {
    const flashcard = document.querySelector('#testCardView .flashcard');
    const answerContent = document.getElementById('testAnswerContent');
    const options = document.getElementById('testOptions');
    const answerInput = document.getElementById('testAnswerInput');
    const showAnswerBtn = document.getElementById('testShowAnswerBtn');
    const checkAnswerBtn = document.getElementById('testCheckAnswerBtn');
    const correctBtn = document.getElementById('testCorrectBtn');
    const incorrectBtn = document.getElementById('testIncorrectBtn');
    const nextBtn = document.getElementById('testNextBtn');

    if (flashcard) flashcard.classList.remove('is-flipped');
    if (answerContent) answerContent.classList.add('hidden');
    if (options) {
        options.innerHTML = '';
        options.classList.add('hidden');
    }
    if (answerInput) {
        answerInput.value = '';
        answerInput.disabled = false;
        answerInput.classList.add('hidden');
        answerInput.classList.remove('correct', 'incorrect');
    }
    if (showAnswerBtn) showAnswerBtn.classList.add('hidden');
    if (checkAnswerBtn) checkAnswerBtn.classList.add('hidden');
    if (correctBtn) correctBtn.classList.add('hidden');
    if (incorrectBtn) incorrectBtn.classList.add('hidden');
    if (nextBtn) nextBtn.classList.add('hidden');
}

function updateTestProgress() {
    const total = practiceTestState.flatItems.length;
    const current = practiceTestState.currentIndex;
    const { correct, incorrect } = getPracticeTestCounts();

    document.getElementById('testInfo').textContent = `${current} of ${total} questions`;
    document.getElementById('testProgressBar').style.width = total > 0 ? `${(current / total) * 100}%` : '0%';
    const statsEl = document.querySelector('#testProgressView .stats');
    const showRunningScore = practiceTestState.modeFlags?.showRunningScore ?? true;
    if (statsEl) statsEl.classList.toggle('hidden', !showRunningScore);
    if (showRunningScore) {
        document.getElementById('testCorrectCount').textContent = correct;
        document.getElementById('testIncorrectCount').textContent = incorrect;
    }
}

function startTest() {
    if (!practiceTestState.startedAt) {
        practiceTestState.startedAt = Date.now();
    }
    transitionSubView(
        document.getElementById('testProgressView'),
        document.getElementById('testCardView')
    );
    showNextTestQuestion();
}

function showNextTestQuestion() {
    if (practiceTestState.currentIndex >= practiceTestState.flatItems.length) {
        finishTest();
        return;
    }

    const regularView = document.getElementById('testRegularView');
    if (regularView) regularView.classList.remove('hidden');

    const item = getCurrentPracticeTestItem();
    const itemType = resolvePracticeTestItemType(item);
    const modeFlags = practiceTestState.modeFlags || {};

    resetTestCardUI();

    const testQuestionEl = document.getElementById('testQuestion');
    const testAnswerEl = document.getElementById('testAnswer');
    if (testQuestionEl) testQuestionEl.textContent = item?.question || '';
    if (testAnswerEl) testAnswerEl.textContent = item?.answer || '';

    document.getElementById('testCardInfo').textContent =
        `Question ${practiceTestState.currentIndex + 1} of ${practiceTestState.flatItems.length}`;

    const answerInput = document.getElementById('testAnswerInput');
    const checkAnswerBtn = document.getElementById('testCheckAnswerBtn');
    const showAnswerBtn = document.getElementById('testShowAnswerBtn');
    if (showAnswerBtn) {
        if (modeFlags.allowFeedback) {
            showAnswerBtn.classList.remove('hidden');
        } else {
            showAnswerBtn.classList.add('hidden');
        }
    }

    if (itemType === 'mcq') {
        const options = generateMultipleChoiceOptions(item, practiceTestState.flatItems);
        displayMultipleChoiceOptions(options);
    } else {
        if (answerInput) {
            answerInput.classList.remove('hidden');
            answerInput.focus();
        }
        if (checkAnswerBtn) {
            checkAnswerBtn.textContent = modeFlags.submitLabel || 'Check Answer';
            checkAnswerBtn.classList.remove('hidden');
        }
    }

    practiceTestState.itemStartTime = Date.now();
}

function generateMultipleChoiceOptions(item, allItems) {
    const options = new Set();
    const answer = item?.answer ?? '';
    if (answer) options.add(answer);
    if (Array.isArray(item?.options)) {
        item.options.forEach(option => {
            if (option) options.add(option);
        });
    }
    const itemCardId = extractIdFromValue(item?.cardId);
    const wrongAnswers = shuffleArray(
        allItems
            .filter(candidate => {
                if (!candidate?.answer) return false;
                const candidateId = extractIdFromValue(candidate?.cardId);
                if (itemCardId && candidateId) return candidateId !== itemCardId;
                return candidate.cardId !== item.cardId;
            })
            .map(candidate => candidate.answer)
    );
    for (const wrongAnswer of wrongAnswers) {
        if (options.size < 4) {
            options.add(wrongAnswer);
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

    options.forEach((option, index) => {
        const button = document.createElement('button');
        button.className = 'btn btn-secondary';
        button.textContent = option;
        button.dataset.testid = `test-mcq-option-${index}`;
        button.onclick = () => {
            if (practiceTestState.modeFlags?.submitOnSelect) {
                submitTestAnswer(option);
            } else {
                checkTestAnswer(option);
                document.querySelectorAll('#testOptions button').forEach(btn => btn.disabled = true);
            }
        };
        optionsContainer.appendChild(button);
    });
}

function evaluatePracticeTestAnswer(selectedOption = null) {
    const item = getCurrentPracticeTestItem();
    const isMultipleChoice = selectedOption !== null;
    const userInput = isMultipleChoice
        ? String(selectedOption)
        : String(document.getElementById('testAnswerInput')?.value || '').trim();
    const correctAnswer = String(item?.answer || '').trim();
    const strictMarking = practiceTestState.strictMarking;
    const normalizedInput = strictMarking ? userInput : userInput.toLowerCase();
    const normalizedAnswer = strictMarking ? correctAnswer : correctAnswer.toLowerCase();
    const isCorrect = normalizedInput === normalizedAnswer;
    return { userInput, correctAnswer, isCorrect, isMultipleChoice };
}

function recordPracticeTestResponse({ response, wasCorrect }) {
    const item = getCurrentPracticeTestItem();
    if (!item) return null;
    const index = practiceTestState.currentIndex;
    if (practiceTestState.responses[index]) return practiceTestState.responses[index];
    const latencyMs = practiceTestState.itemStartTime ? Date.now() - practiceTestState.itemStartTime : null;
    const marksAvailable = Number.isFinite(item.marksAvailable) ? item.marksAvailable : 1;
    const entry = {
        cardId: item.cardId,
        deckId: item.deckId,
        sectionId: item.sectionId,
        response,
        wasCorrect,
        marksAwarded: wasCorrect ? marksAvailable : 0,
        latencyMs
    };
    practiceTestState.responses[index] = entry;
    return entry;
}

function submitTestAnswer(selectedOption = null) {
    if (practiceTestState.responses[practiceTestState.currentIndex]) return;
    const { userInput, isCorrect } = evaluatePracticeTestAnswer(selectedOption);
    recordPracticeTestResponse({ response: userInput, wasCorrect: isCorrect });
    nextTestQuestion();
}

function checkTestAnswer(selectedOption = null) {
    if (!practiceTestState.modeFlags?.allowFeedback) {
        submitTestAnswer(selectedOption);
        return;
    }
    if (practiceTestState.responses[practiceTestState.currentIndex]) return;
    const { userInput, correctAnswer, isCorrect, isMultipleChoice } = evaluatePracticeTestAnswer(selectedOption);
    recordPracticeTestResponse({ response: userInput, wasCorrect: isCorrect });

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
        const inputEl = document.getElementById('testAnswerInput');
        if (inputEl) {
            inputEl.classList.toggle('correct', isCorrect);
            inputEl.classList.toggle('incorrect', !isCorrect);
            inputEl.disabled = true;
        }
    }

    document.getElementById('testCheckAnswerBtn').classList.add('hidden');
    document.getElementById('testAnswerContent').classList.remove('hidden');
    document.querySelector('#testCardView .flashcard').classList.add('is-flipped');
    document.getElementById('testNextBtn').classList.remove('hidden');
}

function showTestAnswer() {
    if (!practiceTestState.modeFlags?.allowFeedback) return;
    document.querySelector('#testCardView .flashcard').classList.add('is-flipped');
    document.getElementById('testAnswerContent').classList.remove('hidden');
    document.getElementById('testShowAnswerBtn').classList.add('hidden');
    document.getElementById('testCorrectBtn').classList.remove('hidden');
    document.getElementById('testIncorrectBtn').classList.remove('hidden');
}

function markTestCorrect() {
    if (!practiceTestState.modeFlags?.allowFeedback) return;
    if (practiceTestState.responses[practiceTestState.currentIndex]) return;
    recordPracticeTestResponse({ response: null, wasCorrect: true });
    nextTestQuestion();
}

function markTestIncorrect() {
    if (!practiceTestState.modeFlags?.allowFeedback) return;
    if (practiceTestState.responses[practiceTestState.currentIndex]) return;
    recordPracticeTestResponse({ response: null, wasCorrect: false });
    nextTestQuestion();
}

function nextTestQuestion() {
    practiceTestState.currentIndex++;
    updateTestProgress();
    showNextTestQuestion();
}

function computeWilsonInterval(correctCount, totalCount, zScore) {
    if (!totalCount || !Number.isFinite(zScore)) return null;
    const phat = correctCount / totalCount;
    const z2 = zScore * zScore;
    const denom = 1 + (z2 / totalCount);
    const center = (phat + (z2 / (2 * totalCount))) / denom;
    const margin = (zScore * Math.sqrt((phat * (1 - phat) + (z2 / (4 * totalCount))) / totalCount)) / denom;
    return {
        lower: Math.max(0, center - margin),
        upper: Math.min(1, center + margin)
    };
}

async function persistPracticeTestAttempt(attempt) {
    try {
        const existing = await getDataFromDB('appData', 'practiceTestAttempts');
        const { appendPracticeTestAttempt } = await getPracticeTestRuntimeModules();
        const updated = appendPracticeTestAttempt(existing, attempt, 50);
        await saveDataToDB('appData', updated);
    } catch (error) {
        console.error('Failed to save practice test attempt', error);
    }
}

async function applyPracticeTestLearningUpdates() {
    if (practiceTestState.applyLearningInProgress) return;
    const responses = Array.isArray(practiceTestState.responses)
        ? practiceTestState.responses.filter(response => response && typeof response.wasCorrect === 'boolean')
        : [];
    if (!responses.length) {
        showToast('No responses to apply.', 'info');
        return;
    }
    const applyBtn = document.getElementById('testApplyLearningBtn');
    practiceTestState.applyLearningInProgress = true;
    if (applyBtn) {
        applyBtn.disabled = true;
        applyBtn.textContent = 'Applying...';
    }
    try {
        const userBaseline = getFsrsBaseline();
        const updatedDeckIds = new Set();
        for (const response of responses) {
            const deckId = response.deckId || practiceTestState.deckId;
            const deck = decks[deckId];
            const responseCardId = extractIdFromValue(response.cardId);
            const card = deck?.cards?.find(c => extractIdFromValue(c.id) === responseCardId);
            if (!deck || !card) continue;
            const interaction = {
                recallLatency: response.latencyMs,
                attemptCount: 1,
                userAnswer: response.response,
                questionType: 'Practice Test'
            };
            const iqs = calculateIQS({ recallLatency: response.latencyMs, attemptCount: 1 }, userBaseline);
            await applyFsrsReviewUpdate(card, deckId, response.wasCorrect, interaction, iqs, { questionType: 'Practice Test' });
            updatedDeckIds.add(deckId);
        }
        for (const deckId of updatedDeckIds) {
            if (decks[deckId]) {
                await saveDataToDB('decks', decks[deckId]);
            }
        }
        if (applyBtn) {
            applyBtn.textContent = 'Learning Applied';
            applyBtn.disabled = true;
        }
        showToast('Learning updates applied.', 'success');
    } catch (error) {
        console.error('Failed to apply learning updates', error);
        showToast('Failed to apply learning updates.', 'error');
        if (applyBtn) {
            applyBtn.textContent = 'Apply Learning Updates';
            applyBtn.disabled = false;
        }
    } finally {
        practiceTestState.applyLearningInProgress = false;
    }
}

async function finishTest() {
    practiceTestState.finishedAt = Date.now();
    const startedAt = practiceTestState.startedAt || practiceTestState.finishedAt;
    const timeTaken = Math.round((practiceTestState.finishedAt - startedAt) / 1000);
    const responses = Array.isArray(practiceTestState.responses) ? practiceTestState.responses : [];
    const answeredResponses = responses.filter(response => response && typeof response.wasCorrect === 'boolean');
    const correctCount = answeredResponses.filter(response => response.wasCorrect).length;
    const answeredCount = answeredResponses.length;
    const accuracyRatio = answeredCount > 0 ? (correctCount / answeredCount) : 0;
    const accuracyPct = Math.round(accuracyRatio * 100);
    const marksTotal = practiceTestState.form?.totalMarks
        ?? practiceTestState.flatItems.reduce((sum, item) => sum + (Number.isFinite(item.marksAvailable) ? item.marksAvailable : 1), 0);
    const marksCorrect = answeredResponses.reduce((sum, response) => sum + (Number.isFinite(response.marksAwarded) ? response.marksAwarded : 0), 0);
    const scorePct = marksTotal > 0 ? Math.round((marksCorrect / marksTotal) * 100) : 0;

    renderMetricInto('testScore', { label: 'Score', value: scorePct, kind: 'score' }, ['compact']);
    document.getElementById('testCorrectFinal').textContent = marksCorrect;
    document.getElementById('testTotalFinal').textContent = marksTotal;
    document.getElementById('testTime').textContent = `${timeTaken}s`;
    renderMetricInto('testAccuracy', { label: 'Accuracy', value: accuracyPct, kind: 'accuracy' }, ['compact']);

    const ciEnabled = Boolean(practiceTestState.blueprint?.scoring?.confidenceInterval?.enabled)
        && Boolean(practiceTestState.confidenceIntervalEnabled);
    let confidenceInterval = null;
    if (ciEnabled) {
        const zScore = Number(practiceTestState.blueprint?.scoring?.confidenceInterval?.z) || 1.64;
        confidenceInterval = computeWilsonInterval(correctCount, answeredCount, zScore);
        const ciEl = document.getElementById('testConfidenceInterval');
        if (ciEl && confidenceInterval) {
            const lower = Math.round(confidenceInterval.lower * 100);
            const upper = Math.round(confidenceInterval.upper * 100);
            ciEl.textContent = `${lower}% - ${upper}%`;
            const stat = ciEl.closest('.stat');
            if (stat) stat.classList.remove('hidden');
        }
    }

    analyticsData.totalStudyTime += timeTaken;
    const deckName = decks[practiceTestState.deckId]?.name || practiceTestState.deckName || 'Unknown Deck';
    analyticsData.sessions.unshift({
        date: new Date().toISOString(),
        deckName,
        mode: 'practice-test',
        duration: timeTaken,
        accuracy: accuracyRatio,
        scorePct
    });
    if (analyticsData.sessions.length > 50) analyticsData.sessions.pop();
    await saveDataToDB('appData', { key: 'analytics', ...analyticsData });

    const attempt = {
        attemptId: practiceTestState.attemptId,
        startedAt,
        finishedAt: practiceTestState.finishedAt,
        deckId: practiceTestState.deckId,
        blueprint: practiceTestState.blueprint,
        form: practiceTestState.form,
        responses: practiceTestState.responses,
        scoreSummary: {
            scorePct,
            marksCorrect,
            marksTotal,
            ...(confidenceInterval ? {
                confidenceInterval: {
                    lower: confidenceInterval.lower,
                    upper: confidenceInterval.upper,
                    z: practiceTestState.blueprint?.scoring?.confidenceInterval?.z
                }
            } : {})
        }
    };

    await persistPracticeTestAttempt(attempt);

    const applyBtn = document.getElementById('testApplyLearningBtn');
    if (applyBtn) {
        applyBtn.classList.remove('hidden');
        applyBtn.disabled = false;
        applyBtn.textContent = 'Apply Learning Updates';
        applyBtn.onclick = applyPracticeTestLearningUpdates;
    }

    transitionSubView(
        document.getElementById('testCardView'),
        document.getElementById('testCompleteView')
    );
}

function restartTest() {
    practiceTestState.attemptId = createPracticeTestAttemptId();
    practiceTestState.startedAt = null;
    practiceTestState.finishedAt = null;
    practiceTestState.responses = new Array(practiceTestState.flatItems.length).fill(null);
    practiceTestState.currentIndex = 0;
    practiceTestState.itemStartTime = null;
    practiceTestState.applyLearningInProgress = false;
    resetPracticeTestCompletionUI();

    transitionSubView(
        document.getElementById('testCompleteView'),
        document.getElementById('testProgressView')
    );
    updateTestProgress();
}

function endTest() {
    transitionView('dashboard', false, null, false);
}

function registerPracticeTestModeAdapter() {
    const adapter = {
        init: openPracticeTestModal,
        start: startPracticeTestInternal,
        showNext: showNextTestQuestion,
        markCorrect: markTestCorrect,
        markIncorrect: markTestIncorrect,
        finish: finishTest,
        teardown: endTest,
        getState: () => ({ ...practiceTestState })
    };

    window.practiceTestController = adapter;
    if (window.modeRegistry && typeof window.modeRegistry.register === 'function') {
        window.modeRegistry.register('practice-test', adapter);
    }
}

function registerLearnModeAdapter() {
    const factory = learnModeAdapterFactory || (window.lagiote && window.lagiote.createLearnModeAdapter);
    if (!factory) return;
    const adapter = factory({
        startLearnMode,
        showNextCard,
        markAnswerCorrect,
        markAnswerIncorrect,
        endSession,
        getStudyState: () => ({ ...studyState })
    });
    if (!adapter) return;
    window.learnModeController = adapter;
    if (window.modeRegistry && typeof window.modeRegistry.register === 'function') {
        window.modeRegistry.register('learn', adapter);
    }
}

function registerReviewModeAdapter() {
    const factory = reviewModeAdapterFactory || (window.lagiote && window.lagiote.createReviewModeAdapter);
    if (!factory) return;
    const adapter = factory({
        startReviewMode,
        showNextCard,
        markAnswerCorrect,
        markAnswerIncorrect,
        endSession,
        getStudyState: () => ({ ...studyState })
    });
    if (!adapter) return;
    window.reviewModeController = adapter;
    if (window.modeRegistry && typeof window.modeRegistry.register === 'function') {
        window.modeRegistry.register('review', adapter);
    }
}

function registerSpacedModeAdapter() {
    const adapter = {
        start: startSpacedMode,
        showNext: showNextCard,
        grade: gradeSpaced,
        endSession,
        getStudyState: () => ({ ...studyState })
    };

    window.spacedModeController = adapter;
    if (window.modeRegistry && typeof window.modeRegistry.register === 'function') {
        window.modeRegistry.register('spaced', adapter);
    }
}

function registerSequenceModeAdapter() {
    const factory = window.createSequenceModeAdapter || (window.lagiote && window.lagiote.createSequenceModeAdapter);
    let adapter = null;
    if (factory) {
        adapter = factory({
            startSequenceSession: startSequenceMode,
            startMode,
            showNextCard,
            markAnswerCorrect,
            markAnswerIncorrect,
            endSession,
            getStudyState: () => ({ ...studyState })
        });
    } else {
        adapter = {
            start: startSequenceMode,
            showNext: continueSequenceTask,
            grade: submitSequenceTask,
            endSession,
            getStudyState: () => ({ ...studyState })
        };
    }
    if (!adapter) return;
    window.sequenceModeController = adapter;
    if (window.modeRegistry && typeof window.modeRegistry.register === 'function') {
        window.modeRegistry.register('sequence', adapter);
    }
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

function formatModeLabel(mode) {
    if (!mode) return 'Session';
    const map = {
        learn: 'Learn',
        review: 'Review',
        spaced: 'Spaced',
        practiceTest: 'Practice Test',
        'practice-test': 'Practice Test',
        exam: 'Exam',
        sequence: 'Sequence'
    };
    if (map[mode]) return map[mode];
    return mode.charAt(0).toUpperCase() + mode.slice(1);
}

function wilson(k, n, z = 1.645) {
    if (n === 0) return [0, 0];
    const p = k / n;
    const denom = 1 + z * z / n;
    const center = (p + z * z / (2 * n)) / denom;
    const halfWidth = z * Math.sqrt((p * (1 - p) + z * z / (4 * n)) / n) / denom;
    return [Math.max(0, center - halfWidth), Math.min(1, center + halfWidth)];
}

function computeDifficultyProxy(card, knowledgeState) {
    if (knowledgeState && knowledgeState.pLower !== undefined) {
        return knowledgeState.pLower;
    }
    if (knowledgeState && knowledgeState.fsrs) {
        const now = Date.now();
        const last = knowledgeState.last_review ? new Date(knowledgeState.last_review).getTime() : (now - 1000 * 60 * 60 * 24 * 30);
        const next = knowledgeState.due ? new Date(knowledgeState.due).getTime() : now;
        
        const interval = Math.max(1, next - last);
        const elapsed = now - last;
        const ratio = elapsed / interval;
        return 1 / (1 + ratio); // 1 if just reviewed, 0.5 if due now, < 0.5 if overdue
    }
    return 0.5;
}

async function renderEvalPanel(container) {
    try {
        const { store, summary, integrity } = await getEvalModules();
        const config = await store.loadEvalConfig('default_user');
        
        // Ensure header exists if we have an experiment ID
        let header = null;
        if (config.experiment?.experimentId) {
            header = await store.ensureExperimentHeader('default_user', config, { version: '1.0.0' }); // Mock version for now
        }

        const completed = await store.loadCompletedProbes('default_user');
        const delaysHours = config.probes?.delaysHours || [6, 24, 72];
        
        const stats = summary.summariseProbes(completed, delaysHours);
        
        const isLocked = !!header;
        const mode = header ? header.mode : (config.experiment?.mode || 'STEP_LEVEL_ROUTER');
        
        let html = `
            <h3 class="section-title" style="font-size: 1.3rem; margin-bottom: 20px;">Evaluation Framework</h3>
            
            <div style="margin-bottom: 15px; padding: 10px; background: var(--bg-secondary); border-radius: 8px;">
                <div style="margin-bottom: 10px;">
                    <label class="checkbox-container">
                        <input type="checkbox" id="evalEnabledCheckbox" ${config.enabled ? 'checked' : ''}>
                        <span class="checkmark"></span>
                        Enable Evaluation
                    </label>
                </div>
                
                <div style="margin-bottom: 10px;">
                    <label>Mode: 
                        <select id="evalModeSelect" style="margin-left: 10px; padding: 4px;" ${isLocked ? 'disabled' : ''}>
                            <option value="STEP_LEVEL_ROUTER" ${mode === 'STEP_LEVEL_ROUTER' ? 'selected' : ''}>Step-Level Router</option>
                            <option value="CARD_LEVEL_SPLIT" ${mode === 'CARD_LEVEL_SPLIT' ? 'selected' : ''}>Card-Level Split</option>
                        </select>
                    </label>
                    ${isLocked ? '<span style="font-size: 0.8rem; color: var(--secondary-text); margin-left: 5px;">(Locked)</span>' : ''}
                </div>

                ${mode === 'CARD_LEVEL_SPLIT' ? `
                <div style="margin-bottom: 10px;">
                    <label>Assignment: 
                        <select id="evalAssignmentMethodSelect" style="margin-left: 10px; padding: 4px;" ${isLocked ? 'disabled' : ''}>
                            <option value="stratified_v1" ${config.experiment?.assignmentMethod === 'stratified_v1' ? 'selected' : ''}>Stratified (Blocked)</option>
                            <option value="random_v1" ${config.experiment?.assignmentMethod === 'random_v1' ? 'selected' : ''}>Pure Random</option>
                        </select>
                    </label>
                </div>
                ` : ''}
                
                <div>
                    <button id="newExperimentBtn" class="btn-secondary" style="font-size: 0.8rem;">Start New Experiment</button>
                    <span style="font-size: 0.8rem; margin-left: 10px; color: var(--secondary-text);">
                        ID: ${config.experiment?.experimentId ? config.experiment.experimentId.substring(0, 8) : 'None'}
                    </span>
                </div>
                ${isLocked ? `
                <div style="margin-top: 10px; font-size: 0.8rem; color: var(--secondary-text);">
                    <strong>Locked Settings:</strong> pA=${header.router.pA}, Sample=${header.probes.sampleRate}, Delays=[${header.probes.delaysHours.join(', ')}]h
                </div>
                ` : ''}
            </div>
            
            <table class="stats-table" style="margin-bottom: 20px;">
                <thead>
                    <tr>
                        <th>Delay</th>
                        <th>Arm A (Cortex)</th>
                        <th>Arm B (Baseline)</th>
                        <th>Delta (A-B)</th>
                    </tr>
                </thead>
                <tbody>
        `;
        
        const buckets = [...delaysHours, 'all'];
        
        const renderRow = (label, bucket) => {
            const sA = stats.policyA[bucket];
            const sB = stats.policyB[bucket];
            
            const fmt = (s) => {
                if (s.n === 0) return '-';
                return `${(s.p*100).toFixed(1)}% <span style="font-size:0.7em; color:var(--secondary-text)">[${(s.lower*100).toFixed(1)}, ${(s.upper*100).toFixed(1)}]</span> <br><span style="font-size:0.7em">(n=${s.n}${s.invalidN > 0 ? `, inv=${s.invalidN}` : ''})</span>`;
            };
            
            const delta = sA.p - sB.p;
            const deltaStr = (sA.n > 0 && sB.n > 0) ? 
                `${(delta > 0 ? '+' : '')}${(delta*100).toFixed(1)}%` : '-';
                
            return `
                <tr>
                    <td>${label}</td>
                    <td>${fmt(sA)}</td>
                    <td>${fmt(sB)}</td>
                    <td>${deltaStr}</td>
                </tr>
            `;
        };
        
        if (completed.length === 0) {
            html += `<tr><td colspan="4">No probe data yet.</td></tr>`;
        } else {
            html += renderRow('All', 'all');
            delaysHours.forEach(delay => {
                html += renderRow(`${delay}h`, delay);
            });
        }
        
        html += `
                </tbody>
            </table>

            <!-- Power Analysis -->
            <div style="margin-bottom: 20px; padding: 10px; background: var(--bg-secondary); border-radius: 8px;">
                <h4 style="margin-top: 0; font-size: 1rem;">Power / Progress</h4>
                <div style="font-size: 0.9rem; color: var(--text-primary);">
        `;
        
        const pBaseline = stats.policyB['all'].n > 10 ? stats.policyB['all'].p : 0.6;
        const reqN = summary.estimateRequiredSample(pBaseline, 0.05);
        const currentN = Math.min(stats.policyA['all'].n, stats.policyB['all'].n);
        const progress = Math.min(100, (currentN / reqN) * 100);
        
        html += `
                    <p>Target detectable lift: 5pp (baseline est. ${(pBaseline*100).toFixed(0)}%)</p>
                    <p>Required n per arm: <strong>${reqN}</strong> (current min: ${currentN})</p>
                    <div style="width: 100%; background: var(--border-color); height: 8px; border-radius: 4px; margin-top: 5px;">
                        <div style="width: ${progress}%; background: var(--accent-color); height: 100%; border-radius: 4px;"></div>
                    </div>
                    <p style="font-size: 0.8rem; margin-top: 5px; color: var(--secondary-text);">
                        ${progress < 100 ? 'Keep collecting data.' : 'Sufficient sample size for analysis.'}
                    </p>
                </div>
            </div>

            <!-- Assignment Balance -->
            ${header && header.assignment && header.assignment.byDeck ? (() => {
                let balanceHtml = `
                    <div style="margin-bottom: 20px; padding: 10px; background: var(--bg-secondary); border-radius: 8px;">
                        <h4 style="margin-top: 0; font-size: 1rem;">Assignment Balance</h4>
                        <div style="font-size: 0.85rem;">
                `;
                
                let totalA = 0;
                let totalB = 0;
                let totalCards = 0;
                
                for (const deckId in header.assignment.byDeck) {
                    const d = header.assignment.byDeck[deckId];
                    totalA += d.assignedA;
                    totalB += d.assignedB;
                    totalCards += d.total;
                    
                    const skew = d.total > 0 ? Math.abs(d.assignedA - d.assignedB) / d.total : 0;
                    const skewWarning = skew > 0.15 ? 'color: var(--error-color); font-weight: bold;' : '';
                    
                    balanceHtml += `
                        <div style="margin-bottom: 10px; border-bottom: 1px solid var(--border-color); padding-bottom: 5px;">
                            <div style="display: flex; justify-content: space-between;">
                                <span>Deck: <strong>${deckId}</strong></span>
                                <span style="${skewWarning}">Skew: ${(skew * 100).toFixed(1)}%</span>
                            </div>
                            <div style="display: flex; gap: 15px; margin-top: 3px; color: var(--secondary-text);">
                                <span>Total: ${d.total}</span>
                                <span>A: ${d.assignedA}</span>
                                <span>B: ${d.assignedB}</span>
                            </div>
                            <div style="margin-top: 5px; display: flex; gap: 4px; overflow-x: auto; padding-bottom: 5px;">
                    `;
                    
                    d.strata.forEach(s => {
                        const sSkew = s.n > 0 ? Math.abs(s.a - s.b) : 0;
                        const sColor = sSkew > 1 ? 'var(--error-color)' : 'var(--secondary-text)';
                        balanceHtml += `
                            <div style="flex: 0 0 auto; border: 1px solid var(--border-color); padding: 2px 6px; border-radius: 4px; font-size: 0.75rem; text-align: center;">
                                <div style="color: var(--secondary-text)">Q${s.q}</div>
                                <div style="font-weight: bold; color: ${sColor}">${s.a}/${s.b}</div>
                            </div>
                        `;
                    });
                    
                    balanceHtml += `
                            </div>
                        </div>
                    `;
                }
                
                const overallSkew = totalCards > 0 ? Math.abs(totalA - totalB) / totalCards : 0;
                if (overallSkew > 0.05) {
                    balanceHtml += `<p style="color: var(--error-color); font-size: 0.8rem; margin-top: 5px;">⚠️ Overall assignment skew is high (${(overallSkew*100).toFixed(1)}%)</p>`;
                }
                
                balanceHtml += `
                        </div>
                    </div>
                `;
                return balanceHtml;
            })() : ''}
            
            <div style="display: flex; gap: 10px;">
                <button id="exportEvalBtn" class="btn-secondary">Export JSON</button>
                <button id="clearEvalBtn" class="btn-danger">Clear Data</button>
            </div>
        `;
        
        container.innerHTML = html;
        
        document.getElementById('evalEnabledCheckbox').onchange = async (e) => {
            config.enabled = e.target.checked;
            if (config.enabled && !config.experiment?.experimentId) {
                config.experiment = config.experiment || {};
                config.experiment.experimentId = Date.now().toString(36) + Math.random().toString(36).substring(2);
                config.experiment.createdAt = Date.now();
                // Header will be created on next render or explicitly here
                await store.ensureExperimentHeader('default_user', config, { version: '1.0.0' });
            }
            await store.saveEvalConfig('default_user', config);
            showToast(`Evaluation ${config.enabled ? 'enabled' : 'disabled'}`, 'info');
            renderEvalPanel(container);
        };
        
        document.getElementById('evalModeSelect').onchange = async (e) => {
            if (isLocked) {
                showToast('Settings are locked for this experiment. Start a new one to change mode.', 'warning');
                e.target.value = mode; // Revert
                return;
            }
            config.experiment = config.experiment || {};
            config.experiment.mode = e.target.value;
            await store.saveEvalConfig('default_user', config);
            showToast(`Mode set to ${e.target.value}`, 'info');
            renderEvalPanel(container);
        };

        if (document.getElementById('evalAssignmentMethodSelect')) {
            document.getElementById('evalAssignmentMethodSelect').onchange = async (e) => {
                if (isLocked) return;
                config.experiment = config.experiment || {};
                config.experiment.assignmentMethod = e.target.value;
                await store.saveEvalConfig('default_user', config);
                showToast(`Assignment method set to ${e.target.value}`, 'info');
            };
        }
        
        document.getElementById('newExperimentBtn').onclick = async () => {
            if (confirm('Start new experiment? This will clear current assignment and probe data.')) {
                const { store } = await getEvalModules();
                await store.clearEvalData('default_user');
                config.experiment = config.experiment || {};
                config.experiment.experimentId = Date.now().toString(36) + Math.random().toString(36).substring(2);
                config.experiment.createdAt = Date.now();
                await store.saveEvalConfig('default_user', config);
                
                let header = await store.ensureExperimentHeader('default_user', config, { version: '1.0.0' });
                
                if (config.experiment.mode === 'CARD_LEVEL_SPLIT') {
                    const allKnowledge = await getAllDataFromDB('userKnowledgeState');
                    const knowledgeMap = new Map(allKnowledge.map(k => {
                        let knowledgeId = k.cardID;
                        if (!knowledgeId && k.id) {
                            const parts = k.id.split(':');
                            knowledgeId = parts.length > 1 ? parts[1] : parts[0];
                        }
                        return [knowledgeId, k];
                    }).filter(([knowledgeId]) => knowledgeId !== undefined && knowledgeId !== null));
                    
                    const { collectCardMetasForDecks } = await import('../core/card-meta.js');
                    const cardMetas = collectCardMetasForDecks(decks, Object.keys(decks || {}), knowledgeMap, computeDifficultyProxy);
                    if (cardMetas.length === 0) {
                        showToast('No cards available for assignment.', 'error');
                        await renderEvalPanel(container);
                        return;
                    }
                    
                    const rng = studyState.evalRng || (() => Math.random());
                    const { stats } = await store.ensureAssignment('default_user', config.experiment.experimentId, cardMetas, rng, {
                        method: config.experiment.assignmentMethod || 'stratified_v1'
                    });
                    
                    header.assignment = stats;
                    await store.saveExperimentHeader('default_user', config.experiment.experimentId, header);
                }

                await renderEvalPanel(container);
                showToast('New experiment started', 'success');
            }
        };
        
        document.getElementById('exportEvalBtn').onclick = async () => {
            const events = await store.loadEvalEvents('default_user');
            const pending = await store.loadPendingProbes('default_user');
            
            // Compute assignment summary
            const exposures = events.filter(e => e.type === 'exposure');
            const assignedA = exposures.filter(e => e.arm === 'A').length;
            const assignedB = exposures.filter(e => e.arm === 'B').length;
            const decksInvolved = [...new Set(exposures.map(e => e.deckId))];

            const exportData = {
                version: 3,
                exportedAt: new Date().toISOString(),
                config,
                experimentHeader: header,
                assignmentSummary: {
                    totalAssignedA: assignedA,
                    totalAssignedB: assignedB,
                    decksInvolved,
                    assignment: header?.assignment || null
                },
                eventsSummary: {
                    count: events.length,
                    exposures: exposures.length
                },
                events, // Full events
                pendingProbes: pending,
                completedProbes: completed
            };
            
            const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `lagiote-eval-${new Date().toISOString().slice(0,10)}.json`;
            a.click();
            URL.revokeObjectURL(url);
        };
        
        document.getElementById('clearEvalBtn').onclick = async () => {
            if (confirm('Are you sure you want to clear all evaluation data? This cannot be undone.')) {
                await store.clearEvalData('default_user');
                await renderEvalPanel(container);
                showToast('Evaluation data cleared', 'success');
            }
        };
        
    } catch (err) {
        console.error('Error rendering eval panel:', err);
        container.innerHTML = `<div class="error-message">Error loading evaluation data: ${err.message}</div>`;
    }
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
            const modeLabel = formatModeLabel(s.mode);
            const accuracyValue = typeof s.accuracy === 'number'
                ? (s.accuracy > 1 ? s.accuracy / 100 : s.accuracy)
                : null;
            const accuracyLabel = typeof accuracyValue === 'number' ? ` | ${Math.round(accuracyValue * 100)}%` : '';
            const deckName = escapeHtml(s.deckName || 'Unknown');
            return `<div class="deck-card-item">${escapeHtml(date)}: ${escapeHtml(modeLabel)} on "${deckName}" for ${escapeHtml(duration)}${escapeHtml(accuracyLabel)}</div>`;
        }).join('');
    } else {
        sessionList.innerHTML = '<p style="color: var(--secondary-text); text-align: center;">No study sessions recorded yet.</p>';
    }

    transitionView('analyticsView', false, () => {
        renderAnalyticsActivityChart(activityData);
        renderAnalyticsDeckBreakdownChart(deckData);
        
        const container = document.getElementById('analyticsView');
        let evalPanel = document.getElementById('evalPanel');
        if (!evalPanel) {
            evalPanel = document.createElement('div');
            evalPanel.id = 'evalPanel';
            evalPanel.className = 'settings-container';
            evalPanel.style.marginTop = '30px';
            container.appendChild(evalPanel);
        }
        renderEvalPanel(evalPanel);
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
        if (!focusDot) return;
        if (averageFocusScore >= 0.85) {
            focusDot.style.backgroundColor = 'var(--deck-accent)';
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

function selectOptimalQuestionType(card, deckOverride = null, modeOverride = currentMode) {
    const resolvedDeck = deckOverride || decks[card.deckId || currentDeckId];

    const detectedType = detectCardType(card);
    if (detectedType === CARD_TYPES.CLOZE) return 'Cloze';
    if (detectedType === CARD_TYPES.BASIC_TYPE_ANSWER) return 'Type';

    if (!resolvedDeck) {
        console.error(`Could not find deck for card "${card.question}". Defaulting to Flashcard.`);
        return 'Flashcard';
    }

    if (modeOverride === 'spaced') {
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

function normalizeMcqOptionKey(optionText) {
    if (window.lagiote?.mcqRemediation?.normalizeOptionKey) {
        return window.lagiote.mcqRemediation.normalizeOptionKey(optionText);
    }
    return String(optionText || '')
        .trim()
        .toLowerCase()
        .normalize('NFKD')
        .replace(/\s+/g, ' ');
}

function getMcqExplanation(card) {
    if (!card || typeof card !== 'object') return '';
    const explanation = [
        card.explanations?.correct,
        card.mcqExplanation,
        card.explanation
    ].find(value => typeof value === 'string' && value.trim());
    return explanation ? explanation.trim() : '';
}

function getMcqRefutation(card, lureKey) {
    if (!card || typeof card !== 'object' || !lureKey) return '';
    const normalizedKey = normalizeMcqOptionKey(lureKey);
    const refutations = [
        card.explanations?.lures,
        card.distractorRefutations,
        card.mcqRefutations
    ];
    for (const source of refutations) {
        if (source && typeof source === 'object') {
            const candidate = source[normalizedKey];
            if (typeof candidate === 'string' && candidate.trim()) {
                return candidate.trim();
            }
        }
    }
    return '';
}

function ensureMcqRemediationState() {
    if (!studyState.mcqRemediation) {
        studyState.mcqRemediation = {
            queue: [],
            cooldownUntil: 0,
            cooldownMs: 60000,
            maxQueue: 20,
            pendingSteps: 0,
            activeTask: null
        };
    }
    if (!Array.isArray(studyState.mcqRemediation.queue)) {
        studyState.mcqRemediation.queue = [];
    }
    return studyState.mcqRemediation;
}

function setRemediationDelay(remediationState, minSteps = 1, maxSteps = 3) {
    const min = Math.max(0, Math.floor(minSteps));
    const max = Math.max(min, Math.floor(maxSteps));
    remediationState.pendingSteps = min + Math.floor(Math.random() * (max - min + 1));
}

function enqueueLureRemediation(card, correctAnswer, lureOption, lureKey) {
    if (!card || !card.id) return;
    const remediationState = ensureMcqRemediationState();
    const normalizedLureKey = normalizeMcqOptionKey(lureKey || lureOption);
    if (!normalizedLureKey) return;

    if (window.lagiote?.mcqRemediation?.enqueueRemediation) {
        const task = {
            type: 'lure_discriminate',
            cardId: card.id,
            correct: String(correctAnswer || '').trim(),
            lure: String(lureOption || '').trim(),
            lureKey: normalizedLureKey
        };
        remediationState.queue = window.lagiote.mcqRemediation.enqueueRemediation(
            remediationState.queue,
            task,
            remediationState.maxQueue
        );
    } else {
        const exists = remediationState.queue.some(task => task.cardId === card.id && task.lureKey === normalizedLureKey);
        if (exists) return;
        remediationState.queue.push({
            type: 'lure_discriminate',
            cardId: card.id,
            correct: String(correctAnswer || '').trim(),
            lure: String(lureOption || '').trim(),
            lureKey: normalizedLureKey,
            createdAt: Date.now(),
            attempts: 0
        });
        if (remediationState.queue.length > remediationState.maxQueue) {
            remediationState.queue.splice(0, remediationState.queue.length - remediationState.maxQueue);
        }
    }

    if (!Number.isFinite(remediationState.pendingSteps) || remediationState.pendingSteps <= 0) {
        setRemediationDelay(remediationState);
    }
}

function shouldShowRemediation(nowMs = Date.now()) {
    const remediationState = ensureMcqRemediationState();
    if (remediationState.queue.length === 0) return false;

    if (window.lagiote?.mcqRemediation?.shouldShowRemediation) {
        if (!window.lagiote.mcqRemediation.shouldShowRemediation(remediationState.queue, nowMs, remediationState.cooldownUntil)) {
            return false;
        }
    } else {
        if (nowMs <= remediationState.cooldownUntil) return false;
    }

    const pending = Number.isFinite(remediationState.pendingSteps) ? remediationState.pendingSteps : 0;
    return pending <= 0;
}

function decrementRemediationDelay() {
    const remediationState = ensureMcqRemediationState();
    if (remediationState.queue.length === 0) {
        remediationState.pendingSteps = 0;
        return;
    }
    const pending = Number.isFinite(remediationState.pendingSteps) ? remediationState.pendingSteps : 0;
    remediationState.pendingSteps = Math.max(0, pending - 1);
}

function popNextRemediation() {
    const remediationState = ensureMcqRemediationState();
    if (remediationState.queue.length === 0) return null;

    if (window.lagiote?.mcqRemediation?.popNextRemediation) {
        const { task, nextQueue } = window.lagiote.mcqRemediation.popNextRemediation(remediationState.queue);
        remediationState.queue = nextQueue;
        return task;
    }

    let bestIndex = 0;
    let bestTask = remediationState.queue[0];
    for (let i = 1; i < remediationState.queue.length; i++) {
        const candidate = remediationState.queue[i];
        if (candidate.attempts < bestTask.attempts) {
            bestIndex = i;
            bestTask = candidate;
            continue;
        }
        if (candidate.attempts === bestTask.attempts && candidate.createdAt < bestTask.createdAt) {
            bestIndex = i;
            bestTask = candidate;
        }
    }
    remediationState.queue.splice(bestIndex, 1);
    return bestTask;
}

function applyRemediationOutcome(stats, isCorrect, nowMs = Date.now()) {
    if (window.lagiote?.mcqRemediation?.updateMcqRemediationStats) {
        const nextStats = window.lagiote.mcqRemediation.updateMcqRemediationStats(stats, isCorrect, { now: nowMs });
        Object.assign(stats, nextStats);
        return;
    }

    stats.remediationAttempts += 1;
    if (isCorrect) {
        stats.remediationCorrect += 1;
        stats.recognitionDependenceEma = Math.max(0, Math.min(1, stats.recognitionDependenceEma * (1 - 0.06)));
    } else {
        const ema = Number.isFinite(stats.recognitionDependenceEma) ? stats.recognitionDependenceEma : 0.0;
        const alpha = 0.22;
        stats.recognitionDependenceEma = Math.max(0, Math.min(1, (ema * (1 - alpha)) + alpha));
    }
    stats.lastRemediationAt = nowMs;
    stats.lastUpdated = nowMs;
}

function findCardById(cardId) {
    if (!cardId) return null;
    const currentDeck = decks[currentDeckId];
    const fromCurrentDeck = currentDeck?.cards?.find(card => card.id === cardId);
    if (fromCurrentDeck) return fromCurrentDeck;
    for (const deck of Object.values(decks)) {
        const candidate = deck?.cards?.find(card => card.id === cardId);
        if (candidate) return candidate;
    }
    return null;
}

function weightedSample(items, weightFn, count) {
    const pool = items.slice();
    const selected = [];
    const targetCount = Math.min(count, pool.length);
    for (let pick = 0; pick < targetCount; pick++) {
        let totalWeight = 0;
        const weights = pool.map(item => {
            const weight = Math.max(0, Number(weightFn(item)) || 0);
            totalWeight += weight;
            return weight;
        });
        if (totalWeight <= 0) {
            selected.push(pool.shift());
            continue;
        }
        let roll = Math.random() * totalWeight;
        let chosenIndex = 0;
        for (let i = 0; i < pool.length; i++) {
            roll -= weights[i];
            if (roll <= 0) {
                chosenIndex = i;
                break;
            }
        }
        selected.push(pool.splice(chosenIndex, 1)[0]);
    }
    return selected;
}

function selectPreferredMcqOptions(options, correctAnswer, preferredCount = 3, lureCounts = null) {
    const unique = Array.from(new Set((Array.isArray(options) ? options : []).map(o => String(o || '').trim())))
        .filter(Boolean);
    const correct = String(correctAnswer || '').trim();
    const withoutEmpty = unique.filter(Boolean);
    if (!withoutEmpty.includes(correct)) withoutEmpty.unshift(correct);
    if (withoutEmpty.length <= preferredCount) return shuffleArray(withoutEmpty);

    const lures = withoutEmpty.filter(opt => opt !== correct);
    if (preferredCount <= 1 || lures.length < (preferredCount - 1)) {
        return shuffleArray(withoutEmpty.slice(0, Math.max(2, Math.min(4, withoutEmpty.length))));
    }

    const lureCountsMap = lureCounts && typeof lureCounts === 'object' ? lureCounts : null;
    let selectedLures;
    if (lureCountsMap && window.lagiote?.mcqRemediation?.weightedSampleDistractors) {
        selectedLures = window.lagiote.mcqRemediation.weightedSampleDistractors(lures, lureCountsMap, preferredCount - 1);
    } else if (lureCountsMap) {
        selectedLures = weightedSample(lures, option => 1 + Math.min(5, lureCountsMap[normalizeMcqOptionKey(option)] || 0), preferredCount - 1);
    } else {
        selectedLures = shuffleArray(lures).slice(0, preferredCount - 1);
    }
    return shuffleArray([correct, ...selectedLures]);
}

function renderMcqOptionsPlaceholder(message = 'Generating options...') {
    const optionsContainer = document.getElementById('mcqOptions');
    if (!optionsContainer) return;
    optionsContainer.innerHTML = '';
    optionsContainer.classList.remove('hidden');
    const placeholder = document.createElement('div');
    placeholder.className = 'mcq-placeholder';
    placeholder.textContent = message;
    optionsContainer.appendChild(placeholder);
}

async function generateAndDisplayMCQ(correctCard) {
    const options = await buildMcqOptions(correctCard);
    displayMCQButtons(options, correctCard);
}

function startMcqPipeline(card) {
    const token = (studyState.pendingMCQToken || 0) + 1;
    studyState.pendingMCQToken = token;
    studyState.pendingMCQCardId = card.id;
    studyState.mcqPipeline = {
        token,
        cardId: card.id,
        phase: 'recall',
        recallWasCorrect: null,
        options: null,
        startedAt: Date.now()
    };
    prefetchMcqOptions(card, token);
}

async function prefetchMcqOptions(card, token) {
    try {
        const options = await buildMcqOptions(card);
        if (studyState.pendingMCQToken !== token) return;
        if (studyState.pendingMCQCardId !== card.id) return;
        if (!studyState.mcqPipeline || studyState.mcqPipeline.token !== token) return;
        studyState.mcqPipeline.options = options;
        if (studyState.mcqPipeline.phase === 'recognition') {
            displayMCQButtons(options, card);
        }
    } catch (error) {
        console.warn('[MCQ] Option prefetch failed', error);
    }
}

async function buildMcqOptions(correctCard) {
    const deckIdForThisCard = correctCard.deckId || currentDeckId;
    let lureCounts = null;
    try {
        const state = studyState.knowledgeStates?.get(correctCard.id)
            || await getOrCreateKnowledgeState('default_user', correctCard.id, deckIdForThisCard);
        const stats = ensureMcqStats(state?.mcqStats);
        lureCounts = stats.lureCounts;
    } catch (error) {
        lureCounts = null;
    }
    const deckForThisCard = decks[deckIdForThisCard];
    if (!deckForThisCard) {
        console.error("Deck not found for card:", correctCard.id, "DeckID:", correctCard.deckId);
        return selectPreferredMcqOptions([correctCard.answer], correctCard.answer, 2, lureCounts);
    }

    const correctAnswer = String(correctCard.answer || '').trim();
    const cardInDeck = deckForThisCard.cards.find(c => c.id === correctCard.id);
    const preGenerated = studyState.preGeneratedDistractors?.get?.(correctCard.id) || null;

    if (Array.isArray(preGenerated) && preGenerated.length >= 2) {
        const options = [correctAnswer, ...preGenerated];
        return selectPreferredMcqOptions(shuffleArray(options), correctAnswer, 3, lureCounts);
    }

    if (cardInDeck?.distractors && cardInDeck.distractors.length >= 2) {
        const options = [correctAnswer, ...cardInDeck.distractors];
        return selectPreferredMcqOptions(shuffleArray(options), correctAnswer, 3, lureCounts);
    }

    if (isOnline) {
        try {
            const requestBody = { question: correctCard.question, answer: correctAnswer };
            let generatedDistractors;

            if (isElectron) {
                generatedDistractors = await window.electronAPI.generateDistractors(requestBody);
            } else {
                const response = await fetch('/api/distractors', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${localStorage.getItem('auth0Token')}`
                    },
                    body: JSON.stringify(requestBody)
                });

                if (response.status === 401) {
                    if (getStoredSession()) {
                        await loadUserDataAndSync();
                    }
                    throw new Error("Token expired, please try again");
                }

                if (!response.ok) {
                    throw new Error(`Server function for distractors failed: ${response.status}`);
                }
                const result = await response.json();
                generatedDistractors = result.distractors;
            }

            if (generatedDistractors?.offline) {
                throw new Error("Offline: " + (generatedDistractors.message || "Cannot generate distractors"));
            }

            if (Array.isArray(generatedDistractors) && generatedDistractors.length >= 2) {
                if (cardInDeck) {
                    cardInDeck.distractors = generatedDistractors;
                    await saveDataToDB('decks', deckForThisCard);
                }
                correctCard.distractors = generatedDistractors;
                const options = [correctAnswer, ...generatedDistractors];
                return selectPreferredMcqOptions(shuffleArray(options), correctAnswer, 3, lureCounts);
            }
        } catch (error) {
            const errorMsg = error.message || "Error generating options";
            if (!String(errorMsg).includes('Offline') && !String(errorMsg).includes('expired')) {
                showToast("Couldn't generate smart options, using random.", "warning");
            }
        }
    }

    const allCardsInDeck = deckForThisCard.cards || [];
    const options = new Set([correctAnswer]);
    const randomFill = shuffleArray(allCardsInDeck.filter(card => card.id !== correctCard.id));
    for (const randomCard of randomFill) {
        if (options.size < 4) options.add(String(randomCard.answer || '').trim());
        else break;
    }
    return selectPreferredMcqOptions(shuffleArray(Array.from(options)), correctAnswer, 3, lureCounts);
}

function enterMcqRecognitionPhase(card) {
    if (!studyState.mcqPipeline || studyState.mcqPipeline.cardId !== card.id) return;
    studyState.mcqPipeline.phase = 'recognition';
    const writeInput = document.getElementById('writeAnswerInput');
    if (writeInput) {
        writeInput.disabled = true;
        writeInput.classList.add('hidden');
    }
    document.getElementById('checkAnswerBtn')?.classList.add('hidden');
    document.getElementById('dontKnowBtn')?.classList.add('hidden');

    const options = studyState.mcqPipeline.options;
    if (Array.isArray(options) && options.length) {
        displayMCQButtons(options, card);
    } else {
        renderMcqOptionsPlaceholder();
    }
}

async function submitMcqRecallAttempt() {
    const card = getActiveCard();
    if (!card || !studyState.mcqPipeline || studyState.mcqPipeline.cardId !== card.id) {
        return autoCheckAnswer();
    }

    const deckIdForThisCard = card.deckId || currentDeckId;
    const state = await getOrCreateKnowledgeState('default_user', card.id, deckIdForThisCard);
    const stats = ensureMcqStats(state?.mcqStats);
    const nowMs = Date.now();

    const userInput = document.getElementById('writeAnswerInput');
    const feedbackMessage = document.getElementById('feedbackMessage');
    const submissionTime = performance.now();
    const recallLatency = currentInteractionLog.firstKeyPressTime ? Math.round(currentInteractionLog.firstKeyPressTime - currentInteractionLog.questionLoadTime) : null;

    let answerFluency = 0;
    if (currentInteractionLog.firstKeyPressTime) {
        const typingDuration = submissionTime - currentInteractionLog.firstKeyPressTime;
        if (typingDuration > 0) {
            answerFluency = parseFloat((userInput.value.trim().length / (typingDuration / 1000))).toFixed(2);
        }
    }

    const userAnswer = userInput ? userInput.value.trim() : '';
    const correctAnswer = String(card.answer || '').trim();
    const deck = decks[deckIdForThisCard];
    const settings = { ...DEFAULT_DECK_SETTINGS, ...(deck?.settings || {}), ...(studyState.settings || {}) };
    const checkResult = checkAnswerForgivingly(userAnswer, correctAnswer, settings);
    const recallCorrect = checkResult.result === 'CORRECT' || checkResult.result === 'TYPO';

    stats.attempts += 1;
    stats.recallAttempts += 1;
    stats.lastUpdated = nowMs;

    studyState.mcqPipeline.recallWasCorrect = recallCorrect;

    if (recallCorrect) {
        stats.recallCorrect += 1;
        stats.recognitionDependenceEma = Math.max(0, Math.min(1, stats.recognitionDependenceEma * (1 - 0.08)));

        state.mcqStats = stats;
        studyState.knowledgeStates?.set?.(card.id, { ...state, mcqStats: stats });

        if (feedbackMessage) {
            feedbackMessage.style.color = 'var(--deck-accent)';
            feedbackMessage.textContent = 'Correct.';
        }
        document.getElementById('checkAnswerBtn')?.classList.add('hidden');
        document.getElementById('dontKnowBtn')?.classList.add('hidden');

        await logInteraction({
            cardID: card.id,
            wasCorrect: true,
            userAnswer,
            correctAnswer,
            recallLatency,
            answerFluency,
            totalCorrections: checkResult.result === 'TYPO' ? checkResult.distance : 0,
            attemptCount: 1,
            questionType: 'MultipleChoice'
        });

        const { shouldLogMcqExposure } = await getEvalExposureDedupeModule();
        if (shouldLogMcqExposure('recall', recallCorrect)) {
            await logEvalExposureOnce(card, true, recallLatency, { pipeline: 'mcq', phase: 'recall' });
        }

        if (userInput) {
            userInput.disabled = true;
            userInput.classList.add('correct');
        }

        setTimeout(() => {
            if (feedbackMessage) feedbackMessage.textContent = '';
            moveCard(card, true, 'MultipleChoice', { format: 'recall', calibrationTruth: true, mcqStats: stats });
        }, 900);
        return;
    }

    state.mcqStats = stats;
    studyState.knowledgeStates?.set?.(card.id, { ...state, mcqStats: stats });

    if (userInput) {
        userInput.disabled = true;
        userInput.classList.add('incorrect');
    }
    if (feedbackMessage) {
        feedbackMessage.style.color = 'var(--text-color)';
        feedbackMessage.textContent = '';
    }

    await logInteraction({
        cardID: card.id,
        wasCorrect: false,
        userAnswer,
        correctAnswer,
        recallLatency,
        answerFluency,
        totalCorrections: 0,
        attemptCount: 1,
        questionType: 'MultipleChoice'
    });

    enterMcqRecognitionPhase(card);
}

function skipMcqRecallAttempt() {
    const card = getActiveCard();
    if (!card || !studyState.mcqPipeline || studyState.mcqPipeline.cardId !== card.id) {
        return dontKnowAnswer();
    }

    const deckIdForThisCard = card.deckId || currentDeckId;
    getOrCreateKnowledgeState('default_user', card.id, deckIdForThisCard).then(state => {
        const stats = ensureMcqStats(state?.mcqStats);
        stats.attempts += 1;
        stats.recallAttempts += 1;
        stats.lastUpdated = Date.now();
        state.mcqStats = stats;
        studyState.knowledgeStates?.set?.(card.id, { ...state, mcqStats: stats });
        studyState.mcqPipeline.recallWasCorrect = false;
        enterMcqRecognitionPhase(card);
    }).catch(() => enterMcqRecognitionPhase(card));
}

function displayMCQButtons(options, correctCard) {
    const optionsContainer = document.getElementById('mcqOptions');
    if (!optionsContainer) return;
    optionsContainer.innerHTML = '';
    optionsContainer.classList.remove('hidden');

    options.forEach((optionText, index) => {
        const button = document.createElement('button');
        button.className = 'btn btn-secondary';
        button.textContent = optionText;
        button.dataset.testid = `mcq-option-${index}`;
        button.onclick = () => handleMcqOptionSelected(optionText, correctCard);
        optionsContainer.appendChild(button);
    });
}

function displayRemediationButtons(options, task) {
    const optionsContainer = document.getElementById('mcqOptions');
    if (!optionsContainer) return;
    optionsContainer.innerHTML = '';
    optionsContainer.classList.remove('hidden');

    options.forEach((optionText, index) => {
        const button = document.createElement('button');
        button.className = 'btn btn-secondary';
        button.textContent = optionText;
        button.dataset.testid = `mcq-option-${index}`;
        button.onclick = () => handleRemediationOptionSelected(optionText, task);
        optionsContainer.appendChild(button);
    });
}

function renderLureRemediation(task) {
    if (!task) return false;
    const remediationState = ensureMcqRemediationState();
    remediationState.activeTask = task;
    remediationState.cooldownUntil = Date.now() + remediationState.cooldownMs;
    if (remediationState.queue.length > 0) {
        setRemediationDelay(remediationState);
    }

    const options = Array.from(new Set([task.correct, task.lure].map(opt => String(opt || '').trim())))
        .filter(Boolean);
    if (options.length < 2) {
        remediationState.activeTask = null;
        return false;
    }

    document.getElementById('mcqView').classList.remove('hidden');
    const simpleButtons = document.getElementById('simpleAnswerButtons');
    if (simpleButtons) simpleButtons.classList.add('hidden');

    const mcqQEl = document.getElementById('mcqQuestion');
    if (mcqQEl) {
        const card = findCardById(task.cardId);
        const prompt = 'Which answer is correct?';
        mcqQEl.textContent = card?.question ? `${prompt} ${card.question}` : prompt;
    }

    const feedbackMessage = document.getElementById('feedbackMessage');
    if (feedbackMessage) feedbackMessage.innerHTML = '';

    displayRemediationButtons(shuffleArray(options), task);
    startInteractionLog(task.cardId);
    return true;
}

async function handleRemediationOptionSelected(optionText, task) {
    const remediationState = ensureMcqRemediationState();
    if (!task || remediationState.activeTask !== task) return;

    const optionsContainer = document.getElementById('mcqOptions');
    optionsContainer?.querySelectorAll?.('button')?.forEach(btn => btn.disabled = true);

    const correctAnswer = String(task.correct || '').trim();
    const chosen = String(optionText || '').trim();
    const isCorrect = chosen === correctAnswer;
    const responseLatency = (typeof currentInteractionLog?.questionLoadTime === 'number')
        ? Math.round(performance.now() - currentInteractionLog.questionLoadTime)
        : null;

    const card = findCardById(task.cardId) || { id: task.cardId, deckId: currentDeckId };
    const deckIdForThisCard = card.deckId || currentDeckId;
    const state = await getOrCreateKnowledgeState('default_user', task.cardId, deckIdForThisCard);
    const stats = ensureMcqStats(state?.mcqStats);
    const nowMs = Date.now();

    applyRemediationOutcome(stats, isCorrect, nowMs);

    state.mcqStats = stats;
    studyState.knowledgeStates?.set?.(task.cardId, { ...state, mcqStats: stats });

    const buttons = Array.from(optionsContainer?.querySelectorAll?.('button') || []);
    buttons.forEach(btn => {
        const text = String(btn.textContent || '').trim();
        if (text === chosen) {
            btn.classList.remove('btn-secondary');
            btn.classList.add(isCorrect ? 'btn-success' : 'btn-danger');
        }
        if (!isCorrect && text === correctAnswer) {
            btn.classList.remove('btn-secondary');
            btn.classList.add('btn-success');
        }
    });

    const feedbackMessage = document.getElementById('feedbackMessage');
    if (feedbackMessage) {
        const safeCorrect = escapeHtml(correctAnswer);
        const refutation = getMcqRefutation(card, task.lureKey);
        feedbackMessage.style.color = 'var(--text-color)';
        if (refutation) {
            feedbackMessage.innerHTML = `${escapeHtml(refutation)}<br><strong>The correct answer is:</strong> <span style="color:var(--deck-accent)">${safeCorrect}</span>`;
        } else {
            feedbackMessage.innerHTML = `<strong>The correct answer is:</strong> <span style="color:var(--deck-accent)">${safeCorrect}</span>`;
        }
    }

    await logInteraction({
        cardID: task.cardId,
        wasCorrect: isCorrect,
        userAnswer: chosen,
        correctAnswer,
        recallLatency: responseLatency,
        answerFluency: 0,
        totalCorrections: 0,
        attemptCount: 1,
        questionType: 'MultipleChoice'
    });

    try {
        const interactionLog = {
            ...currentInteractionLog,
            recallLatency: responseLatency,
            answerFluency: 0,
            totalCorrections: 0,
            attemptCount: 1,
            questionType: 'MultipleChoice'
        };
        await applyFsrsReviewUpdate(
            card,
            deckIdForThisCard,
            isCorrect,
            interactionLog,
            0.5,
            {
                format: 'mcq',
                subformat: 'remediation',
                calibrationTruth: true,
                mcqStats: stats,
                questionType: 'MultipleChoice'
            }
        );
        const deck = decks[deckIdForThisCard];
        if (deck) {
            await saveDataToDB('decks', deck);
        }
    } catch (error) {
        console.warn('[MCQ] Remediation update failed', error);
        await upsertKnowledgeState({ ...state, mcqStats: stats });
    }

    if (!isCorrect) {
        const requeue = {
            ...task,
            attempts: (task.attempts || 0) + 1,
            createdAt: Date.now()
        };
        const exists = remediationState.queue.some(item => item.cardId === requeue.cardId && item.lureKey === requeue.lureKey);
        if (!exists) {
            remediationState.queue.push(requeue);
            if (remediationState.queue.length > remediationState.maxQueue) {
                remediationState.queue.splice(0, remediationState.queue.length - remediationState.maxQueue);
            }
        }
        setRemediationDelay(remediationState, 1, 3);
    }

    setTimeout(() => {
        if (feedbackMessage) feedbackMessage.innerHTML = '';
        remediationState.activeTask = null;
        showNextCard();
    }, 1500);
}

async function handleMcqOptionSelected(optionText, correctCard) {
    const card = correctCard || getActiveCard();
    if (!card) return;
    const optionsContainer = document.getElementById('mcqOptions');
    optionsContainer?.querySelectorAll?.('button')?.forEach(btn => btn.disabled = true);

    const correctAnswer = String(card.answer || '').trim();
    const chosen = String(optionText || '').trim();
    const isCorrect = chosen === correctAnswer;
    const responseLatency = (typeof currentInteractionLog?.questionLoadTime === 'number')
        ? Math.round(performance.now() - currentInteractionLog.questionLoadTime)
        : null;
    const pipeline = studyState.mcqPipeline && studyState.mcqPipeline.cardId === card.id
        ? studyState.mcqPipeline
        : null;
    const recallWasCorrect = pipeline ? pipeline.recallWasCorrect : null;
    const recallAttempted = pipeline ? pipeline.recallWasCorrect !== null : false;

    const deckIdForThisCard = card.deckId || currentDeckId;
    const state = await getOrCreateKnowledgeState('default_user', card.id, deckIdForThisCard);
    const stats = ensureMcqStats(state?.mcqStats);
    const nowMs = Date.now();

    stats.mcqAttempts += 1;
    if (isCorrect) {
        stats.mcqCorrect += 1;
        stats.lastLureKey = null;
    } else {
        const lureKey = normalizeMcqOptionKey(chosen);
        stats.lureCounts[lureKey] = (stats.lureCounts[lureKey] || 0) + 1;
        stats.lastLureKey = lureKey;
        enqueueLureRemediation(card, correctAnswer, chosen, lureKey);
    }
    stats.lastUpdated = nowMs;

    if (studyState.mcqPipeline && studyState.mcqPipeline.cardId === card.id && studyState.mcqPipeline.recallWasCorrect === false) {
        const ema = Number.isFinite(stats.recognitionDependenceEma) ? stats.recognitionDependenceEma : 0.0;
        const alpha = isCorrect ? 0.18 : 0.22;
        stats.recognitionDependenceEma = Math.max(0, Math.min(1, (ema * (1 - alpha)) + alpha));
    }

    state.mcqStats = stats;
    studyState.knowledgeStates?.set?.(card.id, { ...state, mcqStats: stats });

    const buttons = Array.from(optionsContainer?.querySelectorAll?.('button') || []);
    buttons.forEach(btn => {
        const text = String(btn.textContent || '').trim();
        if (text === chosen) {
            btn.classList.remove('btn-secondary');
            btn.classList.add(isCorrect ? 'btn-success' : 'btn-danger');
        }
        if (!isCorrect && text === correctAnswer) {
            btn.classList.remove('btn-secondary');
            btn.classList.add('btn-success');
        }
    });

    const feedbackMessage = document.getElementById('feedbackMessage');
    if (feedbackMessage) {
        const safeCorrect = escapeHtml(correctAnswer);
        if (!isCorrect) {
            feedbackMessage.style.color = 'var(--text-color)';
            const refutation = getMcqRefutation(card, chosen);
            if (refutation) {
                feedbackMessage.innerHTML = `${escapeHtml(refutation)}<br><strong>The correct answer is:</strong> <span style="color:var(--deck-accent)">${safeCorrect}</span>`;
            } else {
                feedbackMessage.innerHTML = `Incorrect. <strong>The correct answer is:</strong> <span style="color:var(--deck-accent)">${safeCorrect}</span>`;
            }
        } else {
            feedbackMessage.style.color = 'var(--deck-accent)';
            const explanation = getMcqExplanation(card);
            if (explanation) {
                feedbackMessage.innerHTML = `Correct. <strong>${safeCorrect}</strong><br>${escapeHtml(explanation)}`;
            } else {
                feedbackMessage.innerHTML = `Correct. <strong>${safeCorrect}</strong>`;
            }
        }
    }

    await logInteraction({
        cardID: card.id,
        wasCorrect: isCorrect,
        userAnswer: chosen,
        correctAnswer,
        recallLatency: responseLatency,
        answerFluency: 0,
        totalCorrections: 0,
        attemptCount: 1,
        questionType: 'MultipleChoice'
    });

    if (currentMode === 'learn' && optionsContainer) {
        optionsContainer.innerHTML = '';
    }

    const { shouldLogMcqExposure } = await getEvalExposureDedupeModule();
    if (shouldLogMcqExposure('recognition', recallWasCorrect)) {
        await logEvalExposureOnce(card, isCorrect, responseLatency, {
            pipeline: 'mcq',
            phase: 'recognition',
            recallAttempted,
            recallWasCorrect
        });
    }

    setTimeout(() => {
        if (feedbackMessage) feedbackMessage.innerHTML = '';
        moveCard(card, isCorrect, 'MultipleChoice', { format: 'mcq', calibrationTruth: true, mcqStats: stats });
    }, 1500);
}

window.debugMcqPipelineSelfCheck = function () {
    const stats = createDefaultMcqStats();
    const clampValue = (value, min, max) => Math.min(max, Math.max(min, value));

    const boost = (s) => {
        const lureCounts = s.lureCounts && typeof s.lureCounts === 'object' ? s.lureCounts : {};
        const lureTotal = Object.values(lureCounts).reduce((sum, v) => sum + (Number.isFinite(Number(v)) ? Math.max(0, Number(v)) : 0), 0);
        const lureBoost = 1 + 0.10 * Math.min(6, lureTotal);
        const ema = Number.isFinite(Number(s.recognitionDependenceEma)) ? Math.max(0, Math.min(1, Number(s.recognitionDependenceEma))) : 0;
        const dependenceBoost = 1 + 0.45 * ema;
        const attempts = Number.isFinite(Number(s.remediationAttempts)) ? Math.max(0, Number(s.remediationAttempts)) : 0;
        const correct = Number.isFinite(Number(s.remediationCorrect)) ? Math.max(0, Number(s.remediationCorrect)) : 0;
        const failureRate = attempts > 0 ? 1 - (correct / Math.max(1, attempts)) : 0;
        const remBoost = 1 + 0.35 * clampValue(failureRate, 0, 1);
        return lureBoost * dependenceBoost * remBoost;
    };

    let prevBoost = boost(stats);
    for (let i = 0; i < 5; i++) {
        stats.attempts += 1;
        stats.recallAttempts += 1;
        stats.mcqAttempts += 1;
        stats.mcqCorrect += 1;
        stats.recognitionDependenceEma = Math.max(0, Math.min(1, (stats.recognitionDependenceEma * (1 - 0.18)) + 0.18));
        stats.lastUpdated = Date.now();
        const nextBoost = boost(stats);
        console.assert(nextBoost >= prevBoost, 'Expected MCQ boost to be non-decreasing with repeated recognition-only success');
        prevBoost = nextBoost;
    }

    console.assert(stats.recognitionDependenceEma > 0, 'Expected recognitionDependenceEma to increase');
    console.assert(stats.mcqCorrect > 0 && stats.recallCorrect === 0, 'Expected mastery gate to block without recall success');

    const remediationState = ensureMcqRemediationState();
    const prevQueue = remediationState.queue.slice();
    const prevPending = remediationState.pendingSteps;
    const prevCooldown = remediationState.cooldownUntil;
    const prevActive = remediationState.activeTask;

    remediationState.queue = [];
    remediationState.pendingSteps = 0;
    remediationState.cooldownUntil = 0;
    remediationState.activeTask = null;

    enqueueLureRemediation({ id: 'mcq-debug-card', answer: 'Alpha' }, 'Alpha', 'Beta', 'beta');
    console.assert(remediationState.queue.length === 1, 'Expected remediation task to enqueue');

    remediationState.pendingSteps = 2;
    console.assert(!shouldShowRemediation(Date.now()), 'Expected remediation to be delayed');
    decrementRemediationDelay();
    decrementRemediationDelay();
    console.assert(shouldShowRemediation(Date.now()), 'Expected remediation to unlock within a few steps');

    const beforeRemBoost = boost(stats);
    applyRemediationOutcome(stats, false, Date.now());
    const afterRemBoost = boost(stats);
    console.assert(stats.remediationAttempts === 1, 'Expected remediationAttempts to increment');
    console.assert(stats.remediationCorrect === 0, 'Expected remediationCorrect to remain 0 after failure');
    console.assert(stats.recognitionDependenceEma > 0, 'Expected remediation failure to increase recognitionDependenceEma');
    console.assert(afterRemBoost > beforeRemBoost, 'Expected remediation failure to increase boost');

    const options = ['Correct', 'Lure A', 'Lure B', 'Lure C'];
    const lureCounts = { [normalizeMcqOptionKey('Lure B')]: 5 };
    const lureTallies = { 'Lure A': 0, 'Lure B': 0, 'Lure C': 0 };
    for (let i = 0; i < 200; i++) {
        const selection = selectPreferredMcqOptions(options, 'Correct', 3, lureCounts);
        selection.forEach(opt => {
            if (opt !== 'Correct' && lureTallies[opt] !== undefined) {
                lureTallies[opt] += 1;
            }
        });
    }
    console.assert(lureTallies['Lure B'] > lureTallies['Lure A'], 'Expected weighted lure to appear more often');
    console.assert(lureTallies['Lure B'] > lureTallies['Lure C'], 'Expected weighted lure to appear more often');

    remediationState.queue = prevQueue;
    remediationState.pendingSteps = prevPending;
    remediationState.cooldownUntil = prevCooldown;
    remediationState.activeTask = prevActive;

    stats.recallCorrect += 1;
    console.assert(!(stats.mcqCorrect > 0 && stats.recallCorrect === 0), 'Expected MCQ-only mastery gate to clear after recallCorrect >= 1');

    console.log('[MCQ Debug] Self-check passed', { stats, boost: prevBoost });
};

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
            if (detectCardType(card) === CARD_TYPES.CLOZE) return true;
            {
                const sourceText = card?.clozeText || card?.text || card?.question || '';
                const parsed = parseClozeText(sourceText);
                return parsed.clozes.length > 0 ||
                    sourceText.includes('___') ||
                    sourceText.includes('...');
            }
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
                apiPromise = fetch('/api/distractors', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
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
                apiPromise = fetch('/api/distractors', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
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

function closeCustomPromptModal() {
    const modal = document.getElementById('customPromptModal');
    if (modal) modal.classList.remove('show');
}

async function saveCustomPrompt() {
    const textarea = document.getElementById('customPromptTextarea');
    if (!textarea) return;

    const prompt = textarea.value.trim();
    if (prompt) {
        globalSettings.customPrompt = prompt;
    } else {
        delete globalSettings.customPrompt;
    }
    await saveDataToDB('appData', { key: 'userSettings', ...globalSettings });
    closeCustomPromptModal();
    showToast('Custom prompt saved.', 'success');
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

        const adapterGenerateDeck = typeof window.generateDeckAdapter === 'function' ? window.generateDeckAdapter : null;

        if (adapterGenerateDeck) {
            console.log('[AI Generation] Using platform adapter');
            apiPromise = adapterGenerateDeck(payload);
        } else if (isElectron) {
            console.log('[AI Generation] Using Electron IPC');
            apiPromise = window.electronAPI.generateDeck(payload);
        } else {
            console.log('[AI Generation] Using server API');
            apiPromise = fetch('/api/generate', {
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

        if (generatedCards?.aiFallback) {
            const fallbackReason = generatedCards.fallbackReason;
            const message = fallbackReason
                ? `Gemini unavailable: ${fallbackReason}`
                : 'Gemini unavailable; generated a simplified fallback deck.';
            showToast(message, 'info', 6000);
        }

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
    } else if (cardsData && cardsData.cards) {
        cards = cardsData.cards;
        deckName = cardsData.deckName;
        deckNotes = cardsData.deckNotes;
        deckLanguage = cardsData.language || '';
        deckType = cardsData.type || deckType;
    } else if (cardsData && typeof cardsData === 'object' && !Array.isArray(cardsData)) {
        cards = cardsData.cards || [];
        deckName = cardsData.deckName;
        deckNotes = cardsData.deckNotes;
        deckLanguage = cardsData.language || '';
        deckType = cardsData.type || deckType;
    }

    listContainer.dataset.previewType = deckType || 'flashcard';
    listContainer.dataset.sequences = '';
    listContainer.dataset.cards = JSON.stringify(cards);
    if (deckName) {
        listContainer.dataset.deckName = deckName;
    }
    if (deckNotes) {
        listContainer.dataset.deckNotes = deckNotes;
    }
    listContainer.dataset.language = deckLanguage || '';
    listContainer.dataset.deckType = deckType || 'flashcard';

    if (deckType === 'sequence' && cardsData && cardsData.sequences) {
        listContainer.dataset.sequences = JSON.stringify(cardsData.sequences);
        listContainer.innerHTML = '';
        const sequences = cardsData.sequences;
        if (!sequences.length) {
            const empty = document.createElement('div');
            empty.className = 'list-empty-state';
            empty.textContent = 'No sequences generated.';
            listContainer.appendChild(empty);
            return;
        }
        sequences.forEach((seq, seqIndex) => {
            const wrapper = document.createElement('div');
            wrapper.className = 'generated-sequence';
            wrapper.style.border = '1px solid var(--border-color)';
            wrapper.style.borderRadius = '10px';
            wrapper.style.padding = '12px 14px';
            wrapper.style.marginBottom = '12px';

            const heading = document.createElement('div');
            heading.style.fontWeight = '700';
            heading.style.display = 'flex';
            heading.style.justifyContent = 'space-between';
            heading.textContent = `${seq.title || `Sequence ${seqIndex + 1}`}`;

            const stepsList = document.createElement('ol');
            stepsList.style.paddingLeft = '20px';
            (seq.steps || []).forEach(step => {
                const li = document.createElement('li');
                li.textContent = typeof step === 'string' ? step : (step.text || step.question || '');
                if (step.notes) {
                    const note = document.createElement('div');
                    note.style.color = 'var(--secondary-text)';
                    note.style.fontSize = '0.9rem';
                    note.textContent = step.notes;
                    li.appendChild(note);
                }
                stepsList.appendChild(li);
            });

            wrapper.appendChild(heading);
            wrapper.appendChild(stepsList);
            listContainer.appendChild(wrapper);
        });
        const heading = document.getElementById('flashcard-count');
        heading.textContent = `Generated Sequences (${cardsData.sequences.length})`;
        return;
    }

    cards = cards.filter(card => !card?._isSequence);

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
    });

    const heading = document.getElementById('flashcard-count');
    heading.textContent = `Generated Flashcards (${cards.length})`;
}

function deleteGeneratedCard(index) {
    const listContainer = document.getElementById('flashcard-list');
    if (listContainer.dataset.previewType === 'sequence') {
        return;
    }
    const cards = JSON.parse(listContainer.dataset.cards);
    cards.splice(index, 1);
    renderAiGeneratedCards(cards);
}

async function saveAiGeneratedDeck() {
    const listContainer = document.getElementById('flashcard-list');
    const previewType = listContainer.dataset.previewType || 'flashcard';
    const cards = listContainer.dataset.cards ? JSON.parse(listContainer.dataset.cards) : [];
    // Use the deckName from the dataset if available, otherwise fallback to doc name or default
    const aiDeckName = listContainer.dataset.deckName;
    const aiDeckNotes = listContainer.dataset.deckNotes || '';
    const deckName = aiDeckName || (documentsForAi.length > 0 ? documentsForAi[0].name.split('.')[0] : "New AI Deck");

    if (previewType === 'sequence') {
        const sequences = listContainer.dataset.sequences ? JSON.parse(listContainer.dataset.sequences) : [];
        if (!sequences.length) {
            showToast("There are no sequences to save.", "error");
            return;
        }
        const converted = convertExternalSequenceJson({ title: deckName, sequences });
        await createNewDeck(deckName, 'Other', converted.cards, aiDeckNotes, 'Sequence', { sequenceMeta: converted.sequenceMeta });
        showToast(`Deck "${deckName}" created successfully!`, 'success');
        backToDashboard();
        return;
    }

    if (cards.length === 0) {
        showToast("There are no cards to save.", "error");
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

function hideStandardStudyControlsForSequence() {
    document.getElementById('flashcardViewContainer')?.classList.add('hidden');
    document.getElementById('mcqView')?.classList.add('hidden');
    document.getElementById('simpleAnswerButtons')?.classList.add('hidden');
    document.getElementById('spacedRatingButtons')?.classList.add('hidden');
    document.getElementById('writeAnswerInput')?.classList.add('hidden');
}

function getCardMasteryScore(card, knowledgeMap) {
    if (!knowledgeMap) return 0;
    const state = knowledgeMap.get(card.id);
    if (!state) return 0;
    if (typeof state.masteryScore === 'number') return state.masteryScore;
    const retention = calculateRetentionAtDate(state, new Date());
    return Number.isFinite(retention) ? retention : 0;
}

function computeSequenceMasteries(deck, knowledgeMap) {
    const groups = buildSequenceGroups(deck.cards || [], deck.sequenceMeta || {});
    return groups.map(group => {
        const scores = group.steps.map(card => getCardMasteryScore(card, knowledgeMap));
        const average = scores.length ? (scores.reduce((a, b) => a + b, 0) / scores.length) : 0;
        return { sequenceId: group.sequenceId, title: group.title, average };
    });
}

function computeSequenceMasteriesFromGroups(groups, knowledgeMap) {
    const safeGroups = Array.isArray(groups) ? groups : [];
    return safeGroups.map(group => {
        const steps = Array.isArray(group.steps) ? group.steps : [];
        const scores = steps.map(card => getCardMasteryScore(card, knowledgeMap));
        const average = scores.length ? (scores.reduce((a, b) => a + b, 0) / scores.length) : 0;
        return { sequenceId: group.sequenceId, title: group.title, average };
    });
}

function buildSequenceChunk(anchorCard, deck, settings) {
    const sequenceCards = (deck.cards || []).filter(c => c.sequenceId === anchorCard.sequenceId)
        .sort((a, b) => {
            const aIdx = typeof a.stepIndex === 'number' ? a.stepIndex : (a.order || 0);
            const bIdx = typeof b.stepIndex === 'number' ? b.stepIndex : (b.order || 0);
            return aIdx - bIdx;
        });
    const baseSize = settings.sequenceStartChunk || 4;
    const min = Math.max(1, settings.sequenceChunkMin || 2);
    const max = settings.sequenceChunkMax || baseSize;
    const windowSize = Math.min(max, Math.max(min, baseSize));
    let anchorIndex = sequenceCards.findIndex(c => c.id === anchorCard.id);
    if (anchorIndex < 0) anchorIndex = 0;
    let start = Math.max(0, anchorIndex - Math.floor(windowSize / 2));
    let end = Math.min(sequenceCards.length, start + windowSize);
    if (end - start < windowSize) {
        start = Math.max(0, end - windowSize);
    }
    const chunk = sequenceCards.slice(start, end);
    const anchorInChunk = chunk.findIndex(c => c.id === anchorCard.id);
    return { chunk, anchorIndex: anchorInChunk >= 0 ? anchorInChunk : 0, startIndex: start };
}

function pickSequenceAnchor(deck, knowledgeMap, session) {
    const masteryBySequence = computeSequenceMasteries(deck, knowledgeMap);
    const threshold = deck.settings?.sequenceMixingThreshold || DEFAULT_DECK_SETTINGS.sequenceMixingThreshold || 0.8;
    const allowMixed = deck.settings?.sequenceAllowMixed !== false;
    const belowThreshold = masteryBySequence.filter(seq => seq.average < threshold);

    if (allowMixed && !belowThreshold.length) {
        session.mixed = true;
    }
    const targetSequences = session.mixed ? masteryBySequence : (belowThreshold.length ? belowThreshold : masteryBySequence);
    const targetIds = new Set(targetSequences.map(seq => seq.sequenceId));
    const candidates = (deck.cards || []).filter(c => targetIds.has(c.sequenceId));
    if (!candidates.length) return null;
    candidates.sort((a, b) => getCardMasteryScore(a, knowledgeMap) - getCardMasteryScore(b, knowledgeMap));
    return candidates[0];
}

async function ensureSequenceGraphForSequence(session, deckId, sequenceId, steps) {
    const module = await getSequenceGraphModule();
    const cacheKey = `${String(deckId)}:${String(sequenceId || 'default')}`;
    const cached = session?.sequenceGraphs?.get ? session.sequenceGraphs.get(cacheKey) : null;
    if (cached) {
        const ensured = module.ensureGraphUpToDate(cached, steps);
        if (ensured !== cached && session?.sequenceGraphs?.set) {
            session.sequenceGraphs.set(cacheKey, ensured);
        }
        return ensured;
    }

    const cardID = getSequenceGraphCardId(deckId, sequenceId);
    const stored = await getDataFromDB('userKnowledgeState', `default_user:${cardID}`);
    const ensured = module.ensureGraphUpToDate(stored?.sequenceGraph, steps);
    if (!stored || stored.sequenceGraph !== ensured) {
        const nowISO = new Date().toISOString();
        const record = prepareKnowledgeRecord({
            userID: 'default_user',
            cardID,
            deckID: deckId,
            sequenceId: String(sequenceId || 'default'),
            kind: 'sequenceGraph',
            sequenceGraph: ensured,
            masteryScore: stored?.masteryScore ?? 0.5,
            fsrs: null,
            lastModified: nowISO,
            updatedAt: nowISO
        });
        if (record) await saveDataToDB('userKnowledgeState', record);
    }
    if (session?.sequenceGraphs?.set) session.sequenceGraphs.set(cacheKey, ensured);
    return ensured;
}

function sliceSequenceWindow(steps, startIndex, endIndex) {
    const safeSteps = Array.isArray(steps) ? steps : [];
    const start = Math.max(0, Math.min(safeSteps.length, startIndex));
    const end = Math.max(start, Math.min(safeSteps.length, endIndex));
    return { chunk: safeSteps.slice(start, end), startIndex: start };
}

function buildCenteredWindow(steps, centerIndex, desiredSize) {
    const safeSteps = Array.isArray(steps) ? steps : [];
    const size = Math.max(2, Math.min(safeSteps.length, desiredSize));
    const center = Math.max(0, Math.min(safeSteps.length - 1, centerIndex));
    let start = Math.max(0, center - Math.floor(size / 2));
    let end = Math.min(safeSteps.length, start + size);
    if (end - start < size) start = Math.max(0, end - size);
    return sliceSequenceWindow(safeSteps, start, end);
}

function computeAdaptiveOrderWindow(module, graph, steps, fromIndex, toIndex, opts = {}) {
    const safeSteps = Array.isArray(steps) ? steps : [];
    const baseSize = Number.isFinite(Number(opts.baseSize)) ? Number(opts.baseSize) : 5;
    const capSize = Number.isFinite(Number(opts.capSize)) ? Number(opts.capSize) : 8;
    const expandThreshold = Number.isFinite(Number(opts.expandThreshold)) ? Number(opts.expandThreshold) : 0.65;
    let left = Math.max(0, Math.min(safeSteps.length - 1, Math.min(fromIndex, toIndex)));
    let right = Math.max(0, Math.min(safeSteps.length - 1, Math.max(fromIndex, toIndex)));

    while ((right - left + 1) < Math.min(baseSize, safeSteps.length)) {
        if (left > 0) left -= 1;
        if ((right - left + 1) >= Math.min(baseSize, safeSteps.length)) break;
        if (right < safeSteps.length - 1) right += 1;
        if (left === 0 && right === safeSteps.length - 1) break;
    }

    while ((right - left + 1) < Math.min(capSize, safeSteps.length)) {
        const canExpandLeft = left > 0;
        const canExpandRight = right < safeSteps.length - 1;
        if (!canExpandLeft && !canExpandRight) break;

        const leftEdgeKey = canExpandLeft ? module.edgeKeyFor(safeSteps, left - 1, left) : null;
        const rightEdgeKey = canExpandRight ? module.edgeKeyFor(safeSteps, right, right + 1) : null;
        const leftEma = leftEdgeKey ? Number(graph?.edges?.[leftEdgeKey]?.ema ?? 0.5) : 1;
        const rightEma = rightEdgeKey ? Number(graph?.edges?.[rightEdgeKey]?.ema ?? 0.5) : 1;
        const shouldExpandLeft = canExpandLeft && leftEma < expandThreshold;
        const shouldExpandRight = canExpandRight && rightEma < expandThreshold;

        if (!shouldExpandLeft && !shouldExpandRight) break;
        if (shouldExpandLeft) left -= 1;
        if ((right - left + 1) >= Math.min(capSize, safeSteps.length)) break;
        if (shouldExpandRight) right += 1;
        if (left === 0 && right === safeSteps.length - 1) break;
    }

    return sliceSequenceWindow(safeSteps, left, right + 1);
}

async function startSequenceMode(deckId) {
    let deck = decks[deckId];
    if (!deck) {
        showToast('Deck not found.', 'error');
        return;
    }
    if (deck.typeHint !== 'Sequence') {
        if (!window.sequenceStepUtils) {
            try {
                await import('../core/sequence-utils.js');
            } catch (error) {
                console.warn('Failed to load sequence utilities', error);
            }
        }
        const adapter = window.sequenceStepUtils?.adaptLegacySequenceDeck;
        if (typeof adapter === 'function') {
            const adapted = adapter(deck);
            if (adapted?.deck && Array.isArray(adapted.cards) && adapted.cards.length >= 2) {
                const updatedCards = adapted.cards.map(card => ({
                    ...card,
                    deckId: card.deckId || deck.id
                }));
                deck = {
                    ...deck,
                    ...adapted.deck,
                    id: deck.id,
                    cards: updatedCards
                };
                decks[deckId] = deck;
                await saveDataToDB('decks', deck);
            }
        }
    }
    if (deck.typeHint !== 'Sequence') {
        showToast('Sequence mode is only available for Sequence decks.', 'error');
        return;
    }
    if (deck.typeHint === 'Sequence') {
        const normalized = normalizeSequenceDeck(deck);
        if (normalized) {
            decks[deckId] = deck;
            await saveDataToDB('decks', deck);
        }
    }

    currentMode = 'sequence';
    currentDeckId = deckId;
    deck.settings = { ...DEFAULT_DECK_SETTINGS, ...(deck.settings || {}) };
    studyState.settings = deck.settings;
    studyAccentModule?.refresh();

    const knowledgeMap = await buildDeckKnowledgeMap(deck);
    studyState.knowledgeStates = knowledgeMap;
    studyState.sequenceSession = {
        deckId,
        knowledgeMap,
        taskCursor: 0,
        incorrectQueue: [],
        mixed: false,
        currentTask: null,
        sequenceGroups: null,
        sequenceStepsById: null,
        sequenceGraphs: new Map(),
        recentEdges: [],
        accuracyLog: [],
        totalAttempts: 0
    };
    studyState.sequenceSession.sequenceGroups = buildSequenceGroups(deck.cards || [], deck.sequenceMeta || {});
    studyState.sequenceSession.sequenceStepsById = new Map(
        (studyState.sequenceSession.sequenceGroups || []).map(group => [group.sequenceId, group.steps])
    );
    studyState.sequenceAccuracy = [];
    studyState.startTime = new Date();

    resetSessionState();
    transitionView('studyMode');
    resetStudySubViews();
    document.getElementById('studyTitle').textContent = 'Sequence Mode';
    document.getElementById('studySubtitle').textContent = deck.name;
    transitionSubView(null, document.getElementById('cardView'));
    hideStandardStudyControlsForSequence();
    document.getElementById('sequenceTaskView')?.classList.remove('hidden');
    await continueSequenceTask();
}

function renderOrderTask(task) {
    const body = document.getElementById('sequenceTaskBody');
    const shuffled = shuffleArray([...task.chunk]);
    const list = document.createElement('div');
    list.id = 'sequenceOrderList';
    list.className = 'sequence-order-list';

    shuffled.forEach(card => {
        const cardId = String(card.id);
        const row = document.createElement('div');
        row.className = 'sequence-order-item';
        row.dataset.cardId = cardId;
        row.dataset.testid = `sequence-order-item-${cardId}`;
        const text = document.createElement('div');
        text.className = 'sequence-order-text';
        text.textContent = card.question || '';
        const actions = document.createElement('div');
        actions.className = 'sequence-order-actions';
        const up = document.createElement('button');
        up.className = 'btn btn-secondary sequence-move-btn';
        up.textContent = '↑';
        up.dataset.testid = `sequence-order-up-${cardId}`;
        up.onclick = () => reorderSequenceOrderItem(row, -1);
        const down = document.createElement('button');
        down.className = 'btn btn-secondary sequence-move-btn';
        down.textContent = '↓';
        down.dataset.testid = `sequence-order-down-${cardId}`;
        down.onclick = () => reorderSequenceOrderItem(row, 1);
        actions.appendChild(up);
        actions.appendChild(down);
        row.appendChild(text);
        row.appendChild(actions);
        list.appendChild(row);
    });

    body.appendChild(list);
}

function reorderSequenceOrderItem(item, direction) {
    if (!item) return;
    const parent = item.parentElement;
    if (!parent) return;
    const siblings = Array.from(parent.children);
    const index = siblings.indexOf(item);
    const targetIndex = index + direction;
    if (targetIndex < 0 || targetIndex >= siblings.length) return;
    const target = siblings[targetIndex];
    if (direction < 0) {
        parent.insertBefore(item, target);
    } else {
        parent.insertBefore(item, target.nextSibling);
    }
}

function bindSequenceTaskInputShortcuts(element) {
    if (!element) return;
    element.addEventListener('keydown', (event) => {
        if (event.key !== 'Enter' || event.shiftKey) return;
        const submitBtn = document.getElementById('sequenceSubmitBtn');
        const continueBtn = document.getElementById('sequenceContinueBtn');
        if (submitBtn && !submitBtn.classList.contains('hidden')) {
            event.preventDefault();
            submitBtn.click();
            return;
        }
        if (continueBtn && !continueBtn.classList.contains('hidden')) {
            event.preventDefault();
            continueBtn.click();
        }
    });
}

function renderNextStepTask(task) {
    const body = document.getElementById('sequenceTaskBody');
    const anchorCard = task.chunk[task.anchorIndex] || task.chunk[0];
    const prompt = document.createElement('div');
    prompt.className = 'sequence-next-prompt';
    prompt.textContent = `Current step: ${anchorCard.question}`;
    const wrapper = document.createElement('div');
    wrapper.className = 'form-group sequence-form-group';
    const input = document.createElement('textarea');
    input.id = 'sequenceNextInput';
    input.className = 'sequence-next-input';
    input.placeholder = task.taskType === 'prev' ? 'Type the previous step...' : 'Type the next step...';
    body.appendChild(prompt);
    wrapper.appendChild(input);
    body.appendChild(wrapper);
    setActiveStudyInput(input);
    input.addEventListener('focus', () => setActiveStudyInput(input));
    bindSequenceTaskInputShortcuts(input);
}

function renderGapTask(task) {
    const body = document.getElementById('sequenceTaskBody');
    const fallbackIndex = Math.min(Math.max(1, Math.floor(task.chunk.length / 2)), task.chunk.length - 1);
    const missingIndex = Number.isFinite(Number(task.missingIndex)) ? Number(task.missingIndex) : fallbackIndex;
    task.missingIndex = missingIndex;
    const missingCard = task.chunk[missingIndex];
    const list = document.createElement('ol');
    list.className = 'sequence-gap-list';
    task.chunk.forEach((card, idx) => {
        const li = document.createElement('li');
        li.className = 'sequence-gap-item';
        if (idx === missingIndex) {
            li.textContent = '[blank]';
            li.classList.add('is-blank');
        } else {
            li.textContent = card.question;
        }
        list.appendChild(li);
    });
    const selectWrapper = document.createElement('div');
    selectWrapper.className = 'form-group sequence-form-group';
    const select = document.createElement('select');
    select.id = 'sequenceGapSelect';
    select.className = 'sequence-gap-select';
    const options = shuffleArray(task.chunk.map(c => c.question || ''));
    options.forEach(opt => {
        const option = document.createElement('option');
        option.value = opt;
        option.textContent = opt;
        select.appendChild(option);
    });
    body.appendChild(list);
    selectWrapper.appendChild(select);
    body.appendChild(selectWrapper);
    task.missingCardId = missingCard?.id;
    bindSequenceTaskInputShortcuts(select);
}

function renderSequenceTask(task) {
    const deck = decks[currentDeckId];
    const sequenceTitle = deck.sequenceMeta?.[task.sequenceId]?.title || task.chunk[0]?.sequenceTitle || deck.name;
    const titleEl = document.getElementById('sequenceTaskTitle');
    const subtitleEl = document.getElementById('sequenceTaskSubtitle');
    const body = document.getElementById('sequenceTaskBody');
    const feedbackEl = document.getElementById('sequenceTaskFeedback');
    const submitBtn = document.getElementById('sequenceSubmitBtn');
    const continueBtn = document.getElementById('sequenceContinueBtn');
    hideStandardStudyControlsForSequence();
    document.getElementById('sequenceTaskView')?.classList.remove('hidden');
    body.innerHTML = '';
    feedbackEl.innerHTML = '';
    feedbackEl.classList.add('hidden');
    submitBtn.classList.remove('hidden');
    continueBtn.classList.add('hidden');
    setActiveStudyInput(null);

    const minStep = Math.min(...task.chunk.map(c => typeof c.stepIndex === 'number' ? c.stepIndex : (c.order || 0)));
    const maxStep = Math.max(...task.chunk.map(c => typeof c.stepIndex === 'number' ? c.stepIndex : (c.order || 0)));
    if (titleEl) titleEl.textContent = sequenceTitle;
    if (subtitleEl) subtitleEl.textContent = `Steps ${minStep + 1}–${maxStep + 1} of "${sequenceTitle}"`;

    if (task.taskType === 'order') renderOrderTask(task);
    if (task.taskType === 'next' || task.taskType === 'prev') renderNextStepTask(task);
    if (task.taskType === 'gap') renderGapTask(task);
    task.renderedAt = performance.now();
}

async function prepareSequenceTask() {
    const deck = decks[currentDeckId];
    if (!deck || deck.typeHint !== 'Sequence') return;
    const session = studyState.sequenceSession;
    if (!session) return;
    const knowledgeMap = session.knowledgeMap || studyState.knowledgeStates || new Map();

    const groups = Array.isArray(session.sequenceGroups)
        ? session.sequenceGroups
        : buildSequenceGroups(deck.cards || [], deck.sequenceMeta || {});
    if (!session.sequenceGroups) {
        session.sequenceGroups = groups;
        session.sequenceStepsById = new Map((groups || []).map(group => [group.sequenceId, group.steps]));
    }

    let forcedSequenceId = null;
    if (session.incorrectQueue.length) {
        const forcedCard = session.incorrectQueue.shift();
        forcedSequenceId = forcedCard?.sequenceId || null;
    }

    let best = null;
    try {
        const graphModule = await getSequenceGraphModule();
        const masteryBySequence = computeSequenceMasteriesFromGroups(groups, knowledgeMap);
        const threshold = deck.settings?.sequenceMixingThreshold || DEFAULT_DECK_SETTINGS.sequenceMixingThreshold || 0.8;
        const allowMixed = deck.settings?.sequenceAllowMixed !== false;
        const belowThreshold = masteryBySequence.filter(seq => seq.average < threshold);
        if (allowMixed && !belowThreshold.length) session.mixed = true;
        const targetSequences = session.mixed ? masteryBySequence : (belowThreshold.length ? belowThreshold : masteryBySequence);
        const candidateIds = forcedSequenceId
            ? [forcedSequenceId]
            : targetSequences.map(seq => seq.sequenceId).filter(Boolean);

        const nowMs = Date.now();
        for (const sequenceId of candidateIds) {
            const steps = session.sequenceStepsById?.get ? session.sequenceStepsById.get(sequenceId) : null;
            if (!Array.isArray(steps) || steps.length < 2) continue;
            const graph = await ensureSequenceGraphForSequence(session, deck.id, sequenceId, steps);
            const pick = graphModule.pickWeakEdge(graph, steps, session.recentEdges, nowMs, {
                minCandidates: 3,
                recencyHalfLifeMs: 10 * 60 * 1000,
                avoidRecentMs: 90 * 1000,
                weightCascade: 0.25
            });
            if (!pick) continue;
            if (!best || pick.score > best.pick.score) {
                best = { sequenceId, steps, graph, pick };
            }
        }

        if (best) {
            const edgeRec = best.graph?.edges?.[best.pick.edgeKey] || null;
            const edgeEma = Number.isFinite(Number(edgeRec?.ema)) ? Number(edgeRec.ema) : 0.5;
            let taskType = null;
            if (edgeEma < 0.45) {
                taskType = (session.taskCursor % 2 === 0) ? 'next' : 'prev';
            } else if (edgeEma < 0.70) {
                taskType = 'gap';
            } else {
                taskType = 'order';
            }
            session.taskCursor += 1;

            const desiredRecallSize = 4;
            let chunk = [];
            let startIndex = 0;
            let anchorIndex = 0;
            let missingIndex = null;

            if (taskType === 'order') {
                const windowed = computeAdaptiveOrderWindow(
                    graphModule,
                    best.graph,
                    best.steps,
                    best.pick.fromIndex,
                    best.pick.toIndex,
                    { baseSize: 5, capSize: 8, expandThreshold: 0.65 }
                );
                chunk = windowed.chunk;
                startIndex = windowed.startIndex;
            } else if (taskType === 'gap') {
                const len = best.steps.length;
                let missingGlobal = best.pick.toIndex;
                if (missingGlobal <= 0 || missingGlobal >= len - 1) {
                    missingGlobal = best.pick.fromIndex;
                }
                missingGlobal = Math.min(Math.max(1, missingGlobal), len - 2);
                const windowed = buildCenteredWindow(best.steps, missingGlobal, 5);
                chunk = windowed.chunk;
                startIndex = windowed.startIndex;
                missingIndex = missingGlobal - startIndex;
            } else {
                const focusIndex = taskType === 'prev' ? best.pick.toIndex : best.pick.fromIndex;
                const start = Math.max(0, Math.min(focusIndex - 1, best.steps.length - desiredRecallSize));
                const windowed = sliceSequenceWindow(best.steps, start, start + desiredRecallSize);
                chunk = windowed.chunk;
                startIndex = windowed.startIndex;
                anchorIndex = focusIndex - startIndex;
            }

            if (!chunk.length) {
                throw new Error('Sequence chunk generation failed');
            }

            if (taskType === 'next' && anchorIndex >= chunk.length - 1 && chunk.length > 1) {
                anchorIndex = chunk.length - 2;
            }
            if (taskType === 'prev' && anchorIndex <= 0 && chunk.length > 1) {
                anchorIndex = 1;
            }

            const currentTask = {
                taskType,
                chunk,
                sequenceId: best.sequenceId,
                anchorIndex,
                startIndex,
                targetEdge: best.pick
            };
            if (taskType === 'gap' && Number.isFinite(Number(missingIndex))) {
                currentTask.missingIndex = missingIndex;
            }
            session.currentTask = currentTask;
            renderSequenceTask(currentTask);
            return;
        }
    } catch (error) {
        console.warn('[Sequence] Falling back to legacy scheduler:', error);
    }

    const fallbackAnchor = pickSequenceAnchor(deck, knowledgeMap, session);
    if (!fallbackAnchor) {
        showToast('No more sequence steps to practice right now.', 'info');
        await endSession();
        return;
    }
    const { chunk, anchorIndex, startIndex } = buildSequenceChunk(fallbackAnchor, deck, deck.settings || DEFAULT_DECK_SETTINGS);
    const taskType = SEQUENCE_TASK_TYPES[session.taskCursor % SEQUENCE_TASK_TYPES.length];
    session.taskCursor += 1;
    const adjustedAnchorIndex = Math.min(anchorIndex, chunk.length - 1);
    const currentTask = {
        taskType,
        chunk,
        sequenceId: fallbackAnchor.sequenceId,
        anchorIndex: adjustedAnchorIndex,
        startIndex,
        targetEdge: null
    };
    if (taskType === 'next' && adjustedAnchorIndex >= chunk.length - 1 && chunk.length > 1) {
        currentTask.anchorIndex = chunk.length - 2;
    }
    session.currentTask = currentTask;
    renderSequenceTask(currentTask);
}

async function submitSequenceTask() {
    const session = studyState.sequenceSession;
    const deck = decks[currentDeckId];
    if (!session || !deck || !session.currentTask) return;
    const task = session.currentTask;
    const now = performance.now();
    const responseTimeMs = typeof task.renderedAt === 'number' ? Math.max(0, now - task.renderedAt) : null;
    const deckSettings = { ...DEFAULT_DECK_SETTINGS, ...(deck.settings || {}) };
    let result = null;

    if (task.taskType === 'order') {
        const orderItems = Array.from(document.querySelectorAll('#sequenceOrderList .sequence-order-item'));
        task.userOrderCardIds = orderItems.map(item => String(item.dataset.cardId ?? ''));
        const expected = [...task.chunk].sort((a, b) => {
            const aIdx = typeof a.stepIndex === 'number' ? a.stepIndex : (a.order || 0);
            const bIdx = typeof b.stepIndex === 'number' ? b.stepIndex : (b.order || 0);
            return aIdx - bIdx;
        });
        task.expectedOrderCardIds = expected.map(card => String(card.id));
        const byStep = orderItems.map((item, idx) => {
            const cardId = String(item.dataset.cardId ?? '');
            const correctCard = expected[idx];
            const correctCardId = correctCard ? String(correctCard.id) : '';
            const isCorrect = cardId === correctCardId;
            return {
                cardId,
                correct: isCorrect,
                userAnswer: item.querySelector('div')?.textContent || '',
                correctAnswer: correctCard?.question || '',
                questionType: 'Sequence:Order'
            };
        });
        const correctCount = byStep.filter(r => r.correct).length;
        result = { correctCount, total: byStep.length, byStep, expected };
    } else if (task.taskType === 'next' || task.taskType === 'prev') {
        const input = document.getElementById('sequenceNextInput');
        const userAnswer = (input?.value || '').trim();
        const anchorIdx = task.anchorIndex;
        const targetCard = task.taskType === 'prev'
            ? (task.chunk[anchorIdx - 1] || task.chunk[anchorIdx] || task.chunk[0])
            : (task.chunk[anchorIdx + 1] || task.chunk[anchorIdx] || task.chunk[0]);
        const correctAnswer = targetCard.question || '';
        const checkResult = checkAnswerForgivingly(userAnswer, correctAnswer, deckSettings);
        const isCorrect = checkResult.result === 'CORRECT' || checkResult.result === 'TYPO';
        result = {
            correctCount: isCorrect ? 1 : 0,
            total: 1,
            byStep: [{
                cardId: targetCard.id,
                correct: isCorrect,
                userAnswer,
                correctAnswer,
                questionType: task.taskType === 'prev' ? 'Sequence:Prev' : 'Sequence:Next'
            }],
            expected: [targetCard]
        };
    } else if (task.taskType === 'gap') {
        const select = document.getElementById('sequenceGapSelect');
        const chosen = select ? select.value : '';
        const missingCard = task.chunk[task.missingIndex] || task.chunk[0];
        const isCorrect = chosen === (missingCard.question || '');
        result = {
            correctCount: isCorrect ? 1 : 0,
            total: 1,
            byStep: [{
                cardId: missingCard.id,
                correct: isCorrect,
                userAnswer: chosen,
                correctAnswer: missingCard.question || '',
                questionType: 'Sequence:Gap'
            }],
            expected: [missingCard]
        };
    }

    if (!result) return;
    result.responseTimeMs = responseTimeMs;
    await recordSequenceResults(result);
}

async function recordSequenceResults(result) {
    const deck = decks[currentDeckId];
    const session = studyState.sequenceSession;
    if (!deck || !session) return;
    const responseTimeSec = typeof result.responseTimeMs === 'number' ? result.responseTimeMs / 1000 : null;
    const recallLatency = typeof result.responseTimeMs === 'number' ? Math.round(result.responseTimeMs) : null;
    const iqsScore = Number.isFinite(recallLatency)
        ? calculateIQS({ recallLatency, attemptCount: 1 }, getFsrsBaseline())
        : 0.5;
    const feedbackEl = document.getElementById('sequenceTaskFeedback');
    const submitBtn = document.getElementById('sequenceSubmitBtn');
    const continueBtn = document.getElementById('sequenceContinueBtn');
    const incorrectCards = [];

    const tasks = result.byStep.map(async step => {
        const stepCardId = String(step.cardId ?? '');
        const card = deck.cards.find(c => String(c.id) === stepCardId);
        if (!card) return;
        const interaction = {
            cardID: card.id,
            deckID: deck.id,
            wasCorrect: step.correct,
            userAnswer: step.userAnswer,
            correctAnswer: step.correctAnswer,
            questionType: step.questionType,
            responseTimeSec,
            recallLatency,
            attemptCount: 1
        };
        await logInteraction(interaction);
        await applyFsrsReviewUpdate(card, deck.id, step.correct, interaction, iqsScore, { questionType: step.questionType });
        if (!step.correct) incorrectCards.push(card);
    });
    await Promise.all(tasks);

    const currentTask = session.currentTask;
    if (currentTask && currentTask.sequenceId) {
        try {
            const graphModule = await getSequenceGraphModule();
            const steps = session.sequenceStepsById?.get
                ? session.sequenceStepsById.get(currentTask.sequenceId)
                : null;
            const sequenceSteps = Array.isArray(steps) && steps.length
                ? steps
                : ((Array.isArray(session.sequenceGroups)
                    ? session.sequenceGroups.find(group => group.sequenceId === currentTask.sequenceId)?.steps
                    : null) || []);
            if (sequenceSteps.length >= 2) {
                let graph = await ensureSequenceGraphForSequence(session, deck.id, currentTask.sequenceId, sequenceSteps);
                const nowMs = Date.now();
                const updatedEdgeKeys = [];

                if (currentTask.taskType === 'order' && Array.isArray(currentTask.userOrderCardIds)) {
                    const indexById = new Map(sequenceSteps.map((card, idx) => [String(card.id), idx]));
                    const expectedIds = Array.isArray(currentTask.expectedOrderCardIds) && currentTask.expectedOrderCardIds.length
                        ? currentTask.expectedOrderCardIds.map(id => String(id))
                        : [...currentTask.chunk].sort((a, b) => {
                            const aIdx = typeof a.stepIndex === 'number' ? a.stepIndex : (a.order || 0);
                            const bIdx = typeof b.stepIndex === 'number' ? b.stepIndex : (b.order || 0);
                            return aIdx - bIdx;
                        }).map(card => String(card.id));
                    const posById = new Map(currentTask.userOrderCardIds.map((id, idx) => [String(id), idx]));
                    for (let k = 0; k < expectedIds.length - 1; k += 1) {
                        const fromId = expectedIds[k];
                        const toId = expectedIds[k + 1];
                        const fromIndex = indexById.get(fromId);
                        const toIndex = indexById.get(toId);
                        if (!Number.isFinite(fromIndex) || !Number.isFinite(toIndex)) continue;
                        const edgeKey = graphModule.edgeKeyFor(sequenceSteps, fromIndex, toIndex);
                        const posFrom = posById.get(fromId);
                        const posTo = posById.get(toId);
                        const edgeCorrect = Number.isFinite(posFrom) && Number.isFinite(posTo) && (posFrom + 1 === posTo);
                        graph = graphModule.updateEdge(graph, edgeKey, edgeCorrect, nowMs, SEQUENCE_GRAPH_ALPHA);
                        updatedEdgeKeys.push(edgeKey);
                    }
                } else if (currentTask.taskType === 'next' || currentTask.taskType === 'prev' || currentTask.taskType === 'gap') {
                    const isCorrect = !!result.byStep?.[0]?.correct;
                    const promptState = {};
                    if (currentTask.taskType === 'next') {
                        promptState.fromIndex = currentTask.targetEdge?.fromIndex ?? (currentTask.startIndex + currentTask.anchorIndex);
                    } else if (currentTask.taskType === 'prev') {
                        promptState.toIndex = currentTask.targetEdge?.toIndex ?? (currentTask.startIndex + currentTask.anchorIndex);
                    } else if (currentTask.taskType === 'gap') {
                        promptState.missingIndex = currentTask.startIndex + currentTask.missingIndex;
                    }
                    const { edgeKeys, nodeKeys } = graphModule.deriveUpdatesFromTask(
                        currentTask.taskType,
                        sequenceSteps,
                        promptState,
                        result.byStep?.[0]?.userAnswer,
                        isCorrect
                    );
                    edgeKeys.forEach(edgeKey => {
                        graph = graphModule.updateEdge(graph, edgeKey, isCorrect, nowMs, SEQUENCE_GRAPH_ALPHA);
                        updatedEdgeKeys.push(edgeKey);
                    });
                    nodeKeys.forEach(nodeKey => {
                        graph = graphModule.updateNode(graph, nodeKey, isCorrect, nowMs, SEQUENCE_GRAPH_ALPHA);
                    });
                }

                if (updatedEdgeKeys.length) {
                    session.recentEdges = Array.isArray(session.recentEdges) ? session.recentEdges : [];
                    updatedEdgeKeys.forEach(edgeKey => session.recentEdges.push({ edgeKey, at: nowMs }));
                    if (session.recentEdges.length > 12) {
                        session.recentEdges.splice(0, session.recentEdges.length - 12);
                    }
                    const nowISO = new Date(nowMs).toISOString();
                    const cardID = getSequenceGraphCardId(deck.id, currentTask.sequenceId);
                    const record = prepareKnowledgeRecord({
                        userID: 'default_user',
                        cardID,
                        deckID: deck.id,
                        sequenceId: String(currentTask.sequenceId || 'default'),
                        kind: 'sequenceGraph',
                        sequenceGraph: graph,
                        masteryScore: 0.5,
                        fsrs: null,
                        lastModified: nowISO,
                        updatedAt: nowISO
                    });
                    if (record) await saveDataToDB('userKnowledgeState', record);
                    const cacheKey = `${String(deck.id)}:${String(currentTask.sequenceId || 'default')}`;
                    session.sequenceGraphs?.set?.(cacheKey, graph);
                }
            }
        } catch (error) {
            console.warn('[Sequence] Failed to update sequence graph:', error);
        }
    }

    const accuracy = result.total > 0 ? result.correctCount / result.total : 0;
    session.accuracyLog.push(accuracy);
    studyState.sequenceAccuracy.push(accuracy);
    session.totalAttempts += 1;

    if (incorrectCards.length) {
        session.incorrectQueue.push(...incorrectCards);
    }

    if (feedbackEl) {
        feedbackEl.classList.remove('hidden');
        feedbackEl.innerHTML = '';
        const mainFeedback = document.createElement('div');
        mainFeedback.className = 'sequence-task-feedback-main';
        const accuracyMetric = renderVisualMetric({ label: 'Accuracy', value: accuracy * 100, kind: 'accuracy' });
        accuracyMetric.classList.add('compact');
        mainFeedback.appendChild(accuracyMetric);
        feedbackEl.appendChild(mainFeedback);
        if (result.expected?.length && result.byStep.length > 1) {
            const orderText = result.expected.map(c => c.question).join(' → ');
            const orderFeedback = document.createElement('div');
            orderFeedback.className = 'sequence-task-feedback-order';
            orderFeedback.textContent = `Order: ${orderText}`;
            feedbackEl.appendChild(orderFeedback);
        }
    }
    if (submitBtn) submitBtn.classList.add('hidden');
    if (continueBtn) continueBtn.classList.remove('hidden');

    const knowledgeMap = studyState.knowledgeStates || session.knowledgeMap;
    if (knowledgeMap && Array.isArray(result.expected)) {
        result.expected.forEach(card => {
            const state = knowledgeMap.get(card.id) || knowledgeMap.get(String(card.id));
            if (state) {
                state.masteryScore = getCardMasteryScore(card, knowledgeMap);
            }
        });
    }
}

async function continueSequenceTask() {
    const submitBtn = document.getElementById('sequenceSubmitBtn');
    const continueBtn = document.getElementById('sequenceContinueBtn');
    if (submitBtn) submitBtn.classList.remove('hidden');
    if (continueBtn) continueBtn.classList.add('hidden');
    await prepareSequenceTask();
}

function setupDragDropView(chunk) {
    const list = document.getElementById('dragDropList');
    if (!list) return;
    const feedbackEl = document.getElementById('dragDropFeedback');
    if (feedbackEl) {
        feedbackEl.textContent = '';
        feedbackEl.className = 'drag-drop-feedback hidden';
    }
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
    renderMetricInto('deckMasteryValue', { label: 'Progress', value: progressPercent, kind: 'progress' }, ['compact']);
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
    setupEventListeners();
    updateOnlineStatusUI();

    loadCookieConsent();

    transitionView('dashboard', false, null, false);
    window.__APP_READY__ = true;
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
    return getGuestIdFromSession();
}

async function loadUserDataAndSync() {
    const allowSyncInTest = typeof window !== 'undefined' && window.__TEST_ALLOW_SYNC__ === true;
    if (isTestMode() && !allowSyncInTest) {
        await loadSavedData();
        return;
    }
    if (!isOnline) {
        console.log("Offline. Skipping sync.");
        await updateDashboard();
        return;
    }

    const devSyncToken = getDevSyncToken();
    const usingDevSyncToken = Boolean(devSyncToken);

    // Check for Auth0 session OR Guest Mode
    const savedSession = usingDevSyncToken ? null : getStoredSession();
    const isGuest = !usingDevSyncToken && !savedSession;

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

        if (usingDevSyncToken) {
            token = devSyncToken;
        } else if (savedSession) {
            token = getAuthTokenFromSession(savedSession);
            console.log('Auth session found for sync. Token present:', !!token);
            if (!token && savedSession && typeof savedSession === 'object') {
                console.warn('Session structure:', Object.keys(savedSession));
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

            if (syncResult.error === 'auth_error' || syncResult.statusCode === 401 || syncResult.status === 401) {
                throw new Error('Sync failed with status 401');
            }

            if (syncResult && syncResult.ok === false) {
                const syncError = new Error(syncResult.message || 'Sync failed');
                syncError.syncInfo = syncResult;
                throw syncError;
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
        const isDev = window.electronAPI?.isDev;
        if (isDev) {
            console.error('Sync Error:', error);
        }
        const syncInfo = error && error.syncInfo;
        if (usingDevSyncToken && (error.message.includes('401') || syncInfo?.error === 'auth_error' || syncInfo?.status === 401)) {
            showToast('Could not sync data. Working in offline mode.', 'error');
        } else if (error.message.includes('401') || syncInfo?.error === 'auth_error' || syncInfo?.status === 401) {
            showToast('Session expired. Logging out.', 'error');
            logout();
        } else if (syncInfo?.type === 'timeout' || error.name === 'AbortError') {
            showToast('Sync timed out. Data is saved locally.', 'info');
        } else if (syncInfo?.type === 'offline') {
            showToast('You are offline. Your data is stored locally and will sync when you reconnect.', 'warning');
        } else if (syncInfo?.type === 'http') {
            showToast(syncInfo.message || 'Server error occurred while syncing. Please try again later.', 'error');
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
        const response = await fetch('/api/public-curricula');
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

function toggleEditorView(deckType, deck = null) {
    const container = document.getElementById('flashcardsContainer');
    const existingStandardCards = Array.from(document.querySelectorAll('#editorView .flashcard-item')).map(el => ({
        question: el.querySelector('.question-input')?.value.trim() || '',
        answer: el.querySelector('.solution-input')?.value.trim() || '',
        questionImage: el.querySelector('.question-image-input')?.value.trim() || '',
        answerImage: el.querySelector('.answer-image-input')?.value.trim() || ''
    })).filter(card => card.question || card.answer || card.questionImage || card.answerImage);
    const existingSequences = collectSequenceEditorData(true);
    container.innerHTML = '';
    editorCardCounter = 0;
    destroySequenceSortables();

    const addBtn = document.querySelector('.add-question-btn');
    if (deckType === 'Sequence') {
        destroyStandardSortableInstance();
        addBtn.textContent = '+ Add Sequence';
        addBtn.onclick = () => editorAddSequence();
        const sourceDeck = deck && deck.typeHint === 'Sequence'
            ? deck
            : ((currentDeckId && decks[currentDeckId]?.typeHint === 'Sequence') ? decks[currentDeckId] : null);
        const sequencesFromDeck = sourceDeck ? buildSequenceGroups(sourceDeck.cards || [], sourceDeck.sequenceMeta || {}) : [];
        const sequencesToRender = sequencesFromDeck.length ? sequencesFromDeck : (existingSequences.length ? existingSequences : []);
        if (sequencesToRender.length) {
            sequencesToRender.forEach(seq => editorAddSequence({
                sequenceId: seq.sequenceId || seq.id,
                title: seq.title,
                description: seq.description,
                steps: seq.steps
            }));
        } else {
            editorAddSequence();
        }
        refreshSequenceSortables();
        editorRenumberCards();
        return;
    }

    destroySequenceSortables();
    addBtn.textContent = '+ Add Question';
    addBtn.onclick = () => editorAddNewCard('Standard');
    const sourceCards = (deck && deck.cards && deck.typeHint !== 'Sequence')
        ? deck.cards
        : (existingStandardCards.length ? existingStandardCards : null);
    if (sourceCards && sourceCards.length) {
        sourceCards.forEach(card => editorAddNewCard('Standard', card));
    } else {
        editorAddNewCard('General');
        editorAddNewCard('General');
    }
    initStandardEditorSortable();
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
            analytics,
            atoms,
            errorAtoms,
            questions,
            markSchemes,
            examSpecs,
            examPapers,
            examSittings,
            markingRecords,
            contentRevisions
        ] = await Promise.all([
            getAllDataFromDB('decks'),
            getAllDataFromDB('userKnowledgeState'),
            getAllDataFromDB('interactionLogs'), // This is the most valuable data for analysis
            getAllDataFromDB('examPlans'),
            getDataFromDB('appData', 'userSettings'),
            getDataFromDB('appData', 'analytics'),
            getAllDataFromDB('atoms'),
            getAllDataFromDB('errorAtoms'),
            getAllDataFromDB('questions'),
            getAllDataFromDB('markSchemes'),
            getAllDataFromDB('examSpecs'),
            getAllDataFromDB('examPapers'),
            getAllDataFromDB('examSittings'),
            getAllDataFromDB('markingRecords'),
            getAllDataFromDB('contentRevisions')
        ]);

        // 3. Construct the Research Object
        const researchData = {
            exportSchemaVersion: 1,
            exportedAt: new Date().toISOString(),
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
            interactionLogs: interactionLogs,
            examEngine: {
                atoms: atoms || [],
                errorAtoms: errorAtoms || [],
                questions: questions || [],
                markSchemes: markSchemes || [],
                examSpecs: examSpecs || [],
                examPapers: examPapers || [],
                examSittings: examSittings || [],
                markingRecords: markingRecords || [],
                contentRevisions: contentRevisions || []
            }
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
    assignTestIds();
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
        const sequences = Array.isArray(response.sequences) ? response.sequences : [];
        if (!sequences.length) {
            throw new Error('AI response did not include sequences.');
        }
        const normalizedSequences = sequences.map((seq, idx) => {
            const title = (seq.title || `Sequence ${idx + 1}`).toString().trim() || `Sequence ${idx + 1}`;
            const steps = Array.isArray(seq.steps) ? seq.steps : [];
            const normalizedSteps = steps.map(step => {
                if (typeof step === 'string') return { text: step };
                if (step && typeof step === 'object') return { text: step.text || step.question || step.prompt || '', notes: step.notes || step.answer || '' };
                return { text: '' };
            }).filter(step => step.text);
            return { title, steps: normalizedSteps, notes: seq.description || seq.notes || '' };
        }).filter(seq => seq.steps.length);
        if (!normalizedSequences.length) {
            throw new Error('AI response did not include usable sequence steps.');
        }
        return { type: 'sequence', deckName, deckNotes, language, sequences: normalizedSequences };
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

function closeCardHistoryModal() {
    const modal = document.getElementById('cardHistoryModal');
    if (modal) modal.classList.remove('show');
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

const inlineHandlers = {
    addTextAsDocument,
    autoCheckAnswer,
    backToDashboard,
    cancelAction,
    checkForUpdates,
    checkTestAnswer,
    clearAllDecks,
    closeAddCategoryModal,
    closeCardHistoryModal,
    closeCustomPromptModal,
    closeDeckSettingsModal,
    closeEditAiCardModal,
    closeEditCardModal,
    closeExamPlanModal,
    closeImportModal,
    closeLearnModeSetupModal,
    closePracticeTestModal,
    configureStudy,
    continueSequenceTask,
    deleteDeck,
    dontKnowAnswer,
    editCurrentStudyCard,
    editDeck,
    editorAddNewCard,
    editorRemoveCard,
    editorSaveDeck,
    endSession,
    endTest,
    generateFullDataExport,
    getClozeNumberForCard,
    gradeSpaced,
    handleCardTypeChange,
    handleImageFile,
    handleNextCard,
    handleNotesImageUpload,
    hideExamPlanBanner,
    importData,
    markCorrect,
    markIncorrect,
    markTestCorrect,
    markTestIncorrect,
    nextTestQuestion,
    openClozePreview,
    openDeckSettingsModal,
    openPracticeTestModal,
    processAllDocuments,
    removeDocument,
    renderGlobalAnalytics,
    resetPomodoro,
    resetProgress,
    resetSpecificDeck,
    restartStudy,
    restartTest,
    saveAiEditedCard,
    saveAiGeneratedDeck,
    saveCustomPrompt,
    saveDeckSettings,
    saveEditedCard,
    saveExamPlan,
    saveNewCategory,
    saveStudySettings,
    saveUsername,
    selectTestPreset,
    showAiGenerator,
    showAnswer,
    showEditor,
    showExamPlanModal,
    showImportModal,
    showInsightsView,
    showPlanDetails,
    showQuestion,
    showSettings,
    showTestAnswer,
    startExamPlanSession,
    startLearnModeWithSetup,
    startPracticeTest,
    startTest,
    submitSequenceTask,
    switchImportTab,
    toggleExamSettingsVisibility,
    togglePomodoro,
    toggleStudyMode,
    triggerImageUpload,
    triggerNotesImageUpload,
    wrapSelectedInCloze
};

// Expose handlers used by inline HTML attributes and generated markup.
if (typeof window !== 'undefined') {
    Object.entries(inlineHandlers).forEach(([name, handler]) => {
        if (typeof handler === 'function') {
            window[name] = handler;
        }
    });
}
