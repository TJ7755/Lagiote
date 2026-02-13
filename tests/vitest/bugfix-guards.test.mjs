/**
 * Bugfix Guards Tests
 *
 * Tests for specific bug fixes:
 * - Empty-phases guard in exam-session-player (currentPhaseIndex >= 0)
 * - Deep clone in question editor reset (no mutation of initialQuestion)
 * - Deep clone in mark scheme editor reset (no mutation of initialScheme)
 */

import { describe, it, expect, afterEach } from 'vitest';
import {
    initSessionPlayer,
    nextQuestion,
    getPlayerState,
    destroySessionPlayer
} from '../../js/core/exam/exam-session-player.js';
import { createQuestion } from '../../js/core/exam/exam-mode.js';
import {
    createQuestionEditor,
    createMarkSchemeEditor
} from '../../js/core/exam/editors.js';

describe('exam-session-player empty phases guard', () => {
    afterEach(() => {
        destroySessionPlayer();
    });

    it('sets currentPhaseIndex to 0 when phases array is empty', () => {
        const session = {
            phases: [],
            totalMinutes: 10
        };

        initSessionPlayer(session, []);
        const state = getPlayerState();

        // With no phases, currentPhaseIndex should be 0 (not -1)
        expect(state.currentPhaseIndex).toBeGreaterThanOrEqual(0);
    });

    it('handles navigation with a single-phase session', () => {
        const session = {
            phases: [{ type: 'main', name: 'Main', questions: ['q1'] }],
            totalMinutes: 10
        };
        const questions = [createQuestion({ id: 'q1', prompt: 'Q1' })];

        initSessionPlayer(session, questions);
        // Moving next from last question should not crash
        const result = nextQuestion();
        expect(result.success).toBe(false);
        expect(result.reason).toBe('at_end');
    });
});

describe('question editor deep clone on reset', () => {
    it('does not mutate the original initialQuestion on reset after edits', () => {
        const initial = {
            id: 'q-original',
            prompt: 'Original prompt',
            type: 'mcq_single',
            options: ['A', 'B', 'C'],
            atomMap: [{ atomId: 'a1', weight: 1 }]
        };

        const editor = createQuestionEditor(initial);

        // Modify via editor
        editor.updateField('prompt', 'Modified prompt');
        editor.updateOption(0, 'Modified A');

        // Reset should restore to original values
        editor.reset();

        const question = editor.getQuestion();
        expect(question.prompt).toBe('Original prompt');
        expect(question.options[0]).toBe('A');

        // Original object must not have been mutated
        expect(initial.prompt).toBe('Original prompt');
        expect(initial.options[0]).toBe('A');
    });

    it('handles reset with nested atomMap without mutation', () => {
        const initial = {
            id: 'q-nested',
            prompt: 'Test',
            atomMap: [{ atomId: 'a1', weight: 0.5 }]
        };

        const editor = createQuestionEditor(initial);
        editor.addAtomMapping('a2', 0.8);

        editor.reset();

        const question = editor.getQuestion();
        // atomMap should be restored (deep clone)
        expect(question.atomMap).toEqual([{ atomId: 'a1', weight: 0.5 }]);
        // Original should be unchanged
        expect(initial.atomMap).toEqual([{ atomId: 'a1', weight: 0.5 }]);
    });
});

describe('mark scheme editor deep clone on reset', () => {
    it('does not mutate the original initialScheme on reset after edits', () => {
        const initial = {
            id: 'ms-original',
            schemeType: 'points',
            points: [
                { id: 'M1', marks: 2, condition: 'Shows method' }
            ]
        };

        const editor = createMarkSchemeEditor(initial);

        // Modify via editor
        editor.addPoint({ id: 'M2', marks: 1, condition: 'Gets answer' });

        // Reset should restore
        editor.reset();

        const scheme = editor.getScheme();
        expect(scheme.points).toHaveLength(1);
        expect(scheme.points[0].id).toBe('M1');

        // Original should not be mutated
        expect(initial.points).toHaveLength(1);
    });
});
