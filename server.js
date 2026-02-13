const express = require('express');
const path = require('path');
const dotenv = require('dotenv');
const fs = require('fs');

const { handler: autocompleteHandler } = require('./netlify/functions/gemini-autocomplete.js');
const { handler: distractorHandler } = require('./netlify/functions/generateDistractors.js');
const { handler: aiDeckHandler } = require('./netlify/functions/getAiCompletion.js');

const envPath = path.resolve(__dirname, '.env.local');
dotenv.config({ path: envPath });

const app = express();
const port = process.env.PORT || 3000;
const rootDir = path.resolve(__dirname);
const distDir = path.join(__dirname, 'dist');
const isAzure = Boolean(process.env.WEBSITE_INSTANCE_ID);
const isProduction = process.env.NODE_ENV === 'production' || isAzure;

const webRoot = (() => {
    if (!isProduction) {
        return rootDir;
    }

    if (!fs.existsSync(distDir)) {
        console.error('Missing dist/ directory in production. Run "npm run build" before starting the server.');
        process.exit(1);
    }

    return distDir;
})();

if (isProduction) {
    console.log(`Serving static assets from ${webRoot}`);
}

app.use(express.json({ limit: '5mb' }));

function formatNetlifyResponse(res, result) {
    if (!result) {
        res.sendStatus(500);
        return;
    }
    if (result.headers) {
        Object.entries(result.headers).forEach(([key, value]) => {
            if (value) {
                res.set(key, value);
            }
        });
    }
    const body = result.body;
    const status = result.statusCode || 200;
    if (typeof body === 'string') {
        const trimmed = body.trim();
        if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
            res.type('application/json');
        }
        res.status(status).send(body);
        return;
    }
    if (body === undefined) {
        res.sendStatus(status);
        return;
    }
    res.status(status).send(body);
}

function createApiHandler(handler) {
    return async (req, res) => {
        if (req.method !== 'POST') {
            res.sendStatus(405);
            return;
        }
        try {
            const event = {
                httpMethod: 'POST',
                body: JSON.stringify(req.body || {})
            };
            const result = await handler(event, {});
            formatNetlifyResponse(res, result);
        } catch (error) {
            console.error('AI handler error:', error);
            res.status(500).json({ error: 'internal_server_error' });
        }
    };
}

app.get('/healthz', (req, res) => {
    res.status(200).json({ ok: true });
});

const curriculaHandler = (req, res) => {
    res.json([]);
};

app.post('/api/autocomplete', createApiHandler(autocompleteHandler));
app.post('/api/distractors', createApiHandler(distractorHandler));
app.post('/api/generate', createApiHandler(aiDeckHandler));
app.get('/api/public-curricula', curriculaHandler);

app.post('/.netlify/functions/gemini-autocomplete', createApiHandler(autocompleteHandler));
app.post('/.netlify/functions/generateDistractors', createApiHandler(distractorHandler));
app.post('/.netlify/functions/getAiCompletion', createApiHandler(aiDeckHandler));
app.get('/.netlify/functions/getPublicCurricula', curriculaHandler);

app.use(express.static(webRoot));

app.use((req, res) => {
    res.sendFile(path.join(webRoot, 'index.html'));
});

app.listen(port, () => {
    console.log(`Server listening on port ${port}`);
});
