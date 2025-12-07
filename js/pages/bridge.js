// Bridge: expose modular assets/js helpers to the global scope for legacy inline handlers.
// This lets us phase out duplicated definitions in dashboard.js without breaking behavior.
import {
    initDB,
    saveDataToDB,
    getDataFromDB,
    getAllDataFromDB,
    deleteDataFromDB,
    clearStoreInDB
} from '../../assets/js/db.js';
import {
    state,
    DEFAULT_DECK_SETTINGS,
    resetStudyState,
    resetPracticeTestState,
    setCurrentDeck,
    setCurrentMode,
    updateGlobalSettings,
    getDeck,
    getAllDecks,
    updateDeck,
    deleteDeck as deleteDeckFromState,
    updateAnalytics
} from '../../assets/js/state.js';
import {
    levenshteinDistance,
    calculateIQS,
    shuffleArray,
    generateId
} from '../../assets/js/utils.js';
import {
    showToast,
    showView,
    transitionView,
    transitionSubView
} from '../../assets/js/ui.js';
import * as studyModule from '../../assets/js/study.js';

// Attach only if not already present to avoid clobbering runtime state unexpectedly.
window.initDB = window.initDB || initDB;
window.saveDataToDB = window.saveDataToDB || saveDataToDB;
window.getDataFromDB = window.getDataFromDB || getDataFromDB;
window.getAllDataFromDB = window.getAllDataFromDB || getAllDataFromDB;
window.deleteDataFromDB = window.deleteDataFromDB || deleteDataFromDB;
window.clearStoreInDB = window.clearStoreInDB || clearStoreInDB;

window.state = window.state || state;
window.DEFAULT_DECK_SETTINGS = window.DEFAULT_DECK_SETTINGS || DEFAULT_DECK_SETTINGS;
window.resetStudyState = window.resetStudyState || resetStudyState;
window.resetPracticeTestState = window.resetPracticeTestState || resetPracticeTestState;
window.setCurrentDeck = window.setCurrentDeck || setCurrentDeck;
window.setCurrentMode = window.setCurrentMode || setCurrentMode;
window.updateGlobalSettings = window.updateGlobalSettings || updateGlobalSettings;
window.getDeck = window.getDeck || getDeck;
window.getAllDecks = window.getAllDecks || getAllDecks;
window.updateDeck = window.updateDeck || updateDeck;
window.deleteDeck = window.deleteDeck || deleteDeckFromState;
window.updateAnalytics = window.updateAnalytics || updateAnalytics;

window.levenshteinDistance = window.levenshteinDistance || levenshteinDistance;
window.calculateIQS = window.calculateIQS || calculateIQS;
window.shuffleArray = window.shuffleArray || shuffleArray;
window.generateId = window.generateId || generateId;

window.showToast = window.showToast || showToast;
window.showView = window.showView || showView;
window.transitionView = window.transitionView || transitionView;
window.transitionSubView = window.transitionSubView || transitionSubView;

// Study module helpers: attach as a namespaced object to avoid clobbering individual functions.
window.studyModule = window.studyModule || studyModule;
