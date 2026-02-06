import { FSRSAlgorithm } from './fsrs.js';
import { initDB, getDB, getDataFromDB, saveDataToDB, getAllDataFromDB, deleteDataFromDB, DEFAULT_USER_ID } from './db.js';
import { DEFAULT_CALIBRATION_BINS, DEFAULT_IMPLICIT_RELIABILITY, DEFAULT_IMPLICIT_WEIGHTS, applyReliability, buildImplicitFeatureVector, calibratePrediction, predictPCorrectFromWeights, loadImplicitCalibration, saveImplicitCalibration, updateCalibrationBins, updateImplicitReliability, updateImplicitWeights } from './cortex-calibration.js';

const DEFAULT_HORIZON_DAYS = 3;
let fsrsInstance = null;
let fsrsPromise = null;

const cortexState = {
    modelConfig: null,
    modelPredictor: null,
    nowProvider: () => new Date(),
    debugEnabled: false,
    featureNames: null,
    implicitCalibration: {
        loaded: false,
        userID: DEFAULT_USER_ID,
        weights: { ...DEFAULT_IMPLICIT_WEIGHTS },
        reliability: { ...DEFAULT_IMPLICIT_RELIABILITY },
        bins: DEFAULT_CALIBRATION_BINS.map(bin => ({ ...bin })),
        updates: 0,
        stats: { n: 0, brierEma: null },
        lastUpdated: null
    }
};

const MODEL_STORAGE_KEY = 'cortexModelV1';
const TRAINING_STORE_NAME = 'cortexTrainingData';
const MODEL_VERSION = 1;
const MIN_PREDICTION_CONFIDENCE = 0.75;
const NEURAL_FEATURE_KEYS = [
    'reps',
    'retrievabilityNow',
    'volatility',
    'lastLatency',
    'sessionMeanLatency',
    'timesSeenThisSession',
    'cardAvgTime',
    'hasExamDate',
    'daysToExam',
    'minutesSinceLastReview'
];
const TRAINING_SAMPLE_LIMIT = 5000;
const TRAINING_TRIGGER_COUNT = 25;
const TRAINING_BATCH_SIZE = 64;
const LEARNING_RATE_GAIN = 0.015;
const LEARNING_RATE_TIME = 0.01;
const MIN_TIME_COST = 2.0;
const MAX_TIME_COST = 60.0;
const DEFAULT_TIME_COST_SECONDS = 5.0;
const IMPLICIT_PERSIST_EVERY = 10;
const BRIER_EMA_ALPHA = 0.02;
const IMPLICIT_UPDATE_OPTS = { lr: 0.02, l2: 0.0005, maxDelta: 0.03, maxNorm: 0.08 };
const IMPLICIT_RELIABILITY_OPTS = { lr_r: 0.01, rMin: 0.2, maxDeltaR: 0.02 };
const TIME_FEATURE_KEYS = ['zLatency', 'zFirstAction', 'pauses', 'focusLoss'];
const IMPLICIT_CALIBRATION_OPTS = { binsCount: 10, priorN: 4, priorS: 2, k: 25, z: 1.64 };
const INTERFERENCE_FRAGILITY_ALPHA = 0.12;
const INTERFERENCE_FRAGILITY_DECAY = 0.06;
const INTERFERENCE_PRIORITY_WEIGHT = 0.35;
const INTERFERENCE_MASTERY_BLOCK_THRESHOLD = 0.35;

// --- Helpers ---

function getNow(nowProvider) {
    const now = typeof nowProvider === 'function' ? nowProvider() : new Date();
    return now instanceof Date ? now : new Date(now);
}

async function getFsrsEngine() {
    if (fsrsInstance) return fsrsInstance;
    if (!fsrsPromise) {
        fsrsPromise = (async () => {
            const engine = new FSRSAlgorithm();
            await engine.init();
            fsrsInstance = engine;
            return engine;
        })();
    }
    return fsrsPromise;
}

function normalizeFeature(value, fallback) {
    const num = Number(value);
    return Number.isFinite(num) ? num : fallback;
}

function sigmoid(x) {
    return 1 / (1 + Math.exp(-x));
}

function clamp(val, min, max) {
    return Math.min(max, Math.max(min, val));
}

function computeProbeCalibrationScale(context) {
    const probe = context?.interference;
    if (!probe || probe.type !== 'probe') return 1;
    const similarityRaw = Number(probe.similarity);
    const similarity = Number.isFinite(similarityRaw) ? clamp(similarityRaw, 0, 1) : 0;
    return clamp(0.6 + 0.4 * (1 - similarity), 0.6, 1.0);
}

function computeFormatCalibrationScale(context) {
    if (context?.format === 'mcq') {
        if (context?.subformat === 'remediation') return 0.4;
        return 0.5;
    }
    return 1.0;
}

function updateInterferenceFragilityEma(prevEma, explicitCorrectness, similarity) {
    const ema = clamp(normalizeFeature(prevEma, 0), 0, 1);
    const simRaw = Number(similarity);
    const sim = Number.isFinite(simRaw) ? clamp(simRaw, 0, 1) : 0;
    const severity = clamp(0.5 + 0.5 * sim, 0.5, 1.0);
    if (explicitCorrectness === true) {
        return clamp(ema * (1 - INTERFERENCE_FRAGILITY_DECAY), 0, 1);
    }
    if (explicitCorrectness === false) {
        return clamp((ema * (1 - INTERFERENCE_FRAGILITY_ALPHA)) + (INTERFERENCE_FRAGILITY_ALPHA * severity), 0, 1);
    }
    return ema;
}

function applyExamPressureDamp(reliability, examPressure) {
    if (!Number.isFinite(examPressure)) return reliability;
    const pressure = clamp(examPressure, 0, 1);
    const damp = 1 - (0.5 * pressure);
    const adjusted = { ...reliability };
    TIME_FEATURE_KEYS.forEach(key => {
        if (typeof adjusted[key] === 'number') {
            adjusted[key] *= damp;
        }
    });
    return adjusted;
}

async function ensureImplicitCalibration(userID = DEFAULT_USER_ID) {
    const state = cortexState.implicitCalibration;
    if (state.loaded && state.userID === userID) return state;
    let loaded = null;
    try {
        loaded = await loadImplicitCalibration(userID);
    } catch (error) {
        if (cortexState.debugEnabled) {
            console.warn('[ImplicitCalibration] Failed to load calibration, using defaults', error);
        }
    }
    cortexState.implicitCalibration = {
        loaded: true,
        userID,
        weights: loaded?.weights || { ...DEFAULT_IMPLICIT_WEIGHTS },
        reliability: loaded?.reliability || { ...DEFAULT_IMPLICIT_RELIABILITY },
        bins: Array.isArray(loaded?.bins) ? loaded.bins : DEFAULT_CALIBRATION_BINS.map(bin => ({ ...bin })),
        updates: loaded?.updates || 0,
        stats: loaded?.stats || { n: 0, brierEma: null },
        lastUpdated: loaded?.lastUpdated || null
    };
    return cortexState.implicitCalibration;
}

function getImplicitWeightsForUser(userID = DEFAULT_USER_ID) {
    const state = cortexState.implicitCalibration;
    if (state.loaded && state.userID === userID && state.weights) return state.weights;
    return DEFAULT_IMPLICIT_WEIGHTS;
}

function getImplicitReliabilityForUser(userID = DEFAULT_USER_ID) {
    const state = cortexState.implicitCalibration;
    if (state.loaded && state.userID === userID && state.reliability) return state.reliability;
    return DEFAULT_IMPLICIT_RELIABILITY;
}

function getImplicitCalibrationBinsForUser(userID = DEFAULT_USER_ID) {
    const state = cortexState.implicitCalibration;
    if (state.loaded && state.userID === userID && Array.isArray(state.bins)) return state.bins;
    return DEFAULT_CALIBRATION_BINS;
}

async function persistImplicitCalibration() {
    const state = cortexState.implicitCalibration;
    if (!state || !state.loaded) return;
    const lastUpdated = new Date().toISOString();
    try {
        await saveImplicitCalibration(state.userID || DEFAULT_USER_ID, {
            weights: state.weights,
            reliability: state.reliability,
            bins: state.bins,
            updates: state.updates || 0,
            lastUpdated,
            stats: state.stats || { n: 0, brierEma: null }
        });
        state.lastUpdated = lastUpdated;
    } catch (error) {
        if (cortexState.debugEnabled) {
            console.warn('[ImplicitCalibration] Persist failed', error);
        }
    }
}

// --- 1. Implicit Inference ---

export function inferRetrievalOutcome(metrics, userBaseline = {}, explicitFeedback = null, context = {}) {
    const featureVector = buildImplicitFeatureVector(metrics, userBaseline);
    const userID = cortexState.implicitCalibration?.userID || DEFAULT_USER_ID;
    const testCalibration = (typeof process !== 'undefined'
        && process.env?.NODE_ENV === 'test'
        && context?._testCalibrationPayload)
        ? context._testCalibrationPayload
        : null;
    const weights = testCalibration?.weights || getImplicitWeightsForUser(userID);
    const reliabilitySource = testCalibration?.reliability || getImplicitReliabilityForUser(userID);
    const reliability = applyExamPressureDamp(reliabilitySource, context?.examPressure);
    const bins = testCalibration?.bins || getImplicitCalibrationBinsForUser(userID);
    const effectiveWeights = applyReliability(weights, reliability);
    const pPred = predictPCorrectFromWeights(effectiveWeights, featureVector.x);
    const calibrated = calibratePrediction(pPred, bins, IMPLICIT_CALIBRATION_OPTS);
    const pLowerBase = calibrated.pLower;
    const pUpperBase = calibrated.pUpper;
    const computeConfidence = (pLower, pUpper) => {
        const intervalWidth = clamp(pUpper - pLower, 0, 1);
        return clamp(1 - intervalWidth, 0.05, 0.99);
    };
    const intervalWidth = clamp(pUpperBase - pLowerBase, 0, 1);
    const confidence = computeConfidence(pLowerBase, pUpperBase);
    const evidenceSigmaBase = 0.5 * intervalWidth;
    
    // --- Explicit Feedback Integration ---
    if (explicitFeedback === false) {
        const pLower = 0.01;
        const pUpper = 0.15;
        const intervalWidthExplicit = clamp(pUpper - pLower, 0, 1);
        const evidenceSigma = 0.5 * intervalWidthExplicit;
        return { 
            pCorrect: 0.05, 
            pLower,
            pUpper,
            evidenceSigma,
            volatility: evidenceSigma,
            confidence: computeConfidence(pLower, pUpper)
        };
    } else if (explicitFeedback === true) {
        const base = clamp(calibrated.pCal, 1e-6, 1 - 1e-6);
        const logOdds = Math.log(base / (1 - base)) + 1.5;
        const pCorrect = clamp(sigmoid(logOdds), 0.01, 0.99);
        const pLower = clamp(Math.min(pLowerBase + 0.10, pCorrect), 0.0, 1.0);
        const pUpper = clamp(Math.max(pUpperBase + 0.10, pCorrect), 0.0, 1.0);
        const intervalWidthExplicit = clamp(pUpper - pLower, 0, 1);
        const evidenceSigma = 0.5 * intervalWidthExplicit;
        return {
            pCorrect,
            pLower,
            pUpper,
            evidenceSigma,
            volatility: evidenceSigma,
            confidence: computeConfidence(pLower, pUpper)
        };
    }
    
    return {
        pCorrect: clamp(calibrated.pCal, 0.01, 0.99),
        pLower: clamp(pLowerBase, 0.0, 1.0),
        pUpper: clamp(pUpperBase, 0.0, 1.0),
        evidenceSigma: evidenceSigmaBase,
        volatility: evidenceSigmaBase,
        confidence: clamp(confidence, 0.1, 0.99)
    };
}

// --- FSRS Mapping ---

function validateProbabilityDistribution(probs) {
    const sum = probs.reduce((acc, p) => acc + p.prob, 0);
    if (Math.abs(sum - 1.0) > 0.001) {
        if (cortexState.debugEnabled) console.warn(`Probability distribution sums to ${sum}, normalizing.`);
        return probs.map(p => ({ ...p, prob: p.prob / sum }));
    }
    return probs;
}

export function mapPCorrectToOutcomeDistribution(pCorrect, confidence) {
    // pCorrect: Probability of recall (0..1)
    // confidence: Epistemic certainty of this pCorrect value (0..1)
    
    // Constants for distribution shapes
    const SHARPNESS = 1.0 + (3.0 * confidence); // Higher confidence = sharper peaks

    // We model outcomes as regions on the probability space.
    // However, FSRS outcomes are discrete {Again, Hard, Good, Easy}.
    // We map pCorrect to a base mass distribution, then sharpen/flatten based on confidence.

    let pAgain, pHard, pGood, pEasy;

    // Base Allocation (Monotonic heuristic)
    const pFail = 1.0 - pCorrect;
    pAgain = pFail;

    // Remaining mass (Success)
    const pSuccess = pCorrect;

    if (pCorrect < 0.5) {
        // Struggle region
        pHard = pSuccess * 0.7;
        pGood = pSuccess * 0.3;
        pEasy = 0;
    } else if (pCorrect < 0.85) {
        // Moderate region
        pHard = pSuccess * 0.3;
        pGood = pSuccess * 0.6;
        pEasy = pSuccess * 0.1;
    } else {
        // Mastery region
        pHard = pSuccess * 0.05;
        pGood = pSuccess * 0.25;
        pEasy = pSuccess * 0.7;
    }

    // Apply Confidence Sharpening
    // If confidence is LOW, we spread mass towards the center (Hard/Good) and increase entropy.
    // If confidence is HIGH, we concentrate mass on the most likely bucket.
    
    // Simple linear interpolation with a "High Uncertainty" Uniform Distribution
    // Uniform-ish over success outcomes + some failure
    if (confidence < 0.5) {
        const uncertainty = (0.5 - confidence) * 2; // 0..1
        // Mix with uniform success distribution
        const uSuccess = pSuccess / 3;
        pHard = (pHard * (1 - uncertainty)) + (uSuccess * uncertainty);
        pGood = (pGood * (1 - uncertainty)) + (uSuccess * uncertainty);
        pEasy = (pEasy * (1 - uncertainty)) + (uSuccess * uncertainty);
    }

    // Normalize
    const total = pAgain + pHard + pGood + pEasy;
    const norm = 1 / total;
    
    return [
        { rating: 'Again', prob: pAgain * norm },
        { rating: 'Hard', prob: pHard * norm },
        { rating: 'Good', prob: pGood * norm },
        { rating: 'Easy', prob: pEasy * norm }
    ];
}


function mapProbabilityToRating(pCorrect, confidence, engine, pLower = null) {
    const ratings = engine.getRatings();
    
    // Map pCorrect to Rating bands
    // Shift pessimistically if confidence is low to ensure safety
    // adjustedP = p - (uncertainty * penalty_factor)
    const uncertainty = 1.0 - confidence;
    const adjustedP = (typeof pLower === 'number' && Number.isFinite(pLower))
        ? pLower
        : (pCorrect - (uncertainty * 0.25));

    if (adjustedP < 0.45) return ratings.Again;
    if (adjustedP < 0.75) return ratings.Hard;
    if (adjustedP < 0.96) return ratings.Good;
    return ratings.Easy;
}

// --- 2. Uncertainty-Aware Update Logic ---

export async function processReview(card, knowledgeState, metrics, explicitFeedback = null, userBaseline = {}, context = {}) {
    const userID = knowledgeState?.userID || knowledgeState?.userId || DEFAULT_USER_ID;
    await ensureImplicitCalibration(userID).catch(() => null);
    const engine = await getFsrsEngine();
    const now = getNow(cortexState.nowProvider);
    const deckContext = context?.deck || null;
    const sessionContext = context?.sessionState || null;
    const priorFragility = clamp(normalizeFeature(knowledgeState?.interferenceFragilityEma, 0), 0, 1);
    const probeContext = context?.interference?.type === 'probe' ? context.interference : null;
    const nextFragility = (typeof explicitFeedback === 'boolean' && context?.calibrationTruth === true && probeContext)
        ? updateInterferenceFragilityEma(priorFragility, explicitFeedback, probeContext.similarity)
        : priorFragility;

    const preFeatures = await computeFeatures(card, knowledgeState, sessionContext, deckContext);
    const targetDate = buildTargetDate(deckContext, now);
    const preparedState = engine.prepareCard(knowledgeState?.fsrs || knowledgeState);
    const beforeRetrievability = await estimateRetrievabilityAt(engine, preparedState, targetDate);

    const inference = inferRetrievalOutcome(metrics, userBaseline, explicitFeedback, context);
    const ratings = engine.getRatings();
    let rating = mapProbabilityToRating(inference.pCorrect, inference.confidence, engine, inference.pLower);
    if (priorFragility > INTERFERENCE_MASTERY_BLOCK_THRESHOLD && rating === ratings.Easy) {
        rating = ratings.Good;
    }
    const result = await engine.reviewCard(knowledgeState, rating, now);

    const resolvedFsrs = result.fsrs || result;
    const afterState = engine.prepareCard(resolvedFsrs);
    const afterRetrievability = await estimateRetrievabilityAt(engine, afterState, targetDate);

    const lastReviewRaw = result.fsrs?.last_review || result.lastReviewed || now;
    const lastReviewedIso = new Date(lastReviewRaw).toISOString();
    const derivedStability = result.fsrs?.stability ?? result.stability ?? 0;

    const updatedState = {
        ...result,
        evidenceSigma: typeof inference.evidenceSigma === 'number' ? inference.evidenceSigma : inference.volatility,
        pLower: inference.pLower,
        pUpper: inference.pUpper,
        lastInference: inference,
        lastMetrics: metrics,
        lastRating: rating,
        rating,
        lastReviewed: lastReviewedIso,
        stability: derivedStability,
        interferenceFragilityEma: nextFragility
    };

    try {
        await recordNeuralTrainingExample({
            card,
            context,
            features: preFeatures,
            metrics,
            realizedGain: clamp(afterRetrievability - beforeRetrievability, 0, 1),
            realizedTimeCost: computeRealizedTimeCost(metrics, preFeatures.cardAvgTime)
        });
    } catch (error) {
        if (cortexState.debugEnabled) {
            console.warn('[NeuralPredictor] Training sample skipped', error);
        }
    }

    if (typeof explicitFeedback === 'boolean' && context?.calibrationTruth === true) {
        try {
            const featureVector = buildImplicitFeatureVector(metrics, userBaseline);
            const currentState = cortexState.implicitCalibration || {};
            const currentWeights = currentState.userID === userID && currentState.weights ? currentState.weights : getImplicitWeightsForUser(userID);
            const currentReliability = currentState.userID === userID && currentState.reliability ? currentState.reliability : getImplicitReliabilityForUser(userID);
            const currentBins = currentState.userID === userID && Array.isArray(currentState.bins) ? currentState.bins : getImplicitCalibrationBinsForUser(userID);
            const y = explicitFeedback ? 1 : 0;
            const effectiveWeights = applyReliability(currentWeights, currentReliability);
            const pHat = predictPCorrectFromWeights(effectiveWeights, featureVector.x);
            const nextBins = updateCalibrationBins(currentBins, pHat, y);
            const probeScale = computeProbeCalibrationScale(context);
            const formatScale = computeFormatCalibrationScale(context);
            const lrScale = probeScale * formatScale;
            const updateOpts = lrScale === 1 ? IMPLICIT_UPDATE_OPTS : { ...IMPLICIT_UPDATE_OPTS, lr: IMPLICIT_UPDATE_OPTS.lr * lrScale };
            const reliabilityOpts = lrScale === 1 ? IMPLICIT_RELIABILITY_OPTS : { ...IMPLICIT_RELIABILITY_OPTS, lr_r: IMPLICIT_RELIABILITY_OPTS.lr_r * lrScale };
            const nextWeights = updateImplicitWeights(currentWeights, featureVector.x, y, updateOpts);
            const nextReliability = updateImplicitReliability(currentReliability, currentWeights, featureVector.x, y, pHat, reliabilityOpts);
            const brier = (pHat - y) * (pHat - y);
            const prevStats = currentState.stats || { n: 0, brierEma: null };
            const nextStats = {
                n: (prevStats.n || 0) + 1,
                brierEma: prevStats.brierEma === null ? brier : (prevStats.brierEma * (1 - BRIER_EMA_ALPHA)) + (BRIER_EMA_ALPHA * brier)
            };
            cortexState.implicitCalibration = {
                ...currentState,
                loaded: true,
                userID,
                weights: nextWeights,
                reliability: nextReliability,
                bins: nextBins,
                updates: (currentState.updates || 0) + 1,
                stats: nextStats
            };
            if ((cortexState.implicitCalibration.updates % IMPLICIT_PERSIST_EVERY) === 0) {
                await persistImplicitCalibration();
            }
        } catch (error) {
            if (cortexState.debugEnabled) {
                console.warn('[ImplicitCalibration] Update failed', error);
            }
        }
    }

    return updatedState;
}

function computeRealizedTimeCost(metrics, fallbackSeconds = DEFAULT_TIME_COST_SECONDS) {
    const latencyMs = metrics && Number.isFinite(metrics.recallLatency) ? metrics.recallLatency : null;
    const seconds = latencyMs !== null ? latencyMs / 1000 : fallbackSeconds;
    if (!Number.isFinite(seconds)) return fallbackSeconds;
    return Math.min(MAX_TIME_COST, Math.max(MIN_TIME_COST, seconds));
}

async function recordNeuralTrainingExample({ card, context, features, metrics = {}, realizedGain, realizedTimeCost }) {
    const predictor = cortexState.modelPredictor;
    if (!predictor || !features) return;
    await predictor.recordExample(
        {
            cardID: card?.id,
            deck: context?.deck || null,
            features
        },
        {
            realizedGain,
            realizedTimeCost
        }
    );
}

const DETERMINISTIC_INFERENCES = {
    Again: { pCorrect: 0.05, pLower: 0.01, pUpper: 0.15, evidenceSigma: 0.07, confidence: 0.95, volatility: 0.07 },
    Hard: { pCorrect: 0.55, pLower: 0.40, pUpper: 0.70, evidenceSigma: 0.15, confidence: 0.95, volatility: 0.15 },
    Good: { pCorrect: 0.80, pLower: 0.65, pUpper: 0.90, evidenceSigma: 0.125, confidence: 0.95, volatility: 0.125 },
    Easy: { pCorrect: 0.95, pLower: 0.85, pUpper: 0.99, evidenceSigma: 0.07, confidence: 0.95, volatility: 0.07 }
};

function resolveRatingLabel(engine, rating) {
    const ratings = engine.getRatings();
    return Object.keys(ratings).find(key => ratings[key] === rating) || null;
}

function buildDeterministicInference(label) {
    if (label && DETERMINISTIC_INFERENCES[label]) {
        return DETERMINISTIC_INFERENCES[label];
    }
    return { pCorrect: 0.5, pLower: 0.25, pUpper: 0.75, evidenceSigma: 0.25, confidence: 0.5, volatility: 0.25 };
}

export async function processReviewWithRating(card, knowledgeState, fsrsRating, nowOverride = null, meta = {}, context = {}) {
    const engine = await getFsrsEngine();
    const now = nowOverride
        ? (nowOverride instanceof Date ? nowOverride : new Date(nowOverride))
        : getNow(cortexState.nowProvider);
    const deckContext = context?.deck || null;
    const sessionContext = context?.sessionState || null;

    const preFeatures = await computeFeatures(card, knowledgeState, sessionContext, deckContext);
    const targetDate = buildTargetDate(deckContext, now);
    const preparedState = engine.prepareCard(knowledgeState?.fsrs || knowledgeState);
    const beforeRetrievability = await estimateRetrievabilityAt(engine, preparedState, targetDate);

    const result = await engine.reviewCard(knowledgeState, fsrsRating, now);
    const resolvedFsrs = result.fsrs || result;
    const afterState = engine.prepareCard(resolvedFsrs);
    const afterRetrievability = await estimateRetrievabilityAt(engine, afterState, targetDate);

    const ratingLabel = resolveRatingLabel(engine, fsrsRating);
    const inference = buildDeterministicInference(ratingLabel);
    const evidenceSigma = (typeof knowledgeState?.evidenceSigma === 'number')
        ? knowledgeState.evidenceSigma
        : (typeof result?.evidenceSigma === 'number' ? result.evidenceSigma : 0.1);
    const lastReviewRaw = result.fsrs?.last_review || result.lastReviewed || now;
    const lastReviewedIso = new Date(lastReviewRaw).toISOString();
    const stability = result.fsrs?.stability ?? result.stability ?? 0;

    try {
        await recordNeuralTrainingExample({
            card,
            context,
            features: preFeatures,
            metrics: meta?.metrics,
            realizedGain: clamp(afterRetrievability - beforeRetrievability, 0, 1),
            realizedTimeCost: computeRealizedTimeCost(meta?.metrics, preFeatures.cardAvgTime)
        });
    } catch (error) {
        if (cortexState.debugEnabled) {
            console.warn('[NeuralPredictor] Training sample skipped', error);
        }
    }

    return {
        ...result,
        rating: fsrsRating,
        lastRating: fsrsRating,
        evidenceSigma,
        pLower: inference.pLower,
        pUpper: inference.pUpper,
        lastInference: inference,
        lastMetrics: meta?.metrics || null,
        lastReviewed: lastReviewedIso,
        interferenceFragilityEma: clamp(normalizeFeature(knowledgeState?.interferenceFragilityEma, 0), 0, 1),
        stability
    };
}


// --- 3. Expectation-Based Gain Calculation ---

async function calculateExpectedGain(engine, knowledgeState, deck, now, pCorrect, confidence) {
    const targetDate = buildTargetDate(deck, now);
    const prepared = engine.prepareCard(knowledgeState?.fsrs || knowledgeState);
    const currentRetrievability = await estimateRetrievabilityAt(engine, prepared, targetDate);
    
    // Use explicit mapping function
    let outcomes = mapPCorrectToOutcomeDistribution(pCorrect, confidence);
    
    // Validate Invariant: Sum to 1
    outcomes = validateProbabilityDistribution(outcomes);

    const ratings = engine.getRatings();
    let expectedGain = 0;
    
    // Get potential next states
    const nextStates = await engine.repeat(prepared, now); 

    for (const o of outcomes) {
        if (o.prob <= 0.0001) continue;
        
        const ratingVal = ratings[o.rating];
        const res = nextStates[ratingVal] || nextStates[o.rating]; 
        
        if (res) {
            const nextFsrs = { ...prepared, ...(res.card || res) };
            const nextR = await estimateRetrievabilityAt(engine, nextFsrs, targetDate);
            
            // Gain is change in retrievability at target date
            const rawGain = Math.max(0, nextR - currentRetrievability);
            
            // Invariant: Gain must be >= 0 (clamped above)
            
            // Note: We do NOT apply 'confidenceDiscount' here anymore. 
            // Gain is pure expected utility. Discounting happens in scoreCard.
            
            expectedGain += o.prob * rawGain;
        }
    }

    // Invariant Check
    if (expectedGain < 0 || expectedGain > 1.0) {
         if (cortexState.debugEnabled) console.warn(`ExpectedGain out of bounds: ${expectedGain}`);
         expectedGain = clamp(expectedGain, 0, 1.0);
    }

    return { 
        before: normalizeFeature(currentRetrievability, 0), 
        expectedGain: normalizeFeature(expectedGain, 0),
        probs: outcomes 
    };
}

// --- Helpers for Gain ---

export function buildTargetDate(deck, now) {
    const examDate = deck?.settings?.examDate ? new Date(deck.settings.examDate) : null;
    if (examDate && examDate > now) {
        return examDate;
    }

    const horizonValue = Number(deck?.settings?.learnHorizonDays ?? 0);
    if (Number.isFinite(horizonValue) && horizonValue > 0) {
        const target = new Date(now);
        target.setTime(target.getTime() + horizonValue * 86400000);
        return target;
    }

    const target = new Date(now);
    target.setTime(target.getTime() + DEFAULT_HORIZON_DAYS * 86400000);
    return target;
}

async function estimateRetrievabilityAt(engine, fsrsState, targetDate) {
    if (!fsrsState.last_review && fsrsState.state === 0) return 0; // New card R=0? Or 0 for gain calc purposes? 
    // For gain calc, if New card, current R is effectively 0 (unlearned).
    
    // We cheat FSRS to calculate R at targetDate.
    // FSRS expects 'now' to compute elapsed time.
    return engine.calculateRetrievability(fsrsState, targetDate);
}


// --- 4. Scoring Logic ---

export async function computeFeatures(card, knowledgeState, sessionState, deck) {
    const engine = await getFsrsEngine();
    const now = getNow(cortexState.nowProvider);
    const fsrsState = engine.prepareCard(knowledgeState?.fsrs || knowledgeState);
    const reps = normalizeFeature(fsrsState.reps, 0);
    const retrievabilityNow = normalizeFeature(engine.calculateRetrievability(fsrsState, now), 0);
    
    // Volatility: From historic performance (evidenceSigma)
    const volatility = normalizeFeature(knowledgeState?.evidenceSigma, 0.2); 
    
    // Session metrics
    const sessionMeanLatency = getSessionMetric(sessionState, 'sessionMeanLatency', 3000);
    const lastLatency = getCardMetric(sessionState, card?.id, 'lastLatency', 0); // 0 means not seen
    const timesSeenThisSession = getCardMetric(sessionState, card?.id, 'timesSeenThisSession', 0);
    
    // Card history for time estimation
    const cardAvgTime = 5.0; 
    
    return {
        reps,
        retrievabilityNow,
        volatility, 
        lastLatency,
        sessionMeanLatency,
        timesSeenThisSession,
        cardAvgTime,
        hasExamDate: deck?.settings?.examDate ? 1 : 0,
        daysToExam: deck?.settings?.examDate ? (new Date(deck.settings.examDate) - now)/86400000 : 0,
        minutesSinceLastReview: fsrsState.last_review ? (now - new Date(fsrsState.last_review))/60000 : 999999
    };
}

function computeMcqPriorityBoost(knowledgeState, deck) {
    if (!knowledgeState || !knowledgeState.mcqStats) return 1.0;
    if (!deck || !Array.isArray(deck.cards) || deck.cards.length < 4) return 1.0;
    const adaptive = deck.settings?.adaptiveModes || null;
    if (adaptive && adaptive.mcq === false) return 1.0;

    const stats = knowledgeState.mcqStats || {};
    const lureCounts = stats.lureCounts && typeof stats.lureCounts === 'object' ? stats.lureCounts : {};
    const lureTotal = Object.values(lureCounts).reduce((sum, v) => {
        const num = Number(v);
        return sum + (Number.isFinite(num) ? Math.max(0, num) : 0);
    }, 0);
    const lureBoost = 1 + 0.10 * Math.min(6, lureTotal);
    const emaRaw = Number(stats.recognitionDependenceEma);
    const ema = Number.isFinite(emaRaw) ? clamp(emaRaw, 0, 1) : 0;
    const dependenceBoost = 1 + 0.45 * ema;
    const remediationAttempts = Number(stats.remediationAttempts);
    const remediationCorrect = Number(stats.remediationCorrect);
    const attempts = Number.isFinite(remediationAttempts) && remediationAttempts > 0 ? remediationAttempts : 0;
    const correct = Number.isFinite(remediationCorrect) ? remediationCorrect : 0;
    const failureRate = attempts > 0 ? 1 - (correct / Math.max(1, attempts)) : 0;
    const remBoost = 1 + 0.35 * clamp(failureRate, 0, 1);
    return lureBoost * dependenceBoost * remBoost;
}

export async function scoreCard(card, knowledgeState, sessionState, deck) {
    const engine = await getFsrsEngine();
    const now = getNow(cortexState.nowProvider);
    const features = await computeFeatures(card, knowledgeState, sessionState, deck);

    let expectedGain = 0;
    let expectedTime = features.cardAvgTime;
    let scoreSource = 'heuristic';
    const predictor = cortexState.modelPredictor;

    // 1. Neural Predictor (Strict Gating)
    if (predictor && predictor.isReady()) {
        const prediction = predictor.predict({ features, cardID: card?.id });
        if (prediction && prediction.confidence >= MIN_PREDICTION_CONFIDENCE) {
            expectedGain = prediction.expectedGain;
            expectedTime = prediction.expectedTimeCost;
            scoreSource = 'neural';
            if (cortexState.debugEnabled) {
                console.log(`[Neural] Used prediction for ${card?.id || 'unknown'} (conf: ${prediction.confidence.toFixed(3)})`);
            }
        } else if (cortexState.debugEnabled && prediction) {
            console.log(`[Neural] Rejected prediction for ${card?.id || 'unknown'} (conf: ${prediction.confidence.toFixed(3)} < ${MIN_PREDICTION_CONFIDENCE})`);
        }
    } else if (cortexState.debugEnabled && predictor) {
        console.log('[Neural] Predictor not ready - samples:', predictor.getSampleCount());
    }

    // 2. Fallback Heuristic
    if (scoreSource === 'heuristic') {
        const pCorrect = features.retrievabilityNow; 
        
        // Confidence: Epistemic certainty based on sample size (reps)
        // More reps = higher confidence that our pCorrect is accurate
        const confidence = Math.min(0.98, 0.3 + (features.reps * 0.15));
        
        // Calculate Gain
        const gainResult = await calculateExpectedGain(engine, knowledgeState, deck, now, pCorrect, confidence);
        expectedGain = gainResult.expectedGain;

        // Calculate Time Cost
        if (features.lastLatency > 0) {
            expectedTime = (expectedTime + (features.lastLatency / 1000)) / 2;
        } else {
            expectedTime = (expectedTime + (features.sessionMeanLatency / 1000)) / 2;
        }
    }
    
    // Clamp Time
    expectedTime = Math.max(2.0, Math.min(60.0, expectedTime));

    // 3. Horizon Weight
    // lambda small to avoid aggressive decay
    const lambda = 0.05; 
    const horizonWeight = features.hasExamDate ? Math.exp(-lambda * Math.max(0, features.daysToExam)) : 1.0;

    // 4. Base Score (Gain / Time)
    const gainPerSecond = (expectedGain * horizonWeight) / expectedTime;

    // 5. Penalties & Bonuses
    const spacingPenalty = features.minutesSinceLastReview < 3 ? 10.0 : 0.0; 
    const overusePenalty = Math.max(0, (features.timesSeenThisSession - 2) * 0.5);
    
    // Uncertainty Penalty (Volatility):
    // If the card is volatile (unstable), we penalize it slightly unless gain is huge.
    // This is separate from 'confidence' which smoothed the gain distribution.
    const uncertaintyPenalty = features.volatility * 0.15; 
    
    // Exploration Bonus:
    // If we have few reps, we want to explore it.
    const explorationBonus = (features.reps === 0) ? 0.05 : 0; 

    let score = gainPerSecond 
        - spacingPenalty
        - overusePenalty
        - uncertaintyPenalty
        + explorationBonus;
    
    const fragility = clamp(normalizeFeature(knowledgeState?.interferenceFragilityEma, 0), 0, 1);
    score *= (1 + (INTERFERENCE_PRIORITY_WEIGHT * fragility));
    score *= computeMcqPriorityBoost(knowledgeState, deck);

    // Invariant: Score valid
    if (!Number.isFinite(score)) score = -999;

    return normalizeFeature(score, -999);
}


// --- 5. Selection ---

export async function pickNextCard(candidates, sessionState, deck, knowledgeStates) {
    if (!Array.isArray(candidates) || candidates.length === 0) return null;
    
    // Check session queue (Determinism & Continuity)
    if (sessionState?.queue && sessionState.queue.length > 0) {
        // Iterate queue to find first valid card (e.g. not deleted)
        // Queue can hold IDs OR { id, intent } objects
        for (const queuedItem of sessionState.queue) {
             const queuedId = (typeof queuedItem === 'object') ? queuedItem.id : queuedItem;
             const card = candidates.find(c => c.id === queuedId);
             
             if (card) {
                 // Attach intent if present
                 if (typeof queuedItem === 'object') {
                     card._sessionIntent = queuedItem.intent;
                 }
                 return card;
             }
        }
    }
    
    // Fallback to scoring if queue empty or invalid
    let bestCard = null;
    let bestScore = -Infinity;

    for (const card of candidates) {
        const state = knowledgeStates?.get ? knowledgeStates.get(card.id) : knowledgeStates?.[card.id];
        const score = await scoreCard(card, state, sessionState, deck);
        
        if (bestCard === null || score > bestScore) {
            bestCard = card;
            bestScore = score;
        }
    }
    
    // Assign implicit intent for newly picked card
    if (bestCard) {
        bestCard._sessionIntent = 'scheduler-auto';
    }
    
    return bestCard;
}

// --- 6. Neural Predictor ---

class NeuralPredictor {
    constructor() {
        this.featureKeys = NEURAL_FEATURE_KEYS;
        this.featureCount = this.featureKeys.length;
        this.model = null;
        this.trainingData = [];
        this.trainingInProgress = false;
        this.samplesSinceLastTraining = 0;
        this.readyPromise = null;
    }

    async init() {
        if (this.readyPromise) return this.readyPromise;
        this.readyPromise = (async () => {
            try {
                await initDB();
            } catch (error) {
                if (cortexState.debugEnabled) console.warn('[NeuralPredictor] DB init failed', error);
            }
            await this.loadModel();
            await this.loadTrainingData();
            return this;
        })();
        return this.readyPromise;
    }

    isReady() {
        return Boolean(this.model && this.trainingData.length >= 10);
    }

    getSampleCount() {
        return this.trainingData.length;
    }

    async loadModel() {
        const stored = await getDataFromDB('appData', MODEL_STORAGE_KEY).catch(() => null);
        if (this.isModelValid(stored)) {
            this.model = stored;
        } else {
            this.model = this.createDefaultModel();
            await this.persistModel();
        }
        cortexState.modelConfig = this.model;
    }

    isModelValid(candidate) {
        if (!candidate || candidate.version !== MODEL_VERSION) return false;
        if (!Array.isArray(candidate.weightsGain) || candidate.weightsGain.length !== this.featureCount) return false;
        if (!Array.isArray(candidate.weightsTime) || candidate.weightsTime.length !== this.featureCount) return false;
        return true;
    }

    createDefaultModel() {
        const randomArray = () => Array.from({ length: this.featureCount }, () => (Math.random() * 0.02) - 0.01);
        return {
            version: MODEL_VERSION,
            featureCount: this.featureCount,
            weightsGain: randomArray(),
            biasGain: 0,
            weightsTime: randomArray(),
            biasTime: DEFAULT_TIME_COST_SECONDS,
            sampleCount: 0,
            lastTrainedAt: Date.now()
        };
    }

    async persistModel() {
        if (!this.model) return;
        try {
            await saveDataToDB('appData', { key: MODEL_STORAGE_KEY, ...this.model });
            cortexState.modelConfig = this.model;
        } catch (error) {
            if (cortexState.debugEnabled) {
                console.warn('[NeuralPredictor] Failed to persist model', error);
            }
        }
    }

    async loadTrainingData() {
        const records = await getAllDataFromDB(TRAINING_STORE_NAME).catch(() => []);
        this.trainingData = Array.isArray(records) ? records.slice().sort((a, b) => (a.id || 0) - (b.id || 0)) : [];
        await this.trimTrainingData();
    }

    flattenFeatures(features) {
        return this.featureKeys.map(key => this.normalizeFeature(key, features?.[key]));
    }

    normalizeFeature(key, value) {
        const num = Number(value);
        if (!Number.isFinite(num)) return 0;
        switch (key) {
            case 'lastLatency':
            case 'sessionMeanLatency':
                return Math.min(5, num / 1000);
            case 'minutesSinceLastReview':
                return Math.min(2, num / 30);
            case 'daysToExam':
                return Math.min(6, num / 30);
            case 'timesSeenThisSession':
                return Math.min(1, num / 5);
            case 'reps':
                return Math.min(1, num / 20);
            case 'cardAvgTime':
                return Math.min(1, num / 60);
            case 'hasExamDate':
                return num ? 1 : 0;
            default:
                return Math.min(1, Math.max(0, num));
        }
    }

    computeDot(weights, features) {
        let total = 0;
        for (let i = 0; i < this.featureCount; i++) {
            total += (weights[i] || 0) * (features[i] || 0);
        }
        return total;
    }

    computeConfidence() {
        const count = this.trainingData.length;
        if (!count) return 0;
        const base = Math.min(0.93, Math.log1p(count) / 8 + 0.1);
        return Math.min(0.99, base + Math.min(0.03, count / TRAINING_SAMPLE_LIMIT));
    }

    predict(inputs) {
        if (!this.model) return null;
        const features = inputs?.features;
        if (!Array.isArray(features) || features.length !== this.featureCount) return null;
        const gainRaw = this.computeDot(this.model.weightsGain, features) + this.model.biasGain;
        const timeRaw = this.computeDot(this.model.weightsTime, features) + this.model.biasTime;
        const expectedGain = clamp(gainRaw, 0, 1);
        const expectedTimeCost = clamp(timeRaw, MIN_TIME_COST, MAX_TIME_COST);
        return {
            expectedGain,
            expectedTimeCost,
            confidence: this.computeConfidence()
        };
    }

    async recordExample(inputs, outcome) {
        if (!this.model) return;
        const flattened = this.flattenFeatures(inputs?.features || {});
        if (flattened.length !== this.featureCount) return;
        const sample = {
            features: flattened,
            realizedGain: clamp(outcome?.realizedGain ?? 0, 0, 1),
            realizedTimeCost: Math.min(MAX_TIME_COST, Math.max(MIN_TIME_COST, Number(outcome?.realizedTimeCost) || DEFAULT_TIME_COST_SECONDS)),
            cardID: inputs?.cardID || null,
            deckID: inputs?.deck?.id || inputs?.deck?.deckId || null,
            timestamp: Date.now()
        };
        const id = await this.appendTrainingSample(sample);
        if (id) sample.id = id;
        this.trainingData.push(sample);
        await this.trimTrainingData();
        this.samplesSinceLastTraining += 1;
        if (cortexState.debugEnabled) {
            console.log(`[NeuralPredictor] Recorded sample #${this.trainingData.length} (gain=${sample.realizedGain.toFixed(3)})`);
        }
        if (this.samplesSinceLastTraining >= TRAINING_TRIGGER_COUNT) {
            this.samplesSinceLastTraining = 0;
            await this.trainModel();
        }
    }

    async appendTrainingSample(sample) {
        const database = getDB();
        if (!database) return null;
        return new Promise((resolve) => {
            try {
                const transaction = database.transaction([TRAINING_STORE_NAME], 'readwrite');
                const store = transaction.objectStore(TRAINING_STORE_NAME);
                const request = store.add(sample);
                request.onsuccess = () => resolve(request.result);
                request.onerror = () => resolve(null);
            } catch (error) {
                if (cortexState.debugEnabled) {
                    console.warn('[NeuralPredictor] Failed to append sample', error);
                }
                resolve(null);
            }
        });
    }

    async trimTrainingData() {
        if (this.trainingData.length <= TRAINING_SAMPLE_LIMIT) return;
        const excess = this.trainingData.length - TRAINING_SAMPLE_LIMIT;
        const removed = this.trainingData.splice(0, excess);
        await Promise.all(removed.map(entry => this.deleteTrainingSample(entry.id)));
    }

    async deleteTrainingSample(id) {
        if (typeof id === 'undefined' || id === null) return;
        try {
            await deleteDataFromDB(TRAINING_STORE_NAME, id);
        } catch (error) {
            if (cortexState.debugEnabled) {
                console.warn('[NeuralPredictor] Failed to delete training sample', error);
            }
        }
    }

    async trainModel() {
        if (this.trainingInProgress || !this.trainingData.length || !this.model) return;
        this.trainingInProgress = true;
        try {
            const batch = this.trainingData.slice(-TRAINING_BATCH_SIZE);
            for (let epoch = 0; epoch < 2; epoch++) {
                for (const sample of batch) {
                    this.applyGradient(sample);
                }
            }
            this.model.sampleCount = this.trainingData.length;
            this.model.lastTrainedAt = Date.now();
            await this.persistModel();
            if (cortexState.debugEnabled) {
                console.log(`[NeuralPredictor] Trained on ${batch.length} samples (total stored: ${this.trainingData.length})`);
            }
        } finally {
            this.trainingInProgress = false;
        }
    }

    applyGradient(sample) {
        if (!sample) return;
        const gainPred = this.computeDot(this.model.weightsGain, sample.features) + this.model.biasGain;
        const timePred = this.computeDot(this.model.weightsTime, sample.features) + this.model.biasTime;
        const gainError = sample.realizedGain - gainPred;
        const timeError = sample.realizedTimeCost - timePred;
        for (let i = 0; i < this.featureCount; i++) {
            this.model.weightsGain[i] += LEARNING_RATE_GAIN * gainError * (sample.features[i] || 0);
            this.model.weightsTime[i] += LEARNING_RATE_TIME * timeError * (sample.features[i] || 0);
        }
        this.model.biasGain += LEARNING_RATE_GAIN * gainError;
        this.model.biasTime += LEARNING_RATE_TIME * timeError;
    }
}

// --- Utils ---

function getSessionMetric(sessionState, key, fallback) {
    if (!sessionState || typeof sessionState[key] === 'undefined') return fallback;
    return normalizeFeature(sessionState[key], fallback);
}

function getCardMetric(sessionState, cardId, key, fallback) {
    if (!sessionState) return fallback;
    const metrics = sessionState.cardMetrics;
    if (metrics instanceof Map) {
        const entry = metrics.get(cardId);
        if (entry && typeof entry[key] !== 'undefined') return normalizeFeature(entry[key], fallback);
        return fallback;
    }
    if (metrics && metrics[cardId] && typeof metrics[cardId][key] !== 'undefined') {
        return normalizeFeature(metrics[cardId][key], fallback);
    }
    return fallback;
}

export async function initCortex(options = {}) {
    cortexState.nowProvider = typeof options.nowProvider === 'function' ? options.nowProvider : () => new Date();
    if (!cortexState.modelPredictor) {
        cortexState.modelPredictor = new NeuralPredictor();
    }
    await cortexState.modelPredictor.init();

    if (options.modelConfig && cortexState.modelPredictor.isModelValid(options.modelConfig)) {
        cortexState.modelPredictor.model = options.modelConfig;
        await cortexState.modelPredictor.persistModel();
    }
    cortexState.modelConfig = cortexState.modelPredictor.model;

    await getFsrsEngine();
    return cortexState;
}

export function setDebug(enabled) {
    cortexState.debugEnabled = Boolean(enabled);
}

export function hasModel() {
    return !!(cortexState.modelConfig);
}

export function debugInterferenceSelfCheck(options = {}) {
    const simRaw = Number(options.similarity);
    const sim = Number.isFinite(simRaw) ? clamp(simRaw, 0, 1) : 0.75;
    const probeFailures = Number.isFinite(options.probeFailures) ? Math.max(1, Math.floor(options.probeFailures)) : 3;
    const probeSuccesses = Number.isFinite(options.probeSuccesses) ? Math.max(0, Math.floor(options.probeSuccesses)) : 2;

    let ema = 0;
    for (let i = 0; i < probeFailures; i++) {
        ema = updateInterferenceFragilityEma(ema, false, sim);
    }
    const afterFailures = ema;
    for (let i = 0; i < probeSuccesses; i++) {
        ema = updateInterferenceFragilityEma(ema, true, sim);
    }

    const boostAfterFailures = 1 + (INTERFERENCE_PRIORITY_WEIGHT * afterFailures);
    const boostAfterSuccesses = 1 + (INTERFERENCE_PRIORITY_WEIGHT * ema);

    return {
        similarity: sim,
        afterFailures,
        afterSuccesses: ema,
        boostAfterFailures,
        boostAfterSuccesses,
        masteryBlockedAfterFailures: afterFailures > INTERFERENCE_MASTERY_BLOCK_THRESHOLD,
        masteryBlockedAfterSuccesses: ema > INTERFERENCE_MASTERY_BLOCK_THRESHOLD
    };
}

function getImplicitCalibration() {
    return cortexState.implicitCalibration;
}

function resetImplicitCalibration() {
    cortexState.implicitCalibration = {
        loaded: true,
        userID: DEFAULT_USER_ID,
        weights: { ...DEFAULT_IMPLICIT_WEIGHTS },
        reliability: { ...DEFAULT_IMPLICIT_RELIABILITY },
        bins: DEFAULT_CALIBRATION_BINS.map(bin => ({ ...bin })),
        updates: 0,
        stats: { n: 0, brierEma: null },
        lastUpdated: null
    };
}

const Cortex = {
    initCortex,
    hasModel,
    setDebug,
    computeFeatures,
    scoreCard,
    pickNextCard,
    processReview,
    processReviewWithRating,
    inferRetrievalOutcome,
    NeuralPredictor,
    buildTargetDate
};

// Test-only hooks gated by environment
export const __TEST_HOOKS__ = (typeof process !== 'undefined' && process?.env?.NODE_ENV === 'test')
    ? { getImplicitCalibration, resetImplicitCalibration, debugInterferenceSelfCheck }
    : null;

// Dev-only runtime guard to prevent accidental exposure
if (typeof process !== 'undefined' && process?.env?.NODE_ENV === 'development') {
    if (Cortex.getImplicitCalibration || Cortex.resetImplicitCalibration || Cortex.debugInterferenceSelfCheck) {
        console.warn('[Cortex] Test hooks leaked into production object. Purging.');
        delete Cortex.getImplicitCalibration;
        delete Cortex.resetImplicitCalibration;
        delete Cortex.debugInterferenceSelfCheck;
    }
}

export default Cortex;
