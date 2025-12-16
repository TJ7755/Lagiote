const env = (typeof import.meta !== 'undefined' && import.meta.env) ? import.meta.env : {};
const AUTH0_DOMAIN = env.VITE_AUTH0_DOMAIN || 'REPLACE_WITH_AUTH0_DOMAIN';
const AUTH0_CLIENT_ID = env.VITE_AUTH0_CLIENT_ID || 'REPLACE_WITH_AUTH0_CLIENT_ID';
const AUTH0_AUDIENCE = env.VITE_AUTH0_AUDIENCE || 'REPLACE_WITH_AUTH0_AUDIENCE';

export { AUTH0_DOMAIN, AUTH0_CLIENT_ID, AUTH0_AUDIENCE };
