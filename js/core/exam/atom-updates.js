import { initDB, getDataFromDB, saveDataToDB } from '../db.js';

const SUCCESS_ALPHA = 0.12;
const FAIL_BETA = 0.08;
const STAB_GAIN_BASE = 0.6;
const STAB_GAIN_DIFF = 2.4;
const STAB_FAIL_MULT = 0.9;
const FRAG_SUCCESS = 0.10;
const FRAG_FAIL = 0.10;

function clampNumber(value, min, max) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return min;
    return Math.min(max, Math.max(min, numeric));
}

function clamp01(value) {
    return clampNumber(value, 0, 1);
}

function normalizeVariationScore(profile) {
    const base = profile && typeof profile === 'object' ? profile : {};
    const values = [
        base.numbers ? 1 : 0,
        base.context ? 1 : 0,
        base.representation ? 1 : 0,
        base.wording ? 1 : 0
    ];
    return values.reduce((sum, entry) => sum + entry, 0) / values.length;
}

function safeNumber(value, fallback = 0) {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : fallback;
}

function getAtomStability(atom) {
    if (!atom) return 0;
    const primary = safeNumber(atom.stabilityDays, null);
    if (primary !== null) return primary;
    return safeNumber(atom.stability, 0);
}

function getMarkSchemeId(question) {
    if (!question || typeof question !== 'object') return null;
    return question.markSchemeId || question.markSchemeID || question.markScheme || null;
}

function collectAwardedMarks(awardedPoints) {
    const map = new Map();
    if (!Array.isArray(awardedPoints)) return map;
    awardedPoints.forEach(entry => {
        const pointId = entry?.pointId;
        if (typeof pointId === 'string') {
            map.set(pointId, safeNumber(entry?.awardedMarks, 0));
        }
    });
    return map;
}

export async function applyMarkingRecordToAtoms({ markingRecordId, nowIso, allowReapply } = {}) {
    await initDB();
    const payload = {
        updatedAtomIds: [],
        skipped: false,
        deltasSummary: {}
    };

    if (!markingRecordId) {
        return { ...payload, skipped: true, reason: 'missing_marking_record_id' };
    }

    const markingRecord = await getDataFromDB('markingRecords', markingRecordId);
    if (!markingRecord) {
        return { ...payload, skipped: true, reason: 'missing_marking_record' };
    }

    if (markingRecord.appliedToAtomsAt && allowReapply !== true) {
        return { ...payload, skipped: true, reason: 'already_applied' };
    }

    const questionId = markingRecord.questionId || markingRecord.questionID;
    if (!questionId) {
        return { ...payload, skipped: true, reason: 'missing_question' };
    }

    const question = await getDataFromDB('questions', questionId);
    if (!question) {
        return { ...payload, skipped: true, reason: 'missing_question' };
    }

    const markSchemeId = getMarkSchemeId(question);
    if (!markSchemeId) {
        return { ...payload, skipped: true, reason: 'missing_mark_scheme' };
    }

    const markScheme = await getDataFromDB('markSchemes', markSchemeId);
    if (!markScheme) {
        return { ...payload, skipped: true, reason: 'missing_mark_scheme' };
    }

    const qDiff = clamp01(question?.difficulty ?? 0.5);
    const qDepth = clamp01(question?.depth ?? 0.5);
    const pressure = clamp01(question?.timeProfile?.pressure ?? 0);
    const variationScore = normalizeVariationScore(question?.variationProfile);

    const difficultyFactor = 0.6 + 0.8 * qDiff;
    const depthFactor = 0.7 + 0.6 * qDepth;
    const pressureFactor = 1.0 + 0.3 * pressure;
    const baseScale = difficultyFactor * depthFactor * pressureFactor;

    const awardedMap = collectAwardedMarks(markingRecord.awardedPoints);
    const points = Array.isArray(markScheme?.points) ? markScheme.points : [];
    const atomCache = new Map();
    const updatedAtomIds = new Set();

    for (const point of points) {
        const pointId = typeof point?.id === 'string'
            ? point.id
            : (typeof point?.pointId === 'string' ? point.pointId : null);
        const atomLinks = Array.isArray(point?.atomLinks) ? point.atomLinks : [];
        if (!atomLinks.length) continue;
        const marks = safeNumber(point?.marks, 0);
        const awardedMarks = pointId ? safeNumber(awardedMap.get(pointId), 0) : 0;
        const fraction = marks > 0 ? clamp01(awardedMarks / marks) : 0;

        for (const atomLink of atomLinks) {
            const atomId = atomLink?.atomId;
            if (typeof atomId !== 'string') continue;
            const w = clamp01(atomLink?.weight ?? 0);
            if (w <= 0) continue;

            let atom = atomCache.get(atomId);
            if (!atom) {
                atom = await getDataFromDB('atoms', atomId);
                if (!atom) {
                    atomCache.set(atomId, null);
                    continue;
                }
                if (atom.isDeleted) {
                    atomCache.set(atomId, null);
                    continue;
                }
                atomCache.set(atomId, atom);
            }
            if (!atom) continue;

            let mastery = clamp01(atom.mastery ?? 0);
            let stabilityDays = Math.max(0, getAtomStability(atom));
            let fragility = clamp01(atom.fragility ?? 0.5);

            if (fraction > 0) {
                const gain = SUCCESS_ALPHA * baseScale * fraction * w;
                mastery = mastery + gain * (1 - mastery);
                stabilityDays += (STAB_GAIN_BASE + STAB_GAIN_DIFF * qDiff) * fraction * w;
                fragility = fragility * (1 - FRAG_SUCCESS * variationScore * w);
            } else {
                const loss = FAIL_BETA * baseScale * w;
                mastery = mastery - loss * mastery;
                stabilityDays = Math.max(
                    0,
                    stabilityDays * (STAB_FAIL_MULT + (1 - STAB_FAIL_MULT) * (1 - w))
                );
                fragility = Math.min(1, fragility + FRAG_FAIL * variationScore * w);
            }

            atom.mastery = clamp01(mastery);
            atom.stabilityDays = Math.max(0, stabilityDays);
            atom.fragility = clamp01(fragility);
            updatedAtomIds.add(atomId);
        }
    }

    for (const atomId of updatedAtomIds) {
        const atom = atomCache.get(atomId);
        if (!atom) continue;
        await saveDataToDB('atoms', atom);
    }

    let errorAtomsUpdated = 0;
    const detectedErrors = Array.isArray(markingRecord.detectedErrorAtomIds)
        ? markingRecord.detectedErrorAtomIds
        : [];
    for (const errorAtomId of detectedErrors) {
        if (typeof errorAtomId !== 'string') continue;
        const errorAtom = await getDataFromDB('errorAtoms', errorAtomId);
        if (!errorAtom || errorAtom.isDeleted) continue;
        const risk = clamp01(errorAtom.risk ?? 0);
        const nextRisk = clamp01(risk + 0.05 * (1 - risk) * (1 + 0.5 * pressure));
        if (nextRisk !== risk) {
            errorAtom.risk = nextRisk;
            await saveDataToDB('errorAtoms', errorAtom);
            errorAtomsUpdated += 1;
        }
    }

    const summary = {
        atomsUpdated: updatedAtomIds.size,
        pointsEvaluated: points.length,
        errorAtomsUpdated
    };

    const appliedAt = nowIso || new Date().toISOString();
    await saveDataToDB('markingRecords', {
        ...markingRecord,
        appliedToAtomsAt: appliedAt,
        atomDeltaSummary: summary
    });

    return {
        updatedAtomIds: Array.from(updatedAtomIds),
        skipped: false,
        deltasSummary: summary
    };
}
