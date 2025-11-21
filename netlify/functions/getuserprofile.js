const { Pool } = require('pg');

exports.handler = async (event, context) => {
    const { user } = context.clientContext;

    if (!user) {
        return {
            statusCode: 401,
            body: JSON.stringify({ error: 'You must be logged in to access this.' }),
        };
    }

    const pool = new Pool({ connectionString: process.env.DATABASE_URL });
    const client = await pool.connect(); 

    try {
        const result = await client.query('SELECT * FROM users WHERE id = $1', [user.sub]);

        let userProfile;
        if (result.rows.length === 0) {
            const newUser = await client.query( 
                'INSERT INTO users (id, email) VALUES ($1, $2) RETURNING *',
                [user.sub, user.email]
            );
            userProfile = newUser.rows[0];
        } else {
            userProfile = result.rows[0];
        }

        return {
            statusCode: 200,
            body: JSON.stringify(userProfile),
        };

    } catch (error) {
        console.error('Database Error:', error);
        return { statusCode: 500, body: JSON.stringify({ error: 'Internal server error.' }) };
    } finally {
        client.release(); 
    }
};