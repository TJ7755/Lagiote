import { FSRSAlgorithm } from './fsrs.js';
import { initDB, getDB, getDataFromDB, saveDataToDB, getAllDataFromDB, deleteDataFromDB } from './db.js';

const DEFAULT_HORIZON_DAYS = 3;
let fsrsInstance = null;
let fsrsPromise = null;

const cortexState = {
    modelConfig: null,
    modelPredictor: null,
    nowProvider: () => new Date(),
    debugEnabled: false,
    featureNames: null
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

// --- 1. Implicit Inference ---

export function inferRetrievalOutcome(metrics, userBaseline = {}, explicitFeedback = null) {
    // metrics: { recallLatency, answerFluency, totalCorrections, attemptCount, 
    //            backspaceRate, hesitationPauses, timeToFirstAction, focusLossCount, ... }
    
    // Baselines
    const baseLatency = userBaseline.latency || 2500;
    const baseFluency = userBaseline.fluency || 5;

    // Feature extraction & Z-scoring
    const latency = normalizeFeature(metrics.recallLatency, baseLatency);
    const zLatency = (latency - baseLatency) / (baseLatency * 0.5); // Assume std ~ 0.5*mean
    
    const timeToFirst = normalizeFeature(metrics.timeToFirstAction, 500);
    const zFirstAction = (timeToFirst - 500) / 300; // Heuristic
    
    const corrections = normalizeFeature(metrics.totalCorrections, 0);
    const attempts = normalizeFeature(metrics.attemptCount, 1);
    const backspaces = normalizeFeature(metrics.backspaceRate, 0); // e.g., per char
    const pauses = normalizeFeature(metrics.hesitationPauses, 0);
    const focusLoss = normalizeFeature(metrics.focusLossCount, 0);
    
    // --- Probability of Correctness (pCorrect) ---
    // Log-odds model starting at 0 (p=0.5)
    let logOdds = 1.0; 
    
    // Latency penalty
    logOdds -= (0.8 * zLatency);
    
    // Hesitation / Struggle penalties
    logOdds -= (0.5 * zFirstAction);
    logOdds -= (1.2 * corrections);
    logOdds -= (1.5 * (attempts - 1));
    logOdds -= (2.0 * backspaces);
    logOdds -= (0.5 * pauses);
    logOdds -= (1.0 * focusLoss);
    
    // --- Volatility & Confidence ---
    // Volatility: Behavioural instability (Noise in execution)
    // High if performance contradicts itself (e.g. fast but wrong) or implies struggle
    let volatility = 0.1;
    if (Math.abs(zLatency) > 2.0) volatility += 0.2;
    if (attempts > 1) volatility += 0.3;
    if (corrections > 1) volatility += 0.2;
    if (backspaces > 0.5) volatility += 0.2;
    
    volatility = clamp(volatility, 0.0, 1.0);

    // Confidence: Epistemic certainty (How well does this single sample represent knowledge?)
    // If volatility is high, our single-sample confidence is lower.
    // Explicit feedback dramatically increases confidence.
    let confidence = 0.8 - (0.5 * volatility);
    
    // --- Explicit Feedback Integration ---
    if (explicitFeedback === false) {
        // Explicit wrong: Clamp pCorrect <= 0.05
        // We override the logOdds derived probability
        return { 
            pCorrect: 0.05, 
            confidence: Math.max(0.9, confidence + 0.2), // High confidence in failure
            volatility: volatility 
        };
    } else if (explicitFeedback === true) {
        // Explicit correct: Add weak prior, do NOT clamp to 1.0
        logOdds += 1.5; 
        confidence = Math.min(0.95, confidence + 0.15); 
    }
    
    const pCorrect = sigmoid(logOdds);
    
    return {
        pCorrect: clamp(pCorrect, 0.01, 0.99),
        confidence: clamp(confidence, 0.1, 0.99),
        volatility
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


function mapProbabilityToRating(pCorrect, confidence, engine) {
    const ratings = engine.getRatings();
    
    // Map pCorrect to Rating bands
    // Shift pessimistically if confidence is low to ensure safety
    // adjustedP = p - (uncertainty * penalty_factor)
    const uncertainty = 1.0 - confidence;
    const adjustedP = pCorrect - (uncertainty * 0.25);

    if (adjustedP < 0.45) return ratings.Again;
    if (adjustedP < 0.75) return ratings.Hard;
    if (adjustedP < 0.96) return ratings.Good;
    return ratings.Easy;
}

// --- 2. Uncertainty-Aware Update Logic ---

export async function processReview(card, knowledgeState, metrics, explicitFeedback = null, userBaseline = {}, context = {}) {
    const engine = await getFsrsEngine();
    const now = getNow(cortexState.nowProvider);
    const deckContext = context?.deck || null;
    const sessionContext = context?.sessionState || null;

    const preFeatures = await computeFeatures(card, knowledgeState, sessionContext, deckContext);
    const targetDate = buildTargetDate(deckContext, now);
    const preparedState = engine.prepareCard(knowledgeState?.fsrs || knowledgeState);
    const beforeRetrievability = await estimateRetrievabilityAt(engine, preparedState, targetDate);

    const inference = inferRetrievalOutcome(metrics, userBaseline, explicitFeedback);
    const rating = mapProbabilityToRating(inference.pCorrect, inference.confidence, engine);
    const result = await engine.reviewCard(knowledgeState, rating, now);

    const resolvedFsrs = result.fsrs || result;
    const afterState = engine.prepareCard(resolvedFsrs);
    const afterRetrievability = await estimateRetrievabilityAt(engine, afterState, targetDate);

    const lastReviewRaw = result.fsrs?.last_review || result.lastReviewed || now;
    const lastReviewedIso = new Date(lastReviewRaw).toISOString();
    const derivedStability = result.fsrs?.stability ?? result.stability ?? 0;

    const updatedState = {
        ...result,
        evidenceSigma: inference.volatility,
        lastInference: inference,
        lastMetrics: metrics,
        lastRating: rating,
        rating,
        lastReviewed: lastReviewedIso,
        stability: derivedStability
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
    Again: { pCorrect: 0.05, confidence: 0.95, volatility: 0.1 },
    Hard: { pCorrect: 0.55, confidence: 0.95, volatility: 0.1 },
    Good: { pCorrect: 0.80, confidence: 0.95, volatility: 0.1 },
    Easy: { pCorrect: 0.95, confidence: 0.95, volatility: 0.1 }
};

function resolveRatingLabel(engine, rating) {
    const ratings = engine.getRatings();
    return Object.keys(ratings).find(key => ratings[key] === rating) || null;
}

function buildDeterministicInference(label) {
    if (label && DETERMINISTIC_INFERENCES[label]) {
        return DETERMINISTIC_INFERENCES[label];
    }
    return { pCorrect: 0.5, confidence: 0.5, volatility: 0.1 };
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
        lastInference: inference,
        lastMetrics: meta?.metrics || null,
        lastReviewed: lastReviewedIso,
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

export default Cortex;
