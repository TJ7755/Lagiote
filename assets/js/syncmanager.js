
function initializeAuth() {
  // TODO: Implement Auth0 authentication
  console.log('Auth initialization - to be implemented with Auth0');
  // For now, check if user is already logged in
  const userToken = localStorage.getItem('userToken');
  if (userToken) {
    // TODO: Validate token and get user info from Auth0
    updateAuthUI({ email: 'user@example.com' }); // Placeholder
  } else {
    updateAuthUI(null);
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
  syncQueuedData(); 
}


document.addEventListener('DOMContentLoaded', () => {
  initializeAuth();

  
  if (localStorage.getItem('guestMode')) {
    document.getElementById('authView')?.classList.add('hidden');
    document.getElementById('loggedInView')?.classList.remove('hidden');
    document.getElementById('appHeader')?.classList.remove('hidden');
  }

  
  document.getElementById('authSignupBtn')?.addEventListener('click', () => {
    // TODO: Implement Auth0 signup
    console.log('Signup will be implemented with Auth0');
  });

  document.getElementById('authLoginBtn')?.addEventListener('click', () => {
    // TODO: Implement Auth0 login
    console.log('Login will be implemented with Auth0');
  });

  document.getElementById('logoutBtn')?.addEventListener('click', () => {
    // TODO: Implement Auth0 logout
    console.log('Logout will be implemented with Auth0');
    localStorage.removeItem('userToken');
    localStorage.removeItem('userId');
    updateAuthUI(null);
  });

  document.getElementById('continueAsGuestBtn')?.addEventListener('click', () => {
    const rememberGuest = document.getElementById('rememberGuestCheckbox')?.checked;
    if (rememberGuest) {
      localStorage.setItem('guestMode', 'true');
    } else {
      sessionStorage.setItem('guestMode', 'true');
    }
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
  try {
    const result = await window.electronAPI.syncData({ decks: queued, token });

    
    if (result?.offline) {
      console.warn("Sync unavailable (offline):", result.message);
      
      return;
    }

    if (result?.success !== false && !result?.error) {
      console.log("Sync successful, clearing queue");
      localStorage.removeItem('pendingSync');
    } else {
      console.warn("Sync failed; keeping data queued:", result.error);
    }
  } catch (error) {
    console.error("Sync error (will retry when online):", error);
    
  }
}

window.addEventListener('online', syncQueuedData);