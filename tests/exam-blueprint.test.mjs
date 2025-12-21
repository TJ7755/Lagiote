import { validateBlueprint, normaliseBlueprint, DEFAULT_BLUEPRINT_EXAM_INDICATIVE } from '../js/core/exam-blueprint.js';
import assert from 'assert';

console.log('Running Exam Blueprint Tests...');

// Test 1: Validation of Default Blueprint
{
    const result = validateBlueprint(DEFAULT_BLUEPRINT_EXAM_INDICATIVE);
    assert.strictEqual(result.ok, true, 'Default exam blueprint should be valid');
    assert.strictEqual(result.errors.length, 0, 'Should have no errors');
}

// Test 2: Invalid Blueprint (Exam Mode with Feedback)
{
    const invalid = {
        ...DEFAULT_BLUEPRINT_EXAM_INDICATIVE,
        feedback: { ...DEFAULT_BLUEPRINT_EXAM_INDICATIVE.feedback, showDuringTest: true }
    };
    const result = validateBlueprint(invalid);
    assert.strictEqual(result.ok, false, 'Exam mode with feedback should be invalid');
    assert.ok(result.errors.some(e => e.includes('feedback')), 'Should report feedback error');
}

// Test 3: Normalization
{
    const partial = {
        name: 'My Test',
        mode: 'exam_indicative',
        durationMinutes: 10000 // Should be clamped
    };
    const normalized = normaliseBlueprint(partial);
    assert.strictEqual(normalized.durationMinutes, 1440, 'Duration should be clamped to max');
    assert.strictEqual(normalized.scoring.strictMarking, true, 'Should inherit defaults');
}

console.log('Exam Blueprint Tests Passed!');
