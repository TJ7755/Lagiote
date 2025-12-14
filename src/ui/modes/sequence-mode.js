export default function createSequenceModeAdapter(api) {
    if (!api) return null;
    return {
        init: api.startSequenceSession,
        start: api.startSequenceSession,
        showNext: api.showNextCard,
        markCorrect: api.markAnswerCorrect,
        markIncorrect: api.markAnswerIncorrect,
        finish: api.endSession,
        teardown: api.endSession,
        getState: () => api.getStudyState && api.getStudyState()
    };
}
