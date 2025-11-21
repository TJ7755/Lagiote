// Auth0 Integration for Electron App
// This module handles authentication in the Electron auth window

// Use global auth0 object from CDN
if (typeof auth0 === 'undefined' || !auth0.createAuth0Client) {
  throw new Error('Auth0 SDK not loaded. Please ensure the CDN script is included in auth.html');
}

const createAuth0Client = auth0.createAuth0Client;

// DOM elements
const loading = document.getElementById('loading');
const error = document.getElementById('error');
const errorDetails = document.getElementById('error-details');
const app = document.getElementById('app');
const loggedOutSection = document.getElementById('logged-out');
const loggedInSection = document.getElementById('logged-in');
const loginBtn = document.getElementById('login-btn');
const logoutBtn = document.getElementById('logout-btn');
const profileContainer = document.getElementById('profile');
const retryBtn = document.getElementById('retry-btn');

let auth0Client;

// Get Auth0 configuration from environment or fallback
function getAuth0Config() {
  // In Electron, we can't use import.meta.env directly
  // We'll need to get config from the main process or use a config file
  // For now, we'll try to get it from window.electronAPI or use defaults

  // Try to get from window (set by main process)
  const config = window.auth0Config || {};

  // In Electron renderer, process.env is not available
  // Get from window config (injected by main process) or localStorage
  const domain = config.domain || localStorage.getItem('AUTH0_DOMAIN');
  const clientId = config.clientId || localStorage.getItem('AUTH0_CLIENT_ID');

  if (!domain || !clientId) {
    console.warn('Auth0 configuration missing. Please check your .env.local file for VITE_AUTH0_DOMAIN and VITE_AUTH0_CLIENT_ID');
  }

  return { domain, clientId };
}

// Initialize Auth0 client
async function initAuth0() {
  try {
    showLoading();

    const { domain, clientId } = getAuth0Config();

    // Validate domain format
    if (!domain.includes('.auth0.com') && !domain.includes('.us.auth0.com') &&
      !domain.includes('.eu.auth0.com') && !domain.includes('.au.auth0.com')) {
      console.warn('Auth0 domain format might be incorrect. Expected format: your-domain.auth0.com');
    }

    // For Electron, we use a custom redirect URI
    // The redirect will be handled within the Electron window
    const redirectUri = window.location.origin + window.location.pathname;

    auth0Client = await createAuth0Client({
      domain: domain,
      clientId: clientId,
      authorizationParams: {
        redirect_uri: redirectUri
      },
      // Use popup mode for Electron (better UX)
      useRefreshTokens: true,
      cacheLocation: 'localstorage'
    });

    // Check if user is returning from login (redirect callback)
    if (window.location.search.includes('code=') && window.location.search.includes('state=')) {
      await handleRedirectCallback();
    }

    // Update UI based on authentication state
    await updateUI();
  } catch (err) {
    console.error('Auth0 initialization error:', err);
    showError(err.message);
  }
}

// Handle redirect callback
async function handleRedirectCallback() {
  try {
    await auth0Client.handleRedirectCallback();
    // Clean up the URL to remove query parameters
    window.history.replaceState({}, document.title, window.location.pathname);
  } catch (err) {
    console.error('Redirect callback error:', err);
    showError(err.message);
  }
}

// Update UI based on authentication state
async function updateUI() {
  try {
    const isAuthenticated = await auth0Client.isAuthenticated();

    if (isAuthenticated) {
      showLoggedIn();
      await displayProfile();
      // Send auth data to main process
      await sendAuthToMain();
    } else {
      showLoggedOut();
    }

    hideLoading();
  } catch (err) {
    console.error('UI update error:', err);
    showError(err.message);
  }
}

// Send authentication data to main Electron process
async function sendAuthToMain() {
  try {
    const user = await auth0Client.getUser();
    const token = await auth0Client.getTokenSilently().catch(() => null);

    const authData = {
      type: 'authorization',
      user: {
        id: user.sub,
        email: user.email,
        name: user.name,
        picture: user.picture,
        nickname: user.nickname
      },
      token: token,
      accessToken: token
    };

    // Send to main process via Electron API
    if (window.electronAPI && window.electronAPI.sendAuthToMain) {
      window.electronAPI.sendAuthToMain(authData);
      window.electronAPI.log('Authentication data sent to main process', 'info');
    } else {
      console.warn('electronAPI not available, storing in localStorage');
      localStorage.setItem('userToken', token);
      localStorage.setItem('userData', JSON.stringify(authData.user));
    }
  } catch (err) {
    console.error('Error sending auth to main:', err);
    window.electronAPI?.handleAuthError(err);
  }
}

// Display user profile
async function displayProfile() {
  try {
    const user = await auth0Client.getUser();
    const placeholderImage = `data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='110' height='110' viewBox='0 0 110 110'%3E%3Ccircle cx='55' cy='55' r='55' fill='%2363b3ed'/%3E%3Cpath d='M55 50c8.28 0 15-6.72 15-15s-6.72-15-15-15-15 6.72-15 15 6.72 15 15 15zm0 7.5c-10 0-30 5.02-30 15v3.75c0 2.07 1.68 3.75 3.75 3.75h52.5c2.07 0 3.75-1.68 3.75-3.75V72.5c0-9.98-20-15-30-15z' fill='%23fff'/%3E%3C/svg%3E`;

    profileContainer.innerHTML = `
      <div style="display: flex; flex-direction: column; align-items: center; gap: 1rem;">
        <img 
          src="${user.picture || placeholderImage}" 
          alt="${user.name || 'User'}" 
          class="profile-picture"
          style="
            width: 110px; 
            height: 110px; 
            border-radius: 50%; 
            object-fit: cover;
            border: 3px solid #63b3ed;
          "
          onerror="this.src='${placeholderImage}'"
        />
        <div style="text-align: center;">
          <div class="profile-name" style="font-size: 2rem; font-weight: 600; color: #f7fafc; margin-bottom: 0.5rem;">
            ${user.name || 'User'}
          </div>
          <div class="profile-email" style="font-size: 1.15rem; color: #a0aec0;">
            ${user.email || 'No email provided'}
          </div>
        </div>
      </div>
    `;
  } catch (err) {
    console.error('Error displaying profile:', err);
  }
}

// Event handlers
async function login() {
  try {
    // For Electron, we can use popup or redirect
    // Popup is better UX but redirect works too
    try {
      await auth0Client.loginWithPopup({
        authorizationParams: {
          redirect_uri: window.location.origin + window.location.pathname
        }
      });
      await updateUI();
    } catch (popupError) {
      // If popup fails (e.g., blocked), fall back to redirect
      if (popupError.error === 'popup_closed_by_user') {
        return; // User closed popup, don't show error
      }
      console.warn('Popup login failed, trying redirect:', popupError);
      await auth0Client.loginWithRedirect({
        authorizationParams: {
          redirect_uri: window.location.origin + window.location.pathname
        }
      });
    }
  } catch (err) {
    console.error('Login error:', err);
    showError(err.message);
    window.electronAPI?.handleAuthError(err);
  }
}

async function logout() {
  try {
    await auth0Client.logout({
      logoutParams: {
        returnTo: window.location.origin + window.location.pathname
      }
    });
    // Clear local storage
    localStorage.removeItem('userToken');
    localStorage.removeItem('userData');
    showLoggedOut();
  } catch (err) {
    console.error('Logout error:', err);
    showError(err.message);
  }
}

// UI state management
function showLoading() {
  loading.style.display = 'block';
  error.style.display = 'none';
  app.style.display = 'none';
}

function hideLoading() {
  loading.style.display = 'none';
  app.style.display = 'flex';
}

function showError(message) {
  loading.style.display = 'none';
  app.style.display = 'none';
  error.style.display = 'block';
  errorDetails.textContent = message;
}

function showLoggedIn() {
  loggedOutSection.style.display = 'none';
  loggedInSection.style.display = 'flex';
}

function showLoggedOut() {
  loggedInSection.style.display = 'none';
  loggedOutSection.style.display = 'flex';
}

// Event listeners
loginBtn.addEventListener('click', login);
logoutBtn.addEventListener('click', logout);
retryBtn.addEventListener('click', () => {
  initAuth0();
});

// Initialize the app
initAuth0();

