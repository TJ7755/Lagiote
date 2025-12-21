;(function () {
    const STEP_PREFIX_REGEX = /^\s*(?:\d+[\.\)]|\(\d+\)|[-\u2013\u2014\u2022\u2023\u2024\u25E6])\s*/;

    function convertStepToString(value) {
        if (value === null || value === undefined) return '';
        if (typeof value === 'string' || typeof value === 'number') return String(value);
        if (typeof value === 'object') {
            return String(
                value.answer ||
                value.term ||
                value.step ||
                value.text ||
                value.label ||
                value.value ||
                value.question ||
                ''
            );
        }
        return '';
    }

    function cleanStepText(value) {
        const text = convertStepToString(value);
        const sanitized = text.replace(STEP_PREFIX_REGEX, '');
        return sanitized.trim();
    }

    function coercePositiveNumber(value) {
        const parsed = Number(value);
        return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
    }

    function ensureArray(value) {
        return Array.isArray(value) ? value : [];
    }

    function hasSequenceMeta(deck) {
        if (!deck || typeof deck !== 'object') return false;
        const typeHints = [
            deck.typeHint,
            deck.type,
            deck.mode,
            deck.deckType,
            deck.metadata && (deck.metadata.type || deck.metadata.mode || deck.metadata.deckType),
            deck.settings && (deck.settings.mode || deck.settings.studyMode || deck.settings.sequenceMode)
        ];
        const normalized = typeHints
            .filter(v => typeof v === 'string')
            .map(v => v.toLowerCase());
        if (normalized.includes('sequence')) return true;
        return deck.isSequence === true
            || deck.metadata?.isSequence === true
            || deck.settings?.isSequence === true;
    }

    function isSequenceDeck(deck) {
        if (!deck || typeof deck !== 'object') return false;
        if (hasSequenceMeta(deck)) return true;

        const cards = ensureArray(deck.cards);
        const orderedCards = cards.filter(card => coercePositiveNumber(card?.order));
        if (orderedCards.length >= 2) return true;

        const flaggedCards = cards.filter(card =>
            card
            && (card._isSequence
                || card.sequence === true
                || card.sequenceStep !== undefined
                || card.step !== undefined
                || card.orderIndex !== undefined));
        if (flaggedCards.length >= 2) return true;

        const legacySteps = [deck.sequence, deck.sequences, deck.sequenceSteps, deck.steps]
            .find(arr => Array.isArray(arr) && arr.length >= 2);
        return Boolean(legacySteps);
    }

    function normalizeSequenceCard(raw, index = 0) {
        const fallbackOrder = index + 1;
        const order = coercePositiveNumber(
            raw?.order ?? raw?.orderIndex ?? raw?.step ?? raw?.sequenceStep
        ) ?? fallbackOrder;
        const baseId = (typeof crypto !== 'undefined' && crypto.randomUUID)
            ? crypto.randomUUID()
            : `seq-${Date.now()}-${Math.random().toString(16).slice(2)}`;
        const id = raw?.id || raw?.cardID || raw?.cardId || baseId;
        const question = raw?.question || raw?.prompt || raw?.description || '';
        const answer = cleanStepText(
            raw?.answer ?? raw?.term ?? raw?.step ?? raw?.text ?? raw?.value ?? raw?.label ?? raw
        );
        return {
            ...(raw && typeof raw === 'object' ? raw : {}),
            id,
            question,
            answer,
            order,
            deckId: raw?.deckId || raw?.deckID || raw?.deck || null
        };
    }

    function normalizeSequenceCardsFromSteps(steps) {
        return ensureArray(steps).map((step, index) => normalizeSequenceCard(step, index));
    }

    function adaptLegacySequenceDeck(deck) {
        if (!deck || typeof deck !== 'object') {
            return { deck, cards: [], migrated: false };
        }

        const workingDeck = { ...deck };
        const cards = ensureArray(deck.cards).map(card => ({ ...(card || {}) }));
        let sequenceCards = [];
        let migrated = false;

        const orderedCards = cards.filter(card => coercePositiveNumber(card?.order));
        if (orderedCards.length >= 2) {
            sequenceCards = orderedCards.map((card, index) => normalizeSequenceCard(card, index));
        } else {
            const legacySteps = [deck.sequence, deck.sequences, deck.sequenceSteps, deck.steps]
                .find(arr => Array.isArray(arr) && arr.length >= 2);
            if (legacySteps) {
                sequenceCards = normalizeSequenceCardsFromSteps(legacySteps);
                migrated = true;
            } else {
                const legacyCandidates = cards.filter(card =>
                    card
                    && (card._isSequence
                        || card.sequence === true
                        || card.sequenceStep !== undefined
                        || card.step !== undefined
                        || card.orderIndex !== undefined));
                if (legacyCandidates.length >= 2) {
                    sequenceCards = legacyCandidates.map((card, index) => normalizeSequenceCard(card, index));
                    migrated = true;
                } else if (isSequenceDeck(deck) && cards.length >= 2) {
                    sequenceCards = cards.map((card, index) => normalizeSequenceCard(card, index));
                }
            }
        }

        sequenceCards = sequenceCards
            .map((card, index) => {
                const normalized = { ...card };
                const coercedOrder = coercePositiveNumber(normalized.order) ?? (index + 1);
                if (coercedOrder !== normalized.order) {
                    normalized.order = coercedOrder;
                    migrated = true;
                }
                if (!normalized.id) {
                    normalized.id = (typeof crypto !== 'undefined' && crypto.randomUUID)
                        ? crypto.randomUUID()
                        : `seq-${Date.now()}-${index}`;
                    migrated = true;
                }
                normalized.question = normalized.question || '';
                normalized.answer = cleanStepText(normalized.answer || normalized.term || normalized.step || normalized.text || '');
                return normalized;
            })
            .sort((a, b) => a.order - b.order);

        if (sequenceCards.length >= 2 && !workingDeck.typeHint && isSequenceDeck({ ...workingDeck, cards: sequenceCards })) {
            workingDeck.typeHint = 'Sequence';
            migrated = true;
        }

        const migrationVersion = typeof workingDeck.sequenceMigrationVersion === 'number'
            ? workingDeck.sequenceMigrationVersion
            : 0;
        if (migrated && migrationVersion < 1) {
            workingDeck.sequenceMigrationVersion = 1;
        }

        return { deck: workingDeck, cards: sequenceCards, migrated };
    }

    const helpers = {
        STEP_PREFIX_REGEX,
        convertStepToString,
        cleanStepText,
        isSequenceDeck,
        adaptLegacySequenceDeck
    };

    if (typeof window !== 'undefined') {
        if (!window.sequenceStepUtils) {
            window.sequenceStepUtils = helpers;
        } else {
            Object.assign(window.sequenceStepUtils, helpers);
        }
    }
})();
