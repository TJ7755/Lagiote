
export function scheduleProbeForExposure({ userID, cardId, deckId, policy, arm, now, config, rng, pendingProbes }) {
    if (!config || !config.probes || !config.probes.enabled) return null;
    
    // Sample rate check
    if (rng() > config.probes.sampleRate) return null;

    // Balancing check
    if (pendingProbes && arm) {
        const pendingA = pendingProbes.filter(p => p.arm === 'A').length;
        const pendingB = pendingProbes.filter(p => p.arm === 'B').length;
        const ratio = 1.25;
        
        if (arm === 'A' && pendingA > pendingB * ratio + 2) return null; // +2 buffer
        if (arm === 'B' && pendingB > pendingA * ratio + 2) return null;
    }

    const delays = config.probes.delaysHours || [6, 24, 72];
    
    let delayHours;
    if (pendingProbes) {
        // Count pending by delay
        const counts = {};
        delays.forEach(d => counts[d] = 0);
        pendingProbes.forEach(p => {
            if (counts[p.delayHours] !== undefined) counts[p.delayHours]++;
        });
        
        // Pick from the ones with min count to balance buckets
        const minCount = Math.min(...Object.values(counts));
        const candidates = delays.filter(d => counts[d] === minCount);
        delayHours = candidates[Math.floor(rng() * candidates.length)];
    } else {
        delayHours = delays[Math.floor(rng() * delays.length)];
    }

    const scheduledAt = now + (delayHours * 3600 * 1000);

    return {
        id: Date.now().toString(36) + Math.random().toString(36).substring(2),
        userID,
        cardId,
        deckId,
        scheduledAt,
        delayHours,
        sourcePolicy: policy,
        arm: arm,
        createdAt: now
    };
}

export function nextDueProbe(pendingProbes, now, config) {
    if (!pendingProbes || pendingProbes.length === 0) return null;
    
    // Sort by scheduledAt
    const sorted = [...pendingProbes].sort((a, b) => a.scheduledAt - b.scheduledAt);
    const candidate = sorted[0];

    if (candidate.scheduledAt <= now) {
        return candidate;
    }
    return null;
}

export function dropExpiredProbes(pendingProbes, now, config) {
    const maxLateness = (config?.probes?.maxLatenessHours || 240) * 3600 * 1000;
    return pendingProbes.filter(p => (now - p.scheduledAt) < maxLateness);
}

export function recordProbeResult(completedProbes, result, config) {
    const maxCompleted = config?.probes?.maxCompleted || 5000;
    const newCompleted = [...completedProbes, result];
    if (newCompleted.length > maxCompleted) {
        return newCompleted.slice(newCompleted.length - maxCompleted);
    }
    return newCompleted;
}
