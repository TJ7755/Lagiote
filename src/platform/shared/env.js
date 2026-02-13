// Platform detection helpers shared across web and Electron renderers.
export function isElectronRenderer() {
    if (typeof window === 'undefined') {
        return false;
    }

    // Prefer explicit preload-exposed API; avoids brittle user agent sniffing.
    if (window.electronAPI && (window.electronAPI.isElectron || typeof window.electronAPI === 'object')) {
        return true;
    }

    // Fallback for environments where preload injects process metadata.
    const processType = typeof window.process !== 'undefined' && window.process?.type;
    return processType === 'renderer';
}
