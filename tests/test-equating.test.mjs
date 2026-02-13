import { equateScore } from '../js/core/test-equating.js';
import assert from 'assert';

console.log('Running Equating Tests...');

// Test 1: No History
{
    const result = equateScore({ rawPct: 0.8, anchorsThisAttempt: 0.8, anchorHistory: null });
    assert.strictEqual(result.equatedPct, 0.8, 'Should return raw score if no history');
}

// Test 2: Harder Form (Anchors score lower than history)
{
    // History 0.8, This 0.6. Diff 0.2. Adj = 0.2 * 0.35 = 0.07.
    const result = equateScore({ rawPct: 0.6, anchorsThisAttempt: 0.6, anchorHistory: 0.8 });
    assert.ok(result.equatedPct > 0.6, 'Score should be adjusted up');
    assert.ok(result.adjustment > 0, 'Adjustment should be positive');
}

// Test 3: Easier Form (Anchors score higher than history)
{
    // History 0.6, This 0.8. Diff -0.2. Adj = -0.2 * 0.35 = -0.07.
    const result = equateScore({ rawPct: 0.8, anchorsThisAttempt: 0.8, anchorHistory: 0.6 });
    assert.ok(result.equatedPct < 0.8, 'Score should be adjusted down');
    assert.ok(result.adjustment < 0, 'Adjustment should be negative');
}

// Test 4: Clamping
{
    const result = equateScore({ rawPct: 0.99, anchorsThisAttempt: 0.5, anchorHistory: 0.9 });
    assert.ok(result.equatedPct <= 1.0, 'Score should be clamped to 1.0');
}

console.log('Equating Tests Passed!');
