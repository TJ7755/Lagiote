import { strict as assert } from 'assert';
import { choosePolicy, makeRng } from '../js/core/eval-router.js';

console.log('Running eval-router tests...');

// Test choosePolicy
{
    const config = {
        enabled: true,
        router: { policyA: 'A', policyB: 'B', pA: 0.5 }
    };
    
    // Force RNG to 0.1 -> should pick A
    assert.equal(choosePolicy({}, config, () => 0.1), 'A');
    
    // Force RNG to 0.9 -> should pick B
    assert.equal(choosePolicy({}, config, () => 0.9), 'B');
    
    // Disabled config
    assert.equal(choosePolicy({}, { enabled: false }, () => 0.1), 'cortex');
}

// Test RNG determinism
{
    const seed = 12345;
    const rng1 = makeRng(seed);
    const rng2 = makeRng(seed);
    
    assert.equal(rng1(), rng2());
    assert.equal(rng1(), rng2());
    assert.equal(rng1(), rng2());
    
    const rng3 = makeRng(seed + 1);
    assert.notEqual(rng1(), rng3()); // Should differ (statistically likely)
}

console.log('eval-router tests passed!');
