import { getAppRuntime } from '../../app/runtime/app-runtime.js';

let bootPromise = null;

export async function bootstrapStudyApp({ platformServices, deckRepository } = {}) {
    if (bootPromise) {
        return bootPromise;
    }

    bootPromise = (async () => {
        try {
            const runtime = getAppRuntime();
            const resolvedPlatformServices = platformServices || runtime.platformServices;
            const resolvedDeckRepository = deckRepository || runtime.db;

            await import('../../../js/pages/study.js');

            const app = {
                platformServices: resolvedPlatformServices,
                deckRepository: resolvedDeckRepository
            };

            if (typeof window !== 'undefined') {
                window.lagioteStudyApp = app;
            }

            return app;
        } catch (error) {
            bootPromise = null;
            throw error;
        }
    })();

    return bootPromise;
}
