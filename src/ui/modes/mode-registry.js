const registry = new Map();

export function registerMode(name, adapter) {
    if (!name || !adapter) return;
    registry.set(name, adapter);
}

export function getMode(name) {
    return registry.get(name);
}

export function getModes() {
    return Array.from(registry.entries()).map(([name, adapter]) => ({ name, adapter }));
}

if (typeof window !== 'undefined') {
    window.modeRegistry = window.modeRegistry || {};
    window.modeRegistry.register = registerMode;
    window.modeRegistry.get = getMode;
    window.modeRegistry.getAll = getModes;
}
