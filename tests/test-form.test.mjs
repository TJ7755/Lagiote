import { generateTestForm } from '../js/core/test-form.js';
import { DEFAULT_BLUEPRINT_EXAM_INDICATIVE } from '../js/core/exam-blueprint.js';
import assert from 'assert';

console.log('Running Test Form Generation Tests...');

const mockDecks = {
    'deck1': {
        cards: [
            { id: 'c1', question: 'Q1', answer: 'A1', type: 'mcq', tags: ['topicA'] },
            { id: 'c2', question: 'Q2', answer: 'A2', type: 'mcq', tags: ['topicB'] },
            { id: 'c3', question: 'Q3', answer: 'A3', type: 'mcq', tags: ['topicA'] }
        ]
    }
};

// Test 1: Basic Generation
{
    const blueprint = {
        ...DEFAULT_BLUEPRINT_EXAM_INDICATIVE,
        selection: { selectedDeckIds: ['deck1'] },
        composition: {
            ...DEFAULT_BLUEPRINT_EXAM_INDICATIVE.composition,
            sections: [{ id: 's1', marks: 2, types: ['mcq'] }]
        }
    };

    const form = await generateTestForm(blueprint, mockDecks);
    assert.strictEqual(form.sections.length, 1, 'Should have 1 section');
    assert.ok(form.sections[0].items.length >= 1, 'Should have items');
    assert.ok(form.sections[0].items.length <= 3, 'Should not exceed available items');
}

// Test 2: Deterministic Seed
{
    const blueprint = {
        ...DEFAULT_BLUEPRINT_EXAM_INDICATIVE,
        selection: { selectedDeckIds: ['deck1'] },
        generation: { seed: 'fixed-seed' }
    };

    const form1 = await generateTestForm(blueprint, mockDecks);
    const form2 = await generateTestForm(blueprint, mockDecks);

    assert.strictEqual(form1.seed, 'fixed-seed');
    assert.deepStrictEqual(form1.sections[0].items.map(i => i.cardId), form2.sections[0].items.map(i => i.cardId), 'Should be deterministic');
}

// Test 3: Question Count Cap
{
    const blueprint = {
        ...DEFAULT_BLUEPRINT_EXAM_INDICATIVE,
        selection: { selectedDeckIds: ['deck1'] },
        composition: {
            ...DEFAULT_BLUEPRINT_EXAM_INDICATIVE.composition,
            sections: [{ id: 's1', marks: 100, types: ['mcq'], questionCount: 2 }]
        },
        generation: { seed: 'limit-seed' }
    };

    const form = await generateTestForm(blueprint, mockDecks);
    assert.strictEqual(form.sections[0].items.length, 2, 'Question count should cap items');
}

// Test 4: Marks Cap Overrides Question Count
{
    const blueprint = {
        ...DEFAULT_BLUEPRINT_EXAM_INDICATIVE,
        selection: { selectedDeckIds: ['deck1'] },
        composition: {
            ...DEFAULT_BLUEPRINT_EXAM_INDICATIVE.composition,
            sections: [{ id: 's1', marks: 1, types: ['mcq'], questionCount: 10 }]
        },
        generation: { seed: 'marks-seed' }
    };

    const form = await generateTestForm(blueprint, mockDecks);
    assert.strictEqual(form.sections[0].items.length, 1, 'Marks cap should limit items');
}

// Test 5: Small Deck MCQ Degrades to Recall
{
    const smallDecks = {
        small: {
            cards: [
                { id: 'a1', question: 'Q1', answer: 'A1', type: 'mcq' },
                { id: 'a2', question: 'Q2', answer: 'A2', type: 'mcq' }
            ]
        }
    };
    const blueprint = {
        ...DEFAULT_BLUEPRINT_EXAM_INDICATIVE,
        selection: { selectedDeckIds: ['small'] },
        composition: {
            ...DEFAULT_BLUEPRINT_EXAM_INDICATIVE.composition,
            sections: [{ id: 's1', marks: 2, types: ['mcq'] }],
            questionRules: {
                ...DEFAULT_BLUEPRINT_EXAM_INDICATIVE.composition.questionRules,
                mcqOptionCount: 4
            }
        },
        generation: { seed: 'small-deck' }
    };

    const form = await generateTestForm(blueprint, smallDecks);
    assert.ok(form.sections[0].items.every(item => item.type === 'type'), 'MCQs should downgrade to recall');
}

console.log('Test Form Generation Tests Passed!');
