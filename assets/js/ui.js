// UI Operations Module
import { showToast } from './utils.js';
import state from './state.js';

// View Management
let viewHistory = [];
export let activeView = 'dashboard';

export function showView(viewName, isReset = false) {
    const currentView = document.querySelector('.view-container:not(.hidden)');
    const newView = document.getElementById(viewName + 'View');
    
    if (!newView) return;
    
    if (isReset) {
        viewHistory = [];
    }
    
    if (currentView) {
        currentView.classList.add('animating', 'fade-out');
        setTimeout(() => {
            currentView.classList.add('hidden');
            currentView.classList.remove('animating', 'fade-out');
            showNewView();
        }, 400);
    } else {
        showNewView();
    }
    
    function showNewView() {
        newView.classList.remove('hidden');
        newView.classList.add('animating', 'fade-in');
        setTimeout(() => newView.classList.remove('animating'), 400);
        
        if (!isReset && activeView) {
            viewHistory.push(activeView);
        }
        activeView = viewName;
        
        const backBtn = document.getElementById('headerBackBtn');
        if (viewHistory.length > 0) {
            backBtn.classList.remove('hidden');
        } else {
            backBtn.classList.add('hidden');
        }
        window.scrollTo(0, 0);
    }
}

export function goBack() {
    if (viewHistory.length === 0) return;
    const previousView = viewHistory.pop();
    showView(previousView, true);
}

// Sub-view transitions
export function transitionSubView(currentView, newView) {
    if (!currentView || !newView) return;
    
    currentView.classList.add('animating', 'sub-view-fade-out');
    setTimeout(() => {
        currentView.classList.add('hidden');
        currentView.classList.remove('animating', 'sub-view-fade-out');
        
        newView.classList.remove('hidden');
        newView.classList.add('animating', 'sub-view-fade-in');
        setTimeout(() => newView.classList.remove('animating'), 400);
    }, 400);
}

// Modal Management
export function showModal(modalId) {
    const modal = document.getElementById(modalId);
    if (modal) modal.classList.add('show');
}

export function closeModal(modalId) {
    const modal = document.getElementById(modalId);
    if (modal) modal.classList.remove('show');
}

export function showConfirmModal(message, callback) {
    const modal = document.getElementById('confirmModal');
    const messageElement = modal.querySelector('.confirm-message');
    messageElement.textContent = message;
    state.confirmCallback = callback;
    showModal('confirmModal');
}

// Update UI elements
export function updateDeckProgress(deck) {
    const totalCards = deck.cards.length;
    let masteredCards = 0;
    
    if (deck.learnState && deck.learnState.buckets) {
        masteredCards = deck.learnState.buckets[deck.settings.maxBuckets - 1]?.length || 0;
    }
    
    const progress = totalCards > 0 ? (masteredCards / totalCards) * 100 : 0;
    return {
        total: totalCards,
        mastered: masteredCards,
        progress: progress
    };
}

export function updateProgressBar(elementId, progress) {
    const progressBar = document.getElementById(elementId);
    if (progressBar) {
        progressBar.style.width = `${progress}%`;
    }
}

// Form Handling
export function getFormData(formElement) {
    const formData = new FormData(formElement);
    const data = {};
    for (let [key, value] of formData.entries()) {
        data[key] = value;
    }
    return data;
}

// UI Feedback
export function showLoadingSpinner(elementId) {
    const element = document.getElementById(elementId);
    if (element) {
        const spinner = document.createElement('div');
        spinner.className = 'spinner';
        element.appendChild(spinner);
    }
}

export function hideLoadingSpinner(elementId) {
    const element = document.getElementById(elementId);
    if (element) {
        const spinner = element.querySelector('.spinner');
        if (spinner) spinner.remove();
    }
}

// Event Listeners Setup
export function setupEventListeners() {
    // Header back button
    document.getElementById('headerBackBtn').addEventListener('click', goBack);
    
    // Modal close on outside click
    window.onclick = function(event) {
        document.querySelectorAll('.modal').forEach(modal => {
            if (event.target === modal) modal.classList.remove('show');
        });
    };
    
    // Dark mode toggle
    document.getElementById('darkModeToggle').addEventListener('change', function() {
        document.body.classList.toggle('dark-mode', this.checked);
        state.globalSettings.darkMode = this.checked;
    });
}