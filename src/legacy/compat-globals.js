// Temporary compatibility helpers to keep legacy globals available while boot code moves to modules.
export function attachIndexGlobals({ loadCDNScript, gtag, dataLayer }) {
    // loadCDNScript was previously defined inline in index.html for CDN loading.
    if (typeof window !== 'undefined' && loadCDNScript && !window.loadCDNScript) {
        window.loadCDNScript = loadCDNScript;
    }

    // Google Analytics globals expected by existing code/snippets.
    if (typeof window !== 'undefined') {
        window.dataLayer = window.dataLayer || dataLayer || [];
        if (gtag && !window.gtag) {
            window.gtag = gtag;
        }
    }
}
