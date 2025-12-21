import { getDataFromDB, saveDataToDB, DEFAULT_USER_ID } from './db.js';

export const DEFAULT_IMPLICIT_WEIGHTS = {
    intercept: 1.0,
    zLatency: -0.8,
    zFirstAction: -0.5,
    corrections: -1.2,
    attemptsMinus1: -1.5,
    backspaces: -2.0,
    pauses: -0.5,
    focusLoss: -1.0
};

const IMPLICIT_FEATURE_NAMES = [
    'intercept',
    'zLatency',
    'zFirstAction',
    'corrections',
    'attemptsMinus1',
    'backspaces',
    'pauses',
    'focusLoss'
];

const RELIABILITY_FEATURE_NAMES = IMPLICIT_FEATURE_NAMES.filter(name => name !== 'intercept');

export const DEFAULT_IMPLICIT_RELIABILITY = RELIABILITY_FEATURE_NAMES.reduce((acc, name) => {
    acc[name] = 1.0;
    return acc;
}, {});

export const DEFAULT_CALIBRATION_BINS = Array.from({ length: 10 }, () => ({ n: 0, s: 0 }));

function clamp(val, min, max) {
    return Math.min(max, Math.max(min, val));
}

function cloneCalibrationBins(bins = DEFAULT_CALIBRATION_BINS) {
    return bins.map(bin => ({
        n: Number.isFinite(bin?.n) ? Math.max(0, Math.floor(bin.n)) : 0,
        s: Number.isFinite(bin?.s) ? Math.max(0, Math.floor(bin.s)) : 0
    }));
}

export function bucketIndex(p, binsCount = DEFAULT_CALIBRATION_BINS.length) {
    const candidate = Number(p);
    const clamped = Number.isFinite(candidate) ? clamp(candidate, 0, 1) : 0;
    const count = Number.isFinite(binsCount) && binsCount > 0 ? Math.floor(binsCount) : DEFAULT_CALIBRATION_BINS.length;
    if (clamped >= 1) return count - 1;
    return clamp(Math.floor(clamped * count), 0, count - 1);
}

export function migrateCalibrationPayload(payload = {}) {
    const version = Number.isFinite(payload.version) ? payload.version : 0;
    const next = { ...payload };
    next.version = version >= 3 ? version : 3;
    if (Array.isArray(next.bins) && next.bins.length === DEFAULT_CALIBRATION_BINS.length) {
        next.bins = cloneCalibrationBins(next.bins);
    } else {
        next.bins = cloneCalibrationBins(DEFAULT_CALIBRATION_BINS);
    }
    return next;
}

function normalizeFeature(value, fallback) {
    const num = Number(value);
    return Number.isFinite(num) ? num : fallback;
}

function sigmoid(x) {
    return 1 / (1 + Math.exp(-x));
}

function toWeightArray(weightsObj = {}) {
    return IMPLICIT_FEATURE_NAMES.map(name => {
        const candidate = weightsObj[name];
        return typeof candidate === 'number' ? candidate : DEFAULT_IMPLICIT_WEIGHTS[name];
    });
}

function toWeightObject(weightsArray) {
    const obj = {};
    IMPLICIT_FEATURE_NAMES.forEach((name, idx) => {
        obj[name] = weightsArray[idx];
    });
    return obj;
}

export function buildImplicitFeatureVector(metrics = {}, userBaseline = {}) {
    const baseLatency = userBaseline.latency || 2500;

    const latency = normalizeFeature(metrics.recallLatency, baseLatency);
    const zLatency = (latency - baseLatency) / (baseLatency * 0.5);

    const timeToFirst = normalizeFeature(metrics.timeToFirstAction, 500);
    const zFirstAction = (timeToFirst - 500) / 300;

    const corrections = normalizeFeature(metrics.totalCorrections, 0);
    const attempts = normalizeFeature(metrics.attemptCount, 1);
    const backspaces = normalizeFeature(metrics.backspaceRate, 0);
    const pauses = normalizeFeature(metrics.hesitationPauses, 0);
    const focusLoss = normalizeFeature(metrics.focusLossCount, 0);

    const x = [
        1,
        zLatency,
        zFirstAction,
        corrections,
        attempts - 1,
        backspaces,
        pauses,
        focusLoss
    ];

    return {
        x,
        featureNames: IMPLICIT_FEATURE_NAMES.slice(),
        raw: {
            zLatency,
            zFirstAction,
            corrections,
            attempts,
            attemptsMinus1: attempts - 1,
            backspaces,
            pauses,
            focusLoss
        }
    };
}

export function predictPCorrectFromWeights(weightsObj, x) {
    const weights = toWeightArray(weightsObj);
    const dot = weights.reduce((acc, w, idx) => acc + w * (x[idx] || 0), 0);
    return sigmoid(dot);
}

export function applyReliability(weightsObj = {}, reliabilityObj = {}) {
    const effective = {};
    IMPLICIT_FEATURE_NAMES.forEach((name, idx) => {
        const weight = typeof weightsObj[name] === 'number' ? weightsObj[name] : DEFAULT_IMPLICIT_WEIGHTS[name];
        if (idx === 0) {
            effective[name] = weight;
            return;
        }
        const reliability = typeof reliabilityObj[name] === 'number' ? reliabilityObj[name] : DEFAULT_IMPLICIT_RELIABILITY[name];
        effective[name] = weight * reliability;
    });
    return effective;
}

export function updateImplicitWeights(weightsObj, x, y, opts = {}) {
    const lr = typeof opts.lr === 'number' ? opts.lr : 0.02;
    const l2 = typeof opts.l2 === 'number' ? opts.l2 : 0;
    const maxDelta = typeof opts.maxDelta === 'number' ? opts.maxDelta : 0.03;
    const maxNorm = typeof opts.maxNorm === 'number' ? opts.maxNorm : 0.08;
    const weights = toWeightArray(weightsObj);
    const prediction = predictPCorrectFromWeights(weightsObj, x);
    const error = y - prediction;
    const decay = 1 - lr * l2;
    const deltas = [];

    for (let i = 0; i < weights.length; i++) {
        const decayed = weights[i] * decay;
        const proposed = decayed + (lr * error * (x[i] || 0));
        const delta = proposed - weights[i];
        const clipped = Math.max(-maxDelta, Math.min(maxDelta, delta));
        deltas[i] = clipped;
    }

    const norm = Math.sqrt(deltas.reduce((acc, d) => acc + (d * d), 0));
    const scale = norm > maxNorm && norm > 0 ? maxNorm / norm : 1;

    const next = weights.map((w, idx) => w + (deltas[idx] * scale));
    return toWeightObject(next);
}

export function updateImplicitReliability(reliabilityObj, weightsObj, x, y, p, opts = {}) {
    const lr = typeof opts.lr_r === 'number' ? opts.lr_r : 0.01;
    const rMin = typeof opts.rMin === 'number' ? opts.rMin : 0.2;
    const maxDelta = typeof opts.maxDeltaR === 'number' ? opts.maxDeltaR : 0.02;
    const weights = toWeightArray(weightsObj);
    const current = { ...DEFAULT_IMPLICIT_RELIABILITY, ...(reliabilityObj || {}) };
    const next = { ...current };
    const err = Math.abs(y - p);

    for (let i = 1; i < IMPLICIT_FEATURE_NAMES.length; i++) {
        const name = IMPLICIT_FEATURE_NAMES[i];
        const xi = x[i] || 0;
        if (xi === 0) continue;
        const contribution = weights[i] * xi;
        const agreement = (y === 1 && contribution >= 0) || (y === 0 && contribution <= 0) ? 1 : -1;
        const delta = clamp(lr * err * agreement, -maxDelta, maxDelta);
        const updated = clamp(next[name] + delta, rMin, 1.0);
        next[name] = updated;
    }

    return next;
}

export function wilsonInterval(s, n, z = 1.64) {
    const nVal = Number(n);
    const sVal = Number(s);
    if (!Number.isFinite(nVal) || nVal <= 0) return { lo: 0, hi: 1 };
    const trials = nVal;
    const successes = clamp(Number.isFinite(sVal) ? sVal : 0, 0, trials);
    const zVal = Number.isFinite(z) ? z : 1.64;
    const phat = successes / trials;
    const z2 = zVal * zVal;
    const denom = 1 + (z2 / trials);
    const center = (phat + (z2 / (2 * trials))) / denom;
    const radicand = ((phat * (1 - phat)) + (z2 / (4 * trials))) / trials;
    const halfWidth = (zVal * Math.sqrt(Math.max(0, radicand))) / denom;
    return {
        lo: clamp(center - halfWidth, 0, 1),
        hi: clamp(center + halfWidth, 0, 1)
    };
}

export function calibratePrediction(pPred, bins = DEFAULT_CALIBRATION_BINS, opts = {}) {
    const binsCount = typeof opts.binsCount === 'number' ? opts.binsCount : DEFAULT_CALIBRATION_BINS.length;
    const priorN = typeof opts.priorN === 'number' ? opts.priorN : 4;
    const priorS = typeof opts.priorS === 'number' ? opts.priorS : 2;
    const k = typeof opts.k === 'number' ? opts.k : 25;
    const z = typeof opts.z === 'number' ? opts.z : 1.64;

    const p = clamp(Number(pPred) || 0, 0, 1);
    const idx = bucketIndex(p, binsCount);
    const resolvedBins = Array.isArray(bins) && bins.length === DEFAULT_CALIBRATION_BINS.length
        ? bins
        : DEFAULT_CALIBRATION_BINS;
    const bin = resolvedBins[idx] || { n: 0, s: 0 };

    const nRaw = Number.isFinite(bin.n) ? Math.max(0, Math.floor(bin.n)) : 0;
    const sRaw = Number.isFinite(bin.s) ? Math.max(0, Math.floor(bin.s)) : 0;
    const nEff = nRaw + Math.max(0, priorN);
    const sEff = clamp(sRaw + Math.max(0, priorS), 0, nEff);
    const binMean = nEff > 0 ? (sEff / nEff) : 0.5;
    const lambda = nRaw / (nRaw + Math.max(1e-6, k));
    const pCal = clamp(((1 - lambda) * p) + (lambda * binMean), 0, 1);

    const interval = wilsonInterval(sEff, nEff, z);
    const pLower = Math.max(0, Math.min(pCal, interval.lo));
    const pUpper = Math.min(1, Math.max(pCal, interval.hi));

    return {
        pCal,
        pLower,
        pUpper,
        binIndex: idx,
        binMean,
        n: nRaw
    };
}

export function updateCalibrationBins(bins = DEFAULT_CALIBRATION_BINS, pPred, y) {
    const resolved = Array.isArray(bins) && bins.length === DEFAULT_CALIBRATION_BINS.length
        ? bins
        : DEFAULT_CALIBRATION_BINS;
    const idx = bucketIndex(pPred, DEFAULT_CALIBRATION_BINS.length);
    const next = cloneCalibrationBins(resolved);
    next[idx].n += 1;
    next[idx].s += y ? 1 : 0;
    return next;
}

export async function loadImplicitCalibration(userID = DEFAULT_USER_ID) {
    const key = `cortexImplicitCalibration:${userID}`;
    let stored = null;
    try {
        stored = await getDataFromDB('appData', key);
    } catch (_) {
        stored = null;
    }

    const payload = {
        key,
        userID,
        version: 3,
        weights: { ...DEFAULT_IMPLICIT_WEIGHTS },
        reliability: { ...DEFAULT_IMPLICIT_RELIABILITY },
        bins: cloneCalibrationBins(DEFAULT_CALIBRATION_BINS),
        updates: 0,
        lastUpdated: null,
        stats: { n: 0, brierEma: null }
    };

    if (stored) {
        const migrated = migrateCalibrationPayload(stored);
        payload.version = migrated.version;
        payload.weights = { ...DEFAULT_IMPLICIT_WEIGHTS, ...(stored.weights || {}) };
        payload.reliability = stored.reliability
            ? { ...DEFAULT_IMPLICIT_RELIABILITY, ...stored.reliability }
            : { ...DEFAULT_IMPLICIT_RELIABILITY };
        payload.bins = Array.isArray(migrated.bins) ? cloneCalibrationBins(migrated.bins) : payload.bins;
        payload.updates = Number.isFinite(stored.updates) ? stored.updates : 0;
        payload.lastUpdated = stored.lastUpdated || null;
        payload.stats = stored.stats || payload.stats;
    }

    return payload;
}

export async function saveImplicitCalibration(userID = DEFAULT_USER_ID, payload = {}) {
    const key = `cortexImplicitCalibration:${userID}`;
    const record = {
        key,
        userID,
        version: 3,
        weights: { ...DEFAULT_IMPLICIT_WEIGHTS, ...(payload.weights || {}) },
        reliability: { ...DEFAULT_IMPLICIT_RELIABILITY, ...(payload.reliability || {}) },
        bins: Array.isArray(payload.bins) ? cloneCalibrationBins(payload.bins) : cloneCalibrationBins(DEFAULT_CALIBRATION_BINS),
        updates: Number.isFinite(payload.updates) ? payload.updates : 0,
        lastUpdated: payload.lastUpdated || new Date().toISOString(),
        stats: payload.stats || { n: 0, brierEma: null }
    };
    await saveDataToDB('appData', record);
    return record;
}

export function _debugCalibrationSanityCheck() {
    const weights = { ...DEFAULT_IMPLICIT_WEIGHTS };
    const reliability = { ...DEFAULT_IMPLICIT_RELIABILITY };
    const syntheticMetrics = {
        recallLatency: 5000,
        timeToFirstAction: 2000,
        totalCorrections: 2,
        attemptCount: 2,
        backspaceRate: 0.6,
        hesitationPauses: 2,
        focusLossCount: 1
    };
    const { x } = buildImplicitFeatureVector(syntheticMetrics, {});
    const before = predictPCorrectFromWeights(applyReliability(weights, reliability), x);
    const updated = updateImplicitWeights(weights, x, 1, { lr: 0.02, l2: 0.0005, maxDelta: 0.03, maxNorm: 0.08 });
    const after = predictPCorrectFromWeights(applyReliability(updated, reliability), x);
    IMPLICIT_FEATURE_NAMES.forEach(name => {
        const delta = Math.abs(updated[name] - weights[name]);
        console.assert(delta <= 0.03 + 1e-6, `Delta for ${name} exceeded cap: ${delta}`);
    });
    console.assert(after > before, 'Updated weights should increase probability for positive outcome');
    const nextReliability = updateImplicitReliability(reliability, weights, x, 1, before, { lr_r: 0.01, rMin: 0.2, maxDeltaR: 0.02 });
    RELIABILITY_FEATURE_NAMES.forEach(name => {
        const delta = Math.abs(nextReliability[name] - reliability[name]);
        console.assert(delta <= 0.02 + 1e-6, `Reliability delta for ${name} exceeded cap: ${delta}`);
        console.assert(nextReliability[name] >= 0.2 - 1e-6, `Reliability for ${name} fell below minimum: ${nextReliability[name]}`);
    });
    console.assert(nextReliability.zLatency < reliability.zLatency, 'Reliability should decrease when contribution contradicts outcome');

    const empty = cloneCalibrationBins(DEFAULT_CALIBRATION_BINS);
    const pPred = clamp(before, 0, 1);
    const initial = calibratePrediction(pPred, empty, { k: 25, priorN: 4, priorS: 2, z: 1.64 });
    console.assert(Math.abs(initial.pCal - pPred) < 1e-9, 'With empty bins pCal should match pPred');

    let bins = empty;
    for (let i = 0; i < 50; i++) {
        bins = updateCalibrationBins(bins, 0.8, 0);
    }
    const degraded = calibratePrediction(0.8, bins, { k: 25, priorN: 4, priorS: 2, z: 1.64 });
    console.assert(degraded.binMean < 0.4, 'Bin mean should drop after consistent failure');
    console.assert(degraded.pCal < 0.8, 'pCal should decrease after consistent failure');
    console.assert(degraded.pLower <= degraded.pCal && degraded.pCal <= degraded.pUpper, 'Interval should wrap pCal');
    return { before, after, updated, nextReliability };
}
