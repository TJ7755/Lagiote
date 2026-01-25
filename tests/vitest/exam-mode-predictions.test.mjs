import { describe, it, expect } from 'vitest';
import {
    createAtom,
    createQuestion,
    createExamSpec,
    predictExamScore,
    computeRevisionCompleteness,
    estimateTimeToTarget,
    rankQuestionsForPractice,
    composeOptimalSession
} from '../../js/core/exam/exam-mode.js';

const MS_PER_DAY = 24 * 60 * 60 * 1000;

describe('Exam Mode - Predicted Score Distribution', () => {
    it('returns non-degenerate variance in score prediction', () => {
        const now = new Date(Date.UTC(2025, 0, 1));
        const examDate = new Date(now.getTime() + 30 * MS_PER_DAY);
        
        const atoms = new Map([
            ['a1', createAtom({ id: 'a1', mastery: 0.6, stabilityDays: 20 })],
            ['a2', createAtom({ id: 'a2', mastery: 0.8, stabilityDays: 15 })],
            ['a3', createAtom({ id: 'a3', mastery: 0.4, stabilityDays: 25 })]
        ]);
        
        const questions = [
            createQuestion({ id: 'q1', difficulty: 0.5, marksAvailable: 20, atomMap: [{ atomId: 'a1', weight: 1 }] }),
            createQuestion({ id: 'q2', difficulty: 0.6, marksAvailable: 30, atomMap: [{ atomId: 'a2', weight: 1 }] }),
            createQuestion({ id: 'q3', difficulty: 0.4, marksAvailable: 50, atomMap: [{ atomId: 'a3', weight: 1 }] })
        ];
        
        const spec = createExamSpec({ totalMarks: 100, targetScore: 70 });
        
        const prediction = predictExamScore(spec, questions, atoms, now, examDate);
        
        expect(prediction).toBeTruthy();
        expect(prediction.expectedMarks).toBeGreaterThan(0);
        expect(prediction.confidenceInterval).toBeTruthy();
        expect(prediction.confidenceInterval.lower).toBeLessThan(prediction.expectedMarks);
        expect(prediction.confidenceInterval.upper).toBeGreaterThan(prediction.expectedMarks);
        
        // Variance should be positive (non-degenerate)
        const variance = prediction.confidenceInterval.upper - prediction.confidenceInterval.lower;
        expect(variance).toBeGreaterThan(0);
    });
    
    it('predictions change with exam date distance', () => {
        const now = new Date(Date.UTC(2025, 0, 1));
        const nearDate = new Date(now.getTime() + 7 * MS_PER_DAY);
        const farDate = new Date(now.getTime() + 60 * MS_PER_DAY);
        
        const atoms = new Map([
            ['a1', createAtom({ id: 'a1', mastery: 0.8, stabilityDays: 14 })]
        ]);
        
        const questions = [
            createQuestion({ id: 'q1', difficulty: 0.5, marksAvailable: 100, atomMap: [{ atomId: 'a1', weight: 1 }] })
        ];
        
        const spec = createExamSpec({ totalMarks: 100 });
        
        const nearPrediction = predictExamScore(spec, questions, atoms, now, nearDate);
        const farPrediction = predictExamScore(spec, questions, atoms, now, farDate);
        
        // Nearer exam should have higher predicted score (less decay)
        expect(nearPrediction.expectedMarks).toBeGreaterThan(farPrediction.expectedMarks);
    });
    
    it('grade probabilities are valid when grade bands are defined', () => {
        const now = new Date(Date.UTC(2025, 0, 1));
        const examDate = new Date(now.getTime() + 30 * MS_PER_DAY);
        
        const atoms = new Map([
            ['a1', createAtom({ id: 'a1', mastery: 0.7, stabilityDays: 20 })]
        ]);
        
        const questions = [
            createQuestion({ id: 'q1', difficulty: 0.5, marksAvailable: 100, atomMap: [{ atomId: 'a1', weight: 1 }] })
        ];
        
        const spec = createExamSpec({
            totalMarks: 100,
            scoring: {
                gradeBands: [
                    { grade: 'A*', minMarks: 90 },
                    { grade: 'A', minMarks: 80 },
                    { grade: 'B', minMarks: 70 },
                    { grade: 'C', minMarks: 60 },
                    { grade: 'D', minMarks: 50 },
                    { grade: 'U', minMarks: 0 }
                ]
            }
        });
        
        const prediction = predictExamScore(spec, questions, atoms, now, examDate);
        
        if (prediction.gradeProbabilities && Object.keys(prediction.gradeProbabilities).length > 0) {
            // Grade probabilities represent cumulative probabilities of achieving at least that grade,
            // so they should be between 0 and 1 for each grade
            Object.values(prediction.gradeProbabilities).forEach(prob => {
                expect(prob).toBeGreaterThanOrEqual(0);
                expect(prob).toBeLessThanOrEqual(1);
            });
        }
    });
});

describe('Exam Mode - Revision Completeness Monotonicity', () => {
    it('completeness increases with higher mastery', () => {
        const now = new Date(Date.UTC(2025, 0, 1));
        const examDate = new Date(now.getTime() + 30 * MS_PER_DAY);
        const spec = createExamSpec({ totalMarks: 100, targetScore: 70 });
        
        const lowMasteryAtoms = new Map([
            ['a1', createAtom({ id: 'a1', mastery: 0.3, stabilityDays: 20 })]
        ]);
        
        const highMasteryAtoms = new Map([
            ['a1', createAtom({ id: 'a1', mastery: 0.9, stabilityDays: 20 })]
        ]);
        
        const lowCompleteness = computeRevisionCompleteness(spec, lowMasteryAtoms, now, examDate, 70);
        const highCompleteness = computeRevisionCompleteness(spec, highMasteryAtoms, now, examDate, 70);
        
        expect(highCompleteness.overall).toBeGreaterThan(lowCompleteness.overall);
    });
    
    it('completeness values are bounded between 0 and 1', () => {
        const now = new Date(Date.UTC(2025, 0, 1));
        const examDate = new Date(now.getTime() + 30 * MS_PER_DAY);
        const spec = createExamSpec({ totalMarks: 100, targetScore: 70 });
        
        const atoms = new Map([
            ['a1', createAtom({ id: 'a1', mastery: 0.5, stabilityDays: 10 })],
            ['a2', createAtom({ id: 'a2', mastery: 0.8, stabilityDays: 20 })]
        ]);
        
        const completeness = computeRevisionCompleteness(spec, atoms, now, examDate, 70);
        
        expect(completeness.overall).toBeGreaterThanOrEqual(0);
        expect(completeness.overall).toBeLessThanOrEqual(1);
        expect(completeness.scoreProgress).toBeGreaterThanOrEqual(0);
        expect(completeness.scoreProgress).toBeLessThanOrEqual(1);
        expect(completeness.coverageProgress).toBeGreaterThanOrEqual(0);
        expect(completeness.coverageProgress).toBeLessThanOrEqual(1);
    });
});

describe('Exam Mode - Time-to-Target Estimates', () => {
    it('more work needed when target is higher', () => {
        const now = new Date(Date.UTC(2025, 0, 1));
        const examDate = new Date(now.getTime() + 30 * MS_PER_DAY);
        const spec = createExamSpec({ totalMarks: 100 });
        
        const atoms = new Map([
            ['a1', createAtom({ id: 'a1', mastery: 0.5, stabilityDays: 20 })]
        ]);
        
        const lowTarget = estimateTimeToTarget(spec, atoms, now, examDate, 50);
        const highTarget = estimateTimeToTarget(spec, atoms, now, examDate, 90);
        
        expect(highTarget.likelyHours).toBeGreaterThanOrEqual(lowTarget.likelyHours);
    });
    
    it('safe hours are greater than or equal to likely hours', () => {
        const now = new Date(Date.UTC(2025, 0, 1));
        const examDate = new Date(now.getTime() + 30 * MS_PER_DAY);
        const spec = createExamSpec({ totalMarks: 100 });
        
        const atoms = new Map([
            ['a1', createAtom({ id: 'a1', mastery: 0.4, stabilityDays: 15 })]
        ]);
        
        const estimate = estimateTimeToTarget(spec, atoms, now, examDate, 70);
        
        expect(estimate.safeHours).toBeGreaterThanOrEqual(estimate.likelyHours);
    });
    
    it('returns top actions for closing gaps', () => {
        const now = new Date(Date.UTC(2025, 0, 1));
        const examDate = new Date(now.getTime() + 30 * MS_PER_DAY);
        const spec = createExamSpec({ totalMarks: 100 });
        
        const atoms = new Map([
            ['a1', createAtom({ id: 'a1', name: 'Weak Topic', mastery: 0.2, stabilityDays: 10 })],
            ['a2', createAtom({ id: 'a2', name: 'Strong Topic', mastery: 0.9, stabilityDays: 30 })]
        ]);
        
        const estimate = estimateTimeToTarget(spec, atoms, now, examDate, 70);
        
        expect(estimate.topActions).toBeTruthy();
        expect(Array.isArray(estimate.topActions)).toBe(true);
    });
});

describe('Exam Mode - Practice Selection', () => {
    it('ranks questions by expected score gain per minute', () => {
        const now = new Date(Date.UTC(2025, 0, 1));
        const examDate = new Date(now.getTime() + 30 * MS_PER_DAY);
        
        const atoms = new Map([
            ['weak', createAtom({ id: 'weak', mastery: 0.2, transferability: 0.8 })],
            ['strong', createAtom({ id: 'strong', mastery: 0.95, transferability: 0.5 })]
        ]);
        
        const questions = [
            createQuestion({
                id: 'q_weak',
                difficulty: 0.5,
                marksAvailable: 10,
                atomMap: [{ atomId: 'weak', weight: 1 }],
                timeProfile: { expectedSeconds: 60 }
            }),
            createQuestion({
                id: 'q_strong',
                difficulty: 0.5,
                marksAvailable: 10,
                atomMap: [{ atomId: 'strong', weight: 1 }],
                timeProfile: { expectedSeconds: 60 }
            })
        ];
        
        const ranked = rankQuestionsForPractice(questions, atoms, now, examDate);
        
        expect(ranked.length).toBe(2);
        // Weak atom question should be ranked higher (more potential gain)
        expect(ranked[0].questionId).toBe('q_weak');
        expect(ranked[0].valuePerMinute).toBeGreaterThan(ranked[1].valuePerMinute);
    });
    
    it('considers fragility in selection', () => {
        const now = new Date(Date.UTC(2025, 0, 1));
        const examDate = new Date(now.getTime() + 30 * MS_PER_DAY);
        
        const atoms = new Map([
            ['fragile', createAtom({ id: 'fragile', mastery: 0.6, fragility: 0.9 })],
            ['stable', createAtom({ id: 'stable', mastery: 0.6, fragility: 0.1 })]
        ]);
        
        const questions = [
            createQuestion({
                id: 'q_fragile',
                difficulty: 0.5,
                marksAvailable: 10,
                atomMap: [{ atomId: 'fragile', weight: 1 }]
            }),
            createQuestion({
                id: 'q_stable',
                difficulty: 0.5,
                marksAvailable: 10,
                atomMap: [{ atomId: 'stable', weight: 1 }]
            })
        ];
        
        const ranked = rankQuestionsForPractice(questions, atoms, now, examDate);
        
        // Fragile atom question should rank higher
        expect(ranked[0].questionId).toBe('q_fragile');
    });
});

describe('Exam Mode - Session Composition', () => {
    it('creates sessions with multiple phases', () => {
        const now = new Date(Date.UTC(2025, 0, 1));
        const examDate = new Date(now.getTime() + 30 * MS_PER_DAY);
        
        const atoms = new Map([
            ['a1', createAtom({ id: 'a1', mastery: 0.8 })],
            ['a2', createAtom({ id: 'a2', mastery: 0.4 })],
            ['a3', createAtom({ id: 'a3', mastery: 0.6 })]
        ]);
        
        const questions = [
            createQuestion({ id: 'q1', atomMap: [{ atomId: 'a1', weight: 1 }] }),
            createQuestion({ id: 'q2', atomMap: [{ atomId: 'a2', weight: 1 }] }),
            createQuestion({ id: 'q3', atomMap: [{ atomId: 'a3', weight: 1 }] })
        ];
        
        const session = composeOptimalSession(questions, atoms, now, examDate, { sessionMinutes: 30 });
        
        expect(session.phases).toBeTruthy();
        expect(session.phases.length).toBeGreaterThan(0);
        expect(session.totalMinutes).toBe(30);
    });
    
    it('includes warm-up phase for easy questions', () => {
        const now = new Date(Date.UTC(2025, 0, 1));
        const examDate = new Date(now.getTime() + 30 * MS_PER_DAY);
        
        const atoms = new Map([
            ['easy', createAtom({ id: 'easy', mastery: 0.9, stabilityDays: 100 })]
        ]);
        
        const questions = [
            createQuestion({ id: 'q_easy', difficulty: 0.3, atomMap: [{ atomId: 'easy', weight: 1 }] })
        ];
        
        const session = composeOptimalSession(questions, atoms, now, examDate, { sessionMinutes: 30 });
        
        const warmUpPhase = session.phases.find(p => p.type === 'warm_up');
        expect(warmUpPhase).toBeTruthy();
    });
    
    it('provides explanation for session composition', () => {
        const now = new Date(Date.UTC(2025, 0, 1));
        const examDate = new Date(now.getTime() + 30 * MS_PER_DAY);
        
        const atoms = new Map([
            ['a1', createAtom({ id: 'a1', mastery: 0.5 })]
        ]);
        
        const questions = [
            createQuestion({ id: 'q1', atomMap: [{ atomId: 'a1', weight: 1 }] })
        ];
        
        const session = composeOptimalSession(questions, atoms, now, examDate, { sessionMinutes: 30 });
        
        expect(session.explanation).toBeTruthy();
        expect(typeof session.explanation).toBe('string');
        expect(session.explanation.length).toBeGreaterThan(0);
    });
    
    it('respects phase parameter in session composition', () => {
        const now = new Date(Date.UTC(2025, 0, 1));
        const examDate = new Date(now.getTime() + 30 * MS_PER_DAY);
        
        const atoms = new Map([
            ['a1', createAtom({ id: 'a1', mastery: 0.5, type: 'exam_technique' })]
        ]);
        
        const questions = [
            createQuestion({ id: 'q1', atomMap: [{ atomId: 'a1', weight: 1 }] })
        ];
        
        const foundationSession = composeOptimalSession(questions, atoms, now, examDate, {
            sessionMinutes: 30,
            phase: 'foundation'
        });
        
        const buildSession = composeOptimalSession(questions, atoms, now, examDate, {
            sessionMinutes: 30,
            phase: 'build'
        });
        
        // Foundation phase should not include technique drill
        const foundationTechnique = foundationSession.phases.find(p => p.type === 'technique_drill');
        expect(foundationTechnique).toBeFalsy();
        
        // Build phase may include technique drill if there are technique atoms
        expect(buildSession.explanation).toContain('build');
    });
});

describe('Exam Mode - Edge Cases', () => {
    it('handles empty atom maps gracefully', () => {
        const now = new Date(Date.UTC(2025, 0, 1));
        const examDate = new Date(now.getTime() + 30 * MS_PER_DAY);
        const spec = createExamSpec({ totalMarks: 100 });
        
        const emptyAtoms = new Map();
        const emptyQuestions = [];
        
        const prediction = predictExamScore(spec, emptyQuestions, emptyAtoms, now, examDate);
        expect(prediction.expectedMarks).toBe(0);
        
        const completeness = computeRevisionCompleteness(spec, emptyAtoms, now, examDate, 70);
        expect(completeness.overall).toBe(0);
        
        const estimate = estimateTimeToTarget(spec, emptyAtoms, now, examDate, 70);
        expect(estimate.likelyHours).toBeGreaterThanOrEqual(0);
    });
    
    it('handles past exam dates', () => {
        const now = new Date(Date.UTC(2025, 0, 15));
        const pastDate = new Date(Date.UTC(2025, 0, 1));
        const spec = createExamSpec({ totalMarks: 100 });
        
        const atoms = new Map([
            ['a1', createAtom({ id: 'a1', mastery: 0.5 })]
        ]);
        
        // Should not throw
        const prediction = predictExamScore(spec, [], atoms, now, pastDate);
        expect(prediction).toBeTruthy();
    });
});
