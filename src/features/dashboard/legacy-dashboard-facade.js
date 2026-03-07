function invokeGlobal(name, ...args) {
    if (typeof window === 'undefined' || typeof window[name] !== 'function') {
        throw new Error(`Legacy dashboard handler "${name}" is unavailable`);
    }
    return window[name](...args);
}

export function createLegacyDashboardFacade({ platformServices, authServices, analyticsServices } = {}) {
    return {
        platformServices,
        authServices,
        analyticsServices,
        loadInitialState() {
            return window.__APP_READY__ === true;
        },
        openDeck(deckId) {
            if (typeof window.showDeckDetail === 'function') {
                return window.showDeckDetail(deckId);
            }
            return null;
        },
        saveDeck(deck) {
            return invokeGlobal('editorSaveDeck', deck);
        },
        startStudySession(config) {
            if (config?.mode === 'practice-test') {
                return invokeGlobal('startPracticeTest');
            }
            if (config?.mode === 'learn') {
                return invokeGlobal('startLearnModeWithSetup');
            }
            if (config?.mode === 'review') {
                return invokeGlobal('toggleStudyMode');
            }
            return null;
        },
        importDeck(source) {
            return invokeGlobal('importData', source);
        },
        exportDeck(deckId, format) {
            return invokeGlobal('generateFullDataExport', { deckId, format });
        },
        refreshAnalytics() {
            return invokeGlobal('showAnalyticsView');
        },
        signIn() {
            return authServices?.startAuthFlow ? authServices.startAuthFlow() : null;
        },
        signOut() {
            if (typeof window.logout === 'function') {
                return window.logout();
            }
            return null;
        }
    };
}
