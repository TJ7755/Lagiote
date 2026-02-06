/**
 * Calibration Harness Tests
 * 
 * Tests golden response testing, mark scheme validation, and drift detection.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
    GOLDEN_RESPONSES,
    runGoldenTests,
    calculateCohensKappa,
    testHumanAIAgreement,
    validateMarkScheme,
    detectGradingDrift,
    runCalibrationSuite,
    runBatchCalibration
} from '../../js/core/exam/calibration-harness.js';

describe('Calibration Harness - Golden Response Tests', () => {
    const mockMarkScheme = {
        schemeType: 'points',
        points: [
            {
                id: 'A1',
                marks: 1,
                grading: { kind: 'mcq_single', correctIndices: [1] }
            }
        ]
    };
    
    const mockQuestion = {
        id: 'q1',
        type: 'mcq_single',
        options: ['A', 'B', 'C', 'D']
    };
    
    it('passes all golden tests for correct scheme', () => {
        const result = runGoldenTests(mockMarkScheme, mockQuestion);
        
        expect(result.passed).toBe(true);
        expect(result.passRate).toBe(1);
    });
    
    it('reports failed tests correctly', () => {
        const badScheme = {
            schemeType: 'points',
            points: [
                {
                    id: 'A1',
                    marks: 1,
                    grading: { kind: 'mcq_single', correctIndices: [0] } // Wrong index
                }
            ]
        };
        
        const result = runGoldenTests(badScheme, mockQuestion);
        
        expect(result.passed).toBe(false);
        expect(result.failedCount).toBeGreaterThan(0);
    });
    
    it('returns error for unsupported question type', () => {
        const result = runGoldenTests(mockMarkScheme, { type: 'essay' });
        
        expect(result.passed).toBe(false);
        expect(result.error).toContain('No golden responses');
    });
    
    it('exports golden responses for supported types', () => {
        expect(GOLDEN_RESPONSES.mcq_single).toBeDefined();
        expect(GOLDEN_RESPONSES.numeric).toBeDefined();
        expect(GOLDEN_RESPONSES.short_text).toBeDefined();
    });
});

describe('Calibration Harness - Cohen\'s Kappa', () => {
    it('calculates perfect agreement', () => {
        const rater1 = [1, 2, 3, 4, 5];
        const rater2 = [1, 2, 3, 4, 5];
        
        const kappa = calculateCohensKappa(rater1, rater2);
        
        expect(kappa.kappa).toBe(1);
        expect(kappa.observedAgreement).toBe(1);
        expect(kappa.isAcceptable).toBe(true);
    });
    
    it('calculates no agreement', () => {
        // Complete systematic disagreement: po=0, pe=0
        // Kappa = (0-0)/(1-0) = 0 (agreement at chance level, which is 0)
        const rater1 = [1, 1, 1];
        const rater2 = [2, 2, 2];
        
        const kappa = calculateCohensKappa(rater1, rater2);
        
        // When both po and pe are 0, kappa should be 0 (not negative)
        // This is mathematically correct: agreement equals chance agreement (both are 0%)
        expect(kappa.kappa).toBe(0);
        expect(kappa.isAcceptable).toBe(false);
    });
    
    it('interprets kappa values correctly', () => {
        // Fair agreement (0.2-0.4)
        const rater1 = [1, 1, 2, 2, 1];
        const rater2 = [1, 2, 2, 2, 1];
        
        const kappa = calculateCohensKappa(rater1, rater2);
        
        expect(kappa.interpretation).toBeDefined();
        expect(['slight', 'fair', 'moderate']).toContain(kappa.interpretation);
    });
    
    it('returns error for mismatched arrays', () => {
        const kappa = calculateCohensKappa([1, 2], [1]);
        expect(kappa.error).toBeDefined();
    });
    
    it('returns error for empty arrays', () => {
        const kappa = calculateCohensKappa([], []);
        expect(kappa.error).toBeDefined();
    });
});

describe('Calibration Harness - Human-AI Agreement', () => {
    const humanMarks = [
        { questionId: 'q1', totalAwardedMarks: 2 },
        { questionId: 'q2', totalAwardedMarks: 1 },
        { questionId: 'q3', totalAwardedMarks: 3 }
    ];
    
    const aiMarks = [
        { 
            questionId: 'q1', 
            suggestions: [{ suggestedAward: 2 }, { suggestedAward: 0 }] 
        },
        { 
            questionId: 'q2', 
            suggestions: [{ suggestedAward: 1 }] 
        },
        { 
            questionId: 'q3', 
            suggestions: [{ suggestedAward: 2 }] // Disagreement
        }
    ];
    
    it('calculates agreement rates', () => {
        const result = testHumanAIAgreement(humanMarks, aiMarks);
        
        expect(result.exactAgreementRate).toBeDefined();
        expect(result.withinOneMarkRate).toBeDefined();
        expect(result.cohensKappa).toBeDefined();
    });
    
    it('provides comparison details', () => {
        const result = testHumanAIAgreement(humanMarks, aiMarks);
        
        expect(result.comparisons).toHaveLength(3);
        expect(result.comparisons[0]).toHaveProperty('humanMarks');
        expect(result.comparisons[0]).toHaveProperty('aiSuggestion');
        expect(result.comparisons[0]).toHaveProperty('agreed');
    });
    
    it('provides recommendation', () => {
        const result = testHumanAIAgreement(humanMarks, aiMarks);
        
        expect(result.recommendation).toBeDefined();
    });
});

describe('Calibration Harness - Mark Scheme Validation', () => {
    it('validates complete mark scheme', () => {
        const scheme = {
            schemeType: 'points',
            points: [
                { id: 'M1', marks: 1, condition: 'Method shown' },
                { id: 'A1', marks: 1, condition: 'Answer correct' }
            ]
        };
        
        const result = validateMarkScheme(scheme, { marksAvailable: 2 });
        
        expect(result.valid).toBe(true);
        expect(result.issues).toHaveLength(0);
    });
    
    it('detects missing points', () => {
        const scheme = { schemeType: 'points' };
        
        const result = validateMarkScheme(scheme, {});
        
        expect(result.valid).toBe(false);
        expect(result.issues).toContain('Mark scheme has no points defined');
    });
    
    it('detects points without IDs', () => {
        const scheme = {
            schemeType: 'points',
            points: [{ marks: 1 }]
        };
        
        const result = validateMarkScheme(scheme, {});
        
        expect(result.valid).toBe(false);
        expect(result.issues.some(i => i.includes('no ID'))).toBe(true);
    });
    
    it('detects circular dependencies', () => {
        const scheme = {
            schemeType: 'points',
            points: [
                { id: 'P1', marks: 1, requires: ['P2'] },
                { id: 'P2', marks: 1, requires: ['P1'] }
            ]
        };
        
        const result = validateMarkScheme(scheme, {});
        
        expect(result.valid).toBe(false);
        expect(result.issues.some(i => i.includes('Circular'))).toBe(true);
    });
    
    it('warns about missing grading config', () => {
        const scheme = {
            schemeType: 'points',
            points: [{ id: 'P1', marks: 1 }]
        };
        
        const result = validateMarkScheme(scheme, {});
        
        expect(result.warnings.length).toBeGreaterThan(0);
    });
    
    it('warns about mismatched total marks', () => {
        const scheme = {
            schemeType: 'points',
            points: [
                { id: 'P1', marks: 2 },
                { id: 'P2', marks: 3 }
            ]
        };
        
        const result = validateMarkScheme(scheme, { marksAvailable: 10 });
        
        expect(result.warnings.length).toBeGreaterThan(0);
    });
    
    it('detects missing dependency targets', () => {
        const scheme = {
            schemeType: 'points',
            points: [
                { id: 'P1', marks: 1, requires: ['P2'] }
            ]
        };
        
        const result = validateMarkScheme(scheme, {});
        
        expect(result.valid).toBe(false);
        expect(result.issues.some(i => i.includes('non-existent'))).toBe(true);
    });
});

describe('Calibration Harness - Drift Detection', () => {
    it('detects stable grading', () => {
        const history = Array(10).fill(null).map((_, i) => ({
            timestamp: `2025-01-${i + 1}`,
            averageMarks: 5 + Math.random() // Stable around 5
        }));
        
        const result = detectGradingDrift(history);
        
        expect(result.sufficientData).toBe(true);
        expect(result.driftDirection).toBe('stable');
    });
    
    it('detects lenient drift', () => {
        const history = [
            ...Array(5).fill(null).map((_, i) => ({
                timestamp: `2025-01-${i + 1}`,
                averageMarks: 5
            })),
            ...Array(5).fill(null).map((_, i) => ({
                timestamp: `2025-01-${i + 6}`,
                averageMarks: 8
            }))
        ];
        
        const result = detectGradingDrift(history);
        
        expect(result.driftDirection).toBe('lenient');
        expect(result.driftAmount).toBeGreaterThan(0);
    });
    
    it('detects strict drift', () => {
        const history = [
            ...Array(5).fill(null).map((_, i) => ({
                timestamp: `2025-01-${i + 1}`,
                averageMarks: 8
            })),
            ...Array(5).fill(null).map((_, i) => ({
                timestamp: `2025-01-${i + 6}`,
                averageMarks: 4
            }))
        ];
        
        const result = detectGradingDrift(history);
        
        expect(result.driftDirection).toBe('strict');
        expect(result.driftAmount).toBeLessThan(0);
        expect(result.needsRecalibration).toBe(true);
    });
    
    it('requires sufficient data', () => {
        const result = detectGradingDrift([]);
        
        expect(result.sufficientData).toBe(false);
    });
});

describe('Calibration Harness - Calibration Suite', () => {
    const mockScheme = {
        id: 'ms1',
        schemeType: 'points',
        points: [
            { id: 'M1', marks: 1, grading: { kind: 'mcq_single', correctIndices: [1] } }
        ]
    };
    
    const mockQuestion = {
        id: 'q1',
        type: 'mcq_single',
        options: ['A', 'B', 'C', 'D']
    };
    
    it('runs full calibration suite', () => {
        const report = runCalibrationSuite(mockScheme, mockQuestion);
        
        expect(report.id).toBeDefined();
        expect(report.timestamp).toBeDefined();
        expect(report.validations).toBeDefined();
        expect(report.goldenTests).toBeDefined();
        expect(report.recommendations).toBeDefined();
        expect(report.calibrated).toBeDefined();
    });
    
    it('identifies critical issues', () => {
        const badScheme = {
            schemeType: 'points',
            points: [{ marks: 1 }] // No ID
        };
        
        const report = runCalibrationSuite(badScheme, mockQuestion);
        
        expect(report.calibrated).toBe(false);
        expect(report.recommendations.some(r => r.priority === 'critical')).toBe(true);
    });
});

describe('Calibration Harness - Batch Calibration', () => {
    const items = [
        {
            question: { id: 'q1', type: 'mcq_single', options: ['A', 'B'] },
            markScheme: {
                schemeType: 'points',
                points: [{ id: 'A1', marks: 1, grading: { kind: 'mcq_single', correctIndices: [0] } }]
            }
        },
        {
            question: { id: 'q2', type: 'numeric' },
            markScheme: {
                schemeType: 'points',
                points: [{ id: 'N1', marks: 1, grading: { kind: 'numeric', value: 42 } }]
            }
        }
    ];
    
    it('calibrates multiple items', () => {
        const result = runBatchCalibration(items);
        
        expect(result.totalItems).toBe(2);
        expect(result.calibrationRate).toBeDefined();
        expect(result.results).toHaveLength(2);
    });
    
    it('sorts by critical issues first', () => {
        const itemsWithBad = [
            ...items,
            {
                question: { id: 'q3' },
                markScheme: { schemeType: 'points' } // Invalid - no points
            }
        ];
        
        const result = runBatchCalibration(itemsWithBad);
        const badResult = result.results.find(r => r.questionId === 'q3');
        
        expect(badResult.result.calibrated).toBe(false);
    });
});
