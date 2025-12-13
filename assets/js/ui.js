import { saveDataToDB, getDataFromDB } from './db.js';
import { decks, globalSettings, analyticsData, studyState, currentDeckId, activeView, viewHistory, isOnline, currentMode, currentViewingDeckId } from './state.js';
import { loadUserDataAndSync } from './auth.js';
import { editorInitialise, isEditorClean, editorAddNewCard, editorRenumberCards } from './editor.js';
import { startLearnMode, startReviewMode, endSession, configureStudy } from './study.js';

let isToastVisible = false;
const toastQueue = [];

export function showToast(message, type = 'info', duration = 3000, icon = null) {
    if (globalSettings.enableToasts === false) {
        if (type !== 'error') {
            return;
        }
    }
    toastQueue.push({ message, type, duration, icon });
    if (!isToastVisible) {
        processToastQueue();
    }
}

function processToastQueue() {
    if (toastQueue.length === 0) {
        isToastVisible = false;
        return;
    }

    isToastVisible = true;
    const messageItem = toastQueue.shift();
    const messageBar = document.getElementById('messageBar');

    if (!messageBar) {
        console.error('Message bar element not found');
        isToastVisible = false;
        return;
    }

    // Set message content
    messageBar.textContent = messageItem.message;

    // Reset classes
    messageBar.className = 'message-bar';

    // Add type class
    if (messageItem.type) {
        messageBar.classList.add(messageItem.type);
    }

    // Show the message bar
    messageBar.classList.remove('hidden');

    // Trigger animation
    setTimeout(() => {
        messageBar.classList.add('show');
    }, 10);

    // Auto-dismiss after duration
    setTimeout(() => {
        messageBar.classList.remove('show');
        setTimeout(() => {
            messageBar.classList.add('hidden');
            processToastQueue(); // Process next message if any
        }, 300); // Wait for slide-up animation
    }, messageItem.duration);
}

export function showView(viewId, isInitial = false, callback = null) {
    const nextView = document.getElementById(viewId);
    if (!nextView) {
        console.error('View not found:', viewId);
        return;
    }

    if (isInitial) {
        nextView.classList.remove('hidden');
        nextView.classList.add('is-visible');
        activeView = viewId;
        if (callback) callback();
        return;
    }

    const currentView = document.getElementById(activeView);
    if (currentView && currentView !== nextView) {
        currentView.classList.add('is-hiding');
        currentView.classList.remove('is-visible');

        setTimeout(() => {
            currentView.classList.remove('is-hiding');
            currentView.classList.add('hidden');
        }, 400);
    }

    nextView.classList.remove('hidden');
    nextView.classList.add('is-visible');

    activeView = viewId;
    window.scrollTo(0, 0);

    if (callback) callback();
}

export function transitionView(viewId, isInitial = false, callback = null) {
    const appHeader = document.getElementById('appHeader');
    if (viewId !== 'authView') {
        appHeader.classList.remove('hidden');
    }
    if (!isInitial && activeView !== viewId && viewId !== 'dashboard') {
        if (viewHistory[viewHistory.length - 1] !== activeView) {
            viewHistory.push(activeView);
        }
    }

    const currentView = document.getElementById(activeView);
    const nextView = document.getElementById(viewId);

    const isDashboard = viewId === 'dashboard';
    const searchBar = document.querySelector('.search-bar');
    if (searchBar) searchBar.style.display = isDashboard ? 'flex' : 'none';
    const headerSettingsBtn = document.getElementById('headerSettingsBtn');
    if (headerSettingsBtn) headerSettingsBtn.style.display = isDashboard ? 'flex' : 'none';
    const headerBackBtn = document.getElementById('headerBackBtn');
    if (headerBackBtn) headerBackBtn.classList.toggle('hidden', viewHistory.length === 0 || isDashboard);
    const headerHomeBtn = document.getElementById('headerHomeBtn');
    if (headerHomeBtn) headerHomeBtn.classList.toggle('hidden', isDashboard);

    document.getElementById('headerHomeBtn').classList.toggle('hidden', isDashboard);

    if (isInitial) {
        if (currentView) currentView.classList.remove('fade-in', 'fade-out', 'animating');
        nextView.classList.add('fade-in', 'animating');
        activeView = viewId;
        if (callback) callback();
        return;
    }

    if (currentView) {
        currentView.classList.add('fade-out', 'animating');
        currentView.classList.remove('fade-in');

        setTimeout(() => {
            currentView.style.display = 'none';
            currentView.classList.remove('fade-out', 'animating');
            nextView.style.display = 'block';
            nextView.classList.add('fade-in', 'animating');
            activeView = viewId;
            window.scrollTo(0, 0);
            if (callback) callback();
        }, 400);
    }
}

export function transitionSubView(currentElem, nextElem) {
    if (currentElem && !currentElem.classList.contains('hidden')) {
        currentElem.classList.add('sub-view-fade-out', 'animating');
        setTimeout(() => {
            currentElem.classList.add('hidden');
            currentElem.classList.remove('sub-view-fade-out', 'animating');
            if (nextElem) {
                nextElem.classList.remove('hidden');
                nextElem.classList.add('sub-view-fade-in', 'animating');
            }
        }, 400);
    } else if (nextElem) {
        nextElem.classList.remove('hidden');
        nextElem.classList.add('sub-view-fade-in', 'animating');
    }
}
