const DEFAULT_TEST_CONFIG = {
    reset: true,
    seed: true,
    auth: 'user'
};

function resolveImportMetaEnv() {
    if (typeof import.meta === 'undefined' || !import.meta.env) return {};
    return import.meta.env;
}

function isTruthy(value) {
    if (value === true) return true;
    if (typeof value === 'string') {
        const normalized = value.trim().toLowerCase();
        return normalized === '1' || normalized === 'true' || normalized === 'yes';
    }
    if (typeof value === 'number') return value === 1;
    return false;
}

export function isTestMode() {
    if (typeof window !== 'undefined' && isTruthy(window.__TEST_MODE__)) return true;
    const env = resolveImportMetaEnv();
    if (isTruthy(env.VITE_TEST_MODE)) return true;
    if (typeof process !== 'undefined' && process?.env && isTruthy(process.env.TEST_MODE)) return true;
    if (typeof localStorage !== 'undefined' && isTruthy(localStorage.getItem('TEST_MODE'))) return true;
    return false;
}

export function getTestConfig() {
    if (!isTestMode()) {
        return { enabled: false, ...DEFAULT_TEST_CONFIG };
    }
    const base = { ...DEFAULT_TEST_CONFIG };
    const fromWindow = (typeof window !== 'undefined' && window.__TEST_CONFIG__ && typeof window.__TEST_CONFIG__ === 'object')
        ? window.__TEST_CONFIG__
        : {};
    return {
        enabled: true,
        reset: isTruthy(fromWindow.reset ?? base.reset),
        seed: isTruthy(fromWindow.seed ?? base.seed),
        auth: typeof fromWindow.auth === 'string' ? fromWindow.auth : base.auth
    };
}

export function getTestSession() {
    return {
        user: {
            sub: 'test-user',
            name: 'Test User',
            email: 'test.user@local'
        },
        access_token: 'test-token',
        id_token: 'test-token',
        token_type: 'Bearer'
    };
}
