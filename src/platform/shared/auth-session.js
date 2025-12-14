const SESSION_KEY = 'auth0Session';
const GUEST_ID_KEY = 'guestID';
const DEFAULT_AUTH0_DOMAIN = 'dev-tn0gt5rtacrg1qdw.uk.auth0.com';
const DEFAULT_AUTH0_CLIENT_ID = 'fFvjuKKem8V4mN6W5eD753fKmCVncT1H';
const DEFAULT_AUTH0_AUDIENCE = 'https://dev-tn0gt5rtacrg1qdw.uk.auth0.com/api/v2/';

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
    const domain = overrides.domain ||
        document.querySelector('meta[name="auth0-domain"]')?.content ||
        DEFAULT_AUTH0_DOMAIN;
    const clientId = overrides.clientId ||
        document.querySelector('meta[name="auth0-client-id"]')?.content ||
        DEFAULT_AUTH0_CLIENT_ID;
    const audience = overrides.audience ||
        document.querySelector('meta[name="auth0-audience"]')?.content ||
        DEFAULT_AUTH0_AUDIENCE;

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

function ensureAuth0Script(loadScript) {
    if (typeof window === 'undefined') return Promise.reject(new Error('No window available'));
    if (window.auth0) return Promise.resolve();

    if (typeof loadScript === 'function') {
        return loadScript('https://cdn.auth0.com/js/auth0-spa-js/2.4/auth0-spa-js.production.js');
    }

    return new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = 'https://cdn.auth0.com/js/auth0-spa-js/2.4/auth0-spa-js.production.js';
        script.onload = resolve;
        script.onerror = reject;
        document.head.appendChild(script);
    });
}

export async function startAuthFlow({ screenHint, loadScript } = {}) {
    // Electron path
    if (typeof window !== 'undefined' && window.electronAPI?.openLoginWindow) {
        const authResult = await window.electronAPI.openLoginWindow();
        if (authResult?.user) {
            saveSession(authResult);
        }
        return authResult;
    }

    await ensureAuth0Script(loadScript);
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

export async function handleWebRedirect({ loadScript, save = saveSession } = {}) {
    await ensureAuth0Script(loadScript);
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
