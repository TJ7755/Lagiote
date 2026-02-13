export default function createReviewModeAdapter(api) {
    if (!api) return null;
    return {
        init: api.startReviewMode,
        start: api.startReviewMode,
        showNext: api.showNextCard,
        markCorrect: api.markAnswerCorrect,
        markIncorrect: api.markAnswerIncorrect,
        finish: api.endSession,
        teardown: api.endSession,
        getState: () => api.getStudyState && api.getStudyState()
    };
}
