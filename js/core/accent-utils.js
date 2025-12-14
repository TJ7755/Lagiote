const ASCII_LETTER_REGEX = /^[A-Za-z]$/;
const COMBINING_MARKS_REGEX = /\p{M}/gu;

function isAsciiLetter(char) {
    return ASCII_LETTER_REGEX.test(char);
}

function isLetter(char) {
    if (!char) return false;
    return char.toLowerCase() !== char.toUpperCase();
}

function resolveAccentBaseKey(char) {
    if (!char) return '';
    const normalized = char.normalize('NFD');
    const withoutMarks = normalized.replace(COMBINING_MARKS_REGEX, '');
    const baseChar = withoutMarks.charAt(0) || char;
    return baseChar.toLowerCase();
}

function extractAccentedCharacters(text) {
    if (text === null || text === undefined) return [];
    const source = typeof text === 'string' ? text : String(text);
    const normalized = source.normalize('NFC');
    const results = [];

    for (const char of normalized) {
        if (!char.trim()) continue;
        if (isAsciiLetter(char)) continue;
        if (!isLetter(char)) continue;
        results.push(char);
    }
    return results;
}

function buildDeckAccentMetadata(deck) {
    const cards = Array.isArray(deck?.cards) ? deck.cards : [];
    const uniqueChars = new Set();

    for (const card of cards) {
        const snippets = [card?.answer, card?.question];
        for (const snippet of snippets) {
            for (const char of extractAccentedCharacters(snippet)) {
                uniqueChars.add(char);
            }
        }
    }

    const accents = Array.from(uniqueChars).sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'variant' }));
    const baseMap = {};

    for (const accent of accents) {
        const baseKey = getAccentBaseKey(accent);
        if (!baseKey) continue;
        if (!baseMap[baseKey]) baseMap[baseKey] = [];
        baseMap[baseKey].push(accent);
    }

    return { accents, baseMap };
}

export function ensureDeckAccentMetadata(deck) {
    if (!deck) {
        return { accents: [], baseMap: {} };
    }

    deck.meta = deck.meta || {};
    const versionToken = deck.lastModified || deck.updatedAt || deck.createdAt || deck.id || 'initial';
    if (deck.meta.accentsComputedFor === versionToken && Array.isArray(deck.meta.accentsUsed)) {
        return {
            accents: deck.meta.accentsUsed,
            baseMap: deck.meta.accentsBaseMap || {}
        };
    }

    const { accents, baseMap } = buildDeckAccentMetadata(deck);
    deck.meta.accentsUsed = accents;
    deck.meta.accentsBaseMap = baseMap;
    deck.meta.accentsComputedFor = versionToken;
    return { accents, baseMap };
}

export function getAccentBaseKey(char) {
    return resolveAccentBaseKey(char);
}

if (typeof window !== 'undefined') {
    window.AccentUtils = window.AccentUtils || {};
    window.AccentUtils.ensureDeckAccentMetadata = ensureDeckAccentMetadata;
    window.AccentUtils.getAccentBaseKey = (char) => {
        if (!char) return '';
        return resolveAccentBaseKey(char);
    };
}
