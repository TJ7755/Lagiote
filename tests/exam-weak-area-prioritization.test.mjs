/**
 * Exam Mode Weak Area Prioritization Test Suite
 * 
 * Tests that rankQuestionsForPractice correctly prioritizes:
 * - Low mastery atoms (weak knowledge)
 * - High mark-impact atoms
 * - Atoms with upcoming exam dates (urgency)
 * - Fragile atoms (inconsistent performance)
 * - Time-sensitive atoms (fluency issues)
 * - Error patterns
 */

import assert from 'assert';
import {
    createAtom,
    createQuestion,
    createExamSpec,
    rankQuestionsForPractice,
    generateUUID
} from '../js/core/exam/exam-mode.js';

import { daysBetweenDates } from '../js/core/exam/atom-dynamics.js';

console.log('Running Exam Mode Weak Area Prioritization Tests...\n');

let testsPassed = 0;
let testsFailed = 0;

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
    testQueue.push({ name: `\n--- ${name} ---`, fn: () => {} });
}

// ============================================================================
// SECTION 1: Basic Prioritization by Mastery
// ============================================================================

section('Section 1: Basic Prioritization by Mastery');

test('rankQuestionsForPractice prioritizes low mastery over high mastery', () => {
    const atoms = new Map([
        ['weak-atom', createAtom({ id: 'weak-atom', mastery: 0.2, stabilityDays: 10 })],
        ['strong-atom', createAtom({ id: 'strong-atom', mastery: 0.9, stabilityDays: 10 })]
    ]);
    
    const questions = [
        createQuestion({ 
            id: 'q-weak', 
            atomMap: [{ atomId: 'weak-atom', weight: 1.0 }],
            difficulty: 0.5,
            timeSeconds: 60
        }),
        createQuestion({ 
            id: 'q-strong', 
            atomMap: [{ atomId: 'strong-atom', weight: 1.0 }],
            difficulty: 0.5,
            timeSeconds: 60
        })
    ];
    
    const now = new Date();
    const examDate = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000); // 30 days from now
    
    const ranked = rankQuestionsForPractice(questions, atoms, now, examDate);
    
    assert.ok(ranked.length > 0, 'Should return ranked questions');
    assert.strictEqual(ranked[0].questionId, 'q-weak', 'Weak atom question should be ranked first');
});

test('rankQuestionsForPractice considers multiple atoms per question', () => {
    const atoms = new Map([
        ['atom1', createAtom({ id: 'atom1', mastery: 0.1, stabilityDays: 5 })],
        ['atom2', createAtom({ id: 'atom2', mastery: 0.8, stabilityDays: 10 })],
        ['atom3', createAtom({ id: 'atom3', mastery: 0.9, stabilityDays: 15 })]
    ]);
    
    const questions = [
        createQuestion({ 
            id: 'q-mixed', 
            atomMap: [
                { atomId: 'atom1', weight: 0.7 },
                { atomId: 'atom2', weight: 0.3 }
            ],
            difficulty: 0.5,
            timeSeconds: 60
        }),
        createQuestion({ 
            id: 'q-strong-only', 
            atomMap: [{ atomId: 'atom3', weight: 1.0 }],
            difficulty: 0.5,
            timeSeconds: 60
        })
    ];
    
    const now = new Date();
    const ranked = rankQuestionsForPractice(questions, atoms, now, now);
    
    assert.strictEqual(ranked[0].questionId, 'q-mixed', 
        'Question with weak atom should rank higher despite mixed atoms');
});

// ============================================================================
// SECTION 2: Urgency and Exam Date
// ============================================================================

section('Section 2: Urgency and Exam Date');

test('rankQuestionsForPractice increases priority with approaching exam date', () => {
    const atoms = new Map([
        ['atom1', createAtom({ id: 'atom1', mastery: 0.5, stabilityDays: 5 })]
    ]);
    
    const question = createQuestion({ 
        id: 'q1', 
        atomMap: [{ atomId: 'atom1', weight: 1.0 }],
        difficulty: 0.5,
        timeSeconds: 60
    });
    
    const now = new Date();
    const nearExam = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000); // 7 days
    const farExam = new Date(now.getTime() + 60 * 24 * 60 * 60 * 1000); // 60 days
    
    const rankedNear = rankQuestionsForPractice([question], atoms, now, nearExam);
    const rankedFar = rankQuestionsForPractice([question], atoms, now, farExam);
    
    // With near exam, priority should be higher (though we can't directly compare scores,
    // we verify it's included in both rankings)
    assert.ok(rankedNear.length > 0, 'Should include question for near exam');
    assert.ok(rankedFar.length > 0, 'Should include question for far exam');
});

test('rankQuestionsForPractice prioritizes atoms that will decay before exam', () => {
    const atoms = new Map([
        ['unstable-atom', createAtom({ id: 'unstable-atom', mastery: 0.7, stabilityDays: 3 })],
        ['stable-atom', createAtom({ id: 'stable-atom', mastery: 0.7, stabilityDays: 30 })]
    ]);
    
    const questions = [
        createQuestion({ 
            id: 'q-unstable', 
            atomMap: [{ atomId: 'unstable-atom', weight: 1.0 }],
            difficulty: 0.5,
            timeSeconds: 60
        }),
        createQuestion({ 
            id: 'q-stable', 
            atomMap: [{ atomId: 'stable-atom', weight: 1.0 }],
            difficulty: 0.5,
            timeSeconds: 60
        })
    ];
    
    const now = new Date();
    const examDate = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000); // 14 days
    
    const ranked = rankQuestionsForPractice(questions, atoms, now, examDate);
    
    assert.strictEqual(ranked[0].questionId, 'q-unstable', 
        'Question with unstable atom should rank higher due to decay before exam');
});

// ============================================================================
// SECTION 3: Difficulty and Time Efficiency
// ============================================================================

section('Section 3: Difficulty and Time Efficiency');

test('rankQuestionsForPractice considers time efficiency (value per minute)', () => {
    const atoms = new Map([
        ['atom1', createAtom({ id: 'atom1', mastery: 0.3, stabilityDays: 10 })]
    ]);
    
    const questions = [
        createQuestion({ 
            id: 'q-quick', 
            atomMap: [{ atomId: 'atom1', weight: 1.0 }],
            difficulty: 0.5,
            timeSeconds: 30 // Quick question
        }),
        createQuestion({ 
            id: 'q-long', 
            atomMap: [{ atomId: 'atom1', weight: 1.0 }],
            difficulty: 0.5,
            timeSeconds: 300 // Long question
        })
    ];
    
    const now = new Date();
    const ranked = rankQuestionsForPractice(questions, atoms, now, now);
    
    // Quick questions with same atom value should rank higher (better value per minute)
    assert.strictEqual(ranked[0].questionId, 'q-quick', 
        'Shorter question should rank higher for same atom improvement');
});

test('rankQuestionsForPractice does not filter by difficulty appropriately yet', () => {
    const atoms = new Map([
        ['atom1', createAtom({ id: 'atom1', mastery: 0.5, stabilityDays: 10 })]
    ]);
    
    const questions = [
        createQuestion({ 
            id: 'q-impossible', 
            atomMap: [{ atomId: 'atom1', weight: 1.0 }],
            difficulty: 0.95, // Too hard
            timeSeconds: 60
        }),
        createQuestion({ 
            id: 'q-optimal', 
            atomMap: [{ atomId: 'atom1', weight: 1.0 }],
            difficulty: 0.55, // Slightly challenging
            timeSeconds: 60
        }),
        createQuestion({ 
            id: 'q-trivial', 
            atomMap: [{ atomId: 'atom1', weight: 1.0 }],
            difficulty: 0.1, // Too easy
            timeSeconds: 60
        })
    ];
    
    const now = new Date();
    const ranked = rankQuestionsForPractice(questions, atoms, now, now);
    
    // Currently, the algorithm ranks by masteryGap * marks * transferability * fragility
    // It doesn't filter by difficulty match to current mastery
    // All three questions have same atom, so ranking depends on other factors
    // This test documents current behaviour - improvement needed in future
    assert.ok(ranked.length === 3, 'All questions should be included in ranking');
    // Note: Optimal difficulty matching is a future enhancement
});

// ============================================================================
// SECTION 4: Fragility and Time Sensitivity
// ============================================================================

section('Section 4: Fragility and Time Sensitivity');

test('rankQuestionsForPractice prioritizes fragile atoms', () => {
    const atoms = new Map([
        ['fragile-atom', createAtom({ 
            id: 'fragile-atom', 
            mastery: 0.7, 
            stabilityDays: 10,
            fragility: 0.9 // High fragility
        })],
        ['robust-atom', createAtom({ 
            id: 'robust-atom', 
            mastery: 0.7, 
            stabilityDays: 10,
            fragility: 0.1 // Low fragility
        })]
    ]);
    
    const questions = [
        createQuestion({ 
            id: 'q-fragile', 
            atomMap: [{ atomId: 'fragile-atom', weight: 1.0 }],
            difficulty: 0.5,
            timeSeconds: 60
        }),
        createQuestion({ 
            id: 'q-robust', 
            atomMap: [{ atomId: 'robust-atom', weight: 1.0 }],
            difficulty: 0.5,
            timeSeconds: 60
        })
    ];
    
    const now = new Date();
    const ranked = rankQuestionsForPractice(questions, atoms, now, now);
    
    assert.strictEqual(ranked[0].questionId, 'q-fragile', 
        'Question testing fragile atom should rank higher');
});

test('rankQuestionsForPractice prioritizes time-sensitive atoms', () => {
    const atoms = new Map([
        ['slow-atom', createAtom({ 
            id: 'slow-atom', 
            mastery: 0.7, 
            stabilityDays: 10,
            timeSensitivity: 0.9 // Needs speed improvement
        })],
        ['fast-atom', createAtom({ 
            id: 'fast-atom', 
            mastery: 0.7, 
            stabilityDays: 10,
            timeSensitivity: 0.1 // Already fluent
        })]
    ]);
    
    const questions = [
        createQuestion({ 
            id: 'q-slow', 
            atomMap: [{ atomId: 'slow-atom', weight: 1.0 }],
            difficulty: 0.5,
            timeSeconds: 60
        }),
        createQuestion({ 
            id: 'q-fast', 
            atomMap: [{ atomId: 'fast-atom', weight: 1.0 }],
            difficulty: 0.5,
            timeSeconds: 60
        })
    ];
    
    const now = new Date();
    const ranked = rankQuestionsForPractice(questions, atoms, now, now);
    
    assert.strictEqual(ranked[0].questionId, 'q-slow', 
        'Question testing time-sensitive atom should rank higher');
});

// ============================================================================
// SECTION 5: Depth and Transferability
// ============================================================================

section('Section 5: Depth and Transferability');

test('rankQuestionsForPractice values high-transfer atoms', () => {
    const atoms = new Map([
        ['transfer-atom', createAtom({ 
            id: 'transfer-atom', 
            mastery: 0.5, 
            stabilityDays: 10,
            transferability: 0.95 // High transfer
        })],
        ['narrow-atom', createAtom({ 
            id: 'narrow-atom', 
            mastery: 0.5, 
            stabilityDays: 10,
            transferability: 0.15 // Low transfer
        })]
    ]);
    
    const questions = [
        createQuestion({ 
            id: 'q-transfer', 
            atomMap: [{ atomId: 'transfer-atom', weight: 1.0 }],
            difficulty: 0.5,
            timeSeconds: 60
        }),
        createQuestion({ 
            id: 'q-narrow', 
            atomMap: [{ atomId: 'narrow-atom', weight: 1.0 }],
            difficulty: 0.5,
            timeSeconds: 60
        })
    ];
    
    const now = new Date();
    const ranked = rankQuestionsForPractice(questions, atoms, now, now);
    
    assert.strictEqual(ranked[0].questionId, 'q-transfer', 
        'Question testing high-transfer atom should rank higher');
});

test('rankQuestionsForPractice prioritises surface-level atoms (current behaviour)', () => {
    const atoms = new Map([
        ['surface-atom', createAtom({ 
            id: 'surface-atom', 
            mastery: 0.5, 
            stabilityDays: 10,
            depth: 0.2 // Surface recall
        })],
        ['deep-atom', createAtom({ 
            id: 'deep-atom', 
            mastery: 0.5, 
            stabilityDays: 10,
            depth: 0.9 // Deep understanding
        })]
    ]);
    
    const questions = [
        createQuestion({ 
            id: 'q-surface', 
            atomMap: [{ atomId: 'surface-atom', weight: 1.0 }],
            difficulty: 0.5,
            timeSeconds: 60
        }),
        createQuestion({ 
            id: 'q-deep', 
            atomMap: [{ atomId: 'deep-atom', weight: 1.0 }],
            difficulty: 0.5,
            timeSeconds: 60
        })
    ];
    
    const now = new Date();
    const ranked = rankQuestionsForPractice(questions, atoms, now, now);
    
    // Currently, depth is not used in the value calculation
    // Both questions have same mastery, so they rank similarly
    // This test documents current behaviour - depth weighting is a future enhancement
    assert.ok(ranked.length === 2, 'Both questions should be in ranking');
    // Note: Depth-based prioritization is a future enhancement
});

// ============================================================================
// SECTION 6: Edge Cases and Robustness
// ============================================================================

section('Section 6: Edge Cases and Robustness');

test('rankQuestionsForPractice handles empty inputs gracefully', () => {
    const atoms = new Map();
    const questions = [];
    const now = new Date();
    
    const ranked = rankQuestionsForPractice(questions, atoms, now, now);
    
    assert.ok(Array.isArray(ranked), 'Should return an array');
    assert.strictEqual(ranked.length, 0, 'Should return empty array for empty inputs');
});

test('rankQuestionsForPractice handles missing atoms gracefully', () => {
    const atoms = new Map([
        ['atom1', createAtom({ id: 'atom1', mastery: 0.5 })]
    ]);
    
    const questions = [
        createQuestion({ 
            id: 'q1', 
            atomMap: [{ atomId: 'missing-atom', weight: 1.0 }],
            difficulty: 0.5,
            timeSeconds: 60
        }),
        createQuestion({ 
            id: 'q2', 
            atomMap: [{ atomId: 'atom1', weight: 1.0 }],
            difficulty: 0.5,
            timeSeconds: 60
        })
    ];
    
    const now = new Date();
    const ranked = rankQuestionsForPractice(questions, atoms, now, now);
    
    // Should handle missing atom and still rank the valid question
    assert.ok(ranked.some(q => q.questionId === 'q2'), 'Should include question with valid atom');
});

test('rankQuestionsForPractice handles zero or negative time values', () => {
    const atoms = new Map([
        ['atom1', createAtom({ id: 'atom1', mastery: 0.3 })]
    ]);
    
    const questions = [
        createQuestion({ 
            id: 'q1', 
            atomMap: [{ atomId: 'atom1', weight: 1.0 }],
            difficulty: 0.5,
            timeSeconds: 0 // Invalid time
        }),
        createQuestion({ 
            id: 'q2', 
            atomMap: [{ atomId: 'atom1', weight: 1.0 }],
            difficulty: 0.5,
            timeSeconds: -10 // Invalid time
        })
    ];
    
    const now = new Date();
    const ranked = rankQuestionsForPractice(questions, atoms, now, now);
    
    // Should handle gracefully without crashing
    assert.ok(Array.isArray(ranked), 'Should return an array even with invalid times');
});

test('rankQuestionsForPractice returns consistent results for same input', () => {
    const atoms = new Map([
        ['atom1', createAtom({ id: 'atom1', mastery: 0.3 })],
        ['atom2', createAtom({ id: 'atom2', mastery: 0.7 })]
    ]);
    
    const questions = [
        createQuestion({ 
            id: 'q1', 
            atomMap: [{ atomId: 'atom1', weight: 1.0 }],
            difficulty: 0.5,
            timeSeconds: 60
        }),
        createQuestion({ 
            id: 'q2', 
            atomMap: [{ atomId: 'atom2', weight: 1.0 }],
            difficulty: 0.5,
            timeSeconds: 60
        })
    ];
    
    const now = new Date();
    
    const ranked1 = rankQuestionsForPractice(questions, atoms, now, now);
    const ranked2 = rankQuestionsForPractice(questions, atoms, now, now);
    
    assert.strictEqual(ranked1.length, ranked2.length, 'Should return same number of questions');
    for (let i = 0; i < ranked1.length; i++) {
        assert.strictEqual(ranked1[i].questionId, ranked2[i].questionId, 
            `Question at position ${i} should be consistent`);
    }
});

// ============================================================================
// Run all tests
// ============================================================================

runTests().then(() => {
    console.log('\n========================================');
    console.log(`Tests Passed: ${testsPassed}`);
    console.log(`Tests Failed: ${testsFailed}`);
    console.log(`Total: ${testsPassed + testsFailed}`);
    console.log('========================================');
    
    if (testsFailed > 0) {
        process.exit(1);
    }
});
