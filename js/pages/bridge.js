import * as db from '../core/db.js';
import { levenshteinDistance, calculateIQS, shuffleArray } from '../core/utils.js';
import { FSRSAlgorithm } from '../core/fsrs.js';
import * as studyModule from './study.js';

const lagiote = window.lagiote || {};
const fsrs = new FSRSAlgorithm();

lagiote.db = db;
lagiote.utils = { levenshteinDistance, calculateIQS, shuffleArray };
lagiote.fsrs = fsrs;
lagiote.FSRSAlgorithm = FSRSAlgorithm;
lagiote.study = studyModule;

if (!window.lagiote) {
    Object.defineProperty(window, 'lagiote', {
        value: lagiote,
        writable: false
    });
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
