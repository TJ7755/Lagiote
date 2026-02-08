/**
 * Exam Mode Editors - Atom, Question, and Mark Scheme Editors
 * 
 * Provides UI generation and state management for:
 * - Atom Editor (create/edit atoms with dimensions)
 * - Question Editor (question authoring with atom mapping)
 * - Mark Scheme Editor (points/rubric builder with test harness)
 */

import { generateUUID, createAtom, createErrorAtom, createQuestion, createExamSpec } from './exam-mode.js';
import { createMarkScheme, createPointsSchemePoint } from './marking.js';
import { createMarkSchemeTestHarness } from './mark-scheme-test-harness.js';
import { validateMarkScheme } from './calibration-harness.js';

// --- Atom Editor ---

/**
 * Creates an atom editor state manager.
 * @param {Object} initialAtom Optional initial atom data
 * @returns {Object} Atom editor interface
 */
export function createAtomEditor(initialAtom = null) {
    // Deep-copy initial atom to prevent mutation
    const initialSnapshot = initialAtom ? JSON.parse(JSON.stringify(initialAtom)) : null;
    
    function cloneInitial() {
        return initialSnapshot ? { ...createAtom({}), ...JSON.parse(JSON.stringify(initialSnapshot)) } : createAtom({});
    }
    
    const state = {
        atom: cloneInitial(),
        isValid: false,
        errors: [],
        touched: new Set()
    };
    
    const validators = {
        name: (v) => !v || v.length < 2 ? 'Name must be at least 2 characters' : null,
        mastery: (v) => v < 0 || v > 1 ? 'Mastery must be between 0 and 1' : null,
        stabilityDays: (v) => v < 0 ? 'Stability must be non-negative' : null
    };
    
    return {
        /**
         * Gets current atom data.
         * @returns {Object} Atom data
         */
        getAtom() {
            return { ...state.atom };
        },
        
        /**
         * Updates an atom field.
         * @param {string} field Field name
         * @param {*} value New value
         */
        updateField(field, value) {
            state.touched.add(field);
            
            // Handle nested fields
            if (field.includes('.')) {
                const [parent, child] = field.split('.');
                state.atom[parent] = { ...state.atom[parent], [child]: value };
            } else {
                state.atom[field] = value;
            }
            
            // Update atom timestamp
            state.atom.updatedAt = new Date().toISOString();
            
            this.validate();
        },
        
        /**
         * Adds a prerequisite.
         * @param {string} atomId Prerequisite atom ID
         * @param {number} weight Weight (0-1)
         */
        addPrerequisite(atomId, weight = 1) {
            const prereqs = [...(state.atom.prerequisites || [])];
            if (!prereqs.some(p => p.atomId === atomId)) {
                prereqs.push({ atomId, weight });
                state.atom.prerequisites = prereqs;
                state.atom.updatedAt = new Date().toISOString();
            }
        },
        
        /**
         * Removes a prerequisite.
         * @param {string} atomId Prerequisite atom ID
         */
        removePrerequisite(atomId) {
            state.atom.prerequisites = (state.atom.prerequisites || [])
                .filter(p => p.atomId !== atomId);
            state.atom.updatedAt = new Date().toISOString();
        },
        
        /**
         * Adds a tag.
         * @param {string} tag Tag to add
         */
        addTag(tag) {
            const tags = new Set(state.atom.tags || []);
            tags.add(tag);
            state.atom.tags = Array.from(tags);
        },
        
        /**
         * Removes a tag.
         * @param {string} tag Tag to remove
         */
        removeTag(tag) {
            state.atom.tags = (state.atom.tags || []).filter(t => t !== tag);
        },
        
        /**
         * Validates the atom.
         * @returns {boolean} Whether valid
         */
        validate() {
            state.errors = [];
            
            Object.entries(validators).forEach(([field, validator]) => {
                const error = validator(state.atom[field]);
                if (error && state.touched.has(field)) {
                    state.errors.push({ field, message: error });
                }
            });
            
            state.isValid = state.errors.length === 0 && state.touched.has('name');
            return state.isValid;
        },
        
        /**
         * Gets validation errors.
         * @returns {Array} Errors
         */
        getErrors() {
            return [...state.errors];
        },
        
        /**
         * Checks if field has error.
         * @param {string} field Field name
         * @returns {boolean} Has error
         */
        hasError(field) {
            return state.errors.some(e => e.field === field);
        },
        
        /**
         * Gets field error message.
         * @param {string} field Field name
         * @returns {string|null} Error message
         */
        getFieldError(field) {
            const error = state.errors.find(e => e.field === field);
            return error?.message || null;
        },
        
        /**
         * Resets to initial state.
         */
        reset() {
            state.atom = cloneInitial();
            state.touched.clear();
            state.errors = [];
            state.isValid = false;
        },
        
        /**
         * Gets editor state.
         * @returns {Object} State object
         */
        getState() {
            return {
                atom: { ...state.atom },
                isValid: state.isValid,
                hasErrors: state.errors.length > 0,
                isDirty: state.touched.size > 0
            };
        }
    };
}

// --- Question Editor ---

/**
 * Creates a question editor state manager.
 * @param {Object} initialQuestion Optional initial question
 * @returns {Object} Question editor interface
 */
export function createQuestionEditor(initialQuestion = null) {
    // Deep-copy initial question to prevent mutation
    const initialSnapshot = initialQuestion ? JSON.parse(JSON.stringify(initialQuestion)) : null;

    function cloneInitial() {
        return initialSnapshot ? { ...createQuestion({ type: 'mcq_single' }), ...JSON.parse(JSON.stringify(initialSnapshot)) } : createQuestion({ type: 'mcq_single' });
    }

    const state = {
        question: cloneInitial(),
        availableAtoms: [],
        isValid: false,
        errors: [],
        touched: new Set()
    };
    
    return {
        /**
         * Gets current question.
         * @returns {Object} Question data
         */
        getQuestion() {
            return { ...state.question };
        },
        
        /**
         * Sets available atoms for mapping.
         * @param {Array} atoms Array of available atoms
         */
        setAvailableAtoms(atoms) {
            state.availableAtoms = atoms.filter(a => !a.isDeleted);
        },
        
        /**
         * Updates a question field.
         * @param {string} field Field name
         * @param {*} value New value
         */
        updateField(field, value) {
            state.touched.add(field);
            state.question[field] = value;
            state.question.updatedAt = new Date().toISOString();
            this.validate();
        },
        
        /**
         * Sets question type (resets type-specific fields).
         * @param {string} type New type
         */
        setType(type) {
            state.touched.add('type');
            state.question.type = type;
            
            // Reset type-specific fields
            if (type === 'mcq_single' || type === 'mcq_multi') {
                if (!state.question.options || state.question.options.length === 0) {
                    state.question.options = ['', '', '', ''];
                }
            } else {
                state.question.options = [];
            }
            
            state.question.updatedAt = new Date().toISOString();
            this.validate();
        },
        
        /**
         * Updates an option.
         * @param {number} index Option index
         * @param {string} text Option text
         */
        updateOption(index, text) {
            const options = [...(state.question.options || [])];
            options[index] = text;
            state.question.options = options;
            state.question.updatedAt = new Date().toISOString();
        },
        
        /**
         * Adds an atom mapping.
         * @param {string} atomId Atom ID
         * @param {number} weight Weight (0-1)
         */
        addAtomMapping(atomId, weight = 1) {
            const atomMap = [...(state.question.atomMap || [])];
            const existing = atomMap.findIndex(m => m.atomId === atomId);
            
            if (existing >= 0) {
                atomMap[existing].weight = weight;
            } else {
                atomMap.push({ atomId, weight });
            }
            
            state.question.atomMap = atomMap;
            state.question.atomIds = atomMap.map(m => m.atomId);
            state.question.updatedAt = new Date().toISOString();
        },
        
        /**
         * Removes an atom mapping.
         * @param {string} atomId Atom ID
         */
        removeAtomMapping(atomId) {
            const atomMap = (state.question.atomMap || []).filter(m => m.atomId !== atomId);
            state.question.atomMap = atomMap;
            state.question.atomIds = atomMap.map(m => m.atomId);
            state.question.updatedAt = new Date().toISOString();
        },
        
        /**
         * Sets time profile.
         * @param {Object} timeProfile Time profile
         */
        setTimeProfile(timeProfile) {
            state.question.timeProfile = {
                ...state.question.timeProfile,
                ...timeProfile
            };
            state.question.updatedAt = new Date().toISOString();
        },
        
        /**
         * Links to a mark scheme.
         * @param {string} markSchemeId Mark scheme ID
         */
        linkMarkScheme(markSchemeId) {
            state.question.markSchemeId = markSchemeId;
            state.question.updatedAt = new Date().toISOString();
        },
        
        /**
         * Validates the question.
         * @returns {boolean} Whether valid
         */
        validate() {
            state.errors = [];
            
            if (state.touched.has('prompt') && (!state.question.prompt || state.question.prompt.length < 5)) {
                state.errors.push({ field: 'prompt', message: 'Prompt must be at least 5 characters' });
            }
            
            if ((state.question.type === 'mcq_single' || state.question.type === 'mcq_multi') &&
                state.touched.has('options')) {
                const validOptions = (state.question.options || []).filter(o => o.length > 0).length;
                if (validOptions < 2) {
                    state.errors.push({ field: 'options', message: 'Need at least 2 valid options' });
                }
            }
            
            state.isValid = state.errors.length === 0 && state.touched.has('prompt');
            return state.isValid;
        },

        /**
         * Checks if field has error.
         * @param {string} field Field name
         * @returns {boolean} Has error
         */
        hasError(field) {
            return state.errors.some(e => e.field === field);
        },

        /**
         * Gets field error message.
         * @param {string} field Field name
         * @returns {string|null} Error message
         */
        getFieldError(field) {
            const error = state.errors.find(e => e.field === field);
            return error?.message || null;
        },
        
        /**
         * Gets available atoms.
         * @returns {Array} Available atoms
         */
        getAvailableAtoms() {
            return [...state.availableAtoms];
        },
        
        /**
         * Gets mapped atoms with details.
         * @returns {Array} Mapped atoms with full data
         */
        getMappedAtoms() {
            const atomMap = state.question.atomMap || [];
            return atomMap.map(mapping => {
                const atom = state.availableAtoms.find(a => a.id === mapping.atomId);
                return { ...mapping, atom: atom || { name: 'Unknown', id: mapping.atomId } };
            });
        },
        
        /**
         * Resets editor.
         */
        reset() {
            state.question = cloneInitial();
            state.touched.clear();
            state.errors = [];
            state.isValid = false;
        },
        
        /**
         * Gets editor state.
         * @returns {Object} State
         */
        getState() {
            return {
                question: { ...state.question },
                isValid: state.isValid,
                hasErrors: state.errors.length > 0,
                isDirty: state.touched.size > 0,
                mappedAtoms: this.getMappedAtoms()
            };
        }
    };
}

// --- Mark Scheme Editor ---

/**
 * Creates a mark scheme editor state manager.
 * @param {Object} initialScheme Optional initial mark scheme
 * @returns {Object} Mark scheme editor interface
 */
export function createMarkSchemeEditor(initialScheme = null) {
    // Deep-copy initial scheme to prevent mutation
    const initialSnapshot = initialScheme ? JSON.parse(JSON.stringify(initialScheme)) : null;

    function cloneInitial() {
        return initialSnapshot ? { ...createMarkScheme({ schemeType: 'points' }), ...JSON.parse(JSON.stringify(initialSnapshot)) } : createMarkScheme({ schemeType: 'points' });
    }

    const state = {
        scheme: cloneInitial(),
        testHarness: null,
        testResults: [],
        isValid: false,
        errors: [],
        warnings: []
    };
    
    return {
        /**
         * Gets current mark scheme.
         * @returns {Object} Mark scheme
         */
        getScheme() {
            return { ...state.scheme };
        },
        
        /**
         * Sets the associated question (for test harness).
         * @param {Object} question Question
         */
        setQuestion(question) {
            state.testHarness = createMarkSchemeTestHarness(state.scheme, question);
        },
        
        /**
         * Sets scheme type.
         * @param {string} type 'points' or 'rubric'
         */
        setType(type) {
            state.scheme.schemeType = type;
            if (type === 'points' && !state.scheme.points) {
                state.scheme.points = [];
            }
            state.scheme.updatedAt = new Date().toISOString();
            this.validate();
        },
        
        /**
         * Adds a point to points-based scheme.
         * @param {Object} pointData Point data
         */
        addPoint(pointData = {}) {
            const point = createPointsSchemePoint(pointData);
            // Don't delete auto-generated IDs - let validation flag them
            // Only delete if user explicitly wants no ID (which is unusual)
            state.scheme.points = [...(state.scheme.points || []), point];
            state.scheme.updatedAt = new Date().toISOString();
            this.validate();
            return point;
        },
        
        /**
         * Updates a point.
         * @param {string} pointId Point ID
         * @param {Object} updates Updates
         */
        updatePoint(pointId, updates) {
            state.scheme.points = (state.scheme.points || []).map(p => {
                if ((p.id || p.pointId) === pointId) {
                    return { ...p, ...updates };
                }
                return p;
            });
            state.scheme.updatedAt = new Date().toISOString();
            this.validate();
        },
        
        /**
         * Removes a point.
         * @param {string} pointId Point ID
         */
        removePoint(pointId) {
            state.scheme.points = (state.scheme.points || []).filter(p => 
                (p.id || p.pointId) !== pointId
            );
            // Remove references from other points' requires
            state.scheme.points.forEach(p => {
                if (p.requires) {
                    p.requires = p.requires.filter(r => r !== pointId);
                }
            });
            state.scheme.updatedAt = new Date().toISOString();
            this.validate();
        },
        
        /**
         * Adds a dependency between points.
         * @param {string} pointId Point that has dependency
         * @param {string} requiredPointId Required point
         */
        addDependency(pointId, requiredPointId) {
            state.scheme.points = (state.scheme.points || []).map(p => {
                if ((p.id || p.pointId) === pointId) {
                    const requires = [...(p.requires || [])];
                    if (!requires.includes(requiredPointId)) {
                        requires.push(requiredPointId);
                    }
                    return { ...p, requires };
                }
                return p;
            });
            state.scheme.updatedAt = new Date().toISOString();
            this.validate();
        },
        
        /**
         * Sets grading configuration for a point.
         * @param {string} pointId Point ID
         * @param {Object} grading Grading config
         */
        setPointGrading(pointId, grading) {
            this.updatePoint(pointId, { grading });
        },
        
        /**
         * Links a point to atoms.
         * @param {string} pointId Point ID
         * @param {Array} atomLinks Array of {atomId, weight}
         */
        setPointAtomLinks(pointId, atomLinks) {
            this.updatePoint(pointId, { atomLinks });
        },
        
        /**
         * Validates the mark scheme.
         * @returns {boolean} Whether valid
         */
        validate() {
            const validation = validateMarkScheme(state.scheme, state.testHarness?.question);
            state.isValid = validation.valid;
            state.errors = validation.issues || [];
            state.warnings = validation.warnings || [];
            return state.isValid;
        },
        
        /**
         * Tests a response through the harness.
         * @param {string|Object} response Response to test
         * @returns {Object} Test result
         */
        testResponse(response) {
            if (!state.testHarness) {
                return { error: 'No question set for testing' };
            }
            const result = state.testHarness.testResponse(response, { includeAI: true });
            state.testResults.push(result);
            return result;
        },
        
        /**
         * Runs golden tests.
         * @returns {Object} Golden test results
         */
        runGoldenTests() {
            if (!state.testHarness) {
                return { error: 'No question set for testing' };
            }
            return state.testHarness.runGoldenTests();
        },
        
        /**
         * Gets test history.
         * @returns {Array} Test results
         */
        getTestHistory() {
            return [...state.testResults];
        },
        
        /**
         * Gets total marks in scheme.
         * @returns {number} Total marks
         */
        getTotalMarks() {
            return state.scheme.points?.reduce((sum, p) => sum + (p.marks || 0), 0) || 0;
        },
        
        /**
         * Generates editor HTML.
         * @returns {string} HTML
         */
        renderEditorHTML() {
            const scheme = state.scheme;
            const points = scheme.points || [];
            
            return `
                <div class="mark-scheme-editor">
                    <div class="scheme-header">
                        <label>Type:</label>
                        <select data-field="schemeType" class="scheme-type-select">
                            <option value="points" ${scheme.schemeType === 'points' ? 'selected' : ''}>Points-based</option>
                            <option value="rubric" ${scheme.schemeType === 'rubric' ? 'selected' : ''}>Rubric/Levels</option>
                        </select>
                        <span class="total-marks">Total: ${this.getTotalMarks()} marks</span>
                    </div>
                    
                    ${scheme.schemeType === 'points' ? `
                        <div class="points-list">
                            ${points.map((p, i) => `
                                <div class="point-item" data-point-id="${p.id || p.pointId}">
                                    <div class="point-header">
                                        <input type="text" class="point-id-input" value="${p.id || p.pointId}" placeholder="Point ID (e.g., M1)" />
                                        <input type="number" class="point-marks-input" value="${p.marks}" min="0" max="10" />
                                        <label><input type="checkbox" class="point-ecf" ${p.allowECF ? 'checked' : ''} /> ECF</label>
                                        <button class="btn-remove-point">Remove</button>
                                    </div>
                                    <textarea class="point-condition" placeholder="Condition/Accept criteria">${p.condition || ''}</textarea>
                                    <div class="point-dependencies">
                                        <label>Requires:</label>
                                        <select class="dependency-select" multiple>
                                            ${points.filter(op => op !== p).map(op => `
                                                <option value="${op.id || op.pointId}" ${p.requires?.includes(op.id || op.pointId) ? 'selected' : ''}>
                                                    ${op.id || op.pointId}
                                                </option>
                                            `).join('')}
                                        </select>
                                    </div>
                                </div>
                            `).join('')}
                        </div>
                        <button class="btn-add-point">Add Point</button>
                    ` : `
                        <div class="rubric-editor">
                            <p>Rubric editor - define levels and descriptors</p>
                            <textarea class="rubric-levels" placeholder="Define levels here...">${JSON.stringify(scheme.levels || [], null, 2)}</textarea>
                        </div>
                    `}
                    
                    ${state.errors.length > 0 ? `
                        <div class="validation-errors">
                            <h4>Errors:</h4>
                            <ul>${state.errors.map(e => `<li>${e}</li>`).join('')}</ul>
                        </div>
                    ` : ''}
                    
                    ${state.warnings.length > 0 ? `
                        <div class="validation-warnings">
                            <h4>Warnings:</h4>
                            <ul>${state.warnings.map(w => `<li>${w}</li>`).join('')}</ul>
                        </div>
                    ` : ''}
                </div>
            `;
        },
        
        /**
         * Resets editor.
         */
        reset() {
            state.scheme = cloneInitial();
            state.testHarness = null;
            state.testResults = [];
            state.errors = [];
            state.warnings = [];
            state.isValid = false;
        },
        
        /**
         * Gets editor state.
         * @returns {Object} State
         */
        getState() {
            return {
                scheme: { ...state.scheme },
                isValid: state.isValid,
                hasErrors: state.errors.length > 0,
                hasWarnings: state.warnings.length > 0,
                totalMarks: this.getTotalMarks(),
                testResultCount: state.testResults.length
            };
        }
    };
}

// --- Editor Factory ---

/**
 * Creates all three editors for a complete authoring workflow.
 * @returns {Object} Editors container
 */
export function createEditorSuite() {
    const editors = {
        atom: null,
        question: null,
        markScheme: null
    };
    
    return {
        /**
         * Creates a new atom editor.
         * @param {Object} initialAtom Initial atom
         * @returns {Object} Atom editor
         */
        createAtomEditor(initialAtom) {
            editors.atom = createAtomEditor(initialAtom);
            return editors.atom;
        },
        
        /**
         * Creates a new question editor.
         * @param {Object} initialQuestion Initial question
         * @returns {Object} Question editor
         */
        createQuestionEditor(initialQuestion) {
            editors.question = createQuestionEditor(initialQuestion);
            return editors.question;
        },
        
        /**
         * Creates a new mark scheme editor.
         * @param {Object} initialScheme Initial scheme
         * @returns {Object} Mark scheme editor
         */
        createMarkSchemeEditor(initialScheme) {
            editors.markScheme = createMarkSchemeEditor(initialScheme);
            return editors.markScheme;
        },
        
        /**
         * Links question to mark scheme for testing.
         */
        linkForTesting() {
            if (editors.markScheme && editors.question) {
                editors.markScheme.setQuestion(editors.question.getQuestion());
            }
        },
        
        /**
         * Gets all editors.
         * @returns {Object} Editors
         */
        getEditors() {
            return { ...editors };
        }
    };
}

// --- Export Module ---

export default {
    createAtomEditor,
    createQuestionEditor,
    createMarkSchemeEditor,
    createEditorSuite
};
