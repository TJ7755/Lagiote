import assert from 'assert';
import {
    normalizeOptionKey,
    enqueueRemediation,
    shouldShowRemediation,
    scheduleCooldown,
    popNextRemediation,
    weightedSampleDistractors,
    updateMcqRemediationStats
} from '../js/core/mcq-remediation.js';

// Test 1: enqueue dedupe + cap
{
    console.log('Test 1: enqueue dedupe + cap');
    let queue = [];
    const task1 = { cardId: 'c1', lureKey: 'l1', type: 'lure_discriminate' };
    queue = enqueueRemediation(queue, task1);
    assert.strictEqual(queue.length, 1);
    
    // Dedupe
    queue = enqueueRemediation(queue, task1);
    assert.strictEqual(queue.length, 1);
    
    // Cap
    for (let i = 2; i <= 25; i++) {
        queue = enqueueRemediation(queue, { cardId: `c${i}`, lureKey: `l${i}`, type: 'lure_discriminate' }, 20);
    }
    assert.strictEqual(queue.length, 20);
    assert.strictEqual(queue[0].cardId, 'c6'); // Oldest dropped (c1-c5 dropped)
    console.log('Test 1 ✅');
}

// Test 2: cooldown gating
{
    console.log('Test 2: cooldown gating');
    const queue = [{ cardId: 'c1' }];
    const now = 1000;
    
    assert.strictEqual(shouldShowRemediation(queue, now, 2000), false);
    assert.strictEqual(shouldShowRemediation(queue, 2001, 2000), true);
    
    const cooldown = scheduleCooldown(now, 60000);
    assert.strictEqual(cooldown, 61000);
    console.log('Test 2 ✅');
}

// Test 3: popNextRemediation ordering
{
    console.log('Test 3: popNextRemediation ordering');
    let queue = [
        { cardId: 'c1', attempts: 1, createdAt: 100 },
        { cardId: 'c2', attempts: 0, createdAt: 200 },
        { cardId: 'c3', attempts: 0, createdAt: 150 }
    ];
    
    // Should pick c3 (lowest attempts, then oldest)
    let result = popNextRemediation(queue);
    assert.strictEqual(result.task.cardId, 'c3');
    queue = result.nextQueue;
    
    result = popNextRemediation(queue);
    assert.strictEqual(result.task.cardId, 'c2');
    queue = result.nextQueue;
    
    result = popNextRemediation(queue);
    assert.strictEqual(result.task.cardId, 'c1');
    console.log('Test 3 ✅');
}

// Test 4: lure weighting increases selection frequency
{
    console.log('Test 4: lure weighting increases selection frequency');
    const distractors = ['A', 'B', 'C', 'D'];
    const lureCounts = { 'a': 10, 'b': 0, 'c': 0, 'd': 0 };
    
    // Simple LCG RNG for determinism
    let seed = 123;
    const rng = () => {
        seed = (seed * 1664525 + 1013904223) % 4294967296;
        return seed / 4294967296;
    };
    
    const samples = 1000;
    let aCount = 0;
    for (let i = 0; i < samples; i++) {
        const selected = weightedSampleDistractors(distractors, lureCounts, 1, rng);
        if (selected[0] === 'A') aCount++;
    }
    
    // Weight for A = 1 + min(5, 10) = 6
    // Weight for others = 1 + 0 = 1
    // Total weight = 6 + 1 + 1 + 1 = 9
    // Expected P(A) = 6/9 = 0.66
    const ratio = aCount / samples;
    assert.ok(ratio > 0.5, `A should appear frequently, got ${ratio}`);
    console.log('Test 4 ✅');
}

// Test 5: remediation stats update
{
    console.log('Test 5: remediation stats update');
    let stats = {
        remediationAttempts: 0,
        remediationCorrect: 0,
        recognitionDependenceEma: 0.5
    };
    
    // Wrong
    stats = updateMcqRemediationStats(stats, false);
    assert.strictEqual(stats.remediationAttempts, 1);
    assert.strictEqual(stats.remediationCorrect, 0);
    assert.ok(stats.recognitionDependenceEma > 0.5);
    
    // Correct
    const beforeCorrect = stats.recognitionDependenceEma;
    stats = updateMcqRemediationStats(stats, true);
    assert.strictEqual(stats.remediationAttempts, 2);
    assert.strictEqual(stats.remediationCorrect, 1);
    assert.ok(stats.recognitionDependenceEma < beforeCorrect);
    console.log('Test 5 ✅');
}
