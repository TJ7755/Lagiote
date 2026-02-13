export function normalizeOptionKey(str) {
    return String(str || '')
        .trim()
        .toLowerCase()
        .normalize('NFKD')
        .replace(/\s+/g, ' ');
}

export function enqueueRemediation(queue, task, maxQueue = 20) {
    const nextQueue = [...queue];
    const exists = nextQueue.some(t => t.cardId === task.cardId && t.lureKey === task.lureKey);
    if (exists) return nextQueue;

    nextQueue.push({
        ...task,
        createdAt: task.createdAt || Date.now(),
        attempts: task.attempts || 0
    });

    if (nextQueue.length > maxQueue) {
        nextQueue.splice(0, nextQueue.length - maxQueue);
    }
    return nextQueue;
}

export function shouldShowRemediation(queue, now, cooldownUntil) {
    if (!queue || queue.length === 0) return false;
    return now > (cooldownUntil || 0);
}

export function scheduleCooldown(now, cooldownMs) {
    return now + cooldownMs;
}

export function popNextRemediation(queue) {
    if (!queue || queue.length === 0) return { task: null, nextQueue: queue };
    
    let bestIndex = 0;
    let bestTask = queue[0];
    
    for (let i = 1; i < queue.length; i++) {
        const candidate = queue[i];
        if (candidate.attempts < bestTask.attempts) {
            bestIndex = i;
            bestTask = candidate;
            continue;
        }
        if (candidate.attempts === bestTask.attempts && candidate.createdAt < bestTask.createdAt) {
            bestIndex = i;
            bestTask = candidate;
        }
    }
    
    const nextQueue = [...queue];
    const task = nextQueue.splice(bestIndex, 1)[0];
    return { task, nextQueue };
}

export function weightedSampleDistractors(distractors, lureCounts, k, rng = Math.random) {
    const pool = distractors.map(d => {
        const text = typeof d === 'string' ? d : (d.text || '');
        return { item: d, key: normalizeOptionKey(text) };
    });
    
    const selected = [];
    const lureCountsMap = lureCounts || {};
    
    for (let i = 0; i < k && pool.length > 0; i++) {
        let totalWeight = 0;
        const weights = pool.map(p => {
            const weight = 1 + Math.min(5, lureCountsMap[p.key] || 0);
            totalWeight += weight;
            return weight;
        });
        
        let roll = rng() * totalWeight;
        let chosenIndex = 0;
        for (let j = 0; j < pool.length; j++) {
            roll -= weights[j];
            if (roll <= 0) {
                chosenIndex = j;
                break;
            }
        }
        selected.push(pool.splice(chosenIndex, 1)[0].item);
    }
    
    return selected;
}

export function updateMcqRemediationStats(mcqStats, wasCorrect, opts = {}) {
    const now = opts.now || Date.now();
    const nextStats = { ...mcqStats };
    
    nextStats.remediationAttempts = (nextStats.remediationAttempts || 0) + 1;
    
    const ema = Number.isFinite(nextStats.recognitionDependenceEma) ? nextStats.recognitionDependenceEma : 0.0;
    
    if (wasCorrect) {
        nextStats.remediationCorrect = (nextStats.remediationCorrect || 0) + 1;
        nextStats.recognitionDependenceEma = Math.max(0, Math.min(1, ema * (1 - 0.06)));
    } else {
        const alpha = 0.22;
        nextStats.recognitionDependenceEma = Math.max(0, Math.min(1, (ema * (1 - alpha)) + alpha));
    }
    
    nextStats.lastRemediationAt = now;
    nextStats.lastUpdated = now;
    
    return nextStats;
}
