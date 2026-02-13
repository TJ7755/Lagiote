import assert from 'assert';

// Simple seeded RNG
function seededRng(seed) {
    let s = seed;
    return () => {
        s = (s * 9301 + 49297) % 233280;
        return s / 233280;
    };
}

function shuffle(array, rng) {
    for (let i = array.length - 1; i > 0; i--) {
        const j = Math.floor(rng() * (i + 1));
        [array[i], array[j]] = [array[j], array[i]];
    }
}

// Logic from eval-store.js (adapted to avoid DB)
async function ensureAssignment(assignment, cardMetas, rng, opts = {}) {
    const { method = 'stratified_v1', quantiles = 5, pA = 0.5 } = opts;
    let changed = false;
    const newAssignment = { ...assignment };

    let metas = cardMetas;
    let actualPA = pA;
    if (Array.isArray(cardMetas) && cardMetas.length > 0 && typeof cardMetas[0] === 'string') {
        metas = cardMetas.map(id => ({ cardId: id, deckId: 'default', difficulty: 0.5 }));
        actualPA = typeof rng === 'number' ? rng : pA;
    }

    if (method === 'random_v1') {
        for (const meta of metas) {
            if (!newAssignment[meta.cardId]) {
                newAssignment[meta.cardId] = rng() < actualPA ? 'A' : 'B';
                changed = true;
            }
        }
    } else if (method === 'stratified_v1') {
        const byDeck = {};
        for (const meta of metas) {
            if (!byDeck[meta.deckId]) byDeck[meta.deckId] = [];
            byDeck[meta.deckId].push(meta);
        }

        for (const deckId in byDeck) {
            const deckMetas = byDeck[deckId];
            deckMetas.sort((a, b) => a.difficulty - b.difficulty);

            const n = deckMetas.length;
            const qSize = Math.ceil(n / quantiles);

            for (let q = 0; q < quantiles; q++) {
                const start = q * qSize;
                const end = Math.min(start + qSize, n);
                if (start >= end) break;

                const bin = deckMetas.slice(start, end);
                const unassigned = bin.filter(m => !newAssignment[m.cardId]);
                
                if (unassigned.length > 0) {
                    shuffle(unassigned, rng);
                    
                    let deckA = 0;
                    let deckB = 0;
                    for (const m of deckMetas) {
                        if (newAssignment[m.cardId] === 'A') deckA++;
                        else if (newAssignment[m.cardId] === 'B') deckB++;
                    }

                    let nextArm = deckA <= deckB ? 'A' : 'B';
                    for (const m of unassigned) {
                        newAssignment[m.cardId] = nextArm;
                        nextArm = nextArm === 'A' ? 'B' : 'A';
                        changed = true;
                    }
                }
            }
        }
    }

    // Compute stats
    const stats = { method, quantiles, byDeck: {} };
    const byDeckMetas = {};
    for (const meta of metas) {
        if (!byDeckMetas[meta.deckId]) byDeckMetas[meta.deckId] = [];
        byDeckMetas[meta.deckId].push(meta);
    }

    for (const deckId in byDeckMetas) {
        const deckMetas = byDeckMetas[deckId];
        deckMetas.sort((a, b) => a.difficulty - b.difficulty);
        const n = deckMetas.length;
        const qSize = Math.ceil(n / quantiles);
        let assignedA = 0, assignedB = 0;
        const strata = [];
        for (let q = 0; q < quantiles; q++) {
            const start = q * qSize;
            const end = Math.min(start + qSize, n);
            if (start >= end) {
                strata.push({ q, n: 0, a: 0, b: 0, difficultyRange: [0, 0] });
                continue;
            }
            const bin = deckMetas.slice(start, end);
            let a = 0, b = 0;
            for (const m of bin) {
                if (newAssignment[m.cardId] === 'A') a++;
                else if (newAssignment[m.cardId] === 'B') b++;
            }
            assignedA += a; assignedB += b;
            strata.push({ q, n: bin.length, a, b, difficultyRange: [bin[0].difficulty, bin[bin.length - 1].difficulty] });
        }
        stats.byDeck[deckId] = { total: n, assignedA, assignedB, strata };
    }

    return { assignment: newAssignment, stats, changed };
}

async function testStratifiedBalance() {
    const rng = seededRng(123);
    const deck1 = Array.from({ length: 100 }, (_, i) => ({ cardId: `d1-c${i}`, deckId: 'deck1', difficulty: i / 100 }));
    const deck2 = Array.from({ length: 100 }, (_, i) => ({ cardId: `d2-c${i}`, deckId: 'deck2', difficulty: i / 100 }));
    const cardMetas = [...deck1, ...deck2];

    const { assignment, stats } = await ensureAssignment({}, cardMetas, rng, { method: 'stratified_v1', quantiles: 5 });

    for (const deckId of ['deck1', 'deck2']) {
        const d = stats.byDeck[deckId];
        assert.strictEqual(d.total, 100);
        assert.ok(Math.abs(d.assignedA - d.assignedB) <= 1, `Deck ${deckId} should be balanced`);
        
        for (const s of d.strata) {
            assert.strictEqual(s.n, 20);
            assert.ok(Math.abs(s.a - s.b) <= 1, `Stratum ${s.q} in ${deckId} should be balanced`);
        }
    }
    console.log('testStratifiedBalance passed');
}

async function testPreserveExisting() {
    const rng = seededRng(456);
    const initialMetas = Array.from({ length: 20 }, (_, i) => ({ cardId: `c${i}`, deckId: 'd1', difficulty: i / 20 }));
    const { assignment: a1 } = await ensureAssignment({}, initialMetas, rng);

    const newMetas = [
        ...initialMetas,
        ...Array.from({ length: 30 }, (_, i) => ({ cardId: `new${i}`, deckId: 'd1', difficulty: i / 30 }))
    ];
    
    const { assignment: a2, stats } = await ensureAssignment(a1, newMetas, seededRng(789));
    
    // Check stability
    for (const m of initialMetas) {
        assert.strictEqual(a2[m.cardId], a1[m.cardId]);
    }
    
    // Check overall balance
    const d = stats.byDeck['d1'];
    assert.strictEqual(d.total, 50);
    assert.ok(Math.abs(d.assignedA - d.assignedB) <= 1);
    
    console.log('testPreserveExisting passed');
}

async function testRandomMethodStillWorks() {
    const rng = seededRng(111);
    const cardMetas = Array.from({ length: 100 }, (_, i) => ({ cardId: `c${i}`, deckId: 'd1', difficulty: 0.5 }));
    const { assignment, stats } = await ensureAssignment({}, cardMetas, rng, { method: 'random_v1' });
    
    assert.strictEqual(stats.method, 'random_v1');
    assert.strictEqual(Object.keys(assignment).length, 100);
    
    console.log('testRandomMethodStillWorks passed');
}

(async () => {
    try {
        await testStratifiedBalance();
        await testPreserveExisting();
        await testRandomMethodStillWorks();
        console.log('All stratified assignment tests passed!');
    } catch (e) {
        console.error('Tests failed:', e);
        process.exit(1);
    }
})();
