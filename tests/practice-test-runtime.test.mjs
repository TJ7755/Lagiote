import assert from 'assert';
import { buildPracticeTestBlueprint, getPracticeTestModeFlags, appendPracticeTestAttempt } from '../js/core/practice-test-runtime.js';
import { normaliseBlueprint, validateBlueprint } from '../js/core/exam-blueprint.js';
import { generateTestForm } from '../js/core/test-form.js';

console.log('Running Practice Test Runtime Tests...');

const mockDecks = {
    deck1: {
        cards: [
            { id: 'c1', question: 'Q1', answer: 'A1', type: 'mcq' },
            { id: 'c2', question: 'Q2', answer: 'A2', type: 'mcq' },
            { id: 'c3', question: 'Q3', answer: 'A3', type: 'mcq' },
            { id: 'c4', question: 'Q4', answer: 'A4', type: 'mcq' }
        ]
    }
};

const baseSettings = {
    durationMinutes: 45,
    totalMarks: 3,
    questionCount: 3,
    allowBack: true,
    showTimer: true,
    strictMarking: true,
    confidenceIntervalEnabled: true,
    deckId: 'deck1',
    seed: 'seed-1'
};

{
    const blueprint = buildPracticeTestBlueprint({ ...baseSettings, mode: 'exam_indicative' });
    const normalized = normaliseBlueprint(blueprint);
    const result = validateBlueprint(normalized);
    assert.strictEqual(result.ok, true, 'Exam blueprint should validate');
}

{
    const blueprint = buildPracticeTestBlueprint({ ...baseSettings, mode: 'free_practice', strictMarking: false, confidenceIntervalEnabled: false });
    const normalized = normaliseBlueprint(blueprint);
    const result = validateBlueprint(normalized);
    assert.strictEqual(result.ok, true, 'Free practice blueprint should validate');
    assert.strictEqual(normalized.mode, 'free_practice');
}

{
    const blueprint = normaliseBlueprint(buildPracticeTestBlueprint({ ...baseSettings, mode: 'exam_indicative', seed: 'fixed-seed' }));
    const form1 = await generateTestForm(blueprint, mockDecks);
    const form2 = await generateTestForm(blueprint, mockDecks);
    assert.deepStrictEqual(
        form1.sections[0].items.map(item => item.cardId),
        form2.sections[0].items.map(item => item.cardId),
        'Seeded forms should be deterministic'
    );
}

{
    const flags = getPracticeTestModeFlags('exam_indicative');
    assert.strictEqual(flags.allowFeedback, false);
    assert.strictEqual(flags.showCorrectness, false);
    assert.strictEqual(flags.showRunningScore, false);
    assert.strictEqual(flags.submitOnSelect, true);
}

{
    let record = null;
    for (let i = 0; i < 51; i += 1) {
        record = appendPracticeTestAttempt(record, { attemptId: `attempt_${i}` });
    }
    assert.strictEqual(record.attempts.length, 50);
    assert.strictEqual(record.attempts[0].attemptId, 'attempt_50');
    assert.strictEqual(record.attempts[49].attemptId, 'attempt_1');
}

{
    const form = {
        sections: [
            { id: 's1', items: [{ cardId: 'c2' }, { cardId: 'c1' }] },
            { id: 's2', items: [{ cardId: 'c3' }] }
        ]
    };
    const record = appendPracticeTestAttempt(null, { attemptId: 'order-1', form });
    const stored = record.attempts[0];
    assert.ok(Array.isArray(stored.itemOrder) || Array.isArray(stored.flatItems), 'Attempt should persist item order');
    const order = Array.isArray(stored.itemOrder)
        ? stored.itemOrder
        : stored.flatItems.map(item => item.cardId);
    assert.deepStrictEqual(order, ['c2', 'c1', 'c3']);
}

console.log('Practice Test Runtime Tests Passed!');
