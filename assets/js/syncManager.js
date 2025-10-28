// Initialize Netlify Identity
function initializeAuth() {
  if (typeof netlifyIdentity !== 'undefined') {
    netlifyIdentity.on('init', user => {
      console.log('Netlify Identity initialized');
      updateAuthUI(user);
      if (user) {
        handleAuthSuccess(user);
      }
    });

    netlifyIdentity.on('login', user => {
      console.log('Login successful');
      handleAuthSuccess(user);
      updateAuthUI(user);
      
      // Handle window closing differently based on environment
      if (window.electronAPI?.isElectron) {
        // In Electron app
        const loginWindow = window.self;
        if (loginWindow !== window.top) {
          loginWindow.close();
        }
      } else {
        // In web browser
        netlifyIdentity.close();
      }
    });

    netlifyIdentity.on('logout', () => {
      console.log('Logged out');
      localStorage.removeItem('userToken');
      localStorage.removeItem('userId');
      updateAuthUI(null);
    });

    netlifyIdentity.init({
      APIUrl: 'https://lagiote-revise.netlify.app/.netlify/identity'
    });
  } else {
    console.error('Netlify Identity Widget not loaded');
  }
}

function updateAuthUI(user) {
  const authView = document.getElementById('authView');
  const loggedInView = document.getElementById('loggedInView');
  const loggedOutView = document.getElementById('loggedOutView');
  const userProfileMenu = document.getElementById('userProfileMenu');
  const userEmailElement = document.getElementById('userEmail');

  if (user) {
    authView.classList.add('hidden');
    loggedInView.classList.remove('hidden');
    loggedOutView.classList.add('hidden');
    userProfileMenu.classList.remove('hidden');
    if (userEmailElement) {
      userEmailElement.textContent = user.email;
    }
  } else {
    if (!localStorage.getItem('guestMode')) {
      authView.classList.remove('hidden');
      loggedInView.classList.add('hidden');
      loggedOutView.classList.remove('hidden');
    }
    userProfileMenu.classList.add('hidden');
  }
}

function handleAuthSuccess(user) {
  localStorage.setItem('userToken', user.token.access_token);
  localStorage.setItem('userId', user.id);
  syncQueuedData(); // Attempt to sync any pending data
}

// Initialize auth when the script loads
document.addEventListener('DOMContentLoaded', () => {
  initializeAuth();

  // Set up auth-related click handlers
  document.getElementById('authSignupBtn')?.addEventListener('click', () => {
    netlifyIdentity.open('signup');
  });

  document.getElementById('authLoginBtn')?.addEventListener('click', () => {
    netlifyIdentity.open('login');
  });

  document.getElementById('logoutBtn')?.addEventListener('click', () => {
    netlifyIdentity.logout();
  });

  document.getElementById('continueAsGuestBtn')?.addEventListener('click', () => {
    localStorage.setItem('guestMode', 'true');
    document.getElementById('authView').classList.add('hidden');
    document.getElementById('loggedInView').classList.remove('hidden');
  });
});

export function queueForSync(update) {
  const queued = JSON.parse(localStorage.getItem('pendingSync') || '[]');
  queued.push({
    data: update,
    timestamp: Date.now(),
  });
  localStorage.setItem('pendingSync', JSON.stringify(queued));
  console.log("Queued update for sync:", update);
}

export async function syncQueuedData() {
  const queued = JSON.parse(localStorage.getItem('pendingSync') || '[]');
  const token = localStorage.getItem('userToken');

  if (!queued.length) {
    console.log("No pending data to sync");
    return;
  }
  if (!token) {
    console.warn("Can't sync: no user token");
    return;
  }

  console.log(`Attempting to sync ${queued.length} items...`);
  const result = await window.electronAPI.syncData({ decks: queued, token });

  if (result?.success !== false) {
    console.log("Sync successful, clearing queue");
    localStorage.removeItem('pendingSync');
  } else {
    console.warn("Sync failed; keeping data queued:", result.error);
  }
}

window.addEventListener('online', syncQueuedData);