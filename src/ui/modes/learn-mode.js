// Wrapper adapter for learn mode to plug into the mode registry without changing core logic.
export default function createLearnModeAdapter(api) {
    if (!api) return null;
    return {
        init: api.startLearnMode,
        start: api.startLearnMode,
        showNext: api.showNextCard,
        markCorrect: api.markAnswerCorrect,
        markIncorrect: api.markAnswerIncorrect,
        finish: api.endSession,
        teardown: api.endSession,
        getState: () => api.getStudyState && api.getStudyState()
    };
}
