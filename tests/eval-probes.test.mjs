import { strict as assert } from 'assert';
import { scheduleProbeForExposure, nextDueProbe, dropExpiredProbes, recordProbeResult } from '../js/core/eval-probes.js';

// Mock RNG
const mockRng = (val) => () => val;

console.log('Running eval-probes tests...');

// Test scheduleProbeForExposure
{
    const config = { probes: { enabled: true, sampleRate: 0.5, delaysHours: [10] } };
    const now = 1000000;
    
    // Should schedule if rng < sampleRate
    const probe1 = scheduleProbeForExposure({
        userID: 'u1', cardId: 'c1', deckId: 'd1', policy: 'p1', now, config, rng: mockRng(0.1)
    });
    assert.ok(probe1, 'Should schedule probe when rng < sampleRate');
    assert.equal(probe1.delayHours, 10);
    assert.equal(probe1.scheduledAt, now + 10 * 3600 * 1000);
    
    // Should NOT schedule if rng > sampleRate
    const probe2 = scheduleProbeForExposure({
        userID: 'u1', cardId: 'c1', deckId: 'd1', policy: 'p1', now, config, rng: mockRng(0.9)
    });
    assert.equal(probe2, null, 'Should not schedule probe when rng > sampleRate');
}

// Test nextDueProbe
{
    const now = 1000000;
    const probes = [
        { id: 'p1', scheduledAt: now + 1000 },
        { id: 'p2', scheduledAt: now - 1000 }, // Due
        { id: 'p3', scheduledAt: now - 2000 }  // Due and earlier
    ];
    
    const due = nextDueProbe(probes, now, {});
    assert.equal(due.id, 'p3', 'Should pick earliest due probe');
    
    const noneDue = nextDueProbe([{ id: 'p1', scheduledAt: now + 1000 }], now, {});
    assert.equal(noneDue, null, 'Should return null if none due');
}

// Test dropExpiredProbes
{
    const now = 1000000;
    const maxLateness = 10 * 3600 * 1000; // 10 hours
    const probes = [
        { id: 'p1', scheduledAt: now - 1000 }, // Just due
        { id: 'p2', scheduledAt: now - maxLateness - 1000 } // Expired
    ];
    
    const kept = dropExpiredProbes(probes, now, { probes: { maxLatenessHours: 10 } });
    assert.equal(kept.length, 1);
    assert.equal(kept[0].id, 'p1');
}

// Test recordProbeResult
{
    const completed = [{ id: 'old' }];
    const result = { id: 'new' };
    const config = { probes: { maxCompleted: 2 } };
    
    const updated = recordProbeResult(completed, result, config);
    assert.equal(updated.length, 2);
    assert.equal(updated[1].id, 'new');
    
    const overflow = recordProbeResult(updated, { id: 'newer' }, config);
    assert.equal(overflow.length, 2);
    assert.equal(overflow[0].id, 'new'); // 'old' dropped
    assert.equal(overflow[1].id, 'newer');
}

// Test balancing
{
    const config = { probes: { enabled: true, sampleRate: 1.0, delaysHours: [10] } };
    const now = 1000000;
    
    // Pending probes heavily skewed to A
    const pendingProbes = [
        { arm: 'A' }, { arm: 'A' }, { arm: 'A' }, { arm: 'A' }, { arm: 'A' }, // 5 A
        { arm: 'B' } // 1 B
    ];
    // Ratio A/B = 5. Limit is 1.25 * 1 + 2 = 3.25. So A should be blocked.
    
    const probeA = scheduleProbeForExposure({
        userID: 'u1', cardId: 'c1', deckId: 'd1', policy: 'p1', arm: 'A', now, config, rng: mockRng(0.1), pendingProbes
    });
    assert.equal(probeA, null, 'Should block A when skewed');
    
    const probeB = scheduleProbeForExposure({
        userID: 'u1', cardId: 'c1', deckId: 'd1', policy: 'p1', arm: 'B', now, config, rng: mockRng(0.1), pendingProbes
    });
    assert.ok(probeB, 'Should allow B when skewed to A');
}

console.log('eval-probes tests passed!');
