/**
 * Exam Blueprint Module
 * Defines the structure, validation, and normalization of exam blueprints.
 */

export const DEFAULT_BLUEPRINT_EXAM_INDICATIVE = {
    version: 1,
    name: 'Exam-Indicative Practice',
    mode: 'exam_indicative',
    durationMinutes: 60,
    navigation: {
        allowBack: true,
        allowSkip: true,
        allowSectionJump: true,
        showTimer: true,
        autoSubmitOnTime: true,
        showMarksPerQuestion: true,
        showConfidenceUI: false
    },
    feedback: {
        showDuringTest: false,
        showCorrectnessDuringTest: false,
        showExplanationsDuringTest: false,
        showCorrectAnswersAfterSubmit: true,
        showExplanationsAfterSubmit: true
    },
    scoring: {
        scale: 'percentage',
        gradeBands: null,
        negativeMarking: null,
        partialCredit: true,
        strictMarking: true,
        confidenceInterval: { enabled: true, z: 1.64 }
    },
    composition: {
        totalMarks: 100,
        sections: [
            {
                id: 'main',
                name: 'Main Section',
                marks: 100,
                timeMinutes: null,
                types: ['mixed'],
                topicWeights: {},
                difficultyTargets: { easy: 0.3, medium: 0.4, hard: 0.3 },
                sourceDeckIds: null
            }
        ],
        questionRules: {
            mcqOptionCount: 4,
            mcqDistractorPolicy: 'existing_only',
            shortAnswerMaxChars: 200,
            longAnswerMaxChars: 2000,
            sequenceWindowSize: null,
            avoidRecentlySeenHours: 24,
            allowRepeats: false
        }
    },
    selection: {
        selectedDeckIds: [],
        excludedCardIds: [],
        tagInclude: [],
        tagExclude: [],
        onlyExamTagged: false,
        contentVersionLock: true
    },
    generation: {
        seed: null,
        anchorItems: { enabled: false, countPerSection: 0 },
        variantGeneration: { enabled: false, type: 'none' }
    },
    externalLLM: {
        enabled: false,
        provider: null,
        allowSendCardText: false,
        useCases: {
            distractors: false,
            rephraseStems: false,
            rubricHints: false
        }
    }
};

export const DEFAULT_BLUEPRINT_FREE_PRACTICE = {
    ...DEFAULT_BLUEPRINT_EXAM_INDICATIVE,
    name: 'Free Practice',
    mode: 'free_practice',
    durationMinutes: 30,
    feedback: {
        showDuringTest: true,
        showCorrectnessDuringTest: true,
        showExplanationsDuringTest: true,
        showCorrectAnswersAfterSubmit: true,
        showExplanationsAfterSubmit: true
    },
    scoring: {
        ...DEFAULT_BLUEPRINT_EXAM_INDICATIVE.scoring,
        strictMarking: false
    },
    selection: {
        ...DEFAULT_BLUEPRINT_EXAM_INDICATIVE.selection,
        contentVersionLock: false
    }
};

/**
 * Validates a blueprint against its mode constraints.
 * @param {Object} blueprint 
 * @returns {Object} { ok: boolean, errors: string[], warnings: string[] }
 */
export function validateBlueprint(blueprint) {
    const errors = [];
    const warnings = [];

    if (!blueprint.name) errors.push("Blueprint must have a name.");
    if (blueprint.durationMinutes <= 0) errors.push("Duration must be positive.");
    
    if (blueprint.mode === 'exam_indicative') {
        if (blueprint.feedback.showDuringTest) {
            errors.push("Exam-Indicative mode cannot show feedback during test.");
        }
        if (blueprint.feedback.showCorrectnessDuringTest) {
            errors.push("Exam-Indicative mode cannot show correctness during test.");
        }
        if (blueprint.composition.totalMarks <= 0) {
            errors.push("Total marks must be positive.");
        }
        
        // Check section marks sum
        const sectionMarksSum = blueprint.composition.sections.reduce((sum, s) => sum + s.marks, 0);
        if (Math.abs(sectionMarksSum - blueprint.composition.totalMarks) > 0.1) {
            warnings.push(`Section marks sum (${sectionMarksSum}) does not match total marks (${blueprint.composition.totalMarks}).`);
        }

        if (blueprint.scoring.negativeMarking) {
            warnings.push("Negative marking is enabled. Ensure this is intended for the target exam.");
        }
    }

    if (blueprint.navigation.allowBack === false) {
        warnings.push("Back navigation is disabled. This increases difficulty.");
    }

    return {
        ok: errors.length === 0,
        errors,
        warnings
    };
}

export function getMcqDeckWarnings(blueprint, decks) {
    const warnings = [];
    if (!blueprint || !decks) return warnings;
    const mcqOptionCount = resolvePositiveInt(blueprint?.composition?.questionRules?.mcqOptionCount) || 4;
    if (mcqOptionCount <= 1) return warnings;
    const sections = Array.isArray(blueprint?.composition?.sections) ? blueprint.composition.sections : [];
    const mcqEnabled = sections.some(section => {
        const types = Array.isArray(section?.types) ? section.types : [];
        if (!types.length || types.includes('mixed')) return true;
        return types.some(type => isMcqType(type));
    });
    if (!mcqEnabled) return warnings;
    const selectedDeckIds = Array.isArray(blueprint?.selection?.selectedDeckIds)
        ? blueprint.selection.selectedDeckIds
        : [];
    const deckIdsToUse = selectedDeckIds.length ? selectedDeckIds : Object.keys(decks);
    const selection = blueprint.selection || {};
    const insufficientDecks = [];
    for (const deckId of deckIdsToUse) {
        const deck = decks?.[deckId];
        const cards = Array.isArray(deck?.cards) ? deck.cards : [];
        let count = 0;
        for (const card of cards) {
            if (!matchesSelection(card, selection)) continue;
            count += 1;
        }
        if (count > 0 && count < mcqOptionCount) {
            insufficientDecks.push({ deckId, count });
        }
    }
    if (insufficientDecks.length) {
        const deckLabels = insufficientDecks.map(entry => {
            const deck = decks?.[entry.deckId];
            const label = deck?.name || entry.deckId;
            return `${label} (${entry.count})`;
        });
        warnings.push(`Some decks are too small for ${mcqOptionCount}-option MCQs and will downgrade to typed recall: ${deckLabels.join(', ')}.`);
    }
    return warnings;
}

/**
 * Normalizes a blueprint, filling in defaults and clamping values.
 * @param {Object} blueprint 
 * @returns {Object} Normalized blueprint
 */
export function normaliseBlueprint(blueprint) {
    const base = blueprint.mode === 'free_practice' 
        ? DEFAULT_BLUEPRINT_FREE_PRACTICE 
        : DEFAULT_BLUEPRINT_EXAM_INDICATIVE;

    // Deep merge would be better, but for now shallow merge top-level and critical nested
    const normalized = {
        ...base,
        ...blueprint,
        navigation: { ...base.navigation, ...(blueprint.navigation || {}) },
        feedback: { ...base.feedback, ...(blueprint.feedback || {}) },
        scoring: { ...base.scoring, ...(blueprint.scoring || {}) },
        composition: { 
            ...base.composition, 
            ...(blueprint.composition || {}),
            questionRules: { ...base.composition.questionRules, ...(blueprint.composition?.questionRules || {}) }
        },
        selection: { ...base.selection, ...(blueprint.selection || {}) },
        generation: { ...base.generation, ...(blueprint.generation || {}) },
        externalLLM: { ...base.externalLLM, ...(blueprint.externalLLM || {}) }
    };

    // Clamp values
    normalized.durationMinutes = Math.max(1, Math.min(1440, normalized.durationMinutes));
    normalized.composition.totalMarks = Math.max(1, normalized.composition.totalMarks);

    // Ensure sections exist
    if (!normalized.composition.sections || normalized.composition.sections.length === 0) {
        normalized.composition.sections = [...base.composition.sections];
    }

    return normalized;
}

function resolvePositiveInt(value) {
    const num = Number(value);
    if (!Number.isFinite(num) || num <= 0) return null;
    return Math.floor(num);
}

function isMcqType(type) {
    const normalized = String(type || '').toLowerCase();
    return normalized.includes('mcq') || normalized.includes('multiple');
}

function matchesSelection(card, selection) {
    if (!card) return false;
    if (Array.isArray(selection.excludedCardIds) && selection.excludedCardIds.includes(card.id)) return false;
    if (Array.isArray(selection.tagInclude) && selection.tagInclude.length > 0) {
        const hasTag = Array.isArray(card.tags) && card.tags.some(tag => selection.tagInclude.includes(tag));
        if (!hasTag) return false;
    }
    if (Array.isArray(selection.tagExclude) && selection.tagExclude.length > 0) {
        const hasExcludedTag = Array.isArray(card.tags) && card.tags.some(tag => selection.tagExclude.includes(tag));
        if (hasExcludedTag) return false;
    }
    if (selection.onlyExamTagged) {
        const isExamTagged = Array.isArray(card.tags) && card.tags.some(tag => String(tag).toLowerCase().includes('exam'));
        if (!isExamTagged) return false;
    }
    return true;
}
