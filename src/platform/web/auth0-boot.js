import { createAuth0Client } from '@auth0/auth0-spa-js';
import { AUTH0_DOMAIN, AUTH0_CLIENT_ID, AUTH0_AUDIENCE } from '../shared/auth0-config.js';

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
    return createAuth0Client({
        domain: platformConfig.domain,
        clientId: platformConfig.clientId,
        ...options,
        authorizationParams
    });
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
    if (!existing.createAuth0Client) {
        existing.createAuth0Client = (opts = {}) => createClient(opts);
    }
    window.auth0 = existing;
}
