const DEFAULT_EMA = 0.5;
const DEFAULT_ALPHA = 0.18;

function clamp01(value) {
    if (!Number.isFinite(value)) return 0;
    return Math.max(0, Math.min(1, value));
}

function coerceNonNegativeInt(value, fallback = 0) {
    const num = Number(value);
    if (!Number.isFinite(num)) return fallback;
    return Math.max(0, Math.floor(num));
}

function normalizeText(value) {
    const raw = (value === null || value === undefined) ? '' : String(value);
    return raw.trim().replace(/\s+/g, ' ');
}

function getStepStableId(step) {
    if (!step || typeof step !== 'object') return null;
    const candidates = [
        step.id,
        step.stepId,
        step.stepID,
        step.cardID,
        step.cardId,
        step._id
    ];
    for (const candidate of candidates) {
        if (typeof candidate === 'string' && candidate.trim()) return candidate.trim();
        if (typeof candidate === 'number' && Number.isFinite(candidate)) return String(candidate);
    }
    return null;
}

function getStepText(step, index) {
    if (!step || typeof step !== 'object') return normalizeText(index);
    return normalizeText(step.question || step.text || step.label || step.answer || index);
}

function fnv1aHash(str) {
    let hash = 0x811c9dc5;
    for (let i = 0; i < str.length; i += 1) {
        hash ^= str.charCodeAt(i);
        hash = Math.imul(hash, 0x01000193);
    }
    return (hash >>> 0).toString(36);
}

export function hashSequenceSteps(steps) {
    const safeSteps = Array.isArray(steps) ? steps : [];
    const tokens = safeSteps.map((step, index) => {
        const stableId = getStepStableId(step);
        if (stableId) return `id:${stableId}`;
        const text = getStepText(step, index);
        return `t:${text}|i:${index}`;
    });
    return `v1:${fnv1aHash(tokens.join('|'))}`;
}

export function nodeKeyFor(steps, i) {
    const safeSteps = Array.isArray(steps) ? steps : [];
    const from = safeSteps[i];
    const id = getStepStableId(from);
    return id ? id : `${i}`;
}

export function edgeKeyFor(steps, i, j) {
    const safeSteps = Array.isArray(steps) ? steps : [];
    const from = safeSteps[i];
    const to = safeSteps[j];
    const fromId = getStepStableId(from);
    const toId = getStepStableId(to);
    if (fromId && toId) return `${fromId}->${toId}`;
    return `${i}->${j}`;
}

export function initSequenceGraph(steps) {
    const safeSteps = Array.isArray(steps) ? steps : [];
    const stepsHash = hashSequenceSteps(safeSteps);
    const edges = {};
    const nodes = {};
    for (let i = 0; i < safeSteps.length; i += 1) {
        const nodeKey = nodeKeyFor(safeSteps, i);
        nodes[nodeKey] = {
            ema: DEFAULT_EMA,
            n: 0,
            s: 0,
            lastSeen: 0
        };
        if (i < safeSteps.length - 1) {
            const edgeKey = edgeKeyFor(safeSteps, i, i + 1);
            edges[edgeKey] = {
                ema: DEFAULT_EMA,
                n: 0,
                s: 0,
                lastSeen: 0
            };
        }
    }
    return {
        version: 1,
        stepsHash,
        edges,
        nodes,
        updatedAt: Date.now()
    };
}

export function ensureGraphUpToDate(graph, steps) {
    const safeSteps = Array.isArray(steps) ? steps : [];
    if (!graph || typeof graph !== 'object' || graph.version !== 1) {
        return initSequenceGraph(safeSteps);
    }
    const currentHash = hashSequenceSteps(safeSteps);
    if (graph.stepsHash !== currentHash) {
        return initSequenceGraph(safeSteps);
    }
    return graph;
}

function defaultEdgeRecord(existing) {
    const ema = clamp01(Number(existing?.ema));
    return {
        ema: Number.isFinite(ema) ? ema : DEFAULT_EMA,
        n: coerceNonNegativeInt(existing?.n, 0),
        s: coerceNonNegativeInt(existing?.s, 0),
        lastSeen: coerceNonNegativeInt(existing?.lastSeen, 0)
    };
}

function defaultNodeRecord(existing) {
    const ema = clamp01(Number(existing?.ema));
    return {
        ema: Number.isFinite(ema) ? ema : DEFAULT_EMA,
        n: coerceNonNegativeInt(existing?.n, 0),
        s: coerceNonNegativeInt(existing?.s, 0),
        lastSeen: coerceNonNegativeInt(existing?.lastSeen, 0)
    };
}

export function updateEdge(graph, edgeKey, correct, now = Date.now(), alpha = DEFAULT_ALPHA) {
    if (!graph || typeof graph !== 'object' || !edgeKey) return graph;
    const safeAlpha = clamp01(Number(alpha)) || DEFAULT_ALPHA;
    const edges = graph.edges && typeof graph.edges === 'object' ? graph.edges : {};
    const current = defaultEdgeRecord(edges[edgeKey]);
    const nextEma = clamp01(current.ema * (1 - safeAlpha) + (correct ? 1 : 0) * safeAlpha);
    const updated = {
        ...current,
        ema: nextEma,
        n: current.n + 1,
        s: current.s + (correct ? 1 : 0),
        lastSeen: coerceNonNegativeInt(now, current.lastSeen)
    };
    return {
        ...graph,
        edges: {
            ...edges,
            [edgeKey]: updated
        },
        updatedAt: coerceNonNegativeInt(now, Date.now())
    };
}

export function updateNode(graph, nodeKey, correct, now = Date.now(), alpha = DEFAULT_ALPHA) {
    if (!graph || typeof graph !== 'object' || !nodeKey) return graph;
    const safeAlpha = clamp01(Number(alpha)) || DEFAULT_ALPHA;
    const nodes = graph.nodes && typeof graph.nodes === 'object' ? graph.nodes : {};
    const current = defaultNodeRecord(nodes[nodeKey]);
    const nextEma = clamp01(current.ema * (1 - safeAlpha) + (correct ? 1 : 0) * safeAlpha);
    const updated = {
        ...current,
        ema: nextEma,
        n: current.n + 1,
        s: current.s + (correct ? 1 : 0),
        lastSeen: coerceNonNegativeInt(now, current.lastSeen)
    };
    return {
        ...graph,
        nodes: {
            ...nodes,
            [nodeKey]: updated
        },
        updatedAt: coerceNonNegativeInt(now, Date.now())
    };
}

export function deriveUpdatesFromTask(taskType, steps, promptState = {}, userAnswer, isCorrect) {
    const safeSteps = Array.isArray(steps) ? steps : [];
    const edgeKeys = [];
    const nodeKeys = [];

    if (taskType === 'next') {
        const fromIndex = Number.isFinite(Number(promptState.fromIndex))
            ? Number(promptState.fromIndex)
            : (Number(promptState.startIndex) + Number(promptState.anchorIndex));
        if (Number.isFinite(fromIndex) && fromIndex >= 0 && fromIndex < safeSteps.length - 1) {
            edgeKeys.push(edgeKeyFor(safeSteps, fromIndex, fromIndex + 1));
            nodeKeys.push(nodeKeyFor(safeSteps, fromIndex + 1));
        }
    }

    if (taskType === 'prev') {
        const toIndex = Number.isFinite(Number(promptState.toIndex))
            ? Number(promptState.toIndex)
            : (Number(promptState.startIndex) + Number(promptState.anchorIndex));
        if (Number.isFinite(toIndex) && toIndex > 0 && toIndex < safeSteps.length) {
            edgeKeys.push(edgeKeyFor(safeSteps, toIndex - 1, toIndex));
            nodeKeys.push(nodeKeyFor(safeSteps, toIndex - 1));
        }
    }

    if (taskType === 'gap') {
        const missingIndex = Number(promptState.missingIndex);
        if (Number.isFinite(missingIndex) && missingIndex > 0 && missingIndex < safeSteps.length - 1) {
            edgeKeys.push(edgeKeyFor(safeSteps, missingIndex - 1, missingIndex));
            edgeKeys.push(edgeKeyFor(safeSteps, missingIndex, missingIndex + 1));
            nodeKeys.push(nodeKeyFor(safeSteps, missingIndex));
        }
    }

    if (taskType === 'order') {
        const expectedStartIndex = Number(promptState.expectedStartIndex);
        const expectedLength = Number(promptState.expectedLength);
        if (Number.isFinite(expectedStartIndex) && Number.isFinite(expectedLength) && expectedLength >= 2) {
            const start = Math.max(0, expectedStartIndex);
            const end = Math.min(safeSteps.length, start + expectedLength);
            for (let i = start; i < end - 1; i += 1) {
                edgeKeys.push(edgeKeyFor(safeSteps, i, i + 1));
            }
        }
    }

    return { edgeKeys, nodeKeys };
}

function recencyBoost(lastSeen, now, halfLifeMs) {
    const seenAt = coerceNonNegativeInt(lastSeen, 0);
    if (!seenAt) return 1;
    const delta = Math.max(0, now - seenAt);
    const hl = Math.max(1, halfLifeMs);
    return 1 - Math.exp(-delta / hl);
}

function edgeEma(graph, steps, fromIndex) {
    const key = edgeKeyFor(steps, fromIndex, fromIndex + 1);
    const rec = graph?.edges?.[key];
    const ema = clamp01(Number(rec?.ema));
    return Number.isFinite(ema) ? ema : DEFAULT_EMA;
}

function wasRecentlyTargeted(edgeKey, recentEdges, now, avoidRecentMs) {
    if (!edgeKey) return false;
    const entries = Array.isArray(recentEdges) ? recentEdges : [];
    for (let i = entries.length - 1; i >= 0; i -= 1) {
        const entry = entries[i];
        if (!entry || entry.edgeKey !== edgeKey) continue;
        const at = coerceNonNegativeInt(entry.at, 0);
        if (!at) return true;
        return now - at < avoidRecentMs;
    }
    return false;
}

export function pickWeakEdge(graph, steps, recentEdges, now = Date.now(), opts = {}) {
    const safeSteps = Array.isArray(steps) ? steps : [];
    if (safeSteps.length < 2) return null;

    const minCandidates = coerceNonNegativeInt(opts.minCandidates, 3) || 3;
    const recencyHalfLifeMs = coerceNonNegativeInt(opts.recencyHalfLifeMs, 10 * 60 * 1000) || (10 * 60 * 1000);
    const avoidRecentMs = coerceNonNegativeInt(opts.avoidRecentMs, 90 * 1000) || (90 * 1000);
    const weightCascade = Number.isFinite(Number(opts.weightCascade)) ? Number(opts.weightCascade) : 0.25;

    const edgesList = [];
    for (let i = 0; i < safeSteps.length - 1; i += 1) {
        const edgeKey = edgeKeyFor(safeSteps, i, i + 1);
        const rec = graph?.edges?.[edgeKey];
        edgesList.push({
            edgeKey,
            fromIndex: i,
            toIndex: i + 1,
            ema: clamp01(Number(rec?.ema)) || DEFAULT_EMA,
            lastSeen: coerceNonNegativeInt(rec?.lastSeen, 0)
        });
    }

    const sortedByWeakness = [...edgesList].sort((a, b) => a.ema - b.ema);
    const candidates = sortedByWeakness.slice(0, Math.min(sortedByWeakness.length, Math.max(minCandidates, 1)));

    let best = null;
    for (const candidate of candidates) {
        if (wasRecentlyTargeted(candidate.edgeKey, recentEdges, now, avoidRecentMs) && candidates.length > 1) {
            continue;
        }
        const weakness = 1 - candidate.ema;
        const recBoost = recencyBoost(candidate.lastSeen, now, recencyHalfLifeMs);
        const prevWeakness = candidate.fromIndex > 0 ? (1 - edgeEma(graph, safeSteps, candidate.fromIndex - 1)) : 0;
        const nextWeakness = candidate.toIndex < safeSteps.length - 1 ? (1 - edgeEma(graph, safeSteps, candidate.fromIndex + 1)) : 0;
        const neighborWeakness = (prevWeakness + nextWeakness) / 2;
        const cascadeFactor = Math.max(0, weightCascade) * neighborWeakness;
        const score = weakness * (1 + recBoost) * (1 + cascadeFactor);
        if (!best || score > best.score) {
            best = {
                edgeKey: candidate.edgeKey,
                fromIndex: candidate.fromIndex,
                toIndex: candidate.toIndex,
                score
            };
        }
    }

    if (best) return best;
    const fallback = sortedByWeakness[0];
    return {
        edgeKey: fallback.edgeKey,
        fromIndex: fallback.fromIndex,
        toIndex: fallback.toIndex,
        score: 1 - fallback.ema
    };
}

export function _debugSequenceGraphSanityCheck() {
    const steps = Array.from({ length: 6 }, (_, i) => ({ id: `s${i}`, question: `Step ${i}` }));
    let graph = initSequenceGraph(steps);
    const now = Date.now();
    const badKey = edgeKeyFor(steps, 2, 3);

    let t = now;
    for (let i = 0; i < steps.length - 1; i += 1) {
        const key = edgeKeyFor(steps, i, i + 1);
        graph = updateEdge(graph, key, true, t, 0.18);
        t += 1000;
    }
    for (let i = 0; i < 25; i += 1) {
        graph = updateEdge(graph, badKey, false, t, 0.18);
        t += 1000;
    }

    const pick = pickWeakEdge(graph, steps, [], t + 1000, { minCandidates: 3, avoidRecentMs: 0 });
    if (!pick || pick.edgeKey !== badKey) {
        throw new Error(`Sanity check failed: expected ${badKey}, got ${pick ? pick.edgeKey : 'null'}`);
    }

    const before = graph.edges[badKey]?.ema ?? 0.5;
    graph = updateEdge(graph, badKey, true, t + 2000, 0.18);
    const after = graph.edges[badKey]?.ema ?? 0.5;
    if (!(after > before)) {
        throw new Error(`Sanity check failed: ema did not increase on success (${before} -> ${after})`);
    }
}
