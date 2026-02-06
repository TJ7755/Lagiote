/**
 * Exam Analytics Tests
 * 
 * Tests mark-loss attribution, command word analysis, and performance trends.
 */

import { describe, it, expect } from 'vitest';
import {
    MARK_LOSS_CATEGORIES,
    COMMAND_WORDS,
    analyseMarkLoss,
    aggregateMarkLoss,
    analyseCommandWords,
    analyseTimeUsage,
    analyseFragility,
    analyseTrends,
    generateAnalyticsDashboard
} from '../../js/core/exam/exam-analytics.js';

describe('Exam Analytics - Mark Loss Attribution', () => {
    const mockQuestion = {
        id: 'q1',
        type: 'structured',
        marksAvailable: 3
    };
    
    const mockMarkScheme = {
        points: [
            { id: 'M1', marks: 1, atomLinks: [{ atomId: 'atom1' }] },
            { id: 'A1', marks: 1, atomLinks: [{ atomId: 'atom2' }] },
            { id: 'R1', marks: 1, atomLinks: [{ atomId: 'atom3' }] }
        ]
    };
    
    it('classifies method mark losses correctly', () => {
        const markingRecord = {
            questionId: 'q1',
            awardedPoints: [
                { pointId: 'M1', awardedMarks: 0 },
                { pointId: 'A1', awardedMarks: 1 },
                { pointId: 'R1', awardedMarks: 1 }
            ],
            totalAwardedMarks: 2
        };
        
        const analysis = analyseMarkLoss(markingRecord, mockQuestion, mockMarkScheme);
        
        expect(analysis.losses).toHaveLength(1);
        expect(analysis.losses[0].category).toBe(MARK_LOSS_CATEGORIES.METHOD_ERROR);
        expect(analysis.losses[0].pointId).toBe('M1');
    });
    
    it('classifies accuracy mark losses correctly', () => {
        const markingRecord = {
            awardedPoints: [
                { pointId: 'M1', awardedMarks: 1 },
                { pointId: 'A1', awardedMarks: 0 }
            ],
            totalAwardedMarks: 1
        };
        
        const analysis = analyseMarkLoss(markingRecord, mockQuestion, mockMarkScheme);
        const accuracyLoss = analysis.losses.find(l => l.pointId === 'A1');
        
        expect(accuracyLoss.category).toBe(MARK_LOSS_CATEGORIES.CALCULATION_ERROR);
    });
    
    it('classifies reasoning mark losses correctly', () => {
        const markingRecord = {
            awardedPoints: [
                { pointId: 'M1', awardedMarks: 1 },
                { pointId: 'A1', awardedMarks: 1 },
                { pointId: 'R1', awardedMarks: 0 }
            ],
            totalAwardedMarks: 2
        };
        
        const analysis = analyseMarkLoss(markingRecord, mockQuestion, mockMarkScheme);
        
        expect(analysis.losses[0].category).toBe(MARK_LOSS_CATEGORIES.TECHNIQUE_ERROR);
    });
    
    it('returns null for invalid marking record', () => {
        const analysis = analyseMarkLoss(null, mockQuestion, mockMarkScheme);
        expect(analysis).toBeNull();
    });
    
    it('tracks missing points as full mark losses', () => {
        const markingRecord = {
            questionId: 'q1',
            awardedPoints: [
                { pointId: 'M1', awardedMarks: 1 }
                // A1 and R1 are missing from awardedPoints
            ],
            totalAwardedMarks: 1
        };
        
        const analysis = analyseMarkLoss(markingRecord, mockQuestion, mockMarkScheme);
        
        expect(analysis.losses).toHaveLength(2); // A1 and R1 not evaluated
        
        const missingA1 = analysis.losses.find(l => l.pointId === 'A1');
        const missingR1 = analysis.losses.find(l => l.pointId === 'R1');
        
        expect(missingA1).toBeDefined();
        expect(missingA1.marksLost).toBe(1);
        expect(missingA1.category).toBe(MARK_LOSS_CATEGORIES.KNOWLEDGE_GAP);
        expect(missingA1.reason).toContain('not evaluated');
        
        expect(missingR1).toBeDefined();
        expect(missingR1.marksLost).toBe(1);
        expect(missingR1.category).toBe(MARK_LOSS_CATEGORIES.KNOWLEDGE_GAP);
        expect(missingR1.reason).toContain('not evaluated');
    });
});

describe('Exam Analytics - Aggregation', () => {
    const analyses = [
        {
            questionId: 'q1',
            totalMarksAvailable: 3,
            totalMarksAwarded: 2,
            losses: [
                { pointId: 'M1', marksLost: 1, category: MARK_LOSS_CATEGORIES.METHOD_ERROR, atomIds: ['atom1'] }
            ]
        },
        {
            questionId: 'q2',
            totalMarksAvailable: 3,
            totalMarksAwarded: 1,
            losses: [
                { pointId: 'A1', marksLost: 1, category: MARK_LOSS_CATEGORIES.CALCULATION_ERROR, atomIds: ['atom2'] },
                { pointId: 'R1', marksLost: 1, category: MARK_LOSS_CATEGORIES.TECHNIQUE_ERROR, atomIds: ['atom3'] }
            ]
        }
    ];
    
    it('aggregates total marks lost', () => {
        const aggregated = aggregateMarkLoss(analyses);
        
        expect(aggregated.totalMarksLost).toBe(3);
        expect(aggregated.totalMarksAvailable).toBe(6);
    });
    
    it('breaks down by category', () => {
        const aggregated = aggregateMarkLoss(analyses);
        
        expect(aggregated.categoryBreakdown).toHaveLength(3);
        expect(aggregated.categoryBreakdown[0]).toHaveProperty('category');
        expect(aggregated.categoryBreakdown[0]).toHaveProperty('marks');
        expect(aggregated.categoryBreakdown[0]).toHaveProperty('percentage');
    });
    
    it('identifies top problem atoms', () => {
        const aggregated = aggregateMarkLoss(analyses);
        
        expect(aggregated.topProblemAtoms).toHaveLength(3);
        expect(aggregated.topProblemAtoms[0]).toHaveProperty('atomId');
        expect(aggregated.topProblemAtoms[0]).toHaveProperty('marksLost');
    });
    
    it('returns null for empty array', () => {
        const aggregated = aggregateMarkLoss([]);
        expect(aggregated).toBeNull();
    });
});

describe('Exam Analytics - Command Word Analysis', () => {
    const questions = [
        { id: 'q1', prompt: 'State the formula for force', marksAvailable: 1 },
        { id: 'q2', prompt: 'Explain why objects fall', marksAvailable: 3 },
        { id: 'q3', prompt: 'Evaluate the experiment', marksAvailable: 5 }
    ];
    
    const markingRecords = [
        { totalAwardedMarks: 1 },
        { totalAwardedMarks: 2 },
        { totalAwardedMarks: 3 }
    ];
    
    it('identifies command words correctly', () => {
        const analysis = analyseCommandWords(questions, markingRecords);
        
        expect(analysis.commandBreakdown).toHaveLength(3);
        expect(analysis.commandBreakdown.map(c => c.command)).toContain('state');
        expect(analysis.commandBreakdown.map(c => c.command)).toContain('explain');
        expect(analysis.commandBreakdown.map(c => c.command)).toContain('evaluate');
    });
    
    it('assigns correct demand levels', () => {
        const analysis = analyseCommandWords(questions, markingRecords);
        
        const stateCmd = analysis.commandBreakdown.find(c => c.command === 'state');
        const evaluateCmd = analysis.commandBreakdown.find(c => c.command === 'evaluate');
        
        expect(stateCmd.demandLevel).toBe('low');
        expect(evaluateCmd.demandLevel).toBe('high');
    });
    
    it('identifies weak command words', () => {
        const analysis = analyseCommandWords(questions, markingRecords);
        
        expect(analysis.weakCommands.length).toBeGreaterThan(0);
        expect(analysis.recommendation).toContain('Focus on practicing');
    });
});

describe('Exam Analytics - Time Usage Analysis', () => {
    const sittings = [
        {
            timing: {
                q1: { totalSeconds: 30, attempts: 1 },
                q2: { totalSeconds: 60, attempts: 1 },
                q3: { totalSeconds: 300, attempts: 1 },
                q4: { totalSeconds: 15, attempts: 1 },
                q5: { totalSeconds: 20, attempts: 1 }
            }
        }
    ];
    
    it('calculates average time per question', () => {
        const analysis = analyseTimeUsage(sittings);
        
        expect(analysis.averageTimePerQuestion).toBe(85); // (30+60+300+15+20)/5
    });
    
    it('identifies time sinks', () => {
        const analysis = analyseTimeUsage(sittings);
        
        expect(analysis.timeSinks.length).toBeGreaterThan(0);
        expect(analysis.timeSinks[0].questionId).toBe('q3'); // 300 seconds
    });
    
    it('identifies rushed questions', () => {
        const analysis = analyseTimeUsage(sittings);
        
        expect(analysis.rushedQuestions.length).toBeGreaterThan(0);
    });
    
    it('returns null for empty sittings', () => {
        const analysis = analyseTimeUsage([]);
        expect(analysis).toBeNull();
    });
});

describe('Exam Analytics - Fragility Analysis', () => {
    const atoms = [
        { id: 'a1', name: 'Stable Atom', fragility: 0.2, mastery: 0.8 },
        { id: 'a2', name: 'Fragile Atom', fragility: 0.8, mastery: 0.6 },
        { id: 'a3', name: 'Very Fragile', fragility: 0.9, mastery: 0.5 }
    ];
    
    const questions = [
        { id: 'q1', atomMap: [{ atomId: 'a1' }, { atomId: 'a2' }] },
        { id: 'q2', atomMap: [{ atomId: 'a2' }, { atomId: 'a3' }] }
    ];
    
    it('identifies fragile atoms', () => {
        const analysis = analyseFragility(atoms, questions, new Map(atoms.map(a => [a.id, a])));
        
        expect(analysis.fragileAtomCount).toBe(2); // a2 and a3
        expect(analysis.fragileAtoms).toHaveLength(2);
    });
    
    it('sorts by fragility', () => {
        const analysis = analyseFragility(atoms, questions, new Map(atoms.map(a => [a.id, a])));
        
        expect(analysis.fragileAtoms[0].fragility).toBe(0.9);
        expect(analysis.fragileAtoms[1].fragility).toBe(0.8);
    });
    
    it('assesses risk level', () => {
        const analysis = analyseFragility(atoms, questions, new Map(atoms.map(a => [a.id, a])));
        
        expect(analysis.riskLevel).toBe('medium'); // 2 fragile atoms
    });
    
    it('provides recommendation', () => {
        const analysis = analyseFragility(atoms, questions, new Map(atoms.map(a => [a.id, a])));
        
        expect(analysis.recommendation).toContain('Practice');
    });
});

describe('Exam Analytics - Trend Analysis', () => {
    const sittings = [
        { createdAt: '2025-01-01', totalAwardedMarks: 50, totalMarks: 100 },
        { createdAt: '2025-01-02', totalAwardedMarks: 55, totalMarks: 100 },
        { createdAt: '2025-01-03', totalAwardedMarks: 60, totalMarks: 100 },
        { createdAt: '2025-01-04', totalAwardedMarks: 70, totalMarks: 100 },
        { createdAt: '2025-01-05', totalAwardedMarks: 80, totalMarks: 100 }
    ];
    
    it('identifies improving trend', () => {
        const analysis = analyseTrends(sittings);
        
        expect(analysis.trend).toContain('improve');
        expect(analysis.improvement).toBeGreaterThan(0);
    });
    
    it('calculates averages correctly', () => {
        const analysis = analyseTrends(sittings);
        
        expect(analysis.firstHalfAverage).toBe(55); // (50+55+60)/3 = 55
        expect(analysis.secondHalfAverage).toBe(75); // (70+80)/2 = 75
    });
    
    it('returns insufficient data for single sitting', () => {
        const analysis = analyseTrends([sittings[0]]);
        
        expect(analysis.trend).toBe('insufficient_data');
    });
    
    it('returns insufficient data for empty array', () => {
        const analysis = analyseTrends([]);
        expect(analysis).toBeNull();
    });
});

describe('Exam Analytics - Dashboard Generation', () => {
    it('generates complete dashboard', () => {
        const params = {
            sittings: [
                { 
                    createdAt: '2025-01-01', 
                    totalAwardedMarks: 50, 
                    totalMarks: 100,
                    timing: { q1: { totalSeconds: 60 } }
                }
            ],
            questions: [
                { id: 'q1', prompt: 'Explain the process', marksAvailable: 10 }
            ],
            markingRecords: [
                { 
                    questionId: 'q1',
                    awardedPoints: [{ pointId: 'M1', awardedMarks: 1 }],
                    totalAwardedMarks: 5,
                    markScheme: {
                        points: [
                            { id: 'M1', marks: 1, atomLinks: [{ atomId: 'a1' }] }
                        ]
                    }
                }
            ],
            atoms: [
                { id: 'a1', name: 'Test Atom', fragility: 0.5, mastery: 0.6, type: 'knowledge' }
            ],
            examDate: '2025-06-01'
        };
        
        const dashboard = generateAnalyticsDashboard(params);
        
        expect(dashboard.id).toBeDefined();
        expect(dashboard.generatedAt).toBeDefined();
        expect(dashboard.summary).toBeDefined();
        expect(dashboard.recommendations).toBeDefined();
        expect(dashboard.priorityActions).toBeDefined();
    });
    
    it('generates recommendations', () => {
        const params = {
            sittings: [],
            questions: [],
            markingRecords: [],
            atoms: [],
            examDate: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString() // 3 days away
        };
        
        const dashboard = generateAnalyticsDashboard(params);
        
        const urgencyRec = dashboard.recommendations.find(r => r.type === 'urgency');
        expect(urgencyRec).toBeDefined();
        expect(urgencyRec.priority).toBe('high');
    });
});

describe('Exam Analytics - Constants', () => {
    it('exports mark loss categories', () => {
        expect(MARK_LOSS_CATEGORIES.KNOWLEDGE_GAP).toBe('knowledge_gap');
        expect(MARK_LOSS_CATEGORIES.METHOD_ERROR).toBe('method_error');
        expect(Object.keys(MARK_LOSS_CATEGORIES).length).toBeGreaterThan(5);
    });
    
    it('exports command words', () => {
        expect(COMMAND_WORDS.low_demand).toContain('state');
        expect(COMMAND_WORDS.high_demand).toContain('evaluate');
        expect(COMMAND_WORDS.medium_demand).toContain('explain');
    });
});
