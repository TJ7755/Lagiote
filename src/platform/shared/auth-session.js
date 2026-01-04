import { AUTH0_DOMAIN, AUTH0_CLIENT_ID, AUTH0_AUDIENCE } from './auth0-config.js';
import { isTestMode, getTestSession } from './test-mode.js';

const SESSION_KEY = 'auth0Session';
const GUEST_ID_KEY = 'guestID';
const DEFAULT_AUTH0_DOMAIN = AUTH0_DOMAIN;
const DEFAULT_AUTH0_CLIENT_ID = AUTH0_CLIENT_ID;
const DEFAULT_AUTH0_AUDIENCE = AUTH0_AUDIENCE;

function safeParse(json) {
    if (!json) return null;
    try {
        return JSON.parse(json);
    } catch (e) {
        return null;
    }
}

export function getStoredSessionRaw() {
    if (typeof localStorage === 'undefined') return null;
    return localStorage.getItem(SESSION_KEY);
}

export function getStoredSession() {
    return safeParse(getStoredSessionRaw());
}

export function saveSession(session) {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(SESSION_KEY, JSON.stringify(session));
}

export function clearSession() {
    if (typeof localStorage === 'undefined') return;
    localStorage.removeItem(SESSION_KEY);
}

export function getAccessToken(session) {
    if (!session || typeof session !== 'object') return null;
    return session.accessToken || session.token || session.access_token || session.id_token || session.idToken || null;
}

export function getStoredToken() {
    const session = getStoredSession();
    return getAccessToken(session);
}

export function getAuthConfig(overrides = {}) {
    const runtimeConfig = (typeof window !== 'undefined' && window.auth0WebConfig) ? window.auth0WebConfig : {};
    const domain = overrides.domain || runtimeConfig.domain || DEFAULT_AUTH0_DOMAIN;
    const clientId = overrides.clientId || runtimeConfig.clientId || DEFAULT_AUTH0_CLIENT_ID;
    const audience = overrides.audience || runtimeConfig.audience || DEFAULT_AUTH0_AUDIENCE;

    return { domain, clientId, audience };
}

export function isGuestMode() {
    if (typeof localStorage === 'undefined') return false;
    return localStorage.getItem('guestMode') === 'true' || sessionStorage.getItem('guestMode') === 'true';
}

export function setGuestMode(enabled) {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem('guestMode', enabled ? 'true' : 'false');
    sessionStorage.setItem('guestMode', enabled ? 'true' : 'false');
}

export function getOrCreateGuestID() {
    if (typeof localStorage === 'undefined') return null;
    let guestId = localStorage.getItem(GUEST_ID_KEY);
    if (!guestId) {
        guestId = (crypto?.randomUUID?.() || `guest_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`);
        localStorage.setItem(GUEST_ID_KEY, guestId);
    }
    return guestId;
}

function ensureAuth0Script() {
    if (isTestMode()) return Promise.resolve();
    if (typeof window === 'undefined') return Promise.reject(new Error('No window available'));
    if (window.auth0 && typeof window.auth0.createAuth0Client === 'function') return Promise.resolve();
    return Promise.reject(new Error('Auth0 client not available'));
}

export async function startAuthFlow({ screenHint } = {}) {
    if (isTestMode()) {
        const session = getTestSession();
        saveSession(session);
        return session;
    }
    // Electron path
    if (typeof window !== 'undefined' && window.electronAPI?.openLoginWindow) {
        const authResult = await window.electronAPI.openLoginWindow();
        if (authResult?.user) {
            saveSession(authResult);
        }
        return authResult;
    }

    await ensureAuth0Script();
    const { domain, clientId, audience } = getAuthConfig();

    const auth0Client = await window.auth0.createAuth0Client({
        domain,
        clientId,
        authorizationParams: {
            redirect_uri: window.location.origin + '/',
            audience,
            scope: 'openid profile email',
            ...(screenHint ? { screen_hint: screenHint } : {})
        }
    });

    await auth0Client.loginWithRedirect();
    return null;
}

export async function handleWebRedirect({ save = saveSession } = {}) {
    if (isTestMode()) {
        const session = getTestSession();
        save(session);
        return session;
    }
    await ensureAuth0Script();
    const { domain, clientId, audience } = getAuthConfig();

    const auth0Client = await window.auth0.createAuth0Client({
        domain,
        clientId,
        authorizationParams: {
            redirect_uri: window.location.origin + '/',
            audience,
            scope: 'openid profile email'
        }
    });

    await auth0Client.handleRedirectCallback();
    const user = await auth0Client.getUser();
    const token = await auth0Client.getTokenSilently();
    const authResult = {
        user,
        access_token: token,
        id_token: token
    };
    save(authResult);
    window.history.replaceState({}, document.title, '/');
    return authResult;
}
