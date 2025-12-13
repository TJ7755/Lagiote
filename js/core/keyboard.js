class KeyboardManager {
    constructor() {
        this.contexts = [];
        this.handleKeydown = this.handleKeydown.bind(this);
        document.addEventListener('keydown', this.handleKeydown);
    }

    registerContext(name, handler) {
        this.contexts = this.contexts.filter(ctx => ctx.name !== name);
        this.contexts.push({ name, handler });
    }

    removeContext(name) {
        this.contexts = this.contexts.filter(ctx => ctx.name !== name);
    }

    shouldIgnore(event) {
        const target = event.target;
        if (!target) return false;
        const editable = target.matches?.('input, textarea, [contenteditable="true"]') || target.closest?.('input, textarea, [contenteditable="true"]');
        return editable && event.key !== 'Escape';
    }

    isVisible(element) {
        if (!element) return false;
        if (element.disabled) return false;
        const style = window.getComputedStyle(element);
        return style.display !== 'none' && style.visibility !== 'hidden' && element.offsetParent !== null;
    }

    clickIfVisible(element) {
        if (this.isVisible(element)) {
            element.click();
            return true;
        }
        return false;
    }

    getActiveModal() {
        const modals = Array.from(document.querySelectorAll('.modal.show'));
        if (!modals.length) return null;
        return modals[modals.length - 1];
    }

    confirmModal(modal) {
        const selectors = [
            '[data-primary]',
            '.modal-actions .btn-prominent',
            '.modal-actions .btn-primary',
            '.modal-actions .btn-success',
            '.modal-actions .btn-danger',
            '.modal-actions button:not(.btn-secondary)'
        ];
        for (const selector of selectors) {
            const btn = modal.querySelector(selector);
            if (this.clickIfVisible(btn)) return true;
        }
        return false;
    }

    closeModal(modal) {
        const selectors = [
            '[data-close]',
            '.close',
            '.modal-actions .btn-secondary',
            '.modal-actions button.cancel',
            '.modal-actions button[data-action="cancel"]'
        ];
        for (const selector of selectors) {
            const btn = modal.querySelector(selector);
            if (this.clickIfVisible(btn)) return true;
        }
        if (modal.classList.contains('show')) {
            modal.classList.remove('show');
            return true;
        }
        return false;
    }

    handleModalShortcut(event) {
        const modal = this.getActiveModal();
        if (!modal) return false;
        if (event.key === 'Escape') return this.closeModal(modal);
        if (event.key === 'Enter') return this.confirmModal(modal);
        return false;
    }

    handleKeydown(event) {
        if (this.shouldIgnore(event)) return;
        if (this.handleModalShortcut(event)) {
            event.preventDefault();
            return;
        }
        for (let i = this.contexts.length - 1; i >= 0; i -= 1) {
            const ctx = this.contexts[i];
            if (typeof ctx.handler === 'function' && ctx.handler(event) === true) {
                event.preventDefault();
                return;
            }
        }
    }
}

const keyboardManager = window.keyboardManager || new KeyboardManager();
window.keyboardManager = keyboardManager;

export { KeyboardManager, keyboardManager };
export default keyboardManager;
