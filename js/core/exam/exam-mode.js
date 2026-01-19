/**
 * Exam Mode - Comprehensive Exam Engine
 * 
 * This module implements a complete exam system following the atoms-first design.
 * It provides: paper/section structure, sitting runner, marking, reporting,
 * prediction and planning, and practice targeting.
 * 
 * Key architectural principles:
 * 1. State Model (physics) - Atom state and decay
 * 2. Assessment Model (measurement) - Questions and mark schemes
 * 3. Policy Model (control/Cortex) - Selection and optimisation
 */

import { clamp01, predictMastery, effectiveMastery, computeEffectiveMasteryMap, daysBetweenDates } from './atom-dynamics.js';

// --- Constants ---

const ATOM_TYPES = ['knowledge', 'procedure', 'exam_technique', 'representation'];
const QUESTION_TYPES = ['mcq_single', 'mcq_multi', 'numeric', 'short_text', 'structured', 'essay'];
const SITTING_STATUSES = ['not_started', 'in_progress', 'paused', 'submitted', 'marked'];
const SESSION_PHASES = ['warm_up', 'targeted_struggle', 'technique_drill', 'timed_chunk', 'recap'];

// Decay and update parameters
const DEFAULT_STABILITY_DAYS = 7;
const DEFAULT_DIFFICULTY = 0.5;
const DEFAULT_DEPTH = 0.5;
const LOGISTIC_STEEPNESS = 6;

// --- UUID Generation ---

export function generateUUID() {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
        return crypto.randomUUID();
    }
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
        const r = Math.random() * 16 | 0;
        const v = c === 'x' ? r : (r & 0x3 | 0x8);
        return v.toString(16);
    });
}

// --- Atom Helpers ---

/**
 * Creates a new atom with all required dimensions.
 * @param {Object} params Atom parameters
 * @returns {Object} Complete atom object
 */
export function createAtom({
    id,
    name,
    type = 'knowledge',
    mastery = 0,
    stabilityDays = DEFAULT_STABILITY_DAYS,
    difficulty = DEFAULT_DIFFICULTY,
    depth = DEFAULT_DEPTH,
    transferability = 0.5,
    fragility = 0.5,
    timeSensitivity = 0.5,
    prerequisites = [],
    tags = [],
    metadata = {}
} = {}) {
    return {
        id: id || generateUUID(),
        name: name || '',
        type: ATOM_TYPES.includes(type) ? type : 'knowledge',
        mastery: clamp01(mastery),
        stabilityDays: Math.max(0, Number(stabilityDays) || DEFAULT_STABILITY_DAYS),
        difficulty: clamp01(difficulty),
        depth: clamp01(depth),
        transferability: clamp01(transferability),
        fragility: clamp01(fragility),
        timeSensitivity: clamp01(timeSensitivity),
        prerequisites: Array.isArray(prerequisites) ? prerequisites : [],
        tags: Array.isArray(tags) ? tags : [],
        metadata: metadata && typeof metadata === 'object' ? metadata : {},
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        isDeleted: false,
        version: 1
    };
}

/**
 * Creates a new error atom representing a failure signature.
 * @param {Object} params Error atom parameters
 * @returns {Object} Complete error atom object
 */
export function createErrorAtom({
    id,
    name,
    description = '',
    frequency = 0,
    persistence = 0.5,
    risk = 0.5,
    contexts = [],
    tags = [],
    metadata = {}
} = {}) {
    return {
        id: id || generateUUID(),
        name: name || '',
        description,
        frequency: clamp01(frequency),
        persistence: clamp01(persistence),
        risk: clamp01(risk),
        contexts: Array.isArray(contexts) ? contexts : [],
        tags: Array.isArray(tags) ? tags : [],
        metadata: metadata && typeof metadata === 'object' ? metadata : {},
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        isDeleted: false,
        version: 1
    };
}

// --- Question Helpers ---

/**
 * Creates a new question with proper structure.
 * @param {Object} params Question parameters
 * @returns {Object} Complete question object
 */
export function createQuestion({
    id,
    prompt = '',
    type = 'mcq_single',
    options = [],
    difficulty = DEFAULT_DIFFICULTY,
    depth = DEFAULT_DEPTH,
    timeProfile = {},
    variationProfile = {},
    atomMap = [],
    markSchemeId = null,
    tags = [],
    metadata = {}
} = {}) {
    const questionType = QUESTION_TYPES.includes(type) ? type : 'mcq_single';
    const atomIds = Array.from(new Set(
        atomMap.map(entry => entry?.atomId).filter(Boolean)
    ));
    
    return {
        id: id || generateUUID(),
        prompt,
        type: questionType,
        options: Array.isArray(options) ? options : [],
        difficulty: clamp01(difficulty),
        depth: clamp01(depth),
        timeProfile: {
            expectedSeconds: Number(timeProfile?.expectedSeconds) || 60,
            pressure: clamp01(timeProfile?.pressure ?? 0.5)
        },
        variationProfile: {
            numbers: Boolean(variationProfile?.numbers),
            context: Boolean(variationProfile?.context),
            representation: Boolean(variationProfile?.representation),
            wording: Boolean(variationProfile?.wording)
        },
        atomMap: Array.isArray(atomMap) ? atomMap : [],
        atomIds,
        markSchemeId,
        tags: Array.isArray(tags) ? tags : [],
        metadata: metadata && typeof metadata === 'object' ? metadata : {},
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        isDeleted: false,
        version: 1
    };
}

// --- Question Success Probability ---

/**
 * Computes the probability of answering a question correctly.
 * Uses logistic function: p(correct) = sigmoid(k * (R - qd))
 * where R is readiness from atom states and qd is question difficulty.
 * 
 * @param {Object} question The question object
 * @param {Map|Object} atomsById Map of atom ID to atom object
 * @param {Date} nowDate Current date
 * @param {Date} targetDate Prediction target date
 * @returns {Object} { probability, readiness, breakdown }
 */
export function computeQuestionSuccessProbability(question, atomsById, nowDate, targetDate) {
    const atomMap = Array.isArray(question?.atomMap) ? question.atomMap : [];
    const questionDifficulty = clamp01(question?.difficulty ?? DEFAULT_DIFFICULTY);
    
    if (!atomMap.length) {
        return {
            probability: 0.5,
            readiness: 0.5,
            breakdown: [],
            questionDifficulty
        };
    }
    
    let weightedSum = 0;
    let weightTotal = 0;
    const breakdown = [];
    
    for (const entry of atomMap) {
        const atomId = entry?.atomId;
        const weight = clamp01(entry?.weight ?? 1);
        
        if (!atomId || weight <= 0) continue;
        
        const result = effectiveMastery(atomId, atomsById, nowDate, targetDate, {
            memo: new Map(),
            visiting: new Set()
        });
        
        weightedSum += weight * result.effective;
        weightTotal += weight;
        
        breakdown.push({
            atomId,
            weight,
            effective: result.effective,
            predicted: result.predicted,
            cap: result.cap
        });
    }
    
    const readiness = weightTotal > 0 ? weightedSum / weightTotal : 0.5;
    const logit = LOGISTIC_STEEPNESS * (readiness - questionDifficulty);
    const probability = 1 / (1 + Math.exp(-logit));
    
    return {
        probability: clamp01(probability),
        readiness: clamp01(readiness),
        breakdown,
        questionDifficulty
    };
}

// --- Exam Spec Helpers ---

/**
 * Creates an ExamSpec blueprint describing the exam structure.
 * @param {Object} params ExamSpec parameters
 * @returns {Object} Complete exam specification
 */
export function createExamSpec({
    id,
    name = 'Exam',
    subject = '',
    examDate = null,
    durationMinutes = 60,
    totalMarks = 100,
    sections = [],
    navigation = {},
    feedback = {},
    scoring = {},
    selection = {},
    topicWeights = {},
    depthDistribution = {},
    questionTypeMix = {},
    tags = [],
    metadata = {}
} = {}) {
    const defaultSection = {
        id: 'main',
        name: 'Main Section',
        marks: totalMarks,
        timeMinutes: null,
        types: ['mixed'],
        topicWeights: {},
        difficultyTargets: { easy: 0.3, medium: 0.4, hard: 0.3 }
    };
    
    return {
        id: id || generateUUID(),
        name,
        subject,
        examDate: examDate ? new Date(examDate).toISOString() : null,
        durationMinutes: Math.max(1, Math.min(1440, Number(durationMinutes) || 60)),
        totalMarks: Math.max(1, Number(totalMarks) || 100),
        sections: sections.length ? sections : [defaultSection],
        navigation: {
            allowBack: navigation?.allowBack !== false,
            allowSkip: navigation?.allowSkip !== false,
            allowSectionJump: navigation?.allowSectionJump !== false,
            showTimer: navigation?.showTimer !== false,
            autoSubmitOnTime: navigation?.autoSubmitOnTime !== false,
            showMarksPerQuestion: navigation?.showMarksPerQuestion !== false
        },
        feedback: {
            showDuringTest: Boolean(feedback?.showDuringTest),
            showCorrectnessDuringTest: Boolean(feedback?.showCorrectnessDuringTest),
            showCorrectAnswersAfterSubmit: feedback?.showCorrectAnswersAfterSubmit !== false,
            showExplanationsAfterSubmit: feedback?.showExplanationsAfterSubmit !== false
        },
        scoring: {
            partialCredit: scoring?.partialCredit !== false,
            strictMarking: scoring?.strictMarking !== false,
            negativeMarking: scoring?.negativeMarking || null,
            gradeBands: Array.isArray(scoring?.gradeBands) ? scoring.gradeBands : null
        },
        selection: {
            selectedDeckIds: Array.isArray(selection?.selectedDeckIds) ? selection.selectedDeckIds : [],
            excludedCardIds: Array.isArray(selection?.excludedCardIds) ? selection.excludedCardIds : [],
            tagInclude: Array.isArray(selection?.tagInclude) ? selection.tagInclude : [],
            tagExclude: Array.isArray(selection?.tagExclude) ? selection.tagExclude : []
        },
        topicWeights: topicWeights && typeof topicWeights === 'object' ? topicWeights : {},
        depthDistribution: {
            recall: clamp01(depthDistribution?.recall ?? 0.3),
            application: clamp01(depthDistribution?.application ?? 0.4),
            evaluation: clamp01(depthDistribution?.evaluation ?? 0.3)
        },
        questionTypeMix: questionTypeMix && typeof questionTypeMix === 'object' ? questionTypeMix : {},
        tags: Array.isArray(tags) ? tags : [],
        metadata: metadata && typeof metadata === 'object' ? metadata : {},
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        isDeleted: false,
        version: 1
    };
}

// --- Exam Paper Generation ---

/**
 * Generates an exam paper from an ExamSpec.
 * @param {Object} examSpec The exam specification
 * @param {Array} questions Available question pool
 * @param {Object} options Generation options
 * @returns {Object} Generated exam paper
 */
export function generateExamPaper(examSpec, questions, options = {}) {
    const paperId = generateUUID();
    const seed = options.seed ?? Date.now();
    const rng = createSeededRandom(seed);
    
    const availableQuestions = questions.filter(q => {
        if (q?.isDeleted) return false;
        if (!q?.id) return false;
        return true;
    });
    
    const paperSections = [];
    let totalMarksAllocated = 0;
    
    for (const section of examSpec.sections || []) {
        const sectionQuestions = selectQuestionsForSection(
            section,
            availableQuestions,
            rng,
            examSpec.selection
        );
        
        const sectionMarks = sectionQuestions.reduce((sum, q) => {
            return sum + (Number(q?.marksAvailable) || 1);
        }, 0);
        
        paperSections.push({
            id: section.id || generateUUID(),
            name: section.name || 'Section',
            questions: sectionQuestions.map(q => ({
                questionId: q.id,
                marksAvailable: Number(q.marksAvailable) || 1,
                order: q.order
            })),
            totalMarks: sectionMarks,
            timeMinutes: section.timeMinutes || null
        });
        
        totalMarksAllocated += sectionMarks;
    }
    
    return {
        id: paperId,
        examSpecId: examSpec.id,
        name: examSpec.name,
        generatedAt: new Date().toISOString(),
        seed,
        durationMinutes: examSpec.durationMinutes,
        totalMarks: totalMarksAllocated,
        sections: paperSections,
        navigation: { ...examSpec.navigation },
        feedback: { ...examSpec.feedback },
        scoring: { ...examSpec.scoring },
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        isDeleted: false,
        version: 1
    };
}

function selectQuestionsForSection(section, questions, rng, selection) {
    const targetMarks = section.marks || 10;
    const types = Array.isArray(section.types) ? section.types : ['mixed'];
    const difficultyTargets = section.difficultyTargets || { easy: 0.3, medium: 0.4, hard: 0.3 };
    
    // Filter questions by type
    let candidates = questions.filter(q => {
        if (types.includes('mixed')) return true;
        return types.includes(q.type);
    });
    
    // Apply selection rules
    if (selection) {
        const excludedIds = new Set(selection.excludedCardIds || []);
        candidates = candidates.filter(q => !excludedIds.has(q.id));
        
        if (selection.tagInclude?.length) {
            candidates = candidates.filter(q => {
                const tags = q.tags || [];
                return selection.tagInclude.some(tag => tags.includes(tag));
            });
        }
        
        if (selection.tagExclude?.length) {
            candidates = candidates.filter(q => {
                const tags = q.tags || [];
                return !selection.tagExclude.some(tag => tags.includes(tag));
            });
        }
    }
    
    // Sort by difficulty buckets
    const easy = candidates.filter(q => (q.difficulty || 0.5) < 0.35);
    const medium = candidates.filter(q => (q.difficulty || 0.5) >= 0.35 && (q.difficulty || 0.5) < 0.65);
    const hard = candidates.filter(q => (q.difficulty || 0.5) >= 0.65);
    
    // Shuffle each bucket
    shuffleArray(easy, rng);
    shuffleArray(medium, rng);
    shuffleArray(hard, rng);
    
    // Select proportionally
    const selected = [];
    let currentMarks = 0;
    let order = 0;
    
    const targetEasy = Math.round(targetMarks * (difficultyTargets.easy || 0.3));
    const targetMedium = Math.round(targetMarks * (difficultyTargets.medium || 0.4));
    const targetHard = Math.round(targetMarks * (difficultyTargets.hard || 0.3));
    
    const addFromBucket = (bucket, target) => {
        let bucketMarks = 0;
        for (const q of bucket) {
            if (bucketMarks >= target) break;
            if (currentMarks >= targetMarks) break;
            const marks = Number(q.marksAvailable) || 1;
            selected.push({ ...q, order: order++, marksAvailable: marks });
            currentMarks += marks;
            bucketMarks += marks;
        }
    };
    
    addFromBucket(easy, targetEasy);
    addFromBucket(medium, targetMedium);
    addFromBucket(hard, targetHard);
    
    // Fill remaining from any bucket
    const remaining = [...easy, ...medium, ...hard].filter(q => 
        !selected.find(s => s.id === q.id)
    );
    shuffleArray(remaining, rng);
    
    for (const q of remaining) {
        if (currentMarks >= targetMarks) break;
        const marks = Number(q.marksAvailable) || 1;
        selected.push({ ...q, order: order++, marksAvailable: marks });
        currentMarks += marks;
    }
    
    return selected;
}

function createSeededRandom(seed) {
    let state = seed;
    return function() {
        state = (state * 1103515245 + 12345) & 0x7fffffff;
        return state / 0x7fffffff;
    };
}

function shuffleArray(array, rng) {
    for (let i = array.length - 1; i > 0; i--) {
        const j = Math.floor(rng() * (i + 1));
        [array[i], array[j]] = [array[j], array[i]];
    }
    return array;
}

// --- Exam Sitting ---

/**
 * Creates a new exam sitting (attempt).
 * @param {Object} examPaper The exam paper
 * @param {Object} options Sitting options
 * @returns {Object} New exam sitting
 */
export function createExamSitting(examPaper, options = {}) {
    const sittingId = generateUUID();
    const userId = options.userId || 'default_user';
    
    const responses = {};
    const timing = {};
    
    for (const section of examPaper.sections || []) {
        for (const item of section.questions || []) {
            responses[item.questionId] = null;
            timing[item.questionId] = {
                firstViewedAt: null,
                lastViewedAt: null,
                totalSeconds: 0
            };
        }
    }
    
    return {
        id: sittingId,
        examPaperId: examPaper.id,
        userId,
        status: 'not_started',
        startedAt: null,
        pausedAt: null,
        submittedAt: null,
        durationMinutes: examPaper.durationMinutes,
        remainingSeconds: (examPaper.durationMinutes || 60) * 60,
        currentSectionIndex: 0,
        currentQuestionIndex: 0,
        responses,
        timing,
        flagged: [],
        autoSaveData: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        isDeleted: false,
        version: 1
    };
}

/**
 * Updates a sitting with a response to a question.
 * @param {Object} sitting Current sitting state
 * @param {string} questionId Question ID
 * @param {*} response The response value
 * @param {Object} options Update options
 * @returns {Object} Updated sitting
 */
export function recordSittingResponse(sitting, questionId, response, options = {}) {
    const now = options.now || new Date();
    const updatedResponses = { ...sitting.responses };
    const updatedTiming = { ...sitting.timing };
    
    updatedResponses[questionId] = response;
    
    if (!updatedTiming[questionId]) {
        updatedTiming[questionId] = {
            firstViewedAt: null,
            lastViewedAt: null,
            totalSeconds: 0
        };
    }
    
    const timingEntry = { ...updatedTiming[questionId] };
    if (!timingEntry.firstViewedAt) {
        timingEntry.firstViewedAt = now.toISOString();
    }
    timingEntry.lastViewedAt = now.toISOString();
    
    if (options.secondsSpent) {
        timingEntry.totalSeconds = (timingEntry.totalSeconds || 0) + options.secondsSpent;
    }
    
    updatedTiming[questionId] = timingEntry;
    
    return {
        ...sitting,
        responses: updatedResponses,
        timing: updatedTiming,
        updatedAt: now.toISOString()
    };
}

/**
 * Submits an exam sitting for marking.
 * @param {Object} sitting Current sitting state
 * @param {Object} options Submit options
 * @returns {Object} Submitted sitting
 */
export function submitExamSitting(sitting, options = {}) {
    const now = options.now || new Date();
    
    return {
        ...sitting,
        status: 'submitted',
        submittedAt: now.toISOString(),
        updatedAt: now.toISOString()
    };
}

// --- Score Prediction ---

/**
 * Predicts exam score without sitting a mock.
 * Computes expected marks and uncertainty band.
 * 
 * @param {Object} examSpec The exam specification
 * @param {Array} questions Question pool
 * @param {Map|Object} atomsById Map of atoms
 * @param {Date} nowDate Current date
 * @param {Date} examDate Target exam date
 * @returns {Object} Prediction result with mean, variance, and grade probabilities
 */
export function predictExamScore(examSpec, questions, atomsById, nowDate, examDate) {
    const targetDate = examDate || (examSpec.examDate ? new Date(examSpec.examDate) : nowDate);
    const totalMarks = examSpec.totalMarks || 100;
    
    // Filter relevant questions
    const relevantQuestions = questions.filter(q => !q?.isDeleted);
    
    if (!relevantQuestions.length) {
        return {
            expectedMarks: 0,
            variance: 0,
            confidenceInterval: { lower: 0, upper: 0 },
            probability: 0.5,
            gradeProbabilities: {},
            breakdown: []
        };
    }
    
    let expectedTotal = 0;
    let varianceTotal = 0;
    const breakdown = [];
    
    for (const question of relevantQuestions) {
        const { probability } = computeQuestionSuccessProbability(
            question,
            atomsById,
            nowDate,
            targetDate
        );
        
        const marks = Number(question.marksAvailable) || 1;
        const expectedMarks = probability * marks;
        const varianceMarks = probability * (1 - probability) * marks * marks;
        
        expectedTotal += expectedMarks;
        varianceTotal += varianceMarks;
        
        breakdown.push({
            questionId: question.id,
            marks,
            probability,
            expectedMarks
        });
    }
    
    // Scale to exam total if needed
    const scaleFactor = relevantQuestions.length > 0 
        ? totalMarks / relevantQuestions.reduce((sum, q) => sum + (Number(q.marksAvailable) || 1), 0)
        : 1;
    
    const scaledExpected = expectedTotal * scaleFactor;
    const scaledVariance = varianceTotal * scaleFactor * scaleFactor;
    const stdDev = Math.sqrt(scaledVariance);
    
    // 90% confidence interval (z = 1.64)
    const z = 1.64;
    const confidenceInterval = {
        lower: Math.max(0, scaledExpected - z * stdDev),
        upper: Math.min(totalMarks, scaledExpected + z * stdDev)
    };
    
    // Compute grade probabilities if bands defined
    const gradeProbabilities = {};
    if (Array.isArray(examSpec.scoring?.gradeBands)) {
        for (const band of examSpec.scoring.gradeBands) {
            const threshold = band.minMarks || 0;
            const zScore = (threshold - scaledExpected) / (stdDev || 0.01);
            const probAbove = 1 - normalCDF(zScore);
            gradeProbabilities[band.grade] = clamp01(probAbove);
        }
    }
    
    return {
        expectedMarks: scaledExpected,
        variance: scaledVariance,
        stdDev,
        confidenceInterval,
        probability: clamp01(scaledExpected / totalMarks),
        gradeProbabilities,
        breakdown
    };
}

function normalCDF(z) {
    // Approximation of the standard normal CDF
    const a1 = 0.254829592;
    const a2 = -0.284496736;
    const a3 = 1.421413741;
    const a4 = -1.453152027;
    const a5 = 1.061405429;
    const p = 0.3275911;
    
    const sign = z < 0 ? -1 : 1;
    const absZ = Math.abs(z);
    const t = 1 / (1 + p * absZ);
    const y = 1 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-absZ * absZ / 2);
    
    return 0.5 * (1 + sign * y);
}

// --- Revision Completeness ---

/**
 * Computes revision completeness metric.
 * Not just "touched everything once" - incorporates predicted score,
 * coverage, fragility, and technique risks.
 * 
 * @param {Object} examSpec The exam specification
 * @param {Map|Object} atomsById Map of atoms
 * @param {Date} nowDate Current date
 * @param {Date} examDate Target exam date
 * @param {number} targetScore Target score (e.g., 70 for 70%)
 * @returns {Object} Completeness metrics
 */
export function computeRevisionCompleteness(examSpec, atomsById, nowDate, examDate, targetScore = 70) {
    const targetDate = examDate || (examSpec.examDate ? new Date(examSpec.examDate) : nowDate);
    const masteryMap = computeEffectiveMasteryMap(atomsById, nowDate, targetDate);
    
    const atoms = Array.from(atomsById instanceof Map ? atomsById.values() : Object.values(atomsById || {}));
    
    if (!atoms.length) {
        return {
            overall: 0,
            scoreProgress: 0,
            coverageProgress: 0,
            fragilityRisk: 0,
            techniqueProgress: 0,
            timingRisk: 0,
            breakdown: {}
        };
    }
    
    // Score progress
    let totalMastery = 0;
    let totalWeight = 0;
    
    for (const atom of atoms) {
        if (atom?.isDeleted) continue;
        const result = masteryMap.get(atom.id);
        const effective = result?.effective ?? 0;
        const weight = 1 + (atom.transferability || 0.5);
        totalMastery += effective * weight;
        totalWeight += weight;
    }
    
    const averageMastery = totalWeight > 0 ? totalMastery / totalWeight : 0;
    const scoreProgress = clamp01(averageMastery / (targetScore / 100));
    
    // Coverage progress (atoms with mastery > 0.2)
    const coveredCount = atoms.filter(a => {
        const result = masteryMap.get(a.id);
        return (result?.effective ?? 0) > 0.2;
    }).length;
    const coverageProgress = clamp01(coveredCount / atoms.length);
    
    // Fragility risk (average fragility of weak atoms)
    const weakAtoms = atoms.filter(a => {
        const result = masteryMap.get(a.id);
        return (result?.effective ?? 0) < 0.5;
    });
    const fragilityRisk = weakAtoms.length > 0
        ? weakAtoms.reduce((sum, a) => sum + (a.fragility || 0.5), 0) / weakAtoms.length
        : 0;
    
    // Technique progress (exam_technique atoms)
    const techniqueAtoms = atoms.filter(a => a.type === 'exam_technique');
    const techniqueProgress = techniqueAtoms.length > 0
        ? techniqueAtoms.reduce((sum, a) => {
            const result = masteryMap.get(a.id);
            return sum + (result?.effective ?? 0);
        }, 0) / techniqueAtoms.length
        : 1;
    
    // Timing risk (average time sensitivity of weak atoms)
    const timingRisk = weakAtoms.length > 0
        ? weakAtoms.reduce((sum, a) => sum + (a.timeSensitivity || 0.5), 0) / weakAtoms.length
        : 0;
    
    // Overall completeness (weighted combination)
    const overall = clamp01(
        0.4 * scoreProgress +
        0.25 * coverageProgress +
        0.15 * (1 - fragilityRisk) +
        0.1 * techniqueProgress +
        0.1 * (1 - timingRisk)
    );
    
    return {
        overall,
        scoreProgress,
        coverageProgress,
        fragilityRisk,
        techniqueProgress,
        timingRisk,
        breakdown: {
            totalAtoms: atoms.length,
            coveredAtoms: coveredCount,
            weakAtoms: weakAtoms.length,
            techniqueAtoms: techniqueAtoms.length,
            averageMastery
        }
    };
}

// --- Time to Target Estimator ---

/**
 * Estimates time remaining to reach target score.
 * Simulates practice actions to project hours needed.
 * 
 * @param {Object} examSpec The exam specification
 * @param {Map|Object} atomsById Map of atoms
 * @param {Date} nowDate Current date
 * @param {Date} examDate Target exam date
 * @param {number} targetScore Target score percentage
 * @param {Object} options Estimation options
 * @returns {Object} Time estimate with likely and safe hours
 */
export function estimateTimeToTarget(examSpec, atomsById, nowDate, examDate, targetScore = 70, options = {}) {
    const minutesPerSession = options.minutesPerSession || 30;
    const questionsPerSession = options.questionsPerSession || 10;
    const masteryGainPerQuestion = options.masteryGainPerQuestion || 0.05;
    
    const atoms = Array.from(atomsById instanceof Map ? atomsById.values() : Object.values(atomsById || {}));
    const targetMastery = targetScore / 100;
    
    if (!atoms.length) {
        return {
            likelyHours: 0,
            safeHours: 0,
            sessionsNeeded: 0,
            uncertaintyBand: { lower: 0, upper: 0 },
            topActions: []
        };
    }
    
    // Calculate current average mastery
    let currentTotal = 0;
    for (const atom of atoms) {
        currentTotal += atom.mastery || 0;
    }
    const currentMastery = currentTotal / atoms.length;
    
    // Calculate mastery gap
    const masteryGap = Math.max(0, targetMastery - currentMastery);
    
    // Estimate questions needed
    const questionsNeeded = masteryGap / masteryGainPerQuestion;
    const sessionsNeeded = Math.ceil(questionsNeeded / questionsPerSession);
    const likelyHours = (sessionsNeeded * minutesPerSession) / 60;
    
    // Add uncertainty (20% buffer for safe estimate)
    const safeHours = likelyHours * 1.2;
    
    // Identify top actions (weakest atoms with highest impact)
    const atomsWithValue = atoms.map(atom => {
        const mastery = atom.mastery || 0;
        const transferability = atom.transferability || 0.5;
        const value = (1 - mastery) * (1 + transferability);
        return { atomId: atom.id, name: atom.name, mastery, value };
    });
    
    atomsWithValue.sort((a, b) => b.value - a.value);
    const topActions = atomsWithValue.slice(0, 5).map(a => ({
        action: `Practise: ${a.name || a.atomId}`,
        currentMastery: a.mastery,
        expectedGain: masteryGainPerQuestion
    }));
    
    return {
        likelyHours,
        safeHours,
        sessionsNeeded,
        uncertaintyBand: {
            lower: likelyHours * 0.8,
            upper: safeHours
        },
        topActions,
        breakdown: {
            currentMastery,
            targetMastery,
            masteryGap,
            questionsNeeded,
            minutesPerSession
        }
    };
}

// --- Weak Area Practice Selection ---

/**
 * Computes value of practising each question for exam score gain.
 * Value(Q) = E[delta ExamScore | Q] / time(Q)
 * 
 * @param {Array} questions Available questions
 * @param {Map|Object} atomsById Map of atoms
 * @param {Date} nowDate Current date
 * @param {Date} examDate Target exam date
 * @param {Object} options Selection options
 * @returns {Array} Questions ranked by value
 */
export function rankQuestionsForPractice(questions, atomsById, nowDate, examDate, options = {}) {
    const targetDate = examDate || nowDate;
    
    const ranked = questions
        .filter(q => !q?.isDeleted)
        .map(question => {
            const { probability, readiness, breakdown } = computeQuestionSuccessProbability(
                question,
                atomsById,
                nowDate,
                targetDate
            );
            
            const marks = Number(question.marksAvailable) || 1;
            const timeSeconds = question.timeProfile?.expectedSeconds || 60;
            
            // Expected score gain from practice
            // Higher when: low mastery, high marks, high transferability
            const masteryGap = 1 - readiness;
            const transferability = breakdown.reduce((sum, b) => {
                const atom = atomsById instanceof Map 
                    ? atomsById.get(b.atomId)
                    : atomsById?.[b.atomId];
                return sum + (atom?.transferability || 0.5);
            }, 0) / Math.max(1, breakdown.length);
            
            const fragility = breakdown.reduce((sum, b) => {
                const atom = atomsById instanceof Map 
                    ? atomsById.get(b.atomId)
                    : atomsById?.[b.atomId];
                return sum + (atom?.fragility || 0.5);
            }, 0) / Math.max(1, breakdown.length);
            
            const expectedGain = masteryGap * marks * (1 + transferability) * (1 + fragility * 0.5);
            const valuePerMinute = expectedGain / (timeSeconds / 60);
            
            return {
                questionId: question.id,
                question,
                probability,
                readiness,
                marks,
                timeSeconds,
                masteryGap,
                transferability,
                fragility,
                expectedGain,
                valuePerMinute
            };
        });
    
    ranked.sort((a, b) => b.valuePerMinute - a.valuePerMinute);
    
    return ranked;
}

// --- Session Composition ---

/**
 * Creates an optimal practice session using Cortex policy.
 * Composes: warm-up, targeted struggle, technique drill, timed chunk, recap.
 * 
 * @param {Array} questions Available questions
 * @param {Map|Object} atomsById Map of atoms
 * @param {Date} nowDate Current date
 * @param {Date} examDate Target exam date
 * @param {Object} options Session options
 * @returns {Object} Composed session with phases
 */
export function composeOptimalSession(questions, atomsById, nowDate, examDate, options = {}) {
    const sessionMinutes = options.sessionMinutes || 30;
    const phase = options.phase || 'build'; // 'foundation', 'build', 'perform'
    const targetDate = examDate || nowDate;
    
    const rankedQuestions = rankQuestionsForPractice(
        questions,
        atomsById,
        nowDate,
        targetDate
    );
    
    if (!rankedQuestions.length) {
        return {
            phases: [],
            totalMinutes: 0,
            expectedGain: 0,
            explanation: 'No questions available for practice.'
        };
    }
    
    const phases = [];
    let remainingMinutes = sessionMinutes;
    let usedQuestionIds = new Set();
    
    // Phase 1: Warm-up (easy retrieval, 10% of time)
    const warmUpMinutes = Math.max(3, Math.round(sessionMinutes * 0.1));
    const warmUpQuestions = rankedQuestions
        .filter(q => q.probability > 0.7 && !usedQuestionIds.has(q.questionId))
        .slice(0, 3);
    
    if (warmUpQuestions.length) {
        phases.push({
            type: 'warm_up',
            name: 'Warm-up',
            questions: warmUpQuestions.map(q => q.questionId),
            targetMinutes: warmUpMinutes,
            purpose: 'Activate memory with familiar content'
        });
        warmUpQuestions.forEach(q => usedQuestionIds.add(q.questionId));
        remainingMinutes -= warmUpMinutes;
    }
    
    // Phase 2: Targeted Struggle (main learning, 50% of time)
    const struggleMinutes = Math.round(sessionMinutes * 0.5);
    const struggleQuestions = rankedQuestions
        .filter(q => q.probability >= 0.3 && q.probability <= 0.7 && !usedQuestionIds.has(q.questionId))
        .slice(0, 5);
    
    if (struggleQuestions.length) {
        phases.push({
            type: 'targeted_struggle',
            name: 'Targeted Practice',
            questions: struggleQuestions.map(q => q.questionId),
            targetMinutes: struggleMinutes,
            purpose: 'Focus on challenging but achievable questions'
        });
        struggleQuestions.forEach(q => usedQuestionIds.add(q.questionId));
        remainingMinutes -= struggleMinutes;
    }
    
    // Phase 3: Technique Drill (if in build/perform phase, 20% of time)
    if (phase !== 'foundation') {
        const techniqueMinutes = Math.round(sessionMinutes * 0.2);
        const techniqueQuestions = rankedQuestions
            .filter(q => {
                if (usedQuestionIds.has(q.questionId)) return false;
                const atom = q.question?.atomMap?.[0]?.atomId;
                if (!atom) return false;
                const atomData = atomsById instanceof Map 
                    ? atomsById.get(atom)
                    : atomsById?.[atom];
                return atomData?.type === 'exam_technique';
            })
            .slice(0, 2);
        
        if (techniqueQuestions.length) {
            phases.push({
                type: 'technique_drill',
                name: 'Exam Technique',
                questions: techniqueQuestions.map(q => q.questionId),
                targetMinutes: techniqueMinutes,
                purpose: 'Practise exam-specific skills'
            });
            techniqueQuestions.forEach(q => usedQuestionIds.add(q.questionId));
            remainingMinutes -= techniqueMinutes;
        }
    }
    
    // Phase 4: Timed Chunk (pressure practice, 15% of time)
    const timedMinutes = Math.round(sessionMinutes * 0.15);
    const timedQuestions = rankedQuestions
        .filter(q => !usedQuestionIds.has(q.questionId))
        .slice(0, 3);
    
    if (timedQuestions.length) {
        phases.push({
            type: 'timed_chunk',
            name: 'Timed Practice',
            questions: timedQuestions.map(q => q.questionId),
            targetMinutes: timedMinutes,
            purpose: 'Build fluency under time pressure',
            timed: true
        });
        timedQuestions.forEach(q => usedQuestionIds.add(q.questionId));
        remainingMinutes -= timedMinutes;
    }
    
    // Phase 5: Recap (review weak points)
    if (remainingMinutes > 0) {
        phases.push({
            type: 'recap',
            name: 'Recap',
            questions: [],
            targetMinutes: remainingMinutes,
            purpose: 'Review weak areas and consolidate learning'
        });
    }
    
    // Calculate total expected gain
    const totalExpectedGain = rankedQuestions
        .filter(q => usedQuestionIds.has(q.questionId))
        .reduce((sum, q) => sum + q.expectedGain, 0);
    
    // Generate explanation
    const explanation = generateSessionExplanation(phases, rankedQuestions, phase);
    
    return {
        phases,
        totalMinutes: sessionMinutes,
        expectedGain: totalExpectedGain,
        explanation,
        metadata: {
            phase,
            examDate: targetDate.toISOString(),
            questionsUsed: usedQuestionIds.size
        }
    };
}

function generateSessionExplanation(phases, rankedQuestions, phase) {
    const parts = [];
    
    parts.push(`This session is designed for the "${phase}" phase of your revision.`);
    
    if (phases.find(p => p.type === 'warm_up')) {
        parts.push('Starting with familiar content to activate your memory.');
    }
    
    if (phases.find(p => p.type === 'targeted_struggle')) {
        parts.push('The main focus is on questions where you can make progress.');
    }
    
    if (phases.find(p => p.type === 'technique_drill')) {
        parts.push('Includes practice on exam techniques.');
    }
    
    if (phases.find(p => p.type === 'timed_chunk')) {
        parts.push('A timed section to build fluency under pressure.');
    }
    
    return parts.join(' ');
}

// --- Keyboard Shortcut Support ---

export const EXAM_MODE_SHORTCUTS = {
    // Navigation
    nextQuestion: { key: 'ArrowRight', alt: 'n', description: 'Next question' },
    previousQuestion: { key: 'ArrowLeft', alt: 'p', description: 'Previous question' },
    jumpToQuestion: { key: 'g', ctrl: true, description: 'Go to question number' },
    
    // Answering
    selectOption1: { key: '1', description: 'Select option 1' },
    selectOption2: { key: '2', description: 'Select option 2' },
    selectOption3: { key: '3', description: 'Select option 3' },
    selectOption4: { key: '4', description: 'Select option 4' },
    submitAnswer: { key: 'Enter', description: 'Submit answer' },
    
    // Exam controls
    flagQuestion: { key: 'f', description: 'Flag question for review' },
    submitExam: { key: 's', ctrl: true, description: 'Submit exam' },
    pauseExam: { key: 'Escape', description: 'Pause exam' },
    
    // Session controls
    startSession: { key: 'Enter', description: 'Start session' },
    showExplanation: { key: 'e', description: 'Show explanation' },
    showHint: { key: 'h', description: 'Show hint' }
};

/**
 * Creates a keyboard handler for exam mode.
 * @param {Object} callbacks Callback functions for each action
 * @returns {Function} Event handler function
 */
export function createExamKeyboardHandler(callbacks = {}) {
    return function handleKeydown(event) {
        const key = event.key;
        const ctrl = event.ctrlKey || event.metaKey;
        
        // Check if user is typing in an input
        const target = event.target;
        if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') {
            if (key !== 'Escape') return;
        }
        
        // Navigation
        if (key === 'ArrowRight' || key === 'n') {
            if (callbacks.nextQuestion) {
                event.preventDefault();
                callbacks.nextQuestion();
            }
        } else if (key === 'ArrowLeft' || key === 'p') {
            if (callbacks.previousQuestion) {
                event.preventDefault();
                callbacks.previousQuestion();
            }
        } else if (key === 'g' && ctrl) {
            if (callbacks.jumpToQuestion) {
                event.preventDefault();
                callbacks.jumpToQuestion();
            }
        }
        
        // Option selection (1-4)
        else if (['1', '2', '3', '4'].includes(key) && !ctrl) {
            if (callbacks.selectOption) {
                event.preventDefault();
                callbacks.selectOption(parseInt(key) - 1);
            }
        }
        
        // Submit
        else if (key === 'Enter' && !ctrl) {
            if (callbacks.submitAnswer) {
                event.preventDefault();
                callbacks.submitAnswer();
            }
        }
        
        // Flag
        else if (key === 'f' && !ctrl) {
            if (callbacks.flagQuestion) {
                event.preventDefault();
                callbacks.flagQuestion();
            }
        }
        
        // Submit exam
        else if (key === 's' && ctrl) {
            if (callbacks.submitExam) {
                event.preventDefault();
                callbacks.submitExam();
            }
        }
        
        // Pause/escape
        else if (key === 'Escape') {
            if (callbacks.pauseExam) {
                event.preventDefault();
                callbacks.pauseExam();
            }
        }
        
        // Show explanation
        else if (key === 'e' && !ctrl) {
            if (callbacks.showExplanation) {
                event.preventDefault();
                callbacks.showExplanation();
            }
        }
        
        // Show hint
        else if (key === 'h' && !ctrl) {
            if (callbacks.showHint) {
                event.preventDefault();
                callbacks.showHint();
            }
        }
    };
}

// --- Exports for Testing ---

export {
    ATOM_TYPES,
    QUESTION_TYPES,
    SITTING_STATUSES,
    SESSION_PHASES,
    DEFAULT_STABILITY_DAYS,
    DEFAULT_DIFFICULTY,
    DEFAULT_DEPTH,
    LOGISTIC_STEEPNESS
};
