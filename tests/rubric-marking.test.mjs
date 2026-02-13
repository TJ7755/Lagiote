import assert from 'assert';
import { gradeQuestion, createMarkScheme } from '../js/core/exam/marking.js';

async function runRubricTests() {
    console.log('Running Rubric and ECF marking tests...');

    // Test 1: Rubric Scheme
    const question = {
        id: 'q1',
        type: 'short_text',
        marksAvailable: 3
    };

    const markScheme = createMarkScheme({
        id: 's1',
        schemeType: 'rubric',
        levels: [
            { id: 'l1', level: 1, marks: 1, descriptor: 'Basic understanding' },
            { id: 'l2', level: 2, marks: 2, descriptor: 'Good understanding' },
            { id: 'l3', level: 3, marks: 3, descriptor: 'Excellent understanding' }
        ]
    });

    const response = {
        selectedLevelId: 'l2',
        comment: 'Satisfactory answer'
    };

    const result = gradeQuestion({ question, markScheme, response });
    
    assert.strictEqual(result.totalAwardedMarks, 2, 'Rubric marks should match awarded level marks');
    assert.strictEqual(result.totalAwardedMarks / question.marksAvailable, 2/3, 'Score should be relative to marksAvailable');
    console.log('[PASS] Rubric scheme basic grading');

    // Test 2: Error Carried Forward (ECF) logic - Points based
    const pointScheme = createMarkScheme({
        schemeType: 'points',
        points: [
            { id: 'p1', marks: 1, condition: 'Step 1 correct', requires: [] },
            { id: 'p2', marks: 1, condition: 'Step 2 correct', requires: ['p1'], allowECF: true }
        ]
    });

    // Case: p1 is wrong, p2 is right but depends on p1 -> Should be ECF if flag is set
    const responseECF = {
        pointsAwarded: ['p2'] // User got p2 right but not p1
    };

    const resultECF = gradeQuestion({ 
        question, 
        markScheme: pointScheme, 
        response: responseECF,
        context: { allowECF: true } // This context flag is what my code checks
    });

    assert.strictEqual(resultECF.totalAwardedMarks, 1, 'Marks awarded if ECF is on even if dependencies fail');
    assert.ok(resultECF.awardedPoints.find(pr => pr.pointId === 'p2').isECF, 'Point should be marked as ECF');
    console.log('[PASS] Error Carried Forward (ECF) logic');

    console.log('All rubric and ECF tests passed!\n');
}

runRubricTests().catch(err => {
    console.error('Test suite failed:', err);
    process.exit(1);
});
