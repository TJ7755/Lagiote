import './auth0-boot.js';
import { bootstrapDashboardApp } from '../../features/dashboard/bootstrap.js';
import { attachIndexGlobals } from '../../legacy/compat-globals.js';
import { isTestMode } from '../shared/test-mode.js';

// Handle Auth0 web callback as early as possible so the app
// processes code/state even if page scripts fail to attach onload.
async function maybeHandleAuth0CallbackEarly() {
    try {
        if (typeof window === 'undefined') return;
        if (window.electronAPI) return; // not web
        const qs = window.location.search || '';
        if (!qs.includes('code=') || !qs.includes('state=')) return;

        const mod = await import('../shared/auth-session.js');
        if (mod && typeof mod.handleWebRedirect === 'function') {
            await mod.handleWebRedirect();
        }
    } catch (err) {
        console.error('Auth0 callback processing failed:', err);
        // Leave URL as-is so downstream handlers can retry or show errors.
    }
}

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
    if (isTestMode()) {
        return { gtag: () => {} };
    }
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

function bootstrap() {
    // Process Auth0 callback first to populate session storage.
    // Intentionally not awaited so the rest of boot can proceed.
    maybeHandleAuth0CallbackEarly();

    applyThemeFromSystem();

    const { gtag } = bootstrapAnalytics();

    attachIndexGlobals({
        gtag,
        dataLayer: window.dataLayer
    });

    bootstrapDashboardApp({
        analyticsServices: { gtag, dataLayer: window.dataLayer }
    }).catch((error) => {
        console.error('Dashboard bootstrap failed:', error);
    });
}

bootstrap();
