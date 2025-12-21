import assert from 'assert';

// Mock logic of ensureAssignment to test the algorithm
async function ensureAssignment(assignment, cardIds, rng, pA = 0.5) {
    let changed = false;
    const newAssignment = { ...assignment };
    
    for (const cardId of cardIds) {
        if (!newAssignment[cardId]) {
            newAssignment[cardId] = rng() < pA ? 'A' : 'B';
            changed = true;
        }
    }
    
    return { assignment: newAssignment, changed };
}

// Simple seeded RNG
function seededRng(seed) {
    let s = seed;
    return () => {
        s = (s * 9301 + 49297) % 233280;
        return s / 233280;
    };
}

async function testAssignmentStability() {
    const rng = seededRng(123);
    const cardIds = ['c1', 'c2', 'c3', 'c4'];
    
    // First run
    const { assignment: a1, changed: c1 } = await ensureAssignment({}, cardIds, rng);
    assert.strictEqual(c1, true);
    assert.strictEqual(Object.keys(a1).length, 4);
    
    // Second run with same cards - should not change
    const { assignment: a2, changed: c2 } = await ensureAssignment(a1, cardIds, seededRng(999)); // Different seed shouldn't matter for existing
    assert.strictEqual(c2, false);
    assert.deepStrictEqual(a1, a2);
    
    // Add new cards
    const newCards = ['c1', 'c2', 'c5'];
    const { assignment: a3, changed: c3 } = await ensureAssignment(a1, newCards, seededRng(123));
    assert.strictEqual(c3, true);
    assert.strictEqual(Object.keys(a3).length, 5);
    assert.strictEqual(a3['c1'], a1['c1']); // Old ones stable
    assert.strictEqual(a3['c2'], a1['c2']);
    assert.ok(a3['c5']); // New one assigned
    
    console.log('testAssignmentStability ✅');
}

async function testDistribution() {
    const rng = seededRng(42);
    const cardIds = Array.from({ length: 1000 }, (_, i) => `card-${i}`);
    const { assignment } = await ensureAssignment({}, cardIds, rng);
    
    const countA = Object.values(assignment).filter(v => v === 'A').length;
    const countB = Object.values(assignment).filter(v => v === 'B').length;
    
    // Should be roughly 50/50
    assert.ok(countA > 450 && countA < 550);
    assert.ok(countB > 450 && countB < 550);
    
    console.log('testDistribution ✅');
}

testAssignmentStability();
testDistribution();
