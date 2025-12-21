import { AUTH0_DOMAIN, AUTH0_CLIENT_ID, AUTH0_AUDIENCE } from '../shared/auth0-config.js';

const AUTH0_SDK_VERSION = '2.11.0';

let sdkCreateAuth0Client = null;
let createAuth0ClientPromise = null;

async function resolveCreateAuth0Client() {
    if (sdkCreateAuth0Client) return sdkCreateAuth0Client;
    if (typeof window !== 'undefined' && window.auth0 && typeof window.auth0.__sdkCreateAuth0Client === 'function') {
        sdkCreateAuth0Client = window.auth0.__sdkCreateAuth0Client;
        return sdkCreateAuth0Client;
    }

    if (createAuth0ClientPromise) return createAuth0ClientPromise;

    createAuth0ClientPromise = (async () => {
        // 1) Bundler path (Vite): this will be resolved at build-time.
        try {
            const mod = await import('@auth0/auth0-spa-js');
            if (mod && typeof mod.createAuth0Client === 'function') {
                sdkCreateAuth0Client = mod.createAuth0Client;
                return sdkCreateAuth0Client;
            }
        } catch (e) {
            // Ignore and try CDN.
        }

        // 2) No-bundler path: load ESM directly from a CDN.
        try {
            const url = `https://cdn.jsdelivr.net/npm/@auth0/auth0-spa-js@${AUTH0_SDK_VERSION}/dist/auth0-spa-js.production.esm.js`;
            const mod = await import(/* @vite-ignore */ url);
            if (mod && typeof mod.createAuth0Client === 'function') {
                sdkCreateAuth0Client = mod.createAuth0Client;
                return sdkCreateAuth0Client;
            }
        } catch (e) {
            // Ignore and throw below.
        }

        throw new Error('Auth0 SPA SDK could not be loaded');
    })();

    return createAuth0ClientPromise;
}

const platformConfig = {
    domain: AUTH0_DOMAIN,
    clientId: AUTH0_CLIENT_ID,
    audience: AUTH0_AUDIENCE || undefined
};

function createClient(options = {}) {
    const authorizationParams = {
        audience: platformConfig.audience,
        ...(options.authorizationParams || {})
    };

    return (async () => {
        const createAuth0Client = await resolveCreateAuth0Client();
        return createAuth0Client({
            domain: platformConfig.domain,
            clientId: platformConfig.clientId,
            ...options,
            authorizationParams
        });
    })();
}

if (typeof window !== 'undefined') {
    const configPayload = {
        domain: platformConfig.domain,
        clientId: platformConfig.clientId
    };
    if (platformConfig.audience) {
        configPayload.audience = platformConfig.audience;
    }
    window.auth0WebConfig = configPayload;
    const existing = window.auth0 || {};
    // Always install a wrapper so callers never depend on a failing static import.
    existing.createAuth0Client = (opts = {}) => createClient(opts);
    existing.__fromBoot = true;
    window.auth0 = existing;
}
