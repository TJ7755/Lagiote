import { isElectronRenderer } from './env.js';

const SERVER_GENERATE_URL = '/api/generate';

async function generateDeckViaElectron(payload) {
    if (!window.electronAPI || typeof window.electronAPI.generateDeck !== 'function') {
        throw new Error('Electron AI adapter unavailable');
    }
    return window.electronAPI.generateDeck(payload);
}

async function generateDeckViaServer(payload) {
    const response = await fetch(SERVER_GENERATE_URL, {
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

    return generateDeckViaServer(payload);
}
