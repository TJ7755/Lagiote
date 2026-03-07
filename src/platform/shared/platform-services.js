import { isElectronRenderer } from './env.js';
import * as authSession from './auth-session.js';
import { generateDeck } from './ai.js';

const DEFAULT_BACKEND_URL = 'https://tj7755-lagiote-proxy.hf.space';

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
    function resolveSyncUrl() {
        if (typeof window !== 'undefined') {
            const base = (window.BACKEND_URL || DEFAULT_BACKEND_URL || '').toString().trim();
            if (base) {
                return `${base.replace(/\/$/, '')}/api/sync`;
            }
        }
        return `${DEFAULT_BACKEND_URL}/api/sync`;
    }

    return {
        async syncData(payload) {
            if (typeof window !== 'undefined' && window.electronAPI?.syncData) {
                return window.electronAPI.syncData(payload);
            }

            const { token, guestId, ...syncPayload } = payload || {};
            const headers = {
                'Content-Type': 'application/json'
            };

            if (token) {
                headers.Authorization = `Bearer ${token}`;
            } else if (guestId) {
                headers['X-Guest-ID'] = guestId;
            }

            const response = await fetch(resolveSyncUrl(), {
                method: 'POST',
                headers,
                body: JSON.stringify(syncPayload)
            });

            if (!response.ok) {
                let detail = '';
                try {
                    detail = (await response.text()).trim();
                } catch (error) {
                    detail = '';
                }
                const suffix = detail ? ` ${detail}` : '';
                throw new Error(`Sync failed with status ${response.status}${suffix}`);
            }

            return response.json();
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
