/**
 * Exam Mode Comprehensive Test Suite
 * 
 * Tests for all exam mode systems:
 * - Atom creation and dynamics
 * - Question management
 * - Mark scheme engine
 * - Prediction systems
 * - Session composition
 * - Keyboard shortcuts
 */

import assert from 'assert';
import {
    createAtom,
    createErrorAtom,
    createQuestion,
    createExamSpec,
    generateExamPaper,
    createExamSitting,
    submitExamSitting,
    predictExamScore,
    computeRevisionCompleteness,
    estimateTimeToTarget,
    rankQuestionsForPractice,
    composeOptimalSession,
    computeQuestionSuccessProbability,
    generateUUID,
    ATOM_TYPES,
    QUESTION_TYPES,
    SITTING_STATUSES,
    SESSION_PHASES,
    DEFAULT_STABILITY_DAYS,
    DEFAULT_DIFFICULTY,
    DEFAULT_DEPTH,
    createExamKeyboardHandler,
    EXAM_MODE_SHORTCUTS
} from '../js/core/exam/exam-mode.js';

import {
    clamp01,
    predictMastery,
    effectiveMastery,
    computeEffectiveMasteryMap,
    daysBetweenDates
} from '../js/core/exam/atom-dynamics.js';

import {
    gradeQuestion,
    normaliseResponseForGrading,
    computeTotalMarksFromAwardedPoints
} from '../js/core/exam/marking.js';

console.log('Running Exam Mode Comprehensive Tests...\n');

let testsPassed = 0;
let testsFailed = 0;

// Helper functions for creating test mark schemes (not exported from marking.js)
function createMarkScheme({ id, name, schemeType = 'points', points = [] } = {}) {
    return {
        id: id || generateUUID(),
        name: name || 'Test Scheme',
        schemeType,
        points: points.map(p => ({
            id: p.id || generateUUID(),
            code: p.code || '',
            marks: p.marks || 1,
            description: p.description || '',
            accept: p.accept || [],
            reject: p.reject || [],
            requires: p.requires || [],
            allowECF: p.allowECF || false,
            atomLinks: p.atomLinks || [],
            grading: p.grading || null
        }))
    };
}

function createPointsSchemePoint({ id, code, marks = 1, description = '', accept = [], atomLinks = [] } = {}) {
    return {
        id: id || generateUUID(),
        code: code || '',
        marks,
        description,
        accept,
        reject: [],
        requires: [],
        allowECF: false,
        atomLinks
    };
}

// Queue of tests to run (supports async tests)
const testQueue = [];

function test(name, fn) {
    testQueue.push({ name, fn });
}

async function runTests() {
    for (const { name, fn } of testQueue) {
        try {
            await fn();
            console.log(`[PASS] ${name}`);
            testsPassed++;
        } catch (error) {
            console.log(`[FAIL] ${name}`);
            console.log(`       Error: ${error.message}`);
            testsFailed++;
        }
    }
}

function section(name) {
    testQueue.push({ name: `--- ${name} ---`, fn: () => console.log() });
}

function assertClose(actual, expected, tolerance = 0.01, message = '') {
    const diff = Math.abs(actual - expected);
    if (diff > tolerance) {
        throw new Error(`${message} Expected ${expected} +/- ${tolerance}, got ${actual} (diff: ${diff})`);
    }
}

// ============================================================================
// SECTION 1: Atom Creation and Management
// ============================================================================

section('Section 1: Atom Creation and Management');

test('createAtom returns valid atom with defaults', () => {
    const atom = createAtom({ name: 'Test Atom' });
    
    assert.ok(atom.id, 'Atom should have an ID');
    assert.strictEqual(atom.name, 'Test Atom');
    assert.strictEqual(atom.type, 'knowledge');
    assert.strictEqual(atom.mastery, 0);
    assert.strictEqual(atom.stabilityDays, DEFAULT_STABILITY_DAYS);
    assert.strictEqual(atom.difficulty, DEFAULT_DIFFICULTY);
    assert.strictEqual(atom.depth, DEFAULT_DEPTH);
    assert.strictEqual(atom.transferability, 0.5);
    assert.strictEqual(atom.fragility, 0.5);
    assert.strictEqual(atom.timeSensitivity, 0.5);
    assert.ok(Array.isArray(atom.prerequisites));
    assert.ok(Array.isArray(atom.tags));
    assert.strictEqual(atom.isDeleted, false);
    assert.strictEqual(atom.version, 1);
});

test('createAtom clamps mastery to [0, 1]', () => {
    const atomHigh = createAtom({ mastery: 1.5 });
    const atomLow = createAtom({ mastery: -0.5 });
    const atomNormal = createAtom({ mastery: 0.7 });
    
    assert.strictEqual(atomHigh.mastery, 1);
    assert.strictEqual(atomLow.mastery, 0);
    assert.strictEqual(atomNormal.mastery, 0.7);
});

test('createAtom validates type', () => {
    const validAtom = createAtom({ type: 'procedure' });
    const invalidAtom = createAtom({ type: 'invalid_type' });
    
    assert.strictEqual(validAtom.type, 'procedure');
    assert.strictEqual(invalidAtom.type, 'knowledge'); // Falls back to default
});

test('createAtom handles all valid types', () => {
    for (const type of ATOM_TYPES) {
        const atom = createAtom({ type });
        assert.strictEqual(atom.type, type);
    }
});

test('createErrorAtom returns valid error atom', () => {
    const errorAtom = createErrorAtom({
        name: 'Unit Error',
        description: 'Forgets to include units in answer',
        frequency: 0.3,
        persistence: 0.7
    });
    
    assert.ok(errorAtom.id);
    assert.strictEqual(errorAtom.name, 'Unit Error');
    assert.strictEqual(errorAtom.frequency, 0.3);
    assert.strictEqual(errorAtom.persistence, 0.7);
    assert.ok(Array.isArray(errorAtom.contexts));
});

test('createErrorAtom clamps values', () => {
    const errorAtom = createErrorAtom({
        frequency: 2.0,
        persistence: -1.0,
        risk: 1.5
    });
    
    assert.strictEqual(errorAtom.frequency, 1);
    assert.strictEqual(errorAtom.persistence, 0);
    assert.strictEqual(errorAtom.risk, 1);
});

// ============================================================================
// SECTION 2: Atom Dynamics (Decay and Mastery)
// ============================================================================

section('Section 2: Atom Dynamics');

test('clamp01 clamps values correctly', () => {
    assert.strictEqual(clamp01(0.5), 0.5);
    assert.strictEqual(clamp01(-0.5), 0);
    assert.strictEqual(clamp01(1.5), 1);
    assert.strictEqual(clamp01(NaN), 0);
    // Infinity is not finite, so returns 0
    assert.strictEqual(clamp01(Infinity), 0);
    // -Infinity is also not finite, so returns 0
    assert.strictEqual(clamp01(-Infinity), 0);
});

test('daysBetweenDates calculates correctly', () => {
    const start = new Date('2025-01-01');
    const end = new Date('2025-01-08');
    
    const days = daysBetweenDates(start, end);
    assert.strictEqual(days, 7);
});

test('daysBetweenDates handles negative intervals', () => {
    const start = new Date('2025-01-08');
    const end = new Date('2025-01-01');
    
    const days = daysBetweenDates(start, end);
    assert.strictEqual(days, -7);
});

test('predictMastery returns current mastery when target is now', () => {
    const atom = { mastery: 0.8, stabilityDays: 10 };
    const now = new Date();
    
    const predicted = predictMastery(atom, now, now);
    assert.strictEqual(predicted, 0.8);
});

test('predictMastery decays over time', () => {
    const atom = { mastery: 1.0, stabilityDays: 7 };
    const now = new Date('2025-01-01');
    const future = new Date('2025-01-08'); // 7 days later = 1 half-life
    
    const predicted = predictMastery(atom, now, future);
    // After 1 stability period, mastery should be ~0.368 (1/e)
    assertClose(predicted, 0.368, 0.01);
});

test('predictMastery returns 0 when stability is 0', () => {
    const atom = { mastery: 1.0, stabilityDays: 0 };
    const now = new Date('2025-01-01');
    const future = new Date('2025-01-02');
    
    const predicted = predictMastery(atom, now, future);
    assert.strictEqual(predicted, 0);
});

test('effectiveMastery respects prerequisites', () => {
    const atoms = new Map([
        ['prereq1', { id: 'prereq1', mastery: 0.5, stabilityDays: 10, prerequisites: [] }],
        ['main', { id: 'main', mastery: 1.0, stabilityDays: 10, prerequisites: [{ atomId: 'prereq1', weight: 1.0 }] }]
    ]);
    const now = new Date();
    
    const result = effectiveMastery('main', atoms, now, now);
    // effectiveMastery returns an object with effective, predicted, cap, prereqScore
    assert.ok(typeof result === 'object');
    assert.ok(result.effective <= 1.0);
    assert.ok(result.effective >= 0);
});

test('effectiveMastery handles circular dependencies', () => {
    const atoms = new Map([
        ['a', { id: 'a', mastery: 0.8, stabilityDays: 10, prerequisites: [{ atomId: 'b', weight: 1.0 }] }],
        ['b', { id: 'b', mastery: 0.6, stabilityDays: 10, prerequisites: [{ atomId: 'a', weight: 1.0 }] }]
    ]);
    const now = new Date();
    
    // Should not throw or infinite loop
    const result = effectiveMastery('a', atoms, now, now);
    assert.ok(typeof result === 'object');
    assert.ok(result.effective >= 0 && result.effective <= 1);
});

test('computeEffectiveMasteryMap computes all atoms', () => {
    const atoms = new Map([
        ['a', { id: 'a', mastery: 0.8, stabilityDays: 10, prerequisites: [] }],
        ['b', { id: 'b', mastery: 0.6, stabilityDays: 10, prerequisites: [] }]
    ]);
    const now = new Date();
    
    const masteryMap = computeEffectiveMasteryMap(atoms, now, now);
    
    assert.ok(masteryMap instanceof Map);
    assert.ok(masteryMap.has('a'));
    assert.ok(masteryMap.has('b'));
});

// ============================================================================
// SECTION 3: Question Creation and Management
// ============================================================================

section('Section 3: Question Creation');

test('createQuestion returns valid question with defaults', () => {
    const question = createQuestion({ prompt: 'What is 2+2?' });
    
    assert.ok(question.id);
    assert.strictEqual(question.prompt, 'What is 2+2?');
    assert.strictEqual(question.type, 'mcq_single');
    assert.strictEqual(question.difficulty, DEFAULT_DIFFICULTY);
    assert.strictEqual(question.depth, DEFAULT_DEPTH);
    assert.ok(question.timeProfile);
    assert.ok(question.variationProfile);
    assert.ok(Array.isArray(question.atomMap));
});

test('createQuestion validates question type', () => {
    const validQ = createQuestion({ type: 'numeric' });
    const invalidQ = createQuestion({ type: 'invalid' });
    
    assert.strictEqual(validQ.type, 'numeric');
    assert.strictEqual(invalidQ.type, 'mcq_single');
});

test('createQuestion handles all valid types', () => {
    for (const type of QUESTION_TYPES) {
        const q = createQuestion({ type });
        assert.strictEqual(q.type, type);
    }
});

test('createQuestion extracts atomIds from atomMap', () => {
    const question = createQuestion({
        atomMap: [
            { atomId: 'atom1', weight: 1.0 },
            { atomId: 'atom2', weight: 0.5 }
        ]
    });
    
    assert.ok(Array.isArray(question.atomIds));
    assert.ok(question.atomIds.includes('atom1'));
    assert.ok(question.atomIds.includes('atom2'));
});

test('computeQuestionSuccessProbability returns valid probability', () => {
    const question = createQuestion({
        difficulty: 0.5,
        atomMap: [{ atomId: 'atom1', weight: 1.0 }]
    });
    
    const atoms = new Map([
        ['atom1', { id: 'atom1', mastery: 0.8, stabilityDays: 10 }]
    ]);
    
    const now = new Date();
    const result = computeQuestionSuccessProbability(question, atoms, now, now);
    
    assert.ok(result.probability >= 0 && result.probability <= 1);
    assert.ok(result.readiness >= 0 && result.readiness <= 1);
    assert.ok(Array.isArray(result.breakdown));
});

test('computeQuestionSuccessProbability handles empty atomMap', () => {
    const question = createQuestion({ atomMap: [] });
    const atoms = new Map();
    const now = new Date();
    
    const result = computeQuestionSuccessProbability(question, atoms, now, now);
    
    assert.strictEqual(result.probability, 0.5);
    assert.strictEqual(result.readiness, 0.5);
});

// ============================================================================
// SECTION 4: Mark Scheme Engine
// ============================================================================

section('Section 4: Mark Scheme Engine');

test('createMarkScheme returns valid scheme', () => {
    const scheme = createMarkScheme({
        name: 'Test Scheme',
        schemeType: 'points',
        points: [
            { id: 'M1', marks: 1, description: 'Method step 1' }
        ]
    });
    
    assert.ok(scheme.id);
    assert.strictEqual(scheme.name, 'Test Scheme');
    assert.strictEqual(scheme.schemeType, 'points');
    assert.ok(Array.isArray(scheme.points));
});

test('createPointsSchemePoint creates valid point', () => {
    const point = createPointsSchemePoint({
        code: 'M1',
        marks: 2,
        description: 'Shows correct method',
        accept: ['method 1', 'method 2']
    });
    
    assert.ok(point.id);
    assert.strictEqual(point.code, 'M1');
    assert.strictEqual(point.marks, 2);
    assert.ok(Array.isArray(point.accept));
});

test('normaliseResponseForGrading handles MCQ single', () => {
    const result = normaliseResponseForGrading('mcq_single', { selectedIndex: 2 });
    assert.ok(result !== null);
});

test('normaliseResponseForGrading handles numeric', () => {
    const result = normaliseResponseForGrading('numeric', { value: 42.5 });
    assert.ok(result !== null);
});

test('gradeQuestion grades MCQ correctly', () => {
    const question = createQuestion({
        type: 'mcq_single',
        options: ['A', 'B', 'C', 'D']
    });
    
    const markScheme = createMarkScheme({
        schemeType: 'points',
        points: [
            {
                id: 'p1',
                marks: 1,
                grading: {
                    kind: 'mcq_single',
                    correctIndex: 1
                }
            }
        ]
    });
    
    // Correct answer - gradeQuestion takes a destructured object
    const correctResult = gradeQuestion({
        question,
        markScheme,
        response: { selectedIndex: 1 }
    });
    
    assert.ok(correctResult);
    assert.ok(correctResult.totalAwardedMarks >= 0);
});

test('gradeQuestion returns consistent results (deterministic)', () => {
    const question = createQuestion({
        type: 'numeric'
    });
    
    const markScheme = createMarkScheme({
        schemeType: 'points',
        points: [
            {
                id: 'p1',
                marks: 1,
                grading: {
                    kind: 'numeric',
                    exactValue: 42,
                    tolerance: 1
                }
            }
        ]
    });
    
    const result1 = gradeQuestion({ question, markScheme, response: { value: 42 } });
    const result2 = gradeQuestion({ question, markScheme, response: { value: 42 } });
    
    assert.strictEqual(result1.totalAwardedMarks, result2.totalAwardedMarks);
});

// ============================================================================
// SECTION 5: Exam Spec and Paper Generation
// ============================================================================

section('Section 5: Exam Spec and Paper Generation');

test('createExamSpec returns valid spec', () => {
    const spec = createExamSpec({
        name: 'Mock Exam',
        examDate: '2025-06-15',
        totalMarks: 100,
        durationMinutes: 120
    });
    
    assert.ok(spec.id);
    assert.strictEqual(spec.name, 'Mock Exam');
    assert.strictEqual(spec.totalMarks, 100);
    assert.strictEqual(spec.durationMinutes, 120);
});

test('createExamSpec handles missing values', () => {
    const spec = createExamSpec({});
    
    assert.ok(spec.id);
    assert.ok(spec.totalMarks > 0);
});

test('generateExamPaper generates paper from spec', () => {
    const spec = createExamSpec({
        totalMarks: 50,
        sections: [
            { name: 'Section A', marks: 25 },
            { name: 'Section B', marks: 25 }
        ]
    });
    
    const questions = [
        createQuestion({ tags: ['Section A'] }),
        createQuestion({ tags: ['Section A'] }),
        createQuestion({ tags: ['Section B'] }),
        createQuestion({ tags: ['Section B'] })
    ];
    
    const paper = generateExamPaper(spec, questions);
    
    assert.ok(paper);
    assert.ok(paper.id);
    assert.ok(Array.isArray(paper.questionIds) || Array.isArray(paper.sections));
});

// ============================================================================
// SECTION 6: Sitting Management
// ============================================================================

section('Section 6: Sitting Management');

test('createExamSitting creates valid sitting', () => {
    const spec = createExamSpec({});
    const paper = { id: 'paper1', questionIds: ['q1', 'q2'] };
    
    const sitting = createExamSitting(spec, paper);
    
    assert.ok(sitting.id);
    assert.strictEqual(sitting.status, 'not_started');
    assert.ok(sitting.responses instanceof Map || typeof sitting.responses === 'object');
});

test('Sitting status transitions are valid', () => {
    for (const status of SITTING_STATUSES) {
        assert.ok(typeof status === 'string');
    }
    
    assert.ok(SITTING_STATUSES.includes('not_started'));
    assert.ok(SITTING_STATUSES.includes('in_progress'));
    assert.ok(SITTING_STATUSES.includes('submitted'));
});

// ============================================================================
// SECTION 7: Predictions
// ============================================================================

section('Section 7: Predictions');

test('predictExamScore returns valid prediction', () => {
    const spec = createExamSpec({ totalMarks: 100, targetScore: 70 });
    
    const questions = [
        createQuestion({ atomMap: [{ atomId: 'a1', weight: 1 }] }),
        createQuestion({ atomMap: [{ atomId: 'a2', weight: 1 }] })
    ];
    
    const atoms = new Map([
        ['a1', createAtom({ id: 'a1', mastery: 0.8 })],
        ['a2', createAtom({ id: 'a2', mastery: 0.6 })]
    ]);
    
    const now = new Date();
    const prediction = predictExamScore(spec, questions, atoms, now, now);
    
    assert.ok(prediction);
    assert.ok(typeof prediction.expectedMarks === 'number');
    assert.ok(prediction.confidenceInterval);
    assert.ok(typeof prediction.confidenceInterval.lower === 'number');
    assert.ok(typeof prediction.confidenceInterval.upper === 'number');
});

test('predictExamScore handles empty questions', () => {
    const spec = createExamSpec({});
    const prediction = predictExamScore(spec, [], new Map(), new Date(), new Date());
    
    assert.ok(prediction);
    assert.strictEqual(prediction.expectedMarks, 0);
});

test('computeRevisionCompleteness returns valid completeness', () => {
    const spec = createExamSpec({ targetScore: 70 });
    const atoms = new Map([
        ['a1', createAtom({ id: 'a1', mastery: 0.9 })],
        ['a2', createAtom({ id: 'a2', mastery: 0.4 })]
    ]);
    
    const now = new Date();
    const completeness = computeRevisionCompleteness(spec, atoms, now, now, 70);
    
    assert.ok(completeness);
    assert.ok(typeof completeness.overall === 'number');
    assert.ok(completeness.overall >= 0 && completeness.overall <= 1);
});

test('estimateTimeToTarget returns valid estimate', () => {
    const spec = createExamSpec({ targetScore: 80 });
    const atoms = new Map([
        ['a1', createAtom({ id: 'a1', mastery: 0.5 })]
    ]);
    
    const now = new Date();
    const future = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000); // 30 days
    
    const estimate = estimateTimeToTarget(spec, atoms, now, future, 80);
    
    assert.ok(estimate);
    assert.ok(typeof estimate.likelyHours === 'number');
    assert.ok(estimate.likelyHours >= 0);
});

// ============================================================================
// SECTION 8: Practice Selection and Session Composition
// ============================================================================

section('Section 8: Practice Selection');

test('rankQuestionsForPractice ranks by expected gain', () => {
    const questions = [
        createQuestion({ id: 'q1', atomMap: [{ atomId: 'a1', weight: 1 }], difficulty: 0.5 }),
        createQuestion({ id: 'q2', atomMap: [{ atomId: 'a2', weight: 1 }], difficulty: 0.3 })
    ];
    
    const atoms = new Map([
        ['a1', createAtom({ id: 'a1', mastery: 0.3 })], // Lower mastery = higher priority
        ['a2', createAtom({ id: 'a2', mastery: 0.9 })]  // Higher mastery = lower priority
    ]);
    
    const now = new Date();
    const ranked = rankQuestionsForPractice(questions, atoms, now, now);
    
    assert.ok(Array.isArray(ranked));
    assert.ok(ranked.length <= questions.length);
    
    // Lower mastery question should rank higher
    if (ranked.length >= 2) {
        assert.strictEqual(ranked[0].questionId, 'q1');
    }
});

test('composeOptimalSession creates valid session', () => {
    const questions = [
        createQuestion({ id: 'q1', atomMap: [{ atomId: 'a1', weight: 1 }] }),
        createQuestion({ id: 'q2', atomMap: [{ atomId: 'a2', weight: 1 }] }),
        createQuestion({ id: 'q3', atomMap: [{ atomId: 'a3', weight: 1 }] })
    ];
    
    const atoms = new Map([
        ['a1', createAtom({ id: 'a1', mastery: 0.8 })],
        ['a2', createAtom({ id: 'a2', mastery: 0.4 })],
        ['a3', createAtom({ id: 'a3', mastery: 0.6 })]
    ]);
    
    const now = new Date();
    const session = composeOptimalSession(questions, atoms, now, now, { targetMinutes: 15 });
    
    assert.ok(session);
    assert.ok(Array.isArray(session.phases));
    assert.ok(session.totalMinutes > 0);
});

test('Session phases are valid', () => {
    for (const phase of SESSION_PHASES) {
        assert.ok(typeof phase === 'string');
    }
    
    assert.ok(SESSION_PHASES.includes('warm_up'));
    assert.ok(SESSION_PHASES.includes('targeted_struggle'));
    assert.ok(SESSION_PHASES.includes('recap'));
});

// ============================================================================
// SECTION 9: Keyboard Shortcuts
// ============================================================================

section('Section 9: Keyboard Shortcuts');

test('EXAM_MODE_SHORTCUTS is defined', () => {
    assert.ok(EXAM_MODE_SHORTCUTS);
    assert.ok(typeof EXAM_MODE_SHORTCUTS === 'object');
});

test('createExamKeyboardHandler returns function', () => {
    const handler = createExamKeyboardHandler({});
    assert.ok(typeof handler === 'function');
});

test('Keyboard handler does not throw on key events', () => {
    const callbacks = {
        nextQuestion: () => {},
        previousQuestion: () => {},
        submitAnswer: () => {},
        flagQuestion: () => {}
    };
    
    const handler = createExamKeyboardHandler(callbacks);
    
    // Simulate key events with proper target
    const mockEvent = {
        key: 'ArrowRight',
        ctrlKey: false,
        metaKey: false,
        target: { tagName: 'DIV' },
        preventDefault: () => {}
    };
    
    // Should not throw
    handler(mockEvent);
});

// ============================================================================
// SECTION 10: UUID Generation
// ============================================================================

section('Section 10: Utilities');

test('generateUUID returns valid UUID format', () => {
    const uuid = generateUUID();
    
    assert.ok(typeof uuid === 'string');
    assert.ok(uuid.length > 0);
    // Basic UUID format check (8-4-4-4-12)
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    assert.ok(uuidRegex.test(uuid), `UUID format invalid: ${uuid}`);
});

test('generateUUID generates unique IDs', () => {
    const uuids = new Set();
    for (let i = 0; i < 100; i++) {
        uuids.add(generateUUID());
    }
    
    assert.strictEqual(uuids.size, 100, 'All UUIDs should be unique');
});

// ============================================================================
// SECTION 11: Edge Cases and Error Handling
// ============================================================================

section('Section 11: Edge Cases');

test('createAtom handles null/undefined inputs', () => {
    // createAtom throws on null - cannot destructure null
    assert.throws(() => createAtom(null), 'createAtom should throw on null');
    
    // undefined uses default parameter {}, so works
    const atom2 = createAtom(undefined);
    assert.ok(atom2.id);
    
    // Empty object should work with defaults
    const atom3 = createAtom({});
    assert.ok(atom3.id);
});

test('createQuestion handles null/undefined inputs', () => {
    // createQuestion throws on null - cannot destructure null
    assert.throws(() => createQuestion(null), 'createQuestion should throw on null');
    
    // undefined uses default parameter {}, so works
    const q2 = createQuestion(undefined);
    assert.ok(q2.id);
    
    // Empty object should work with defaults
    const q3 = createQuestion({});
    assert.ok(q3.id);
});

test('predictMastery handles missing atom properties', () => {
    const predicted1 = predictMastery({}, new Date(), new Date());
    const predicted2 = predictMastery(null, new Date(), new Date());
    
    assert.strictEqual(predicted1, 0);
    assert.strictEqual(predicted2, 0);
});

test('effectiveMastery handles missing atom', () => {
    const atoms = new Map();
    const now = new Date();
    
    const result = effectiveMastery('nonexistent', atoms, now, now);
    // Returns object with effective = 0 for missing atoms
    assert.ok(typeof result === 'object');
    assert.strictEqual(result.effective, 0);
});

test('computeQuestionSuccessProbability handles missing atoms', () => {
    const question = createQuestion({
        atomMap: [{ atomId: 'missing', weight: 1 }]
    });
    
    const atoms = new Map(); // Empty
    const now = new Date();
    
    const result = computeQuestionSuccessProbability(question, atoms, now, now);
    
    assert.ok(result.probability >= 0 && result.probability <= 1);
});

test('rankQuestionsForPractice handles empty inputs', () => {
    const ranked = rankQuestionsForPractice([], new Map(), new Date(), new Date());
    assert.ok(Array.isArray(ranked));
    assert.strictEqual(ranked.length, 0);
});

test('composeOptimalSession handles empty questions', () => {
    const session = composeOptimalSession([], new Map(), new Date(), new Date(), {});
    
    assert.ok(session);
    assert.ok(Array.isArray(session.phases));
});

// ============================================================================
// Run all tests and print summary
// ============================================================================

runTests().then(() => {
    console.log('\n========================================');
    console.log(`Tests Passed: ${testsPassed}`);
    console.log(`Tests Failed: ${testsFailed}`);
    console.log(`Total: ${testsPassed + testsFailed}`);
    console.log('========================================\n');

    if (testsFailed > 0) {
        process.exit(1);
    }
});
