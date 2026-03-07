import { isElectronRenderer } from './env.js';
import * as authSession from './auth-session.js';
import { generateDeck } from './ai.js';

function createRuntimeService() {
    const electron = isElectronRenderer();
    return {
        isElectron: electron,
        isWeb: !electron,
        isOnline() {
            if (typeof navigator === 'undefined') return true;
            return navigator.onLine;
        }
    };
}

function createAuthService() {
    return {
        getStoredSession: authSession.getStoredSession,
        getStoredSessionRaw: authSession.getStoredSessionRaw,
        saveSession: authSession.saveSession,
        clearSession: authSession.clearSession,
        getAccessToken: authSession.getAccessToken,
        getStoredToken: authSession.getStoredToken,
        getAuthConfig: authSession.getAuthConfig,
        startAuthFlow: authSession.startAuthFlow,
        handleWebRedirect: authSession.handleWebRedirect,
        isGuestMode: authSession.isGuestMode,
        setGuestMode: authSession.setGuestMode,
        getOrCreateGuestID: authSession.getOrCreateGuestID
    };
}

function createStorageService() {
    return {
        local: {
            getItem(key) {
                return typeof localStorage === 'undefined' ? null : localStorage.getItem(key);
            },
            setItem(key, value) {
                if (typeof localStorage === 'undefined') return;
                localStorage.setItem(key, value);
            },
            removeItem(key) {
                if (typeof localStorage === 'undefined') return;
                localStorage.removeItem(key);
            }
        },
        session: {
            getItem(key) {
                return typeof sessionStorage === 'undefined' ? null : sessionStorage.getItem(key);
            },
            setItem(key, value) {
                if (typeof sessionStorage === 'undefined') return;
                sessionStorage.setItem(key, value);
            },
            removeItem(key) {
                if (typeof sessionStorage === 'undefined') return;
                sessionStorage.removeItem(key);
            }
        }
    };
}

function createAiService() {
    return {
        generateDeck
    };
}

function createSyncService() {
    return {
        async syncData(payload) {
            if (typeof window !== 'undefined' && window.electronAPI?.syncData) {
                return window.electronAPI.syncData(payload);
            }
            throw new Error('Sync service is not available in this runtime');
        }
    };
}

function createShellService() {
    return {
        reload() {
            if (typeof window === 'undefined') return;
            window.location.reload();
        },
        navigate(url) {
            if (typeof window === 'undefined') return;
            window.location.assign(url);
        },
        goBack() {
            if (typeof window === 'undefined') return;
            window.history.back();
        }
    };
}

export function createPlatformServices() {
    return {
        runtime: createRuntimeService(),
        auth: createAuthService(),
        storage: createStorageService(),
        ai: createAiService(),
        sync: createSyncService(),
        shell: createShellService()
    };
}
