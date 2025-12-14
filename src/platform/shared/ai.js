import { isElectronRenderer } from './env.js';

const NETLIFY_GENERATE_URL = '/.netlify/functions/getAiCompletion';

async function generateDeckViaElectron(payload) {
    if (!window.electronAPI || typeof window.electronAPI.generateDeck !== 'function') {
        throw new Error('Electron AI adapter unavailable');
    }
    return window.electronAPI.generateDeck(payload);
}

async function generateDeckViaNetlify(payload) {
    const response = await fetch(NETLIFY_GENERATE_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
    });

    if (!response.ok) {
        throw new Error(`Server function error: ${response.status}`);
    }

    return response.json();
}

export async function generateDeck(payload) {
    if (isElectronRenderer()) {
        return generateDeckViaElectron(payload);
    }

    return generateDeckViaNetlify(payload);
}
