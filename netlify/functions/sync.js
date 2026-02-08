const { Pool } = require('pg');

exports.handler = async (event, context) => {
    const { user } = context.clientContext;
    if (!user) {
        return {
            statusCode: 401,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ error: 'Unauthorised' })
        };
    }

    const pool = new Pool({ connectionString: process.env.DATABASE_URL });
    let client;

    try {
        client = await pool.connect();

        // Safely parse request body
        let requestBody;
        try {
            requestBody = typeof event.body === 'string' ? JSON.parse(event.body) : (event.body || {});
        } catch (parseError) {
            console.error('Body parse error:', parseError);
            return {
                statusCode: 400,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ error: 'Invalid request body' })
            };
        }

        const { lastSynced, dirtyDecks, dirtyKnowledgeStates } = requestBody;

        await client.query('BEGIN');

        if (dirtyDecks && dirtyDecks.length > 0) {
            for (const deck of dirtyDecks) {
                await client.query(
                    `INSERT INTO decks (id, owner_id, data, last_modified)
                    VALUES ($1, $2, $3, NOW())
                    ON CONFLICT (id) DO UPDATE 
                        SET data = EXCLUDED.data, 
                            last_modified = NOW()
                        WHERE decks.owner_id = $2`,
                    [deck.id, user.sub, JSON.stringify(deck)]
                );
            }
        }

        if (dirtyKnowledgeStates && dirtyKnowledgeStates.length > 0) {
            for (const state of dirtyKnowledgeStates) {
                await client.query(
                    `INSERT INTO user_knowledge_state (user_id, card_id, data, last_modified)
                     VALUES ($1, $2, $3, NOW())
                     ON CONFLICT (user_id, card_id) DO UPDATE SET data = $3, last_modified = NOW()`,
                    [user.sub, state.cardID, JSON.stringify(state)]
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
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                newTimestamp: new Date().toISOString(),
                updatedDecks: remoteDecks.rows.map(r => r.data),
                updatedKnowledgeStates: remoteKnowledgeStates.rows.map(r => r.data),
            }),
        };

    } catch (error) {
        if (client) {
            try {
                await client.query('ROLLBACK');
            } catch (rollbackError) {
                console.error('Rollback error:', rollbackError);
            }
        }
        console.error('Sync Error:', error);
        return {
            statusCode: 500,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ error: 'Sync failed.', details: error.message })
        };
    } finally {
        if (client) {
            client.release();
        }
    }
};