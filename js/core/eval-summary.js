/**
 * Computes Wilson score interval for a binomial proportion.
 * @param {number} k Successes
 * @param {number} n Trials
 * @param {number} z Z-score (default 1.645 for 90%)
 * @returns {object} { p, lower, upper }
 */
export function wilsonScore(k, n, z = 1.645) {
    if (n === 0) return { p: 0, lower: 0, upper: 0 };
    const p = k / n;
    const denominator = 1 + z * z / n;
    const center = (p + z * z / (2 * n)) / denominator;
    const spread = (z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n))) / denominator;
    return {
        p,
        lower: Math.max(0, center - spread),
        upper: Math.min(1, center + spread)
    };
}

/**
 * Summarises probes by arm and delay bucket.
 * Excludes invalidated probes from accuracy stats.
 * @param {Array} completedProbes 
 * @param {Array} delaysHours 
 * @returns {object} Summary structure
 */
export function summariseProbes(completedProbes, delaysHours) {
    const buckets = [...delaysHours, 'all'];
    const stats = {
        policyA: {},
        policyB: {}
    };

    // Initialise buckets
    ['policyA', 'policyB'].forEach(arm => {
        buckets.forEach(b => {
            stats[arm][b] = {
                n: 0,
                k: 0,
                invalidN: 0,
                p: 0,
                lower: 0,
                upper: 0
            };
        });
    });

    completedProbes.forEach(probe => {
        const arm = probe.policy === 'policyA' ? 'policyA' : 'policyB';
        if (!stats[arm]) return;

        // Determine bucket
        // Assuming probe.scheduledDelay is in hours or we can infer it
        // If probe has bucket info, use it. Otherwise match closest delay.
        let bucket = 'all';
        if (probe.scheduledDelay) {
            // Find closest configured delay
            const delay = probe.scheduledDelay;
            const closest = delaysHours.reduce((prev, curr) => 
                Math.abs(curr - delay) < Math.abs(prev - delay) ? curr : prev
            );
            bucket = closest;
        }

        // Count invalid
        if (probe.invalidated) {
            stats[arm][bucket].invalidN++;
            stats[arm]['all'].invalidN++;
            return;
        }

        // Count valid
        const isCorrect = probe.outcome === 1 || probe.outcome === true;
        stats[arm][bucket].n++;
        if (isCorrect) stats[arm][bucket].k++;
        
        stats[arm]['all'].n++;
        if (isCorrect) stats[arm]['all'].k++;
    });

    // Compute Wilson intervals
    ['policyA', 'policyB'].forEach(arm => {
        buckets.forEach(b => {
            const s = stats[arm][b];
            const w = wilsonScore(s.k, s.n);
            s.p = w.p;
            s.lower = w.lower;
            s.upper = w.upper;
        });
    });

    return stats;
}

/**
 * Estimates required sample size per arm for a two-proportion z-test.
 * @param {number} p1 Baseline proportion (0-1)
 * @param {number} delta Detectable difference (e.g. 0.05)
 * @param {number} alpha Significance level (default 0.10)
 * @param {number} power Power (default 0.80)
 * @returns {number} Required n per arm
 */
export function estimateRequiredSample(p1, delta = 0.05, alpha = 0.10, power = 0.80) {
    // Z-scores
    // alpha 0.10 two-tailed -> 1.645
    // power 0.80 -> 0.84
    const zAlpha = 1.645; 
    const zBeta = 0.84;
    
    const p2 = p1 + delta;
    // Clamp p2
    if (p2 > 0.99) return estimateRequiredSample(p1, -delta, alpha, power); // Try other direction if capped
    
    const num = Math.pow(zAlpha + zBeta, 2) * (p1 * (1 - p1) + p2 * (1 - p2));
    const den = Math.pow(p1 - p2, 2);
    
    return Math.ceil(num / den);
}
