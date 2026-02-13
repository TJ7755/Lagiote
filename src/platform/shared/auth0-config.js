const env = (typeof import.meta !== 'undefined' && import.meta.env) ? import.meta.env : {};

// These values are safe to ship (not secrets) and act as a fallback for
// non-Vite runs where `import.meta.env` is unavailable.
const AUTH0_DOMAIN = env.VITE_AUTH0_DOMAIN || 'dev-tn0gt5rtacrg1qdw.uk.auth0.com';
const AUTH0_CLIENT_ID = env.VITE_AUTH0_CLIENT_ID || 'fFvjuKKem8V4mN6W5eD753fKmCVncT1H';
// Optional; keep empty by default so callers can omit the audience parameter.
const AUTH0_AUDIENCE = env.VITE_AUTH0_AUDIENCE || '';

export { AUTH0_DOMAIN, AUTH0_CLIENT_ID, AUTH0_AUDIENCE };
