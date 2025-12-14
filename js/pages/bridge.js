import * as db from '../core/db.js';
import { levenshteinDistance, calculateIQS, shuffleArray } from '../core/utils.js';
import { FSRSAlgorithm } from '../core/fsrs.js';
import * as studyModule from './study.js';
import * as fsrsUtils from '../core/fsrs-utils.js';
import { isElectronRenderer } from '../../src/platform/shared/env.js';
import { generateDeck as platformGenerateDeck } from '../../src/platform/shared/ai.js';
import * as authSession from '../../src/platform/shared/auth-session.js';
import '../../src/ui/modes/mode-registry.js';
import createLearnModeAdapter from '../../src/ui/modes/learn-mode.js';
import createReviewModeAdapter from '../../src/ui/modes/review-mode.js';
import createSequenceModeAdapter from '../../src/ui/modes/sequence-mode.js';

const lagiote = window.lagiote || {};
const fsrs = new FSRSAlgorithm();

lagiote.db = db;
lagiote.utils = { levenshteinDistance, calculateIQS, shuffleArray };
lagiote.fsrs = fsrs;
lagiote.FSRSAlgorithm = FSRSAlgorithm;
lagiote.study = studyModule;
lagiote.knowledgeStateUtils = fsrsUtils;
lagiote.platform = { isElectronRenderer };
lagiote.ai = { generateDeck: platformGenerateDeck };
lagiote.authSession = authSession;
lagiote.createLearnModeAdapter = createLearnModeAdapter;
lagiote.createReviewModeAdapter = createReviewModeAdapter;
lagiote.createSequenceModeAdapter = createSequenceModeAdapter;

if (!window.lagiote) {
    Object.defineProperty(window, 'lagiote', {
        value: lagiote,
        writable: false
    });
}

if (!window.generateDeckAdapter) {
    window.generateDeckAdapter = platformGenerateDeck;
}

if (!window.isElectronRenderer) {
    window.isElectronRenderer = isElectronRenderer;
}

if (!window.authSession) {
    window.authSession = authSession;
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
