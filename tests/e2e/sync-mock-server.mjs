function clone(value) {
    return value ? JSON.parse(JSON.stringify(value)) : value;
}

function normalizeTime(value) {
    if (!value) return null;
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return null;
    return parsed.toISOString();
}

function toRecordKey(record, fallbackKey) {
    if (record?.id !== undefined && record.id !== null) return String(record.id);
    if (record?.cardID !== undefined && record.cardID !== null) return String(record.cardID);
    if (record?.cardId !== undefined && record.cardId !== null) return String(record.cardId);
    if (record?.deckID !== undefined && record.deckID !== null) return String(record.deckID);
    if (record?.deckId !== undefined && record.deckId !== null) return String(record.deckId);
    if (fallbackKey) return String(fallbackKey);
    return null;
}

function resolveRecordTime(record) {
    return normalizeTime(record?.lastModified || record?.updatedAt || record?.timestamp || record?.created);
}

function upsertRecords(records, map) {
    if (!Array.isArray(records)) return;
    for (const record of records) {
        const key = toRecordKey(record);
        if (!key) continue;
        const incoming = clone(record);
        const incomingTime = resolveRecordTime(incoming) || new Date().toISOString();
        incoming.lastModified = incoming.lastModified || incomingTime;
        const existing = map.get(key);
        if (!existing) {
            map.set(key, incoming);
            continue;
        }
        const existingTime = resolveRecordTime(existing) || new Date(0).toISOString();
        if (new Date(incomingTime) >= new Date(existingTime)) {
            map.set(key, incoming);
        }
    }
}

function collectUpdates(map, since) {
    const sinceTime = normalizeTime(since);
    const results = [];
    for (const value of map.values()) {
        if (!sinceTime) {
            results.push(clone(value));
            continue;
        }
        const recordTime = resolveRecordTime(value);
        if (!recordTime) continue;
        if (new Date(recordTime) > new Date(sinceTime)) {
            results.push(clone(value));
        }
    }
    return results;
}

export function createSyncMockServer() {
    const state = {
        decks: new Map(),
        knowledgeStates: new Map(),
        examPlans: new Map(),
        interactionLogs: new Map(),
        settings: null,
        deletedDeckIds: new Set(),
        requestLog: []
    };
    let failNext = 0;
    let delayMs = 0;
    let unavailable = false;

    const reset = () => {
        state.decks.clear();
        state.knowledgeStates.clear();
        state.examPlans.clear();
        state.interactionLogs.clear();
        state.settings = null;
        state.deletedDeckIds.clear();
        state.requestLog = [];
        failNext = 0;
        delayMs = 0;
        unavailable = false;
    };

    const setFailNext = (count = 1) => {
        failNext = Math.max(0, Number(count) || 0);
    };

    const setDelay = (ms = 0) => {
        delayMs = Math.max(0, Number(ms) || 0);
    };

    const setUnavailable = (value) => {
        unavailable = Boolean(value);
    };

    const getStateSnapshot = () => ({
        decks: Array.from(state.decks.values()).map(clone),
        knowledgeStates: Array.from(state.knowledgeStates.values()).map(clone),
        examPlans: Array.from(state.examPlans.values()).map(clone),
        interactionLogs: Array.from(state.interactionLogs.values()).map(clone),
        settings: clone(state.settings),
        deletedDeckIds: Array.from(state.deletedDeckIds)
    });

    const handlePayload = (payload = {}) => {
        const now = new Date().toISOString();
        const lastSynced = payload.lastSynced || null;
        if (payload.userSettings) {
            state.settings = clone(payload.userSettings);
        }
        upsertRecords(payload.dirtyDecks, state.decks);
        upsertRecords(payload.dirtyKnowledgeStates, state.knowledgeStates);
        upsertRecords(payload.dirtyExamPlans, state.examPlans);
        if (Array.isArray(payload.dirtyInteractionLogs)) {
            for (const log of payload.dirtyInteractionLogs) {
                const key = toRecordKey(log, `${log?.timestamp || now}-${Math.random().toString(36).slice(2, 8)}`);
                if (!key) continue;
                state.interactionLogs.set(key, clone(log));
            }
        }
        return {
            updatedDecks: collectUpdates(state.decks, lastSynced),
            updatedKnowledgeStates: collectUpdates(state.knowledgeStates, lastSynced),
            updatedExamPlans: collectUpdates(state.examPlans, lastSynced),
            updatedSettings: state.settings ? clone(state.settings) : null,
            deletedDeckIds: Array.from(state.deletedDeckIds),
            timestamp: now
        };
    };

    const handleRequest = async (request) => {
        if (unavailable) {
            return { status: 503, body: { error: 'unavailable' } };
        }
        if (failNext > 0) {
            failNext -= 1;
            return { status: 503, body: { error: 'temporary' } };
        }
        if (delayMs) {
            await new Promise(resolve => setTimeout(resolve, delayMs));
        }
        const payloadText = request.postData() || '{}';
        let payload;
        try {
            payload = JSON.parse(payloadText);
        } catch (error) {
            payload = {};
        }
        state.requestLog.push({
            url: request.url(),
            method: request.method(),
            timestamp: new Date().toISOString(),
            payload
        });
        const response = handlePayload(payload);
        return { status: 200, body: response };
    };

    const handleRoute = async (route) => {
        const request = route.request();
        const result = await handleRequest(request);
        await route.fulfill({
            status: result.status,
            contentType: 'application/json',
            body: JSON.stringify(result.body)
        });
    };

    return {
        state,
        reset,
        setFailNext,
        setDelay,
        setUnavailable,
        getStateSnapshot,
        handleRequest,
        handleRoute
    };
}
