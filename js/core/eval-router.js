
export function makeSessionId() {
    return Date.now().toString(36) + Math.random().toString(36).substring(2);
}

export function makeRng(seed) {
    if (seed === null || seed === undefined) {
        return Math.random;
    }
    // Simple LCG for deterministic behavior
    let state = seed;
    return function() {
        state = (state * 1664525 + 1013904223) % 4294967296;
        return state / 4294967296;
    };
}

export function choosePolicy(sessionState, config, rng) {
    if (!config || !config.enabled) return config?.router?.policyA || 'cortex';
    
    const pA = config.router.pA ?? 0.5;
    const rand = rng();
    return rand < pA ? config.router.policyA : config.router.policyB;
}
