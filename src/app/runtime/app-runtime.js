import * as db from '../../../js/core/db.js';
import { levenshteinDistance, calculateIQS, shuffleArray } from '../../../js/core/utils.js';
import { FSRSAlgorithm } from '../../../js/core/fsrs.js';
import * as fsrsUtils from '../../../js/core/fsrs-utils.js';
import * as mcqRemediation from '../../../js/core/mcq-remediation.js';
import { isElectronRenderer } from '../../platform/shared/env.js';
import { generateDeck } from '../../platform/shared/ai.js';
import * as authSession from '../../platform/shared/auth-session.js';
import createLearnModeAdapter from '../../ui/modes/learn-mode.js';
import createReviewModeAdapter from '../../ui/modes/review-mode.js';
import createSequenceModeAdapter from '../../ui/modes/sequence-mode.js';
import { createPlatformServices } from '../../platform/shared/platform-services.js';

const fsrs = new FSRSAlgorithm();
const platformServices = createPlatformServices();

const runtime = {
    platformServices,
    authSession,
    db,
    ai: { generateDeck },
    fsrs,
    FSRSAlgorithm,
    knowledgeStateUtils: fsrsUtils,
    mcqRemediation,
    platform: { isElectronRenderer },
    utils: {
        levenshteinDistance,
        calculateIQS,
        shuffleArray
    },
    modeAdapters: {
        learn: createLearnModeAdapter,
        review: createReviewModeAdapter,
        sequence: createSequenceModeAdapter
    }
};

export function getAppRuntime() {
    return runtime;
}
