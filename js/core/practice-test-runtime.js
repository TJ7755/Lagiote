import { DEFAULT_BLUEPRINT_EXAM_INDICATIVE, DEFAULT_BLUEPRINT_FREE_PRACTICE } from './exam-blueprint.js';

export function buildPracticeTestBlueprint(settings = {}) {
    const mode = settings.mode === 'free_practice' ? 'free_practice' : 'exam_indicative';
    const base = mode === 'free_practice' ? DEFAULT_BLUEPRINT_FREE_PRACTICE : DEFAULT_BLUEPRINT_EXAM_INDICATIVE;
    const durationMinutes = Number.isFinite(settings.durationMinutes) ? settings.durationMinutes : base.durationMinutes;
    const totalMarks = Number.isFinite(settings.totalMarks) ? settings.totalMarks : base.composition.totalMarks;
    const questionCount = Number.isFinite(settings.questionCount) ? settings.questionCount : null;
    const allowBack = typeof settings.allowBack === 'boolean' ? settings.allowBack : base.navigation.allowBack;
    const showTimer = typeof settings.showTimer === 'boolean' ? settings.showTimer : base.navigation.showTimer;
    const strictMarking = typeof settings.strictMarking === 'boolean' ? settings.strictMarking : base.scoring.strictMarking;
    const confidenceIntervalEnabled = typeof settings.confidenceIntervalEnabled === 'boolean'
        ? settings.confidenceIntervalEnabled
        : base.scoring.confidenceInterval.enabled;
    const seed = settings.seed ?? base.generation.seed ?? null;
    const deckId = settings.deckId || null;
    const baseSection = Array.isArray(base.composition.sections) && base.composition.sections.length
        ? base.composition.sections[0]
        : { id: 'main', name: 'Main Section', marks: totalMarks };
    const section = {
        ...baseSection,
        id: baseSection.id || 'main',
        name: baseSection.name || 'Main Section',
        marks: totalMarks
    };
    if (questionCount !== null) {
        section.questionCount = questionCount;
    }
    return {
        ...base,
        mode,
        durationMinutes,
        navigation: { ...base.navigation, allowBack, showTimer },
        scoring: {
            ...base.scoring,
            strictMarking,
            confidenceInterval: { ...base.scoring.confidenceInterval, enabled: confidenceIntervalEnabled }
        },
        selection: {
            ...base.selection,
            selectedDeckIds: deckId ? [deckId] : []
        },
        composition: {
            ...base.composition,
            totalMarks,
            sections: [section],
            questionRules: { ...base.composition.questionRules, allowRepeats: false }
        },
        generation: { ...base.generation, seed }
    };
}

export function getPracticeTestModeFlags(mode) {
    const isExam = mode === 'exam_indicative';
    return {
        mode,
        isExam,
        allowFeedback: !isExam,
        allowShowAnswer: !isExam,
        showCorrectness: !isExam,
        showRunningScore: !isExam,
        submitOnSelect: isExam,
        submitLabel: isExam ? 'Submit Answer' : 'Check Answer'
    };
}

export function flattenTestForm(form) {
    const items = [];
    const sections = Array.isArray(form?.sections) ? form.sections : [];
    for (const section of sections) {
        const sectionId = section?.id ?? null;
        const sectionName = section?.name ?? '';
        const sectionItems = Array.isArray(section?.items) ? section.items : [];
        for (const item of sectionItems) {
            items.push({
                ...item,
                sectionId,
                sectionName,
                marksAvailable: Number.isFinite(item?.marksAvailable) ? item.marksAvailable : 1
            });
        }
    }
    return items;
}

export function appendPracticeTestAttempt(existingRecord, attempt, maxAttempts = 50) {
    const attempts = Array.isArray(existingRecord?.attempts) ? [...existingRecord.attempts] : [];
    if (attempt) {
        attempts.unshift(ensureAttemptOrder(attempt));
    }
    return { key: 'practiceTestAttempts', attempts: attempts.slice(0, maxAttempts) };
}

function ensureAttemptOrder(attempt) {
    if (!attempt || typeof attempt !== 'object') return attempt;
    if (Array.isArray(attempt.flatItems) || Array.isArray(attempt.itemOrder)) return attempt;
    const flatItems = flattenTestForm(attempt.form);
    if (!flatItems.length) return attempt;
    const itemOrder = flatItems.map((item, index) => {
        if (item?.cardId) return item.cardId;
        if (item?.itemId) return item.itemId;
        if (item?.id) return item.id;
        return `item_${index}`;
    });
    return { ...attempt, itemOrder };
}
