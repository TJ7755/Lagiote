function coerceFsrsNumber(value, fallback = 0) {
    const coerced = Number(value);
    return Number.isFinite(coerced) ? coerced : fallback;
}

function parseFsrsDate(value) {
    if (!value) return null;
    const candidate = value instanceof Date ? value : new Date(value);
    return Number.isNaN(candidate.getTime()) ? null : candidate;
}

function normalizeFsrsState(fsrs) {
    if (!fsrs || typeof fsrs !== 'object') return null;
    return {
        state: coerceFsrsNumber(fsrs.state),
        stability: coerceFsrsNumber(fsrs.stability),
        difficulty: coerceFsrsNumber(fsrs.difficulty),
        reps: coerceFsrsNumber(fsrs.reps),
        lapses: coerceFsrsNumber(fsrs.lapses),
        due: parseFsrsDate(fsrs.due),
        last_review: parseFsrsDate(fsrs.last_review)
    };
}

function isFsrsReviewedState(fsrs) {
    if (!fsrs || typeof fsrs !== 'object') return false;
    const stability = coerceFsrsNumber(fsrs.stability);
    const reps = coerceFsrsNumber(fsrs.reps);
    const lastReview = parseFsrsDate(fsrs.last_review);
    return stability > 0 && reps > 0 && Boolean(lastReview);
}

function isKnowledgeStateReviewed(state) {
    if (!state) return false;
    return isFsrsReviewedState(state.fsrs);
}

export {
    coerceFsrsNumber,
    parseFsrsDate,
    normalizeFsrsState,
    isFsrsReviewedState,
    isKnowledgeStateReviewed
};
