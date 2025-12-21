const MAX_TOKENS_DEFAULT = 60;
const signatureCache = new Map();

export function normaliseText(str) {
    if (typeof str !== 'string') return '';
    return str
        .normalize('NFKD')
        .replace(/\p{M}+/gu, '')
        .toLowerCase()
        .replace(/[^\p{L}\p{N}\s]+/gu, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

export function tokenise(str, opts = {}) {
    const maxTokens = Number.isFinite(opts.maxTokens) ? opts.maxTokens : MAX_TOKENS_DEFAULT;
    const normalized = normaliseText(str);
    if (!normalized) return [];
    const tokens = normalized
        .split(' ')
        .filter(token => token.length >= 2);
    if (tokens.length <= maxTokens) return tokens;
    return tokens.slice(0, maxTokens);
}

export function jaccard(aTokens, bTokens) {
    if (!Array.isArray(aTokens) || !Array.isArray(bTokens)) return 0;
    if (aTokens.length === 0 || bTokens.length === 0) return 0;

    const aSet = new Set(aTokens);
    const bSet = new Set(bTokens);
    let intersection = 0;
    for (const token of aSet) {
        if (bSet.has(token)) intersection += 1;
    }
    const union = aSet.size + bSet.size - intersection;
    if (!union) return 0;
    return intersection / union;
}

function clamp(val, min, max) {
    return Math.min(max, Math.max(min, val));
}

function extractSharedTagBoost(cardA, cardB) {
    const tagsA = Array.isArray(cardA?.tags) ? cardA.tags : (Array.isArray(cardA?.topics) ? cardA.topics : null);
    const tagsB = Array.isArray(cardB?.tags) ? cardB.tags : (Array.isArray(cardB?.topics) ? cardB.topics : null);
    if (tagsA && tagsB) {
        const bSet = new Set(tagsB.filter(Boolean));
        for (const tag of tagsA) {
            if (tag && bSet.has(tag)) return 0.1;
        }
    }

    const topicA = typeof cardA?.topic === 'string' ? cardA.topic : null;
    const topicB = typeof cardB?.topic === 'string' ? cardB.topic : null;
    if (topicA && topicB && topicA === topicB) return 0.1;

    return 0;
}

function signatureTextForCard(card) {
    if (!card || typeof card !== 'object') return '';
    const prompt = card.question || card.prompt || card.front || card.term || '';
    const answer = card.answer || card.back || card.definition || '';
    return `${prompt}\n${answer}`;
}

export function computeCardSignature(card, opts = {}) {
    const id = card?.id || card?.cardID || card?.cardId;
    if (id && signatureCache.has(id)) return signatureCache.get(id);

    const text = signatureTextForCard(card);
    const tokens = tokenise(text, { maxTokens: opts.maxTokens });
    const signature = { text, tokens };
    if (id) signatureCache.set(id, signature);
    return signature;
}

export function similarity(cardA, cardB, opts = {}) {
    if (!cardA || !cardB) return 0;
    const sigA = computeCardSignature(cardA, opts);
    const sigB = computeCardSignature(cardB, opts);
    let sim = jaccard(sigA.tokens, sigB.tokens);
    sim += extractSharedTagBoost(cardA, cardB);
    return clamp(sim, 0, 1);
}

export function pickConfusableCard(targetCard, candidates, opts = {}) {
    const minSim = Number.isFinite(opts.minSim) ? opts.minSim : 0.28;
    const maxSim = Number.isFinite(opts.maxSim) ? opts.maxSim : 0.85;
    const maxCandidatesToScan = Number.isFinite(opts.maxCandidatesToScan) ? opts.maxCandidatesToScan : 120;
    const recentIds = opts.recentIds instanceof Set ? opts.recentIds : null;
    const targetId = targetCard?.id;

    if (!targetCard || !Array.isArray(candidates) || candidates.length === 0) return null;

    let best = null;
    let bestSim = -Infinity;
    const limit = Math.min(candidates.length, maxCandidatesToScan);
    for (let i = 0; i < limit; i++) {
        const candidate = candidates[i];
        const candidateId = candidate?.id;
        if (!candidate || !candidateId) continue;
        if (candidateId === targetId) continue;
        if (recentIds && recentIds.has(candidateId)) continue;
        const sim = similarity(targetCard, candidate, opts);
        if (sim < minSim || sim > maxSim) continue;
        if (sim > bestSim) {
            bestSim = sim;
            best = candidate;
        }
    }

    if (!best) return null;
    return { card: best, sim: bestSim };
}

export function clearInterferenceSignatureCache() {
    signatureCache.clear();
}

