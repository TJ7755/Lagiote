import { getDB } from './db.js';

const STORE_NAME = 'appData';

async function get(key) {
    const db = getDB();
    if (!db) return null;
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readonly');
        const store = tx.objectStore(STORE_NAME);
        const req = store.get(key);
        req.onsuccess = () => resolve(req.result ? req.result.value : null);
        req.onerror = () => reject(req.error);
    });
}

async function put(key, value) {
    const db = getDB();
    if (!db) return;
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readwrite');
        const store = tx.objectStore(STORE_NAME);
        const req = store.put({ key, value });
        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error);
    });
}

export async function loadEvalConfig(userID) {
    const config = await get(`eval:config:${userID}`);
    return config || {
        enabled: true,
        experiment: {
            mode: 'STEP_LEVEL_ROUTER', // 'STEP_LEVEL_ROUTER' | 'CARD_LEVEL_SPLIT'
            experimentId: null,
            createdAt: null,
            assignmentMethod: 'stratified_v1'
        },
        router: {
            policyA: 'cortex',
            policyB: 'baseline',
            pA: 0.5,
            seed: null
        },
        probes: {
            enabled: true,
            sampleRate: 0.12,
            delaysHours: [6, 24, 72],
            maxPending: 200,
            maxCompleted: 5000,
            maxLatenessHours: 240
        },
        logging: {
            maxEvents: 20000
        }
    };
}

export async function loadExperimentHeader(userID, experimentId) {
    return await get(`eval:experiment:${userID}:${experimentId}`);
}

export async function saveExperimentHeader(userID, experimentId, header) {
    await put(`eval:experiment:${userID}:${experimentId}`, header);
}

export async function ensureExperimentHeader(userID, config, appInfo = {}) {
    if (!config || !config.experiment || !config.experiment.experimentId) {
        return null;
    }
    const experimentId = config.experiment.experimentId;
    const existing = await loadExperimentHeader(userID, experimentId);
    if (existing) {
        return existing;
    }

    const header = {
        userID,
        experimentId,
        createdAt: Date.now(),
        mode: config.experiment.mode,
        router: { ...config.router },
        probes: { ...config.probes },
        baseline: {
            version: 1,
            description: 'FSRS due -> recency/retrievability -> RNG tie-break'
        },
        app: {
            version: appInfo.version || null,
            build: appInfo.build || null
        },
        integrity: {
            startedAt: Date.now(),
            lastConfigChangeAt: null
        }
    };

    await saveExperimentHeader(userID, experimentId, header);
    return header;
}

export async function saveEvalConfig(userID, config) {
    await put(`eval:config:${userID}`, config);
}

export async function appendEvalEvent(userID, event, maxEvents) {
    const key = `eval:events:${userID}`;
    let events = (await get(key)) || [];
    events.push(event);
    if (events.length > maxEvents) {
        events = events.slice(events.length - maxEvents);
    }
    await put(key, events);
}

export async function loadEvalEvents(userID) {
    return (await get(`eval:events:${userID}`)) || [];
}

export async function loadPendingProbes(userID) {
    return (await get(`eval:probes:pending:${userID}`)) || [];
}

export async function savePendingProbes(userID, probes) {
    await put(`eval:probes:pending:${userID}`, probes);
}

export async function loadCompletedProbes(userID) {
    return (await get(`eval:probes:completed:${userID}`)) || [];
}

export async function appendCompletedProbe(userID, result, maxCompleted) {
    const key = `eval:probes:completed:${userID}`;
    let completed = (await get(key)) || [];
    completed.push(result);
    if (completed.length > maxCompleted) {
        completed = completed.slice(completed.length - maxCompleted);
    }
    await put(key, completed);
}

export async function loadFingerprint(userID, cardId) {
    return await get(`eval:fingerprint:${userID}:${cardId}`);
}

export async function saveFingerprint(userID, cardId, fingerprintObj) {
    await put(`eval:fingerprint:${userID}:${cardId}`, fingerprintObj);
}

export async function clearEvalData(userID) {
    const db = getDB();
    if (!db) return;
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    store.delete(`eval:events:${userID}`);
    store.delete(`eval:probes:pending:${userID}`);
    store.delete(`eval:probes:completed:${userID}`);
}

export async function loadAssignment(userID, experimentId) {
    return await get(`eval:assignment:${userID}:${experimentId}`);
}

export async function saveAssignment(userID, experimentId, map) {
    await put(`eval:assignment:${userID}:${experimentId}`, map);
}

function shuffle(array, rng) {
    for (let i = array.length - 1; i > 0; i--) {
        const j = Math.floor(rng() * (i + 1));
        [array[i], array[j]] = [array[j], array[i]];
    }
}

export async function ensureAssignment(userID, experimentId, cardMetas, rng, opts = {}) {
    const { method = 'stratified_v1', quantiles = 5, pA = 0.5 } = opts;
    let assignment = (await loadAssignment(userID, experimentId)) || {};
    let changed = false;

    // Handle legacy call signature: ensureAssignment(userID, experimentId, cardIds, rng, pA)
    let metas = cardMetas;
    let actualPA = pA;
    if (Array.isArray(cardMetas) && cardMetas.length > 0 && typeof cardMetas[0] === 'string') {
        metas = cardMetas.map(id => ({ cardId: id, deckId: 'default', difficulty: 0.5 }));
        actualPA = typeof rng === 'number' ? rng : pA; // If 4th arg is number, it's pA
    }

    if (method === 'random_v1') {
        for (const meta of metas) {
            if (!assignment[meta.cardId]) {
                assignment[meta.cardId] = rng() < actualPA ? 'A' : 'B';
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
                const unassigned = bin.filter(m => !assignment[m.cardId]);
                
                if (unassigned.length > 0) {
                    shuffle(unassigned, rng);
                    
                    // Count current balance in this deck to decide who starts
                    let deckA = 0;
                    let deckB = 0;
                    for (const m of deckMetas) {
                        if (assignment[m.cardId] === 'A') deckA++;
                        else if (assignment[m.cardId] === 'B') deckB++;
                    }

                    let nextArm = deckA <= deckB ? 'A' : 'B';
                    for (const m of unassigned) {
                        assignment[m.cardId] = nextArm;
                        nextArm = nextArm === 'A' ? 'B' : 'A';
                        changed = true;
                    }
                }
            }
        }
    }

    if (changed) {
        await saveAssignment(userID, experimentId, assignment);
    }

    // Compute stats
    const stats = {
        method,
        quantiles,
        byDeck: {}
    };

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
        
        let assignedA = 0;
        let assignedB = 0;
        const strata = [];

        for (let q = 0; q < quantiles; q++) {
            const start = q * qSize;
            const end = Math.min(start + qSize, n);
            if (start >= end) {
                strata.push({ q, n: 0, a: 0, b: 0, difficultyRange: [0, 0] });
                continue;
            }

            const bin = deckMetas.slice(start, end);
            let a = 0;
            let b = 0;
            for (const m of bin) {
                if (assignment[m.cardId] === 'A') a++;
                else if (assignment[m.cardId] === 'B') b++;
            }
            assignedA += a;
            assignedB += b;
            strata.push({
                q,
                n: bin.length,
                a,
                b,
                difficultyRange: [bin[0].difficulty, bin[bin.length - 1].difficulty]
            });
        }

        stats.byDeck[deckId] = {
            total: n,
            assignedA,
            assignedB,
            strata
        };
    }

    return { assignment, stats };
}
