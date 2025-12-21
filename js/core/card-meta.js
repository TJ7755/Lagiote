export function collectCardMetasForDecks(decks, deckIds = null, knowledgeMap = null, computeDifficultyProxy = null) {
    const metas = [];
    if (!decks) {
        return metas;
    }
    const selectedDeckIds = Array.isArray(deckIds) && deckIds.length ? deckIds : Object.keys(decks);
    for (const deckId of selectedDeckIds) {
        const deck = decks?.[deckId];
        const cards = Array.isArray(deck?.cards) ? deck.cards : [];
        for (const card of cards) {
            const difficulty = typeof computeDifficultyProxy === 'function'
                ? computeDifficultyProxy(card, knowledgeMap?.get?.(card.id))
                : 0.5;
            metas.push({
                cardId: card.id,
                deckId,
                difficulty
            });
        }
    }
    metas.sort((a, b) => {
        const deckCompare = String(a.deckId).localeCompare(String(b.deckId));
        if (deckCompare !== 0) {
            return deckCompare;
        }
        return String(a.cardId).localeCompare(String(b.cardId));
    });
    return metas;
}

export function collectCardMetas(decks, knowledgeMap, computeDifficultyProxy) {
    return collectCardMetasForDecks(decks, null, knowledgeMap, computeDifficultyProxy);
}
