/**
 * Keyboard Manager - Clean implementation for global keyboard shortcuts
 * 
 * Key Principles:
 * 1. NEVER intercept keys when user is typing in text inputs (except Escape)
 * 2. Use direct event listeners on specific elements for Enter in inputs
 * 3. Global shortcuts only apply when not typing
 */

class KeyboardManager {
    constructor() {
        this.initialized = false;
    }

    init() {
        if (this.initialized) return;
        this.initialized = true;
        document.addEventListener('keydown', this.handleGlobalKeydown.bind(this));
    }

    /**
     * Check if user is currently typing in a text field
     */
    isTyping() {
        const active = document.activeElement;
        if (!active) return false;
        
        const tag = active.tagName.toUpperCase();
        if (tag === 'TEXTAREA') return true;
        if (tag === 'INPUT') {
            const type = (active.type || '').toLowerCase();
            return ['text', 'search', 'email', 'password', 'tel', 'url', 'number'].includes(type);
        }
        if (active.isContentEditable) return true;
        
        return false;
    }

    /**
     * Check if element is visible and can be clicked
     */
    isVisible(element) {
        if (!element) return false;
        if (element.disabled) return false;
        if (element.classList.contains('hidden')) return false;
        const style = window.getComputedStyle(element);
        return style.display !== 'none' && style.visibility !== 'hidden';
    }

    /**
     * Click element if visible, return true if clicked
     */
    clickIfVisible(element) {
        if (this.isVisible(element)) {
            element.click();
            return true;
        }
        return false;
    }

    /**
     * Handle global keyboard shortcuts
     * Only fires when user is NOT typing
     */
    handleGlobalKeydown(event) {
        // Always allow Escape to work
        if (event.key === 'Escape') {
            // Close any open modal
            const modal = document.querySelector('.modal.show');
            if (modal) {
                const closeBtn = modal.querySelector('.close, [data-close]');
                if (closeBtn) closeBtn.click();
                else modal.classList.remove('show');
                event.preventDefault();
                return;
            }
            // Blur active element if typing
            if (this.isTyping()) {
                document.activeElement.blur();
                event.preventDefault();
                return;
            }
        }

        // If typing, only allow Ctrl/Cmd shortcuts through
        if (this.isTyping()) {
            if (!(event.ctrlKey || event.metaKey)) {
                return; // Let the key be typed naturally
            }
        }

        // Handle modal Enter to confirm
        const modal = document.querySelector('.modal.show');
        if (modal && event.key === 'Enter' && !this.isTyping()) {
            const primaryBtn = modal.querySelector('.modal-actions .btn-primary, .modal-actions .btn-success, [data-primary]');
            if (this.clickIfVisible(primaryBtn)) {
                event.preventDefault();
                return;
            }
        }

        // Global Ctrl/Cmd shortcuts
        const isMeta = event.ctrlKey || event.metaKey;
        const key = event.key.toLowerCase();

        if (isMeta) {
            if (key === 'k') {
                event.preventDefault();
                document.getElementById('searchInput')?.focus();
                return;
            }
            if (key === 'n') {
                event.preventDefault();
                window.createNewDeck?.();
                return;
            }
            if (key === ',') {
                event.preventDefault();
                window.showView?.('settings');
                return;
            }
            if (event.shiftKey) {
                if (key === 'a') {
                    event.preventDefault();
                    window.showView?.('analytics');
                    return;
                }
                if (key === 'i') {
                    event.preventDefault();
                    window.showView?.('insights');
                    return;
                }
                if (key === 'g') {
                    event.preventDefault();
                    window.showView?.('globalAnalytics');
                    return;
                }
                // Ctrl+Shift+E: Open Exam Hub
                if (key === 'e') {
                    event.preventDefault();
                    this.openExamHubWithDeckSelection();
                    return;
                }
                // Ctrl+Shift+?: Show keyboard shortcuts help
                if (key === '?') {
                    event.preventDefault();
                    window.showKeyboardShortcutsHelp?.();
                    return;
                }
            }
        }
    }

    /**
     * Opens the Exam Hub with deck selection if needed.
     * If a deck is currently selected, opens the hub for that deck.
     * Otherwise, shows a modal to select a deck.
     */
    openExamHubWithDeckSelection() {
        // Check if there's a currently viewing deck
        const currentDeckId = window.currentViewingDeckId || window.currentDeckId;
        
        if (currentDeckId && typeof window.openExamModeHub === 'function') {
            window.openExamModeHub(currentDeckId);
            return;
        }
        
        // Show deck selection modal for Exam Hub
        if (typeof window.showExamHubDeckSelector === 'function') {
            window.showExamHubDeckSelector();
        } else if (typeof window.openExamModeHub === 'function') {
            // Fallback: show toast asking user to select a deck first
            window.showToast?.('Please select a deck first to open Exam Hub.', 'info');
        }
    }
}

const keyboardManager = new KeyboardManager();
keyboardManager.init();

// Expose globally
window.keyboardManager = keyboardManager;

export { KeyboardManager, keyboardManager };
export default keyboardManager;
