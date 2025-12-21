import assert from 'assert';
import { collectCardMetasForDecks } from '../js/core/card-meta.js';

console.log('Running Card Meta Tests...');

{
    const decks = {
        bDeck: { cards: [{ id: 'b2' }, { id: 'b1' }] },
        aDeck: { cards: [{ id: 'a3' }, { id: 'a1' }] }
    };
    const metas = collectCardMetasForDecks(decks, ['bDeck', 'aDeck'], null, () => 0.5);
    const order = metas.map(meta => `${meta.deckId}:${meta.cardId}`);
    assert.deepStrictEqual(order, ['aDeck:a1', 'aDeck:a3', 'bDeck:b1', 'bDeck:b2']);
}

{
    const metas = collectCardMetasForDecks({}, []);
    assert.deepStrictEqual(metas, []);
}

console.log('Card Meta Tests Passed!');
