/**
 * Mark Scheme Test Harness Tests
 * 
 * Tests the interactive mark scheme testing tool.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
    createMarkSchemeTestHarness,
    quickTestMarkScheme
} from '../../js/core/exam/mark-scheme-test-harness.js';

describe('Mark Scheme Test Harness - Basic Operations', () => {
    const mockMarkScheme = {
        id: 'ms1',
        schemeType: 'points',
        points: [
            {
                id: 'M1',
                marks: 1,
                condition: 'Method shown',
                grading: { kind: 'mcq_single', correctIndices: [1] }
            },
            {
                id: 'A1',
                marks: 1,
                condition: 'Correct answer',
                grading: { kind: 'mcq_single', correctIndices: [1] }
            }
        ]
    };
    
    const mockQuestion = {
        id: 'q1',
        type: 'mcq_single',
        options: ['A', 'B', 'C', 'D'],
        marksAvailable: 2
    };
    
    it('creates harness with mark scheme', () => {
        const harness = createMarkSchemeTestHarness(mockMarkScheme, mockQuestion);
        
        expect(harness).toBeDefined();
        expect(harness.getTotalMarks()).toBe(2);
    });
    
    it('tests a response', () => {
        const harness = createMarkSchemeTestHarness(mockMarkScheme, mockQuestion);
        
        const result = harness.testResponse({ selectedIndex: 1 });
        
        expect(result.id).toBeDefined();
        expect(result.timestamp).toBeDefined();
        expect(result.gradeResult).toBeDefined();
        expect(result.gradeResult.totalAwardedMarks).toBe(2);
    });
    
    it('tracks test history', () => {
        const harness = createMarkSchemeTestHarness(mockMarkScheme, mockQuestion);
        
        harness.testResponse({ selectedIndex: 1 });
        harness.testResponse({ selectedIndex: 0 });
        
        const history = harness.getHistory();
        expect(history).toHaveLength(2);
    });
    
    it('clears history', () => {
        const harness = createMarkSchemeTestHarness(mockMarkScheme, mockQuestion);
        
        harness.testResponse({ selectedIndex: 1 });
        harness.clearHistory();
        
        expect(harness.getHistory()).toHaveLength(0);
    });
    
    it('explains point decisions', () => {
        const harness = createMarkSchemeTestHarness(mockMarkScheme, mockQuestion);
        const result = harness.testResponse({ selectedIndex: 1 });
        
        expect(result.pointBreakdown).toHaveLength(2);
        expect(result.pointBreakdown[0]).toHaveProperty('pointId');
        expect(result.pointBreakdown[0]).toHaveProperty('status');
        expect(result.pointBreakdown[0]).toHaveProperty('reason');
    });
    
    it('infers point types correctly', () => {
        const harness = createMarkSchemeTestHarness(mockMarkScheme, mockQuestion);
        
        expect(harness.inferPointType('M1')).toBe('method');
        expect(harness.inferPointType('A1')).toBe('accuracy');
        expect(harness.inferPointType('R1')).toBe('reasoning');
        expect(harness.inferPointType('B1')).toBe('independent');
        expect(harness.inferPointType('X1')).toBe('unknown');
    });
    
    it('runs batch tests', () => {
        const harness = createMarkSchemeTestHarness(mockMarkScheme, mockQuestion);
        
        const responses = [
            { name: 'Correct', response: { selectedIndex: 1 } },
            { name: 'Wrong', response: { selectedIndex: 0 } }
        ];
        
        const result = harness.testBatch(responses);
        
        expect(result.results).toHaveLength(2);
        expect(result.stats.total).toBe(2);
        expect(result.stats.fullMarks).toBe(1);
        expect(result.stats.zeroMarks).toBe(1);
    });
    
    it('validates mark scheme', () => {
        const harness = createMarkSchemeTestHarness(mockMarkScheme, mockQuestion);
        
        const validation = harness.validate();
        
        expect(validation.valid).toBe(true);
        expect(validation.pointCount).toBe(2);
        expect(validation.totalMarks).toBe(2);
    });
    
    it('runs golden tests', () => {
        const harness = createMarkSchemeTestHarness(mockMarkScheme, mockQuestion);
        
        const golden = harness.runGoldenTests();
        
        expect(golden.passed).toBeDefined();
        expect(golden.passRate).toBeDefined();
    });
    
    it('generates report HTML', () => {
        const harness = createMarkSchemeTestHarness(mockMarkScheme, mockQuestion);
        harness.testResponse({ selectedIndex: 1 });
        
        const report = harness.generateReport();
        
        expect(report).toContain('Mark Scheme Test Harness Report');
        expect(report).toContain('validation-section');
        expect(report).toContain('history-section');
    });
});

describe('Mark Scheme Test Harness - Response Normalization', () => {
    const numericScheme = {
        schemeType: 'points',
        points: [
            { id: 'N1', marks: 1, grading: { kind: 'numeric', value: 42, toleranceAbs: 0.5 } }
        ]
    };
    
    const numericQuestion = {
        id: 'q1',
        type: 'numeric'
    };
    
    it('normalizes numeric text responses', () => {
        const harness = createMarkSchemeTestHarness(numericScheme, numericQuestion);
        
        const result = harness.testResponse('42 m/s');
        
        expect(result.response).toEqual({
            value: 42,
            unit: 'm/s',
            rawValue: '42 m/s'
        });
    });
    
    it('normalizes short text responses', () => {
        const textScheme = {
            schemeType: 'points',
            points: [{ id: 'S1', marks: 1, grading: { kind: 'short_text', accepted: ['answer'] } }]
        };
        
        const textQuestion = { id: 'q1', type: 'short_text' };
        const harness = createMarkSchemeTestHarness(textScheme, textQuestion);
        
        const result = harness.testResponse('  My Answer  ');
        
        expect(result.response).toEqual({ text: 'My Answer' });
    });
    
    it('normalizes MCQ letter responses', () => {
        const mcqScheme = {
            schemeType: 'points',
            points: [{ id: 'A1', marks: 1, grading: { kind: 'mcq_single', correctIndices: [1] } }]
        };
        
        const mcqQuestion = { id: 'q1', type: 'mcq_single', options: ['A', 'B', 'C', 'D'] };
        const harness = createMarkSchemeTestHarness(mcqScheme, mcqQuestion);
        
        const result = harness.testResponse('B');
        
        expect(result.response.selectedIndex).toBe(1);
    });
    
    it('normalizes MCQ number responses', () => {
        const mcqScheme = {
            schemeType: 'points',
            points: [{ id: 'A1', marks: 1, grading: { kind: 'mcq_single', correctIndices: [2] } }]
        };
        
        const mcqQuestion = { id: 'q1', type: 'mcq_single', options: ['A', 'B', 'C', 'D'] };
        const harness = createMarkSchemeTestHarness(mcqScheme, mcqQuestion);
        
        const result = harness.testResponse('2');
        
        expect(result.response.selectedIndex).toBe(2);
    });
});

describe('Mark Scheme Test Harness - Quick Test', () => {
    const markScheme = {
        id: 'ms1',
        schemeType: 'points',
        points: [
            { id: 'A1', marks: 1, grading: { kind: 'mcq_single', correctIndices: [1] } }
        ]
    };
    
    const question = {
        id: 'q1',
        type: 'mcq_single',
        options: ['A', 'B', 'C', 'D']
    };
    
    const samples = [
        { name: 'Correct', response: { selectedIndex: 1 }, expectedMarks: 1 },
        { name: 'Wrong', response: { selectedIndex: 0 }, expectedMarks: 0 }
    ];
    
    it('runs quick test successfully', () => {
        const result = quickTestMarkScheme(markScheme, question, samples);
        
        expect(result.success).toBe(true);
        expect(result.validation.valid).toBe(true);
        expect(result.sampleResults).toHaveLength(2);
    });
    
    it('detects mismatches in samples', () => {
        const badSamples = [
            { name: 'Should be 0', response: { selectedIndex: 0 }, expectedMarks: 1 } // Wrong expectation
        ];
        
        const result = quickTestMarkScheme(markScheme, question, badSamples);
        
        expect(result.success).toBe(false);
        expect(result.sampleResults[0].matches).toBe(false);
    });
    
    it('fails on invalid mark scheme', () => {
        const invalidScheme = { schemeType: 'points' }; // No points
        
        const result = quickTestMarkScheme(invalidScheme, question, samples);
        
        expect(result.success).toBe(false);
        expect(result.error).toContain('validation failed');
    });
});

describe('Mark Scheme Test Harness - Point Explanations', () => {
    const schemeWithRequires = {
        schemeType: 'points',
        points: [
            { id: 'M1', marks: 1, grading: { kind: 'mcq_single', correctIndices: [0] } },
            { 
                id: 'A1', 
                marks: 1, 
                requires: ['M1'],
                grading: { kind: 'mcq_single', correctIndices: [1] }
            }
        ]
    };
    
    const question = {
        id: 'q1',
        type: 'mcq_single',
        options: ['A', 'B', 'C', 'D']
    };
    
    it('explains prerequisite failures', () => {
        const harness = createMarkSchemeTestHarness(schemeWithRequires, question);
        
        // Response gets A1 but not M1
        const result = harness.testResponse({ selectedIndex: 1 });
        
        const a1Breakdown = result.pointBreakdown.find(p => p.pointId === 'A1');
        expect(a1Breakdown.status).toBe('not_awarded');
        expect(a1Breakdown.reason).toContain('Prerequisite');
    });
    
    it('explains why not awarded for numeric', () => {
        const numericScheme = {
            schemeType: 'points',
            points: [
                { id: 'N1', marks: 1, grading: { kind: 'numeric', value: 10, toleranceAbs: 0.5 } }
            ]
        };
        
        const numericQuestion = { id: 'q1', type: 'numeric' };
        const harness = createMarkSchemeTestHarness(numericScheme, numericQuestion);
        
        const result = harness.testResponse({ value: 20 });
        
        const explanation = harness.explainWhyNotAwarded(
            numericScheme.points[0],
            result.gradeResult
        );
        
        expect(explanation).toContain('10');
        expect(explanation).toContain('tolerance');
    });
});

describe('Mark Scheme Test Harness - Edge Cases', () => {
    it('handles missing mark scheme gracefully', () => {
        const harness = createMarkSchemeTestHarness(null, { id: 'q1' });
        
        const validation = harness.validate();
        expect(validation.valid).toBe(false);
    });
    
    it('handles empty responses', () => {
        const scheme = {
            schemeType: 'points',
            points: [{ id: 'S1', marks: 1, grading: { kind: 'short_text', accepted: ['test'] } }]
        };
        
        const harness = createMarkSchemeTestHarness(scheme, { id: 'q1', type: 'short_text' });
        
        const result = harness.testResponse('');
        expect(result.gradeResult.totalAwardedMarks).toBe(0);
    });
    
    it('truncates long responses in report', () => {
        const harness = createMarkSchemeTestHarness(
            { schemeType: 'points', points: [] },
            { id: 'q1', type: 'short_text' }
        );
        
        const longText = 'A'.repeat(100);
        harness.testResponse(longText);
        
        const report = harness.generateReport();
        expect(report).not.toContain(longText); // Should be truncated
    });
});
