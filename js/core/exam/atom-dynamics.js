const MS_PER_DAY = 24 * 60 * 60 * 1000;

function toTimestamp(value) {
    if (value instanceof Date) {
        return value.getTime();
    }
    if (typeof value === 'number') {
        return value;
    }
    const parsed = new Date(value ?? 0);
    const ts = parsed.getTime();
    return Number.isFinite(ts) ? ts : 0;
}

function getAtomById(atomsById, atomId) {
    if (!atomsById) return null;
    if (atomsById instanceof Map) {
        return atomsById.get(atomId) ?? null;
    }
    return atomsById[atomId] ?? null;
}

function normalizeAtomsById(atoms) {
    if (!atoms) return new Map();
    if (atoms instanceof Map) {
        return new Map(atoms);
    }
    if (Array.isArray(atoms)) {
        const map = new Map();
        atoms.forEach(atom => {
            if (!atom) return;
            const id = atom.id ?? atom.atomId;
            if (id != null) {
                map.set(id, atom);
            }
        });
        return map;
    }
    if (typeof atoms === 'object') {
        const map = new Map();
        Object.entries(atoms).forEach(([key, value]) => {
            if (!value) return;
            const id = value.id ?? key;
            map.set(id, value);
        });
        return map;
    }
    return new Map();
}

export function clamp01(value) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return 0;
    return Math.min(1, Math.max(0, numeric));
}

export function daysBetweenDates(startDate, endDate) {
    const startMs = toTimestamp(startDate);
    const endMs = toTimestamp(endDate);
    return (endMs - startMs) / MS_PER_DAY;
}

export function predictMastery(atom, nowDate, targetDate) {
    const mastery = clamp01(atom?.mastery ?? 0);
    const stabilityValue = atom?.stabilityDays ?? atom?.stability ?? 0;
    const stabilityDays = Number.isFinite(Number(stabilityValue)) ? Number(stabilityValue) : 0;
    const deltaDays = Math.max(0, daysBetweenDates(nowDate, targetDate));
    if (deltaDays === 0) return mastery;
    if (stabilityDays <= 0) return 0;
    const predicted = mastery * Math.exp(-deltaDays / stabilityDays);
    return clamp01(predicted);
}

export function effectiveMastery(atomId, atomsById, nowDate, targetDate, opts = {}) {
    const memo = opts.memo instanceof Map ? opts.memo : new Map();
    const visiting = opts.visiting instanceof Set ? opts.visiting : new Set();

    if (memo.has(atomId)) {
        return memo.get(atomId);
    }

    const atom = getAtomById(atomsById, atomId);
    const predicted = predictMastery(atom ?? {}, nowDate, targetDate);
    let cap = 1;
    let prereqScore = 0;

    const prereqs = Array.isArray(atom?.prerequisites) ? atom.prerequisites : [];
    if (prereqs.length) {
        visiting.add(atomId);
        const eligiblePrereqs = prereqs.filter(prereq => {
            const prereqId = prereq?.atomId;
            if (!prereqId) return false;
            if (visiting.has(prereqId)) return false;
            return true;
        });

        if (eligiblePrereqs.length) {
            let weightedSum = 0;
            let weightTotal = 0;
            for (const prereq of eligiblePrereqs) {
                const weightRaw = Number(prereq?.weight);
                const weight = Number.isFinite(weightRaw) ? Math.max(0, weightRaw) : 0;
                const prereqId = prereq?.atomId;
                if (weight > 0 && prereqId) {
                    const prereqResult = effectiveMastery(prereqId, atomsById, nowDate, targetDate, {
                        memo,
                        visiting
                    });
                    weightedSum += weight * prereqResult.effective;
                }
                weightTotal += weight;
            }
            prereqScore = weightTotal === 0 ? 0 : weightedSum / weightTotal;
            const capFloor = 0.2;
            cap = clamp01(capFloor + (1 - capFloor) * prereqScore);
        } else {
            cap = 1;
        }
        visiting.delete(atomId);
    }

    const effective = Math.min(predicted, cap);
    const result = { effective, predicted, cap, prereqScore };
    memo.set(atomId, result);
    return result;
}

export function computeEffectiveMasteryMap(atoms, nowDate, targetDate) {
    const atomsById = normalizeAtomsById(atoms);
    const memo = new Map();
    const results = new Map();
    for (const atomId of atomsById.keys()) {
        const result = effectiveMastery(atomId, atomsById, nowDate, targetDate, {
            memo,
            visiting: new Set()
        });
        results.set(atomId, result);
    }
    return results;
}
