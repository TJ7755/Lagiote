export function resetEvalExposureState(state, cardId) {
    return {
        cardId: cardId || null,
        token: null
    };
}

export function applyEvalExposureLog(state, cardId, token) {
    const normalized = state && typeof state === 'object'
        ? state
        : { cardId: null, token: null };

    if (normalized.cardId === cardId && normalized.token) {
        return { state: normalized, shouldLog: false };
    }

    return {
        state: {
            cardId: cardId || null,
            token: token || null
        },
        shouldLog: true
    };
}

export function shouldLogMcqExposure(phase, recallWasCorrect) {
    if (phase === 'recall') return recallWasCorrect === true;
    if (phase === 'recognition') return recallWasCorrect !== true;
    return false;
}
