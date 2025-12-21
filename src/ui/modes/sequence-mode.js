// Adapter that bridges the rebuilt Sequence mode into the legacy dashboard API surface.
export default function createLegacyModeAdapter(api) {
    if (!api) return null;
    const start = (deckId) => {
        if (typeof api.startSequenceSession === 'function') {
            return api.startSequenceSession(deckId);
        }
        if (typeof api.startMode === 'function') {
            return api.startMode('sequence', deckId);
        }
        return null;
    };
    return {
        init: start,
        start,
        showNext: api.showNextCard,
        markCorrect: api.markAnswerCorrect,
        markIncorrect: api.markAnswerIncorrect,
        finish: api.endSession,
        teardown: api.endSession,
        getState: () => api.getStudyState && api.getStudyState()
    };
}
