// Auth0 Authentication Service for Electron Native App
// Based on https://auth0.com/blog/securing-electron-applications-with-openid-connect-and-oauth-2/

const { jwtDecode } = require('jwt-decode');
const axios = require('axios');
const url = require('url');
const crypto = require('crypto');
const { safeStorage } = require('electron');
const fs = require('fs');
const path = require('path');
const os = require('os');

// Configuration
const auth0Domain = process.env.ELECTRON_AUTH0_DOMAIN;
const clientId = process.env.ELECTRON_AUTH0_CLIENT_ID;
const audience = process.env.ELECTRON_AUTH0_AUDIENCE;
let redirectUri = process.env.ELECTRON_AUTH0_REDIRECT_URI || null;

// Storage for tokens (using file-based storage with encryption)
const tokenStoragePath = path.join(os.homedir(), '.lagiote-auth');

// In-memory token storage
let accessToken = null;
let profile = null;
let refreshToken = null;

// Generate PKCE code verifier and challenge
function generatePKCE() {
    const verifier = crypto.randomBytes(32).toString('base64url');
    const challenge = crypto
        .createHash('sha256')
        .update(verifier)
        .digest('base64url');

    return { verifier, challenge };
}

// Store PKCE verifier temporarily (for the duration of the auth flow)
let currentPKCE = null;

function setRedirectUri(uri) {
    redirectUri = uri;
    console.log('[Auth] Redirect URI configured:', redirectUri);
}

function getRedirectUri() {
    if (!redirectUri) {
        throw new Error('Redirect URI not configured. Start the callback server before requesting authentication.');
    }
    return redirectUri;
}

/**
 * Get the Auth0 authentication URL
 * @returns {string} The Auth0 authorise URL with PKCE
 */
function getAuthenticationURL() {
    if (!auth0Domain || !clientId) {
        throw new Error('Auth0 configuration missing. Please set ELECTRON_AUTH0_DOMAIN and ELECTRON_AUTH0_CLIENT_ID in .env.local');
    }

    // Generate PKCE values
    currentPKCE = generatePKCE();

    // Build authorization URL
    const authParams = new URLSearchParams({
        scope: 'openid profile email offline_access',
        response_type: 'code',
        client_id: clientId,
        code_challenge: currentPKCE.challenge,
        code_challenge_method: 'S256',
        redirect_uri: getRedirectUri()
    });

    if (audience) {
        authParams.append('audience', audience);
    }

    console.log('[Auth] Configured audience:', audience || 'None');

    const authUrl = `https://${auth0Domain}/authorize?${authParams.toString()}`;
    console.log('[Auth] Final redirect URI:', getRedirectUri());
    return authUrl;
}

/**
 * Exchange authorization code for tokens
 * @param {string} callbackURL - The callback URL with authorization code
 */
async function loadTokens(callbackURL) {
    try {
        const urlParts = url.parse(callbackURL, true);
        const query = urlParts.query;

        if (!query.code) {
            throw new Error('No authorization code found in callback URL');
        }

        if (!currentPKCE) {
            throw new Error('No PKCE verifier found. Please restart the authentication flow.');
        }

        // Exchange authorization code for tokens
        const exchangeOptions = {
            grant_type: 'authorization_code',
            client_id: clientId,
            code: query.code,
            code_verifier: currentPKCE.verifier,
            redirect_uri: getRedirectUri()
        };

        const options = {
            method: 'POST',
            url: `https://${auth0Domain}/oauth/token`,
            headers: { 'content-type': 'application/json' },
            data: exchangeOptions
        };

        const response = await axios(options);

        // Store tokens
        accessToken = response.data.access_token;
        profile = jwtDecode(response.data.id_token);
        refreshToken = response.data.refresh_token;

        // Save refresh token securely
        if (refreshToken) {
            await saveRefreshToken(refreshToken);
        }

        // Clear PKCE verifier
        currentPKCE = null;

        return { accessToken, profile };
    } catch (error) {
        console.error('Token exchange error:', error);
        await logout();
        throw error;
    }
}

/**
 * Refresh the access token using the refresh token
 */
async function refreshTokens() {
    const storedRefreshToken = await loadRefreshToken();

    if (storedRefreshToken) {
        const refreshOptions = {
            method: 'POST',
            url: `https://${auth0Domain}/oauth/token`,
            headers: { 'content-type': 'application/json' },
            data: {
                grant_type: 'refresh_token',
                client_id: clientId,
                refresh_token: storedRefreshToken
            }
        };

        try {
            const response = await axios(refreshOptions);
            accessToken = response.data.access_token;
            profile = jwtDecode(response.data.id_token);

            return { accessToken, profile };
        } catch (error) {
            console.error('Token refresh error:', error);
            await logout();
            throw error;
        }
    } else {
        throw new Error('No available refresh token.');
    }
}

/**
 * Save refresh token securely
 * @param {string} token - The refresh token to save
 */
async function saveRefreshToken(token) {
    try {
        // Ensure storage directory exists
        const storageDir = path.dirname(tokenStoragePath);
        if (!fs.existsSync(storageDir)) {
            fs.mkdirSync(storageDir, { recursive: true });
        }

        // Use Electron's safeStorage if available, otherwise use base64 encoding
        let encryptedToken;
        if (safeStorage && safeStorage.isEncryptionAvailable()) {
            const buffer = safeStorage.encryptString(token);
            encryptedToken = buffer.toString('base64');
        } else {
            // Fallback to simple base64 encoding (not secure, but better than plaintext)
            console.warn('Secure storage not available, using base64 encoding');
            encryptedToken = Buffer.from(token).toString('base64');
        }

        fs.writeFileSync(tokenStoragePath, encryptedToken, 'utf8');
    } catch (error) {
        console.error('Error saving refresh token:', error);
    }
}

/**
 * Load refresh token from secure storage
 * @returns {string|null} The refresh token or null if not found
 */
async function loadRefreshToken() {
    try {
        if (!fs.existsSync(tokenStoragePath)) {
            return null;
        }

        const encryptedToken = fs.readFileSync(tokenStoragePath, 'utf8');

        // Use Electron's safeStorage if available
        if (safeStorage && safeStorage.isEncryptionAvailable()) {
            const buffer = Buffer.from(encryptedToken, 'base64');
            return safeStorage.decryptString(buffer);
        } else {
            // Fallback: decode base64
            return Buffer.from(encryptedToken, 'base64').toString('utf8');
        }
    } catch (error) {
        console.error('Error loading refresh token:', error);
        return null;
    }
}

/**
 * Logout and clear session
 */
async function logout() {
    // Clear in-memory tokens
    accessToken = null;
    profile = null;
    refreshToken = null;

    // Delete refresh token file
    try {
        if (fs.existsSync(tokenStoragePath)) {
            fs.unlinkSync(tokenStoragePath);
        }
    } catch (error) {
        console.error('Error deleting refresh token:', error);
    }
}

/**
 * Get the current access token
 * @returns {string|null} The access token or null if not authenticated
 */
function getAccessToken() {
    return accessToken;
}

/**
 * Get the current user profile
 * @returns {object|null} The user profile or null if not authenticated
 */
function getProfile() {
    return profile;
}

/**
 * Get the Auth0 logout URL
 * @returns {string} The logout URL
 */
function getLogOutUrl() {
    return `https://${auth0Domain}/v2/logout`;
}

module.exports = {
    getAccessToken,
    getAuthenticationURL,
    getLogOutUrl,
    getProfile,
    loadTokens,
    logout,
    refreshTokens,
    setRedirectUri,
    getRedirectUri
};
