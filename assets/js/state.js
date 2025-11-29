export const state = {
    db: null,
    decks: {},
    categories: ["Science", "Maths", "Language"],
    globalSettings: {},
    analyticsData: {
        lastUsed: null,
        streak: 0,
        totalStudyTime: 0,
        sessions: []
    },
    currentDeckId: null,
    currentMode: null,
    confirmCallback: null,
    cardToEdit: { deckId: null, cardIndex: null, from: null },
    studyState: {
        buckets: [],
        currentRound: 1,
        currentCardIndex: 0,
        roundCards: [],
        settings: {},
        lastRoundIncorrect: [],
        isRetypingIncorrect: false,
        startTime: null,
        cardStartTime: null,
        activeLearningPool: [],
        knowledgeStates: new Map(),
        
        masterSequence: [],
        chunks: [[]],
        currentChunkIndex: 0,
        chunkStates: [],
        isSequenceMode: false
    },
    practiceTestState: {
        deckId: null,
        cards: [],
        currentCardIndex: 0,
        correctCount: 0,
        incorrectCount: 0,
        startTime: null,
        testType: 'flashcard',
        numQuestions: 10
    },
    isOnline: navigator.onLine,
    currentViewingDeckId: null,
    activeView: 'dashboard',
    viewHistory: [],
    editorCardCounter: 0,
};

export const DEFAULT_DECK_SETTINGS = {
    learnMode: 'flashcard',
    reviewOrder: 'random',
    cardsPerRound: 10,
    maxBuckets: 4,
    caseSensitive: false,
    punctuation: false,
    retypeIncorrect: true,
    feedbackStyle: 'simple',
    forgivingAutomarking: false
};


export function resetStudyState() {
    state.studyState = {
        buckets: [],
        currentRound: 1,
        currentCardIndex: 0,
        roundCards: [],
        settings: {},
        lastRoundIncorrect: [],
        isRetypingIncorrect: false,
        startTime: null,
        cardStartTime: null,
        activeLearningPool: [],
        knowledgeStates: new Map(),
        masterSequence: [],
        chunks: [[]],
        currentChunkIndex: 0,
        chunkStates: [],
        isSequenceMode: false
    };
}

export function resetPracticeTestState() {
    state.practiceTestState = {
        deckId: null,
        cards: [],
        currentCardIndex: 0,
        correctCount: 0,
        incorrectCount: 0,
        startTime: null,
        testType: 'flashcard',
        numQuestions: 10
    };
}

export function setCurrentDeck(deckId) {
    state.currentDeckId = deckId;
}

export function setCurrentMode(mode) {
    state.currentMode = mode;
}

export function updateGlobalSettings(settings) {
    state.globalSettings = { ...state.globalSettings, ...settings };
}

export function getDeck(deckId) {
    return state.decks[deckId];
}

export function getAllDecks() {
    return state.decks;
}

export function updateDeck(deckId, deckData) {
    state.decks[deckId] = deckData;
}

export function deleteDeck(deckId) {
    const deletedDeck = {...state.decks[deckId], deleted: true};
    delete state.decks[deckId];
 
}

export function updateAnalytics(analyticsData) {
    state.analyticsData = { ...state.analyticsData, ...analyticsData };
}

export default state;
