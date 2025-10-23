const { Pool } = require('pg');

exports.handler = async (event, context) => {
    const { user } = context.clientContext;
    if (!user) {
        return { statusCode: 401, body: JSON.stringify({ error: 'Unauthorized' }) };
    }

    const pool = new Pool({ connectionString: process.env.DATABASE_URL });
    const client = await pool.connect();

    try {
        const { lastSynced, dirtyDecks, dirtyKnowledgeStates } = JSON.parse(event.body);

        await client.query('BEGIN');

        if (dirtyDecks && dirtyDecks.length > 0) {
            for (const deck of dirtyDecks) {
                await client.query(
                    `INSERT INTO decks (id, owner_id, data, last_modified)
                     VALUES ($1, $2, $3, NOW())
                     ON CONFLICT (id) DO UPDATE SET data = $3, last_modified = NOW()`,
                    [deck.id, user.sub, deck] 
                );
            }
        }

        if (dirtyKnowledgeStates && dirtyKnowledgeStates.length > 0) {
            for (const state of dirtyKnowledgeStates) {
                await client.query(
                    `INSERT INTO user_knowledge_state (user_id, card_id, data, last_modified)
                     VALUES ($1, $2, $3, NOW())
                     ON CONFLICT (user_id, card_id) DO UPDATE SET data = $3, last_modified = NOW()`,
                    [user.sub, state.cardID, state]
                );
            }
        }

        const remoteDecks = await client.query(
            'SELECT data FROM decks WHERE owner_id = $1 AND last_modified > $2',
            [user.sub, lastSynced || '1970-01-01']
        );

        const remoteKnowledgeStates = await client.query(
            'SELECT data FROM user_knowledge_state WHERE user_id = $1 AND last_modified > $2',
            [user.sub, lastSynced || '1970-01-01']
        );

        await client.query('COMMIT');

        return {
            statusCode: 200,
            body: JSON.stringify({
                newTimestamp: new Date().toISOString(),
                updatedDecks: remoteDecks.rows.map(r => r.data),
                updatedKnowledgeStates: remoteKnowledgeStates.rows.map(r => r.data),
            }),
        };

    } catch (error) {
        await client.query('ROLLBACK'); 
        console.error('Sync Error:', error);
        return { statusCode: 500, body: JSON.stringify({ error: 'Sync failed.' }) };
    } finally {
        client.release(); 
    }
};