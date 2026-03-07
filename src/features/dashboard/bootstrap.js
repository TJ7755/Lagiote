import { getAppRuntime } from '../../app/runtime/app-runtime.js';
import { createLegacyDashboardFacade } from './legacy-dashboard-facade.js';

let bootPromise = null;

export async function bootstrapDashboardApp({
    platformServices,
    authServices,
    analyticsServices
} = {}) {
    if (bootPromise) {
        return bootPromise;
    }

    bootPromise = (async () => {
        const runtime = getAppRuntime();
        const resolvedPlatformServices = platformServices || runtime.platformServices;
        const resolvedAuthServices = authServices || resolvedPlatformServices.auth;
        const resolvedAnalyticsServices = analyticsServices || {
            gtag: typeof window !== 'undefined' ? window.gtag : null,
            dataLayer: typeof window !== 'undefined' ? window.dataLayer : []
        };

        await import('../../../js/pages/bridge.js');
        await import('../../../js/core/keyboard.js');
        await import('../../../js/pages/dashboard.js');
        await import('../../../js/pages/exam-mode-ui.js');

        const facade = createLegacyDashboardFacade({
            platformServices: resolvedPlatformServices,
            authServices: resolvedAuthServices,
            analyticsServices: resolvedAnalyticsServices
        });

        if (typeof window !== 'undefined') {
            window.lagioteApp = facade;
        }

        return facade;
    })();

    return bootPromise;
}
