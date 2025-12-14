import { attachIndexGlobals } from '../../legacy/compat-globals.js';

function applyThemeFromSystem() {
    const target = document.documentElement;
    const applyTheme = (isDark) => {
        if (!target) return;
        if (isDark) {
            target.classList.add('dark-mode');
            if (document.body) document.body.classList.add('dark-mode');
        } else {
            target.classList.remove('dark-mode');
            if (document.body) document.body.classList.remove('dark-mode');
        }
    };

    const systemDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
    applyTheme(systemDark);
}

function bootstrapAnalytics() {
    if (navigator.onLine) {
        const gtagScript = document.createElement('script');
        gtagScript.async = true;
        gtagScript.src = 'https://www.googletagmanager.com/gtag/js?id=G-86DQ5HTDV9';
        gtagScript.onerror = () => console.warn('Failed to load Google Analytics 2');
        document.head.appendChild(gtagScript);
    }

    window.dataLayer = window.dataLayer || [];
    function gtag() {
        window.dataLayer.push(arguments);
    }

    gtag('js', new Date());
    gtag('config', 'G-86DQ5HTDV9');

    return { gtag };
}

function createLoadCdnScript() {
    return function loadCDNScript(src, onload) {
        if (!navigator.onLine) {
            console.warn('Offline: Skipping CDN script', src);
            if (onload) onload();
            return;
        }
        const script = document.createElement('script');
        script.src = src;
        script.onerror = () => {
            console.warn('Failed to load CDN script:', src);
            if (onload) onload();
        };
        if (onload && !src.includes('module')) {
            script.onload = onload;
        }
        document.head.appendChild(script);
    };
}

function bootstrapCdn(loadCDNScript) {
    loadCDNScript('https://cdn.jsdelivr.net/npm/sortablejs@latest/Sortable.min.js', () => {
        console.log('Sortable.js loaded or skipped');
    });

    if (navigator.onLine) {
        const transformersScript = document.createElement('script');
        transformersScript.type = 'module';
        transformersScript.src = 'https://cdn.jsdelivr.net/npm/@xenova/transformers@2.17.1';
        transformersScript.onerror = () => console.warn('Failed to load Transformers library');
        document.head.appendChild(transformersScript);
    }
}

function bootstrap() {
    applyThemeFromSystem();

    const { gtag } = bootstrapAnalytics();
    const loadCDNScript = createLoadCdnScript();

    attachIndexGlobals({
        loadCDNScript,
        gtag,
        dataLayer: window.dataLayer
    });

    bootstrapCdn(loadCDNScript);
}

bootstrap();
