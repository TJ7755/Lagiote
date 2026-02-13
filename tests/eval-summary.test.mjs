import { strict as assert } from 'assert';
import { summariseProbes, estimateRequiredSample, wilsonScore } from '../js/core/eval-summary.js';

console.log('Running eval-summary tests...');

// Test wilsonScore
{
    const w = wilsonScore(50, 100);
    assert.equal(w.p, 0.5);
    assert.ok(w.lower < 0.5);
    assert.ok(w.upper > 0.5);
    console.log('wilsonScore passed');
}

// Test summariseProbes
{
    const probes = [
        { policy: 'policyA', scheduledDelay: 6, outcome: 1, invalidated: false },
        { policy: 'policyA', scheduledDelay: 6, outcome: 0, invalidated: false },
        { policy: 'policyA', scheduledDelay: 24, outcome: 1, invalidated: true }, // Invalid
        { policy: 'policyB', scheduledDelay: 6, outcome: 1, invalidated: false }
    ];
    const delays = [6, 24];
    
    const stats = summariseProbes(probes, delays);
    
    // Check A
    assert.equal(stats.policyA[6].n, 2);
    assert.equal(stats.policyA[6].k, 1);
    assert.equal(stats.policyA[24].n, 0); // Invalid excluded from n
    assert.equal(stats.policyA[24].invalidN, 1);
    
    // Check B
    assert.equal(stats.policyB[6].n, 1);
    assert.equal(stats.policyB[6].k, 1);
    
    // Check All
    assert.equal(stats.policyA['all'].n, 2);
    assert.equal(stats.policyA['all'].invalidN, 1);
    
    console.log('summariseProbes passed');
}

// Test estimateRequiredSample
{
    const n = estimateRequiredSample(0.5, 0.05);
    assert.ok(n > 0);
    // Approximate check: for p=0.5, d=0.05, alpha=0.1, power=0.8
    // n approx 1200-1300?
    // zA=1.645, zB=0.84 -> (2.485)^2 * (0.25 + 0.2475) / 0.0025
    // 6.17 * 0.4975 / 0.0025 = 1227
    assert.ok(n > 1000 && n < 1500);
    console.log('estimateRequiredSample passed');
}

console.log('All eval-summary tests passed!');
