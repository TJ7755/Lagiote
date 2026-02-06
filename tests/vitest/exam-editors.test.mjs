/**
 * Exam Editors Tests
 * 
 * Tests atom editor, question editor, and mark scheme editor.
 */

import { describe, it, expect } from 'vitest';
import {
    createAtomEditor,
    createQuestionEditor,
    createMarkSchemeEditor,
    createEditorSuite
} from '../../js/core/exam/editors.js';

describe('Exam Editors - Atom Editor', () => {
    it('creates atom with defaults', () => {
        const editor = createAtomEditor();
        const atom = editor.getAtom();
        
        expect(atom.id).toBeDefined();
        expect(atom.mastery).toBe(0);
        expect(atom.type).toBe('knowledge');
    });
    
    it('loads initial atom', () => {
        const initial = {
            id: 'test-atom',
            name: 'Test',
            mastery: 0.8
        };
        
        const editor = createAtomEditor(initial);
        const atom = editor.getAtom();
        
        expect(atom.name).toBe('Test');
        expect(atom.mastery).toBe(0.8);
    });
    
    it('updates fields', () => {
        const editor = createAtomEditor();
        
        editor.updateField('name', 'New Name');
        
        expect(editor.getAtom().name).toBe('New Name');
        expect(editor.getAtom().updatedAt).toBeDefined();
    });
    
    it('adds and removes prerequisites', () => {
        const editor = createAtomEditor();
        
        editor.addPrerequisite('prereq-1', 0.8);
        expect(editor.getAtom().prerequisites).toHaveLength(1);
        expect(editor.getAtom().prerequisites[0].weight).toBe(0.8);
        
        editor.removePrerequisite('prereq-1');
        expect(editor.getAtom().prerequisites).toHaveLength(0);
    });
    
    it('prevents duplicate prerequisites', () => {
        const editor = createAtomEditor();
        
        editor.addPrerequisite('prereq-1');
        editor.addPrerequisite('prereq-1');
        
        expect(editor.getAtom().prerequisites).toHaveLength(1);
    });
    
    it('adds and removes tags', () => {
        const editor = createAtomEditor();
        
        editor.addTag('physics');
        editor.addTag('mechanics');
        expect(editor.getAtom().tags).toHaveLength(2);
        
        editor.removeTag('physics');
        expect(editor.getAtom().tags).toEqual(['mechanics']);
    });
    
    it('validates name field', () => {
        const editor = createAtomEditor();
        
        editor.updateField('name', '');
        const isValid = editor.validate();
        
        expect(isValid).toBe(false);
        expect(editor.hasError('name')).toBe(true);
    });
    
    it('validates mastery range', () => {
        const editor = createAtomEditor();
        
        editor.updateField('mastery', 1.5);
        editor.validate();
        
        expect(editor.hasError('mastery')).toBe(true);
    });
    
    it('tracks dirty state', () => {
        const editor = createAtomEditor();
        
        expect(editor.getState().isDirty).toBe(false);
        
        editor.updateField('name', 'Changed');
        expect(editor.getState().isDirty).toBe(true);
    });
    
    it('resets to initial state', () => {
        const initial = { id: 'test', name: 'Original' };
        const editor = createAtomEditor(initial);
        
        editor.updateField('name', 'Changed');
        editor.reset();
        
        expect(editor.getAtom().name).toBe('Original');
        expect(editor.getState().isDirty).toBe(false);
    });
});

describe('Exam Editors - Question Editor', () => {
    it('creates question with defaults', () => {
        const editor = createQuestionEditor();
        const question = editor.getQuestion();
        
        expect(question.id).toBeDefined();
        expect(question.type).toBe('mcq_single');
    });
    
    it('sets available atoms', () => {
        const editor = createQuestionEditor();
        const atoms = [
            { id: 'a1', name: 'Atom 1' },
            { id: 'a2', name: 'Atom 2' }
        ];
        
        editor.setAvailableAtoms(atoms);
        
        expect(editor.getAvailableAtoms()).toHaveLength(2);
    });
    
    it('filters deleted atoms', () => {
        const editor = createQuestionEditor();
        const atoms = [
            { id: 'a1', name: 'Active' },
            { id: 'a2', name: 'Deleted', isDeleted: true }
        ];
        
        editor.setAvailableAtoms(atoms);
        
        expect(editor.getAvailableAtoms()).toHaveLength(1);
    });
    
    it('changes question type', () => {
        const editor = createQuestionEditor();
        
        editor.setType('numeric');
        
        expect(editor.getQuestion().type).toBe('numeric');
    });
    
    it('initializes options for MCQ', () => {
        const editor = createQuestionEditor();
        
        editor.setType('mcq_single');
        
        expect(editor.getQuestion().options).toHaveLength(4);
    });
    
    it('updates options', () => {
        const editor = createQuestionEditor();
        editor.setType('mcq_single');
        
        editor.updateOption(0, 'Option A');
        
        expect(editor.getQuestion().options[0]).toBe('Option A');
    });
    
    it('adds and removes atom mappings', () => {
        const editor = createQuestionEditor();
        
        editor.addAtomMapping('atom-1', 1.0);
        editor.addAtomMapping('atom-2', 0.5);
        
        expect(editor.getQuestion().atomMap).toHaveLength(2);
        expect(editor.getQuestion().atomIds).toContain('atom-1');
        expect(editor.getQuestion().atomIds).toContain('atom-2');
        
        editor.removeAtomMapping('atom-1');
        expect(editor.getQuestion().atomMap).toHaveLength(1);
    });
    
    it('updates existing atom mapping', () => {
        const editor = createQuestionEditor();
        
        editor.addAtomMapping('atom-1', 1.0);
        editor.addAtomMapping('atom-1', 0.5);
        
        expect(editor.getQuestion().atomMap).toHaveLength(1);
        expect(editor.getQuestion().atomMap[0].weight).toBe(0.5);
    });
    
    it('sets time profile', () => {
        const editor = createQuestionEditor();
        
        editor.setTimeProfile({ expectedSeconds: 120 });
        
        expect(editor.getQuestion().timeProfile.expectedSeconds).toBe(120);
    });
    
    it('links mark scheme', () => {
        const editor = createQuestionEditor();
        
        editor.linkMarkScheme('ms-123');
        
        expect(editor.getQuestion().markSchemeId).toBe('ms-123');
    });
    
    it('validates prompt length', () => {
        const editor = createQuestionEditor();
        
        editor.updateField('prompt', 'Hi');
        editor.validate();
        
        expect(editor.hasError('prompt')).toBe(true);
    });
    
    it('validates MCQ options', () => {
        const editor = createQuestionEditor();
        editor.setType('mcq_single');
        editor.updateField('prompt', 'Valid question prompt here');
        editor.updateField('options', ['', '', '', '']); // Empty options
        
        editor.validate();
        
        expect(editor.hasError('options')).toBe(true);
    });
});

describe('Exam Editors - Mark Scheme Editor', () => {
    it('creates scheme with defaults', () => {
        const editor = createMarkSchemeEditor();
        const scheme = editor.getScheme();
        
        expect(scheme.id).toBeDefined();
        expect(scheme.schemeType).toBe('points');
    });
    
    it('changes scheme type', () => {
        const editor = createMarkSchemeEditor();
        
        editor.setType('rubric');
        
        expect(editor.getScheme().schemeType).toBe('rubric');
    });
    
    it('adds points', () => {
        const editor = createMarkSchemeEditor();
        
        const point = editor.addPoint({ id: 'M1', marks: 1 });
        
        expect(point.id).toBe('M1');
        expect(editor.getScheme().points).toHaveLength(1);
    });
    
    it('updates points', () => {
        const editor = createMarkSchemeEditor();
        editor.addPoint({ id: 'M1', marks: 1 });
        
        editor.updatePoint('M1', { marks: 2, condition: 'New condition' });
        
        const point = editor.getScheme().points[0];
        expect(point.marks).toBe(2);
        expect(point.condition).toBe('New condition');
    });
    
    it('removes points and cleans up dependencies', () => {
        const editor = createMarkSchemeEditor();
        editor.addPoint({ id: 'M1', marks: 1 });
        editor.addPoint({ id: 'M2', marks: 1, requires: ['M1'] });
        
        editor.removePoint('M1');
        
        expect(editor.getScheme().points).toHaveLength(1);
        // M2's requires should be cleaned up
        expect(editor.getScheme().points[0].requires).toHaveLength(0);
    });
    
    it('adds dependencies', () => {
        const editor = createMarkSchemeEditor();
        editor.addPoint({ id: 'M1', marks: 1 });
        editor.addPoint({ id: 'A1', marks: 1 });
        
        editor.addDependency('A1', 'M1');
        
        const a1 = editor.getScheme().points.find(p => p.id === 'A1');
        expect(a1.requires).toContain('M1');
    });
    
    it('sets point grading', () => {
        const editor = createMarkSchemeEditor();
        editor.addPoint({ id: 'N1', marks: 1 });
        
        editor.setPointGrading('N1', { kind: 'numeric', value: 42 });
        
        const point = editor.getScheme().points[0];
        expect(point.grading.kind).toBe('numeric');
        expect(point.grading.value).toBe(42);
    });
    
    it('sets point atom links', () => {
        const editor = createMarkSchemeEditor();
        editor.addPoint({ id: 'M1', marks: 1 });
        
        editor.setPointAtomLinks('M1', [
            { atomId: 'atom-1', weight: 1.0 },
            { atomId: 'atom-2', weight: 0.5 }
        ]);
        
        const point = editor.getScheme().points[0];
        expect(point.atomLinks).toHaveLength(2);
    });
    
    it('calculates total marks', () => {
        const editor = createMarkSchemeEditor();
        editor.addPoint({ id: 'M1', marks: 2 });
        editor.addPoint({ id: 'A1', marks: 3 });
        
        expect(editor.getTotalMarks()).toBe(5);
    });
    
    it('validates scheme', () => {
        const editor = createMarkSchemeEditor();
        editor.addPoint({ id: 'M1', marks: 1 });
        
        editor.validate();
        
        expect(editor.getState().isValid).toBe(true);
    });
    
    it('detects validation errors', () => {
        const editor = createMarkSchemeEditor();
        editor.addPoint({ marks: 1 }); // No ID
        
        editor.validate();
        
        expect(editor.getState().isValid).toBe(false);
        expect(editor.getState().hasErrors).toBe(true);
    });
    
    it('generates editor HTML', () => {
        const editor = createMarkSchemeEditor();
        editor.addPoint({ id: 'M1', marks: 1 });
        
        const html = editor.renderEditorHTML();
        
        expect(html).toContain('mark-scheme-editor');
        expect(html).toContain('M1');
    });
});

describe('Exam Editors - Editor Suite', () => {
    it('creates all three editors', () => {
        const suite = createEditorSuite();
        
        const atomEditor = suite.createAtomEditor();
        const questionEditor = suite.createQuestionEditor();
        const markSchemeEditor = suite.createMarkSchemeEditor();
        
        expect(atomEditor).toBeDefined();
        expect(questionEditor).toBeDefined();
        expect(markSchemeEditor).toBeDefined();
    });
    
    it('retrieves editors', () => {
        const suite = createEditorSuite();
        
        suite.createAtomEditor();
        suite.createQuestionEditor();
        suite.createMarkSchemeEditor();
        
        const editors = suite.getEditors();
        
        expect(editors.atom).toBeDefined();
        expect(editors.question).toBeDefined();
        expect(editors.markScheme).toBeDefined();
    });
    
    it('links editors for testing', () => {
        const suite = createEditorSuite();
        
        suite.createQuestionEditor();
        suite.createMarkSchemeEditor();
        
        suite.linkForTesting();
        
        // Test harness should be set up
        expect(() => suite.linkForTesting()).not.toThrow();
    });
});
