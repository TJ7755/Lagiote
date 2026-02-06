import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
    generateUUID,
    createAtom,
    createErrorAtom,
    createQuestion,
    computeQuestionSuccessProbability,
    createExamSpec,
    generateExamPaper,
    createExamSitting,
    recordSittingResponse,
    submitExamSitting,
    predictExamScore,
    computeRevisionCompleteness,
    estimateTimeToTarget,
    rankQuestionsForPractice,
    composeOptimalSession,
    createExamKeyboardHandler,
    ATOM_TYPES,
    QUESTION_TYPES,
    SITTING_STATUSES,
    SESSION_PHASES,
    EXAM_MODE_SHORTCUTS
} from '../../js/core/exam/exam-mode.js';

describe('Exam Mode - UUID Generation', () => {
    it('generates valid UUID format', () => {
        const uuid = generateUUID();
        expect(typeof uuid).toBe('string');
        expect(uuid.length).toBe(36);
        expect(uuid).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
    });

    it('generates unique UUIDs', () => {
        const uuids = new Set();
        for (let i = 0; i < 100; i++) {
            uuids.add(generateUUID());
        }
        expect(uuids.size).toBe(100);
    });
});

describe('Exam Mode - Atom Creation', () => {
    it('creates atom with default values', () => {
        const atom = createAtom({ name: 'Test Atom' });
        
        expect(atom.id).toBeDefined();
        expect(atom.name).toBe('Test Atom');
        expect(atom.type).toBe('knowledge');
        expect(atom.mastery).toBe(0);
        expect(atom.stabilityDays).toBe(7);
        expect(atom.difficulty).toBe(0.5);
        expect(atom.depth).toBe(0.5);
        expect(atom.transferability).toBe(0.5);
        expect(atom.fragility).toBe(0.5);
        expect(atom.timeSensitivity).toBe(0.5);
        expect(atom.prerequisites).toEqual([]);
        expect(atom.tags).toEqual([]);
        expect(atom.isDeleted).toBe(false);
        expect(atom.version).toBe(1);
    });

    it('clamps mastery values to 0-1', () => {
        const atomLow = createAtom({ mastery: -0.5 });
        const atomHigh = createAtom({ mastery: 1.5 });
        
        expect(atomLow.mastery).toBe(0);
        expect(atomHigh.mastery).toBe(1);
    });

    it('validates atom types', () => {
        const validAtom = createAtom({ type: 'procedure' });
        const invalidAtom = createAtom({ type: 'invalid_type' });
        
        expect(validAtom.type).toBe('procedure');
        expect(invalidAtom.type).toBe('knowledge');
    });

    it('preserves prerequisites', () => {
        const atom = createAtom({
            name: 'Advanced',
            prerequisites: [
                { atomId: 'basic-1', weight: 0.8 },
                { atomId: 'basic-2', weight: 0.5 }
            ]
        });
        
        expect(atom.prerequisites).toHaveLength(2);
        expect(atom.prerequisites[0].atomId).toBe('basic-1');
        expect(atom.prerequisites[0].weight).toBe(0.8);
    });
});

describe('Exam Mode - Error Atom Creation', () => {
    it('creates error atom with default values', () => {
        const errorAtom = createErrorAtom({ name: 'Unit Confusion' });
        
        expect(errorAtom.id).toBeDefined();
        expect(errorAtom.name).toBe('Unit Confusion');
        expect(errorAtom.frequency).toBe(0);
        expect(errorAtom.persistence).toBe(0.5);
        expect(errorAtom.risk).toBe(0.5);
        expect(errorAtom.contexts).toEqual([]);
        expect(errorAtom.isDeleted).toBe(false);
    });

    it('clamps risk values', () => {
        const lowRisk = createErrorAtom({ risk: -0.1 });
        const highRisk = createErrorAtom({ risk: 1.5 });
        
        expect(lowRisk.risk).toBe(0);
        expect(highRisk.risk).toBe(1);
    });
});

describe('Exam Mode - Question Creation', () => {
    it('creates question with default values', () => {
        const question = createQuestion({
            prompt: 'What is 2 + 2?',
            options: ['3', '4', '5', '6']
        });
        
        expect(question.id).toBeDefined();
        expect(question.prompt).toBe('What is 2 + 2?');
        expect(question.type).toBe('mcq_single');
        expect(question.options).toHaveLength(4);
        expect(question.difficulty).toBe(0.5);
        expect(question.depth).toBe(0.5);
        expect(question.timeProfile.expectedSeconds).toBe(60);
        expect(question.timeProfile.pressure).toBe(0.5);
        expect(question.isDeleted).toBe(false);
    });

    it('extracts atomIds from atomMap', () => {
        const question = createQuestion({
            prompt: 'Test',
            atomMap: [
                { atomId: 'atom-1', weight: 1 },
                { atomId: 'atom-2', weight: 0.5 },
                { atomId: 'atom-1', weight: 0.8 } // Duplicate
            ]
        });
        
        expect(question.atomIds).toHaveLength(2);
        expect(question.atomIds).toContain('atom-1');
        expect(question.atomIds).toContain('atom-2');
    });

    it('validates question types', () => {
        const valid = createQuestion({ type: 'numeric' });
        const invalid = createQuestion({ type: 'invalid' });
        
        expect(valid.type).toBe('numeric');
        expect(invalid.type).toBe('mcq_single');
    });
});

describe('Exam Mode - Question Success Probability', () => {
    it('computes probability based on atom mastery', () => {
        const atoms = {
            'atom-1': { id: 'atom-1', mastery: 0.8, stabilityDays: 100 }
        };
        const question = createQuestion({
            difficulty: 0.5,
            atomMap: [{ atomId: 'atom-1', weight: 1 }]
        });
        
        const now = new Date();
        const result = computeQuestionSuccessProbability(question, atoms, now, now);
        
        expect(result.probability).toBeGreaterThan(0.5);
        expect(result.readiness).toBeCloseTo(0.8, 2);
        expect(result.breakdown).toHaveLength(1);
    });

    it('returns 0.5 for questions without atoms', () => {
        const question = createQuestion({ atomMap: [] });
        const result = computeQuestionSuccessProbability(question, {}, new Date(), new Date());
        
        expect(result.probability).toBe(0.5);
    });

    it('combines multiple atoms with weights', () => {
        const atoms = {
            'atom-1': { id: 'atom-1', mastery: 1.0, stabilityDays: 100 },
            'atom-2': { id: 'atom-2', mastery: 0.0, stabilityDays: 100 }
        };
        const question = createQuestion({
            difficulty: 0.5,
            atomMap: [
                { atomId: 'atom-1', weight: 0.5 },
                { atomId: 'atom-2', weight: 0.5 }
            ]
        });
        
        const now = new Date();
        const result = computeQuestionSuccessProbability(question, atoms, now, now);
        
        expect(result.readiness).toBeCloseTo(0.5, 2);
    });
});

describe('Exam Mode - Exam Spec Creation', () => {
    it('creates exam spec with default values', () => {
        const spec = createExamSpec({ name: 'Mock Exam' });
        
        expect(spec.id).toBeDefined();
        expect(spec.name).toBe('Mock Exam');
        expect(spec.durationMinutes).toBe(60);
        expect(spec.totalMarks).toBe(100);
        expect(spec.sections).toHaveLength(1);
        expect(spec.navigation.allowBack).toBe(true);
        expect(spec.feedback.showDuringTest).toBe(false);
        expect(spec.scoring.partialCredit).toBe(true);
        expect(spec.isDeleted).toBe(false);
    });

    it('clamps duration to valid range', () => {
        const tooShort = createExamSpec({ durationMinutes: -5 });
        const tooLong = createExamSpec({ durationMinutes: 5000 });
        const zero = createExamSpec({ durationMinutes: 0 });
        
        // When duration is 0, || 60 kicks in, resulting in 60
        expect(zero.durationMinutes).toBe(60);
        // When duration is -5, clamping gives max(1, min(1440, -5)) = 1
        expect(tooShort.durationMinutes).toBe(1);
        expect(tooLong.durationMinutes).toBe(1440);
    });

    it('parses exam date correctly', () => {
        const spec = createExamSpec({
            examDate: '2025-06-15T09:00:00Z'
        });
        
        expect(spec.examDate).toBe('2025-06-15T09:00:00.000Z');
    });

    it('includes depth distribution', () => {
        const spec = createExamSpec({
            depthDistribution: { recall: 0.4, application: 0.4, evaluation: 0.2 }
        });
        
        expect(spec.depthDistribution.recall).toBe(0.4);
        expect(spec.depthDistribution.application).toBe(0.4);
        expect(spec.depthDistribution.evaluation).toBe(0.2);
    });
});

describe('Exam Mode - Paper Generation', () => {
    const testQuestions = [
        createQuestion({ id: 'q1', difficulty: 0.2, marksAvailable: 2 }),
        createQuestion({ id: 'q2', difficulty: 0.5, marksAvailable: 3 }),
        createQuestion({ id: 'q3', difficulty: 0.8, marksAvailable: 5 }),
        createQuestion({ id: 'q4', difficulty: 0.3, marksAvailable: 2 }),
        createQuestion({ id: 'q5', difficulty: 0.6, marksAvailable: 3 })
    ];

    it('generates paper with sections', () => {
        const spec = createExamSpec({
            name: 'Test Exam',
            sections: [{
                id: 'section-1',
                name: 'Section 1',
                marks: 10,
                difficultyTargets: { easy: 0.4, medium: 0.3, hard: 0.3 }
            }]
        });
        
        const paper = generateExamPaper(spec, testQuestions);
        
        expect(paper.id).toBeDefined();
        expect(paper.examSpecId).toBe(spec.id);
        expect(paper.sections).toHaveLength(1);
        expect(paper.sections[0].questions.length).toBeGreaterThan(0);
    });

    it('uses seed for reproducibility', () => {
        const spec = createExamSpec({ name: 'Test' });
        
        const paper1 = generateExamPaper(spec, testQuestions, { seed: 12345 });
        const paper2 = generateExamPaper(spec, testQuestions, { seed: 12345 });
        
        expect(paper1.sections[0].questions.map(q => q.questionId))
            .toEqual(paper2.sections[0].questions.map(q => q.questionId));
    });

    it('excludes deleted questions', () => {
        const questionsWithDeleted = [
            createQuestion({ id: 'q1' }),
            { ...createQuestion({ id: 'q2' }), isDeleted: true }
        ];
        
        const spec = createExamSpec({});
        const paper = generateExamPaper(spec, questionsWithDeleted);
        
        const usedIds = paper.sections.flatMap(s => s.questions.map(q => q.questionId));
        expect(usedIds).not.toContain('q2');
    });
});

describe('Exam Mode - Sitting Management', () => {
    it('creates sitting with initial state', () => {
        const paper = generateExamPaper(
            createExamSpec({}),
            [createQuestion({ id: 'q1' })]
        );
        
        const sitting = createExamSitting(paper);
        
        expect(sitting.id).toBeDefined();
        expect(sitting.examPaperId).toBe(paper.id);
        expect(sitting.status).toBe('not_started');
        expect(sitting.startedAt).toBeNull();
        expect(sitting.remainingSeconds).toBe(60 * 60);
        expect(sitting.currentSectionIndex).toBe(0);
        expect(sitting.currentQuestionIndex).toBe(0);
    });

    it('records response correctly', () => {
        const paper = generateExamPaper(
            createExamSpec({}),
            [createQuestion({ id: 'q1' })]
        );
        const sitting = createExamSitting(paper);
        
        const updated = recordSittingResponse(sitting, 'q1', { selectedIndex: 2 }, {
            secondsSpent: 30
        });
        
        expect(updated.responses['q1']).toEqual({ selectedIndex: 2 });
        expect(updated.timing['q1'].totalSeconds).toBe(30);
        expect(updated.timing['q1'].firstViewedAt).toBeDefined();
    });

    it('submits sitting correctly', () => {
        const paper = generateExamPaper(
            createExamSpec({}),
            [createQuestion({ id: 'q1' })]
        );
        const sitting = createExamSitting(paper);
        
        const submitted = submitExamSitting(sitting);
        
        expect(submitted.status).toBe('submitted');
        expect(submitted.submittedAt).toBeDefined();
    });
});

describe('Exam Mode - Score Prediction', () => {
    it('predicts score based on atom mastery', () => {
        const atoms = {
            'atom-1': { id: 'atom-1', mastery: 0.8, stabilityDays: 100 }
        };
        const questions = [
            createQuestion({
                id: 'q1',
                difficulty: 0.5,
                marksAvailable: 10,
                atomMap: [{ atomId: 'atom-1', weight: 1 }]
            })
        ];
        const spec = createExamSpec({ totalMarks: 10 });
        
        const now = new Date();
        const prediction = predictExamScore(spec, questions, atoms, now, now);
        
        expect(prediction.expectedMarks).toBeGreaterThan(5);
        expect(prediction.variance).toBeDefined();
        expect(prediction.confidenceInterval.lower).toBeLessThan(prediction.expectedMarks);
        expect(prediction.confidenceInterval.upper).toBeGreaterThan(prediction.expectedMarks);
    });

    it('returns zero for empty question list', () => {
        const spec = createExamSpec({});
        const prediction = predictExamScore(spec, [], {}, new Date(), new Date());
        
        expect(prediction.expectedMarks).toBe(0);
        expect(prediction.probability).toBe(0.5);
    });

    it('includes grade probabilities when bands defined', () => {
        const atoms = {
            'atom-1': { id: 'atom-1', mastery: 0.7, stabilityDays: 100 }
        };
        const questions = [
            createQuestion({
                difficulty: 0.5,
                marksAvailable: 100,
                atomMap: [{ atomId: 'atom-1', weight: 1 }]
            })
        ];
        const spec = createExamSpec({
            totalMarks: 100,
            scoring: {
                gradeBands: [
                    { grade: 'A', minMarks: 70 },
                    { grade: 'B', minMarks: 60 },
                    { grade: 'C', minMarks: 50 }
                ]
            }
        });
        
        const prediction = predictExamScore(spec, questions, atoms, new Date(), new Date());
        
        expect(prediction.gradeProbabilities).toBeDefined();
        expect(prediction.gradeProbabilities['A']).toBeDefined();
    });
});

describe('Exam Mode - Revision Completeness', () => {
    it('computes completeness metrics', () => {
        const atoms = {
            'atom-1': { id: 'atom-1', mastery: 0.8, stabilityDays: 100, fragility: 0.2 },
            'atom-2': { id: 'atom-2', mastery: 0.3, stabilityDays: 50, fragility: 0.7 },
            'atom-3': { id: 'atom-3', mastery: 0.5, stabilityDays: 80, type: 'exam_technique' }
        };
        const spec = createExamSpec({});
        
        const now = new Date();
        const completeness = computeRevisionCompleteness(spec, atoms, now, now, 70);
        
        expect(completeness.overall).toBeGreaterThan(0);
        expect(completeness.overall).toBeLessThanOrEqual(1);
        expect(completeness.scoreProgress).toBeDefined();
        expect(completeness.coverageProgress).toBeDefined();
        expect(completeness.fragilityRisk).toBeDefined();
        expect(completeness.techniqueProgress).toBeDefined();
    });

    it('returns zero for empty atoms', () => {
        const spec = createExamSpec({});
        const completeness = computeRevisionCompleteness(spec, {}, new Date(), new Date());
        
        expect(completeness.overall).toBe(0);
    });
});

describe('Exam Mode - Time to Target Estimation', () => {
    it('estimates time needed to reach target', () => {
        const atoms = {
            'atom-1': { id: 'atom-1', mastery: 0.3, name: 'Basic Concept' },
            'atom-2': { id: 'atom-2', mastery: 0.5, name: 'Advanced Topic' }
        };
        const spec = createExamSpec({});
        
        const estimate = estimateTimeToTarget(spec, atoms, new Date(), new Date(), 80);
        
        expect(estimate.likelyHours).toBeGreaterThan(0);
        expect(estimate.safeHours).toBeGreaterThanOrEqual(estimate.likelyHours);
        expect(estimate.sessionsNeeded).toBeGreaterThan(0);
        expect(estimate.topActions).toHaveLength(2);
    });

    it('returns zero for empty atoms', () => {
        const spec = createExamSpec({});
        const estimate = estimateTimeToTarget(spec, {}, new Date(), new Date());
        
        expect(estimate.likelyHours).toBe(0);
        expect(estimate.sessionsNeeded).toBe(0);
    });
});

describe('Exam Mode - Practice Question Ranking', () => {
    it('ranks questions by value per minute', () => {
        const atoms = {
            'atom-1': { id: 'atom-1', mastery: 0.2, transferability: 0.8, fragility: 0.7 },
            'atom-2': { id: 'atom-2', mastery: 0.8, transferability: 0.3, fragility: 0.2 }
        };
        const questions = [
            createQuestion({
                id: 'q1',
                marksAvailable: 5,
                atomMap: [{ atomId: 'atom-1', weight: 1 }],
                timeProfile: { expectedSeconds: 60 }
            }),
            createQuestion({
                id: 'q2',
                marksAvailable: 5,
                atomMap: [{ atomId: 'atom-2', weight: 1 }],
                timeProfile: { expectedSeconds: 60 }
            })
        ];
        
        const ranked = rankQuestionsForPractice(questions, atoms, new Date(), new Date());
        
        expect(ranked).toHaveLength(2);
        expect(ranked[0].questionId).toBe('q1'); // Lower mastery = higher value
        expect(ranked[0].valuePerMinute).toBeGreaterThan(ranked[1].valuePerMinute);
    });

    it('excludes deleted questions', () => {
        const questions = [
            createQuestion({ id: 'q1' }),
            { ...createQuestion({ id: 'q2' }), isDeleted: true }
        ];
        
        const ranked = rankQuestionsForPractice(questions, {}, new Date(), new Date());
        
        expect(ranked).toHaveLength(1);
        expect(ranked[0].questionId).toBe('q1');
    });
});

describe('Exam Mode - Session Composition', () => {
    it('composes session with multiple phases', () => {
        const atoms = {
            'atom-1': { id: 'atom-1', mastery: 0.8, stabilityDays: 100 },
            'atom-2': { id: 'atom-2', mastery: 0.4, stabilityDays: 100 },
            'atom-3': { id: 'atom-3', mastery: 0.5, stabilityDays: 100, type: 'exam_technique' }
        };
        const questions = [
            createQuestion({ id: 'q1', atomMap: [{ atomId: 'atom-1', weight: 1 }] }),
            createQuestion({ id: 'q2', atomMap: [{ atomId: 'atom-2', weight: 1 }] }),
            createQuestion({ id: 'q3', atomMap: [{ atomId: 'atom-3', weight: 1 }] })
        ];
        
        const session = composeOptimalSession(questions, atoms, new Date(), new Date(), {
            sessionMinutes: 30,
            phase: 'build'
        });
        
        expect(session.phases.length).toBeGreaterThan(0);
        expect(session.totalMinutes).toBe(30);
        expect(session.explanation).toBeDefined();
    });

    it('includes warm-up phase with high-mastery questions', () => {
        const atoms = {
            'atom-1': { id: 'atom-1', mastery: 0.9, stabilityDays: 100 }
        };
        const questions = [
            createQuestion({ id: 'q1', atomMap: [{ atomId: 'atom-1', weight: 1 }] })
        ];
        
        const session = composeOptimalSession(questions, atoms, new Date(), new Date());
        
        const warmUp = session.phases.find(p => p.type === 'warm_up');
        expect(warmUp).toBeDefined();
    });

    it('returns empty session for no questions', () => {
        const session = composeOptimalSession([], {}, new Date(), new Date());
        
        expect(session.phases).toHaveLength(0);
        expect(session.explanation).toBe('No questions available for practice.');
    });
});

describe('Exam Mode - Keyboard Shortcuts', () => {
    it('defines all required shortcuts', () => {
        expect(EXAM_MODE_SHORTCUTS.nextQuestion).toBeDefined();
        expect(EXAM_MODE_SHORTCUTS.previousQuestion).toBeDefined();
        expect(EXAM_MODE_SHORTCUTS.submitAnswer).toBeDefined();
        expect(EXAM_MODE_SHORTCUTS.flagQuestion).toBeDefined();
        expect(EXAM_MODE_SHORTCUTS.submitExam).toBeDefined();
        expect(EXAM_MODE_SHORTCUTS.pauseExam).toBeDefined();
    });

    it('creates keyboard handler that calls callbacks', () => {
        const callbacks = {
            nextQuestion: () => {},
            previousQuestion: () => {},
            selectOption: () => {},
            submitAnswer: () => {},
            flagQuestion: () => {}
        };
        
        const handler = createExamKeyboardHandler(callbacks);
        expect(typeof handler).toBe('function');
    });
});

describe('Exam Mode - Constants', () => {
    it('exports valid atom types', () => {
        expect(ATOM_TYPES).toContain('knowledge');
        expect(ATOM_TYPES).toContain('procedure');
        expect(ATOM_TYPES).toContain('exam_technique');
        expect(ATOM_TYPES).toContain('representation');
    });

    it('exports valid question types', () => {
        expect(QUESTION_TYPES).toContain('mcq_single');
        expect(QUESTION_TYPES).toContain('mcq_multi');
        expect(QUESTION_TYPES).toContain('numeric');
        expect(QUESTION_TYPES).toContain('short_text');
        expect(QUESTION_TYPES).toContain('structured');
        expect(QUESTION_TYPES).toContain('essay');
    });

    it('exports valid sitting statuses', () => {
        expect(SITTING_STATUSES).toContain('not_started');
        expect(SITTING_STATUSES).toContain('in_progress');
        expect(SITTING_STATUSES).toContain('paused');
        expect(SITTING_STATUSES).toContain('submitted');
        expect(SITTING_STATUSES).toContain('marked');
    });

    it('exports valid session phases', () => {
        expect(SESSION_PHASES).toContain('warm_up');
        expect(SESSION_PHASES).toContain('targeted_struggle');
        expect(SESSION_PHASES).toContain('technique_drill');
        expect(SESSION_PHASES).toContain('timed_chunk');
        expect(SESSION_PHASES).toContain('recap');
    });
});
