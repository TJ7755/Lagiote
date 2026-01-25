import { initDB, getDataFromDB, saveDataToDB } from '../db.js';

const SUPPORTED_KINDS = new Set(['mcq_single', 'mcq_multi', 'numeric', 'short_text']);

export function createMarkScheme(options = {}) {
    return {
        id: options.id || generateId(),
        deckId: options.deckId || null,
        questionId: options.questionId || null,
        schemeType: options.schemeType || 'points', // 'points' or 'rubric'
        points: Array.isArray(options.points) ? options.points : [],
        rubric: Array.isArray(options.rubric) ? options.rubric : [], // for backward compatibility/mixing
        levels: Array.isArray(options.levels) ? options.levels : (Array.isArray(options.rubric) ? options.rubric : []),
        author: options.author || 'system',
        version: options.version || 1,
        createdAt: options.createdAt || new Date().toISOString(),
        updatedAt: options.updatedAt || new Date().toISOString(),
        isDeleted: false
    };
}

export function createPointsSchemePoint(options = {}) {
    return {
        id: options.id || `point-${Math.random().toString(36).slice(2, 9)}`,
        marks: Number.isFinite(options.marks) ? options.marks : 1,
        condition: options.condition || '',
        requires: Array.isArray(options.requires) ? options.requires : [],
        allowECF: options.allowECF === true,
        grading: options.grading || null
    };
}

function generateId() {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
        return crypto.randomUUID();
    }
    return `mark-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function clampNumber(value, minValue, maxValue) {
    const min = Number.isFinite(minValue) ? minValue : 0;
    const max = Number.isFinite(maxValue) ? maxValue : min;
    const numeric = Number.isFinite(value) ? value : 0;
    return Math.min(max, Math.max(min, numeric));
}

function normaliseIndices(values) {
    if (!Array.isArray(values)) return [];
    const normalised = values
        .map(value => Number(value))
        .filter(value => Number.isFinite(value))
        .map(value => Math.trunc(value))
        .filter(value => value >= 0);
    return Array.from(new Set(normalised));
}

function normaliseText(value, options = {}) {
    const base = typeof value === 'string' ? value : String(value ?? '');
    const trimmed = options.trim === false ? base : base.trim();
    const folded = options.caseFold === false ? trimmed : trimmed.toLowerCase();
    const collapsed = options.collapseWhitespace === false ? folded : folded.replace(/\s+/g, ' ');
    return options.stripPunctuation ? collapsed.replace(/[^\w\s]/g, '') : collapsed;
}

function parseAcceptIndices(acceptEntries, options) {
    if (!Array.isArray(acceptEntries)) return [];
    const optionList = Array.isArray(options) ? options.map(option => String(option)) : [];
    const indices = [];
    acceptEntries.forEach(entry => {
        if (typeof entry !== 'string') return;
        const trimmed = entry.trim();
        const match = trimmed.match(/^idx:(\d+)$/i);
        if (match) {
            indices.push(Number(match[1]));
            return;
        }
        if (optionList.length) {
            const index = optionList.findIndex(option => option === trimmed);
            if (index >= 0) indices.push(index);
        }
    });
    return normaliseIndices(indices);
}

function parseNumericAcceptEntry(entry) {
    if (typeof entry !== 'string') return null;
    const trimmed = entry.trim();
    if (!trimmed.toLowerCase().startsWith('value:')) return null;
    const raw = trimmed.slice(6).trim();
    if (!raw) return null;
    const parts = raw.split('±');
    const baseValue = Number(parts[0].trim());
    if (!Number.isFinite(baseValue)) return null;
    let toleranceAbs = 0;
    let toleranceRel = 0;
    if (parts.length > 1) {
        const toleranceRaw = parts.slice(1).join('±').trim();
        if (toleranceRaw.endsWith('%')) {
            const percent = Number(toleranceRaw.slice(0, -1));
            if (Number.isFinite(percent)) toleranceRel = Math.abs(percent) / 100;
        } else {
            const absolute = Number(toleranceRaw);
            if (Number.isFinite(absolute)) toleranceAbs = Math.abs(absolute);
        }
    }
    return { value: baseValue, toleranceAbs, toleranceRel };
}

function matchesNumericTarget(value, target, toleranceAbs, toleranceRel) {
    if (!Number.isFinite(value) || !Number.isFinite(target)) return false;
    const absTol = Number.isFinite(toleranceAbs) ? Math.abs(toleranceAbs) : 0;
    const relTol = Number.isFinite(toleranceRel) ? Math.abs(toleranceRel) : 0;
    const tolerance = Math.max(absTol, Math.abs(target) * relTol);
    return Math.abs(value - target) <= tolerance;
}

function confidenceFromLevel(level) {
    if (level <= 0) return 'low';
    if (level === 1) return 'medium';
    return 'high';
}

export function normaliseResponseForGrading(questionType, response) {
    const kind = typeof questionType === 'string' ? questionType.toLowerCase() : null;
    if (!kind) return null;

    if (kind === 'mcq_single') {
        if (response && typeof response === 'object' && Number.isFinite(response.selectedIndex)) {
            return { selectedIndex: Math.trunc(response.selectedIndex) };
        }
        if (response && typeof response === 'object' && Array.isArray(response.selectedIndices)) {
            const indices = normaliseIndices(response.selectedIndices);
            if (indices.length) return { selectedIndex: indices[0] };
            return { selectedIndex: -1 };
        }
        if (Number.isFinite(response)) {
            return { selectedIndex: Math.trunc(response) };
        }
        return null;
    }

    if (kind === 'mcq_multi') {
        if (response && typeof response === 'object' && Array.isArray(response.selectedIndices)) {
            return { selectedIndices: normaliseIndices(response.selectedIndices) };
        }
        if (Array.isArray(response)) {
            return { selectedIndices: normaliseIndices(response) };
        }
        if (response && typeof response === 'object' && Number.isFinite(response.selectedIndex)) {
            return { selectedIndices: normaliseIndices([response.selectedIndex]) };
        }
        return null;
    }

    if (kind === 'numeric') {
        const value = response && typeof response === 'object' ? response.value : response;
        const rawValue = typeof value === 'string' ? value : null;
        const parsed = typeof value === 'number' ? value : Number(value);
        if (!Number.isFinite(parsed)) return null;
        const unit = response && typeof response === 'object' && typeof response.unit === 'string'
            ? response.unit
            : undefined;
        return { value: parsed, unit, rawValue };
    }

    if (kind === 'short_text') {
        const text = response && typeof response === 'object' ? response.text : response;
        if (typeof text !== 'string') return null;
        return { text };
    }

    return null;
}

export function computeTotalMarksFromAwardedPoints(awardedPoints) {
    if (!Array.isArray(awardedPoints)) return 0;
    return awardedPoints.reduce((total, point) => {
        const increment = Number.isFinite(point?.awardedMarks) ? point.awardedMarks : 0;
        return total + increment;
    }, 0);
}

function gradeMcqSingle(grading, response, pointMarks) {
    if (!grading || !response || !Number.isFinite(response.selectedIndex)) return 0;
    const correctIndices = normaliseIndices(grading.correctIndices);
    if (!correctIndices.length) return 0;
    const allowAnyOf = grading.allowAnyOf === true;
    const selected = response.selectedIndex;
    if (allowAnyOf) {
        return correctIndices.includes(selected) ? pointMarks : 0;
    }
    if (correctIndices.length === 1) {
        return selected === correctIndices[0] ? pointMarks : 0;
    }
    return selected === correctIndices[0] ? pointMarks : 0;
}

function gradeMcqMulti(grading, response, pointMarks) {
    if (!grading || !response) return 0;
    const selected = normaliseIndices(response.selectedIndices);
    const correct = normaliseIndices(grading.correctIndices);
    if (!correct.length) return 0;
    const mode = grading.mode === 'partial' ? 'partial' : 'all_or_nothing';
    if (mode === 'partial') {
        const perCorrect = Number.isFinite(grading.partialCredit?.perCorrect)
            ? Number(grading.partialCredit.perCorrect)
            : 0;
        const perIncorrect = Number.isFinite(grading.partialCredit?.perIncorrect)
            ? Number(grading.partialCredit.perIncorrect)
            : 0;
        const min = Number.isFinite(grading.partialCredit?.min)
            ? Number(grading.partialCredit.min)
            : 0;
        const max = Number.isFinite(grading.partialCredit?.max)
            ? Number(grading.partialCredit.max)
            : pointMarks;
        const correctSet = new Set(correct);
        const correctCount = selected.filter(index => correctSet.has(index)).length;
        const incorrectCount = selected.filter(index => !correctSet.has(index)).length;
        const rawScore = (correctCount * perCorrect) - (incorrectCount * perIncorrect);
        return clampNumber(rawScore, min, max);
    }
    if (selected.length !== correct.length) return 0;
    const correctSet = new Set(correct);
    const allMatch = selected.every(index => correctSet.has(index));
    return allMatch ? pointMarks : 0;
}

function gradeNumeric(grading, response, pointMarks) {
    if (!grading || !response) return 0;
    if (typeof response.rawValue === 'string' && grading.allowSciNotation === false) {
        if (/e/i.test(response.rawValue)) return 0;
    }
    const expected = Number(grading.value);
    if (!Number.isFinite(expected) || !Number.isFinite(response.value)) return 0;
    if (grading.requireUnit) {
        const responseUnit = typeof response.unit === 'string' ? response.unit : '';
        const expectedUnit = grading.requireUnit;
        if (grading.unitStrict) {
            if (responseUnit !== expectedUnit) return 0;
        } else {
            if (responseUnit.trim().toLowerCase() !== String(expectedUnit).trim().toLowerCase()) return 0;
        }
    }
    const toleranceAbs = Number.isFinite(grading.toleranceAbs) ? grading.toleranceAbs : 0;
    const toleranceRel = Number.isFinite(grading.toleranceRel) ? grading.toleranceRel : 0;
    return matchesNumericTarget(response.value, expected, toleranceAbs, toleranceRel) ? pointMarks : 0;
}

function gradeShortText(grading, response, pointMarks) {
    if (!grading || !response || typeof response.text !== 'string') return 0;
    const accepted = Array.isArray(grading.accepted) ? grading.accepted : [];
    const normaliseOptions = {
        caseFold: grading.normalise?.caseFold !== false,
        trim: grading.normalise?.trim !== false,
        collapseWhitespace: grading.normalise?.collapseWhitespace !== false,
        stripPunctuation: grading.normalise?.stripPunctuation === true
    };
    const normalisedResponse = normaliseText(response.text, normaliseOptions);
    const matchMode = grading.match || 'exact';
    if (matchMode === 'regex') {
        const regexes = Array.isArray(grading.regexes) ? grading.regexes : [];
        const regexMatch = regexes.some(pattern => {
            try {
                return new RegExp(pattern).test(normalisedResponse);
            } catch {
                return false;
            }
        });
        if (regexMatch) return pointMarks;
    }
    if (!accepted.length) return 0;
    const normalisedAccepted = accepted.map(entry => normaliseText(entry, normaliseOptions));
    if (matchMode === 'contains') {
        return normalisedAccepted.some(entry => normalisedResponse.includes(entry)) ? pointMarks : 0;
    }
    return normalisedAccepted.includes(normalisedResponse) ? pointMarks : 0;
}

function gradeFallbackMcqSingle(point, response, question, pointMarks) {
    const correctIndices = parseAcceptIndices(point?.accept, question?.options);
    if (!correctIndices.length || !response || !Number.isFinite(response.selectedIndex)) return 0;
    return correctIndices.includes(response.selectedIndex) ? pointMarks : 0;
}

function gradeFallbackMcqMulti(point, response, question, pointMarks) {
    const correctIndices = parseAcceptIndices(point?.accept, question?.options);
    if (!correctIndices.length || !response) return 0;
    const selected = normaliseIndices(response.selectedIndices);
    if (selected.length !== correctIndices.length) return 0;
    const correctSet = new Set(correctIndices);
    const allMatch = selected.every(index => correctSet.has(index));
    return allMatch ? pointMarks : 0;
}

function gradeFallbackNumeric(point, response, pointMarks) {
    if (!response || !Number.isFinite(response.value)) return 0;
    const acceptEntries = Array.isArray(point?.accept) ? point.accept : [];
    const parsedEntries = acceptEntries
        .map(parseNumericAcceptEntry)
        .filter(entry => entry);
    if (!parsedEntries.length) return 0;
    const matches = parsedEntries.some(entry =>
        matchesNumericTarget(response.value, entry.value, entry.toleranceAbs, entry.toleranceRel)
    );
    return matches ? pointMarks : 0;
}

function gradeFallbackShortText(point, response, pointMarks) {
    if (!response || typeof response.text !== 'string') return 0;
    const acceptEntries = Array.isArray(point?.accept) ? point.accept : [];
    const rejectEntries = Array.isArray(point?.reject) ? point.reject : [];
    const normalisedResponse = normaliseText(response.text);
    const normalisedRejects = rejectEntries.map(entry => normaliseText(entry));
    if (normalisedRejects.includes(normalisedResponse)) return 0;
    const normalisedAccepts = acceptEntries.map(entry => normaliseText(entry));
    return normalisedAccepts.includes(normalisedResponse) ? pointMarks : 0;
}

function gradePointWithGrading(kind, grading, response, pointMarks) {
    if (kind === 'mcq_single') return gradeMcqSingle(grading, response, pointMarks);
    if (kind === 'mcq_multi') return gradeMcqMulti(grading, response, pointMarks);
    if (kind === 'numeric') return gradeNumeric(grading, response, pointMarks);
    if (kind === 'short_text') return gradeShortText(grading, response, pointMarks);
    return 0;
}

function gradePointWithFallback(kind, point, response, question, pointMarks) {
    if (kind === 'mcq_single') return gradeFallbackMcqSingle(point, response, question, pointMarks);
    if (kind === 'mcq_multi') return gradeFallbackMcqMulti(point, response, question, pointMarks);
    if (kind === 'numeric') return gradeFallbackNumeric(point, response, pointMarks);
    if (kind === 'short_text') return gradeFallbackShortText(point, response, pointMarks);
    return 0;
}

function gradeRubricScheme(markScheme, response) {
    const levels = Array.isArray(markScheme?.levels) ? markScheme.levels : [];
    if (!levels.length || !response) return 0;
    
    const selectedLevelId = response.selectedLevelId;
    const level = levels.find(l => l.id === selectedLevelId);
    if (!level) return 0;
    
    const maxMarks = Number(level.maxMarks || level.marks || 0);
    const minMarks = Number(level.minMarks || 0);
    const awarded = Number.isFinite(response.awardedMarks) 
        ? response.awardedMarks 
        : (response.levelMarks || maxMarks);
        
    return clampNumber(awarded, minMarks, maxMarks);
}

export function gradeQuestion({ question, markScheme, response, context } = {}) {
    const points = Array.isArray(markScheme?.points) ? markScheme.points : [];
    const schemeType = typeof markScheme?.schemeType === 'string'
        ? markScheme.schemeType.toLowerCase()
        : 'points';
    const examSittingId = context?.examSittingId ?? context?.examSittingID ?? null;
    const questionId = context?.questionId || question?.id || markScheme?.questionId || null;

    if (schemeType === 'rubric') {
        const totalAwarded = gradeRubricScheme(markScheme, response);
        return {
            id: generateId(),
            examSittingId,
            questionId,
            totalAwardedMarks: totalAwarded,
            confidence: response?.isManual ? 'high' : 'medium',
            awardedPoints: [{ type: 'rubric_level', awardedMarks: totalAwarded, levelId: response?.selectedLevelId }]
        };
    }

    if (schemeType !== 'points' || !points.length) {
        return {
            id: generateId(),
            examSittingId,
            questionId,
            totalAwardedMarks: 0,
            confidence: 'low',
            awardedPoints: []
        };
    }

    const awardedPoints = [];
    const awardedMap = new Map();
    let confidenceLevel = 2;

    points.forEach(point => {
        const pointId = typeof point?.id === 'string'
            ? point.id
            : (typeof point?.pointId === 'string' ? point.pointId : null);
        const pointMarks = Number.isFinite(point?.marks) ? Number(point.marks) : 0;
        const requirements = Array.isArray(point?.requires) ? point.requires : [];
        const allowECF = point?.allowECF === true;
        
        const requirementsMet = requirements.length === 0 || requirements.every(reqId => {
            if (typeof reqId !== 'string') return false;
            const awarded = awardedMap.get(reqId);
            return Number.isFinite(awarded) && awarded > 0;
        });

        if (!requirementsMet && !allowECF) {
            awardedPoints.push({ pointId, awardedMarks: 0, requirementsFailed: true });
            if (pointId) awardedMap.set(pointId, 0);
            return;
        }

        const grading = point?.grading && typeof point.grading === 'object' ? point.grading : null;
        const rawKind = grading?.kind || question?.type || null;
        const kind = typeof rawKind === 'string' ? rawKind.toLowerCase() : null;
        let awardedMarks = 0;
        let fallbackUsed = false;
        let responseMalformed = false;
        let unsupported = false;

        if (!SUPPORTED_KINDS.has(kind)) {
            unsupported = true;
        } else {
            const normalisedResponse = normaliseResponseForGrading(kind, response);
            
            // Check if point is explicitly awarded in the response (manual/pre-graded)
            const explicitlyAwarded = (
                (Array.isArray(response?.pointsAwarded) && response.pointsAwarded.includes(pointId)) ||
                (response?.awardedMarksById && Number.isFinite(response.awardedMarksById[pointId]))
            );

            if (explicitlyAwarded) {
                awardedMarks = response?.awardedMarksById && Number.isFinite(response.awardedMarksById[pointId])
                    ? response.awardedMarksById[pointId]
                    : pointMarks;
            } else if (!normalisedResponse) {
                responseMalformed = true;
            } else if (grading && typeof grading.kind === 'string') {
                awardedMarks = gradePointWithGrading(kind, grading, normalisedResponse, pointMarks);
            } else {
                awardedMarks = gradePointWithFallback(kind, point, normalisedResponse, question, pointMarks);
                fallbackUsed = true;
            }
        }

        awardedMarks = clampNumber(awardedMarks, 0, pointMarks);
        
        const pointResult = { pointId, awardedMarks };
        if (!requirementsMet && allowECF && awardedMarks > 0) {
            pointResult.isECF = true;
        }
        
        awardedPoints.push(pointResult);
        if (pointId) awardedMap.set(pointId, awardedMarks);

        if (unsupported) {
            confidenceLevel = 0;
        } else if (fallbackUsed || responseMalformed) {
            confidenceLevel = Math.min(confidenceLevel, 1);
        }
    });

    return {
        id: generateId(),
        examSittingId,
        questionId,
        totalAwardedMarks: computeTotalMarksFromAwardedPoints(awardedPoints),
        confidence: confidenceFromLevel(confidenceLevel),
        awardedPoints
    };
}

export async function gradeAndStoreQuestion({ examSittingId, questionId, response }) {
    await initDB();
    if (!questionId) {
        throw new Error('questionId is required to grade a question');
    }
    const question = await getDataFromDB('questions', questionId);
    if (!question) {
        throw new Error(`Question not found: ${questionId}`);
    }
    const markSchemeId = question.markSchemeId || question.markSchemeID || question.markScheme;
    if (!markSchemeId) {
        throw new Error(`Mark scheme ID missing for question: ${questionId}`);
    }
    const markScheme = await getDataFromDB('markSchemes', markSchemeId);
    if (!markScheme) {
        throw new Error(`Mark scheme not found: ${markSchemeId}`);
    }

    const record = gradeQuestion({
        question,
        markScheme,
        response,
        context: { examSittingId, questionId }
    });
    const payload = {
        ...record,
        examSittingId: examSittingId ?? record.examSittingId ?? null,
        questionId
    };
    await saveDataToDB('markingRecords', payload);
    return payload;
}
