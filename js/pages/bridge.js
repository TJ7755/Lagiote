import * as studyModule from './study.js';
import '../core/sequence-utils.js';
import { getAppRuntime } from '../../src/app/runtime/app-runtime.js';

const runtime = getAppRuntime();
const lagiote = window.lagiote || {};

Object.assign(lagiote, runtime);
lagiote.study = studyModule;
lagiote.createLearnModeAdapter = runtime.modeAdapters.learn;
lagiote.createReviewModeAdapter = runtime.modeAdapters.review;
lagiote.createSequenceModeAdapter = runtime.modeAdapters.sequence;

if (!window.lagiote) {
    Object.defineProperty(window, 'lagiote', {
        value: lagiote,
        writable: false
    });
}

if (!window.generateDeckAdapter) {
    window.generateDeckAdapter = runtime.ai.generateDeck;
}

if (!window.isElectronRenderer) {
    window.isElectronRenderer = runtime.platform.isElectronRenderer;
}

if (!window.authSession) {
    window.authSession = runtime.authSession;
}

['initDB', 'getDataFromDB', 'saveDataToDB', 'getAllDataFromDB'].forEach(fn => {
    if (!window[fn] && typeof lagiote.db[fn] === 'function') {
        Object.defineProperty(window, fn, {
            configurable: true,
            get() {
                console.warn(`${fn} global access is deprecated. Use window.lagiote.db.${fn} instead.`);
                return lagiote.db[fn];
            }
        });
    }
});
