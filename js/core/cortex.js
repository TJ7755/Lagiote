import { FSRSAlgorithm } from './fsrs.js';

const DEFAULT_HORIZON_DAYS = 3;
let fsrsInstance = null;
let fsrsPromise = null;

const cortexState = {
    modelConfig: null,
    nowProvider: () => new Date(),
    debugEnabled: false,
    featureNames: null
};

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

export async function processReview(card, knowledgeState, metrics, explicitFeedback = null) {
    const engine = await getFsrsEngine();
    const now = getNow(cortexState.nowProvider);

    // 1. Infer outcome
    const inference = inferRetrievalOutcome(metrics, {}, explicitFeedback); // TODO: pass userBaseline

    // 2. Map to FSRS Rating
    const rating = mapProbabilityToRating(inference.pCorrect, inference.confidence, engine);

    // 3. Perform Update
    // Standard FSRS update with the inferred rating
    const currentFsrs = engine.prepareCard(knowledgeState?.fsrs || knowledgeState);
    const result = await engine.reviewCard(knowledgeState, rating, now);

    // 4. Update Knowledge State (persist inference metadata)
    const updatedState = {
        ...result,
        evidenceSigma: inference.volatility,
        lastInference: inference,
        lastMetrics: metrics // Optional: store raw metrics for debugging/training
    };
    
    return updatedState;
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

function buildTargetDate(deck, now) {
    // Session Objective: Exam Date
    const examDate = deck?.settings?.examDate ? new Date(deck.settings.examDate) : null;
    if (examDate && examDate > now) {
        return examDate; // Target is exam date
    }
    // Fallback: Default Horizon
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

    // 1. Neural Predictor (Strict Gating)
    if (cortexState.modelConfig && cortexState.modelPredictor) {
        const prediction = cortexState.modelPredictor.predict({ 
            features, 
            cardID: card.id 
        });
        
        if (prediction.confidence >= MIN_PREDICTION_CONFIDENCE) {
            expectedGain = prediction.expectedGain;
            expectedTime = prediction.expectedTimeCost;
            scoreSource = 'neural';
            if (cortexState.debugEnabled) console.log(`[Neural] Used prediction for ${card.id} (conf: ${prediction.confidence})`);
        } else {
             if (cortexState.debugEnabled) console.log(`[Neural] Rejected prediction for ${card.id} (conf: ${prediction.confidence} < ${MIN_PREDICTION_CONFIDENCE})`);
        }
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
        this.isEnabled = false;
        this.confidenceThreshold = 0.8;
    }
    
    /**
     * Predicts ExpectedGain and ExpectedTimeCost
     * @param {Object} inputs - { fsrsState, implicitMetrics, cardMetadata, timeSinceLast }
     * @returns {Object} { expectedGain, expectedTimeCost, confidence }
     */
    predict(inputs) {
        // Placeholder implementation
        // In a real scenario, this would run an ONNX model or similar.
        
        return {
            expectedGain: 0, // Should be model output
            expectedTimeCost: 0, // Should be model output
            confidence: 0 // Should be model confidence
        };
    }
    
    /**
     * Record a training example
     * @param {Object} inputs 
     * @param {Object} outcome - { realizedGain, realizedTimeCost, finalGrade }
     */
    recordExample(inputs, outcome) {
        // Schema: 
        // Inputs: FSRS vector, user stats, card stats
        // Targets: Gain (change in R), Time
        if (cortexState.debugEnabled) {
             console.log('[NeuralTrainer] Example:', { inputs, outcome });
        }
        // TODO: Persist to 'training_data' store in IDB
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
    cortexState.modelConfig = options.modelConfig || null;
    cortexState.nowProvider = typeof options.nowProvider === 'function' ? options.nowProvider : () => new Date();
    await getFsrsEngine();
    return cortexState;
}

export function hasModel() {
    return !!(cortexState.modelConfig);
}

const Cortex = {
    initCortex,
    hasModel,
    computeFeatures,
    scoreCard,
    pickNextCard,
    processReview,
    inferRetrievalOutcome,
    NeuralPredictor
};

export default Cortex;