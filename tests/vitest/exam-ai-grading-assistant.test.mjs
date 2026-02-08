/**
 * AI Grading Assistant Tests
 * 
 * Tests evidence extraction, scheme matching, and feedback generation.
 */

import { describe, it, expect } from 'vitest';
import {
    extractCalculations,
    extractClaims,
    extractEvidence,
    suggestPointsFromEvidence,
    generateFeedback,
    calculateGradingConfidence,
    aiGradingAssistant
} from '../../js/core/exam/ai-grading-assistant.js';

describe('AI Grading Assistant - Evidence Extraction', () => {
    it('extracts simple calculations', () => {
        const text = 'First I calculated 5 + 3 = 8, then 10 * 2 = 20';
        const calcs = extractCalculations(text);
        
        expect(calcs).toHaveLength(2);
        expect(calcs[0].operand1).toBe(5);
        expect(calcs[0].operator).toBe('+');
        expect(calcs[0].verified).toBe(true);
    });
    
    it('detects incorrect calculations', () => {
        const text = 'I calculated 5 + 3 = 10';
        const calcs = extractCalculations(text);
        
        expect(calcs).toHaveLength(1);
        expect(calcs[0].verified).toBe(false);
    });
    
    it('extracts values with units', () => {
        const text = 'The answer is 10 m/s or 5.2 kg';
        const calcs = extractCalculations(text);
        
        const unitValues = calcs.filter(c => c.type === 'value_with_unit');
        expect(unitValues.length).toBeGreaterThanOrEqual(1);
        expect(unitValues[0].unit).toBeDefined();
    });
    
    it('handles edge cases gracefully', () => {
        expect(extractCalculations('')).toEqual([]);
        expect(extractCalculations(null)).toEqual([]);
        expect(extractCalculations('No numbers here')).toEqual([]);
    });
});

describe('AI Grading Assistant - Claim Extraction', () => {
    it('extracts sentences as claims', () => {
        const text = 'The force equals mass times acceleration. Therefore, F = ma.';
        const claims = extractClaims(text);
        
        expect(claims.length).toBeGreaterThanOrEqual(1);
        expect(claims[0].text).toContain('force');
    });
    
    it('identifies conclusion claims', () => {
        const text = 'Therefore, the answer is correct.';
        const claims = extractClaims(text);
        
        const conclusion = claims.find(c => c.type === 'conclusion');
        expect(conclusion).toBeDefined();
    });
    
    it('identifies reasoning claims', () => {
        const text = 'Because gravity acts downward, the object falls.';
        const claims = extractClaims(text);
        
        const reasoning = claims.find(c => c.type === 'reasoning');
        expect(reasoning).toBeDefined();
    });
    
    it('filters out very short sentences', () => {
        const text = 'A. B. This is a real sentence.';
        const claims = extractClaims(text);
        
        expect(claims.every(c => c.text.length >= 5)).toBe(true);
    });
});

describe('AI Grading Assistant - Full Evidence Extraction', () => {
    it('extracts comprehensive evidence', () => {
        const text = `
            To solve this, I first calculated 10 + 5 = 15 meters.
            Then using F = ma, I found the force to be 30 Newtons.
            Therefore, the acceleration is 2 m/s².
        `;
        
        const evidence = extractEvidence(text, 'structured');
        
        expect(evidence.calculations.length).toBeGreaterThan(0);
        expect(evidence.claims.length).toBeGreaterThan(0);
        expect(evidence.keyTerms.length).toBeGreaterThan(0);
        expect(evidence.structure).toBeDefined();
    });
    
    it('analyses essay structure', () => {
        const text = `
            Introduction paragraph with main argument.
            
            First supporting point with evidence.
            
            Second supporting point with analysis.
            
            Conclusion summarizing findings.
        `;
        
        const evidence = extractEvidence(text, 'essay');
        
        expect(evidence.paragraphs).toBeDefined();
        expect(evidence.paragraphs.length).toBeGreaterThan(2);
        expect(evidence.argumentFlow).toBeDefined();
    });
});

describe('AI Grading Assistant - Point Matching', () => {
    const mockMarkScheme = {
        schemeType: 'points',
        points: [
            {
                id: 'M1',
                marks: 1,
                condition: 'Correct method shown',
                grading: { kind: 'calculation' }
            },
            {
                id: 'A1',
                marks: 1,
                condition: 'Correct answer',
                grading: { kind: 'numeric', value: 42, toleranceAbs: 0.5 }
            },
            {
                id: 'R1',
                marks: 1,
                condition: 'Reasoning explained',
                grading: { accepted: ['because', 'therefore'] }
            }
        ]
    };
    
    it('suggests method marks for calculations', () => {
        const evidence = {
            calculations: [{ full: '10 + 5 = 15', verified: true }],
            claims: []
        };
        
        const suggestions = suggestPointsFromEvidence(evidence, mockMarkScheme, {});
        const methodSuggestion = suggestions.find(s => s.pointId === 'M1');
        
        expect(methodSuggestion).toBeDefined();
        expect(methodSuggestion.confidence).toBe('medium');
    });
    
    it('suggests accuracy marks for correct values', () => {
        const evidence = extractEvidence('The answer is 42');
        
        const suggestions = suggestPointsFromEvidence(evidence, mockMarkScheme, {});
        const accuracySuggestion = suggestions.find(s => s.pointId === 'A1');
        
        expect(accuracySuggestion).toBeDefined();
    });
    
    it('suggests reasoning marks for reasoning words', () => {
        const evidence = extractEvidence('Therefore, this is true because of physics.');
        
        const suggestions = suggestPointsFromEvidence(evidence, mockMarkScheme, {});
        const reasoningSuggestion = suggestions.find(s => s.pointId === 'R1');
        
        expect(reasoningSuggestion).toBeDefined();
        expect(reasoningSuggestion.confidence).toBe('high');
    });
    
    it('returns empty array for invalid mark scheme', () => {
        const suggestions = suggestPointsFromEvidence({}, null, {});
        expect(suggestions).toEqual([]);
    });
});

describe('AI Grading Assistant - Feedback Generation', () => {
    it('generates positive feedback for awarded points', () => {
        const awardedPoints = [
            { pointId: 'M1', awardedMarks: 1 },
            { pointId: 'A1', awardedMarks: 1 }
        ];
        const missedPoints = [];
        const markScheme = { points: [{ id: 'M1' }, { id: 'A1' }] };
        
        const feedback = generateFeedback(awardedPoints, missedPoints, markScheme);
        
        expect(feedback.summary.totalAwarded).toBe(2);
        expect(feedback.positive.length).toBeGreaterThan(0);
    });
    
    it('generates improvement suggestions for missed points', () => {
        const awardedPoints = [{ pointId: 'M1', awardedMarks: 1 }];
        const missedPoints = [
            { pointId: 'A1', reasons: ['Wrong answer'] },
            { pointId: 'R1', reasons: ['No reasoning'] }
        ];
        const markScheme = { points: [{ id: 'M1' }, { id: 'A1' }, { id: 'R1' }] };
        
        const feedback = generateFeedback(awardedPoints, missedPoints, markScheme);
        
        expect(feedback.improvements.length).toBe(2);
        expect(feedback.nextSteps.length).toBeGreaterThan(0);
    });
    
    it('suggests method mark practice when method marks missed', () => {
        const awardedPoints = [];
        const missedPoints = [{ pointId: 'M1', marksLost: 1 }];
        const markScheme = { points: [{ id: 'M1' }] };
        
        const feedback = generateFeedback(awardedPoints, missedPoints, markScheme);
        
        const methodSuggestion = feedback.nextSteps.find(s => 
            s.toLowerCase().includes('method')
        );
        expect(methodSuggestion).toBeDefined();
    });
});

describe('AI Grading Assistant - Confidence Scoring', () => {
    it('returns high confidence for mostly high suggestions', () => {
        const suggestions = [
            { confidence: 'high' },
            { confidence: 'high' },
            { confidence: 'medium' }
        ];
        
        const confidence = calculateGradingConfidence(suggestions, {});
        
        expect(confidence.overall).toBe('high');
        expect(confidence.requiresManualReview).toBe(false);
    });
    
    it('returns low confidence for mostly low suggestions', () => {
        const suggestions = [
            { confidence: 'low' },
            { confidence: 'low' },
            { confidence: 'medium' }
        ];
        
        const confidence = calculateGradingConfidence(suggestions, {});
        
        expect(confidence.overall).toBe('low');
        expect(confidence.requiresManualReview).toBe(true);
    });
    
    it('handles empty suggestions', () => {
        const confidence = calculateGradingConfidence([], {});
        
        expect(confidence.overall).toBe('low');
    });
});

describe('AI Grading Assistant - Main Interface', () => {
    const mockQuestion = {
        id: 'q1',
        type: 'structured',
        prompt: 'Calculate the force'
    };
    
    const mockMarkScheme = {
        id: 'ms1',
        schemeType: 'points',
        points: [
            { id: 'M1', marks: 1, condition: 'Use F=ma' },
            { id: 'A1', marks: 1, condition: 'Correct answer' }
        ]
    };
    
    it('returns complete grading assistance result', () => {
        const result = aiGradingAssistant({
            responseText: 'Using F = ma, I calculated 10 * 2 = 20 N',
            question: mockQuestion,
            markScheme: mockMarkScheme
        });
        
        expect(result.id).toBeDefined();
        expect(result.timestamp).toBeDefined();
        expect(result.evidence).toBeDefined();
        expect(result.suggestions).toBeDefined();
        expect(result.confidence).toBeDefined();
        expect(result.preliminaryFeedback).toBeDefined();
        expect(result.disclaimer).toContain('AI ASSISTANCE ONLY');
    });
    
    it('processes within reasonable time', () => {
        const result = aiGradingAssistant({
            responseText: 'Short answer',
            question: mockQuestion,
            markScheme: mockMarkScheme
        });
        
        expect(result.processingTimeMs).toBeGreaterThanOrEqual(0);
        expect(result.processingTimeMs).toBeLessThan(1000); // Should be fast
    });
});
