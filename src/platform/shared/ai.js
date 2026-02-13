import { isElectronRenderer } from './env.js';

const LOCAL_GENERATE_URL = '/api/generate';
const DEFAULT_BACKEND_URL = 'https://tj7755-lagiote-proxy.hf.space';

function resolveProxyGenerateUrl() {
    if (typeof window !== 'undefined') {
        const base = (window.BACKEND_URL || DEFAULT_BACKEND_URL || '').toString().trim();
        if (base) {
            return `${base.replace(/\/$/, '')}/api/generate`;
        }
    }
    return `${DEFAULT_BACKEND_URL}/api/generate`;
}

async function postJson(url, payload) {
    const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
    });

    if (!response.ok) {
        let detail = '';
        try {
            const contentType = response.headers.get('content-type') || '';
            if (contentType.includes('application/json')) {
                const json = await response.json();
                detail = json?.message || json?.error || JSON.stringify(json);
            } else {
                detail = (await response.text()).trim();
            }
        } catch (e) {
            // Ignore parsing issues.
        }

        const suffix = detail ? `: ${detail}` : '';
        const error = new Error(`Server function error: ${response.status}${suffix}`);
        error.status = response.status;
        throw error;
    }

    return response.json();
}

async function generateDeckViaElectron(payload) {
    if (!window.electronAPI || typeof window.electronAPI.generateDeck !== 'function') {
        throw new Error('Electron AI adapter unavailable');
    }
    return window.electronAPI.generateDeck(payload);
}

async function generateDeckViaServer(payload) {
    try {
        return await postJson(LOCAL_GENERATE_URL, payload);
    } catch (error) {
        const status = error?.status;
        // If the local origin function is unavailable/misconfigured, fall back to the proxy.
        if (status === 404 || (typeof status === 'number' && status >= 500)) {
            const proxyUrl = resolveProxyGenerateUrl();
            if (proxyUrl !== LOCAL_GENERATE_URL) {
                return postJson(proxyUrl, payload);
            }
        }
        throw error;
    }
}

export async function generateDeck(payload) {
    if (isElectronRenderer()) {
        return generateDeckViaElectron(payload);
    }

    return generateDeckViaServer(payload);
}
