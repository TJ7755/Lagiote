import { __TEST_HOOKS__ } from './cortex.js';

/**
 * Test-only hook to retrieve the current implicit calibration state.
 * Only available when process.env.NODE_ENV === 'test'.
 */
export function getImplicitCalibrationForTests() {
    if (!__TEST_HOOKS__) {
        throw new Error('Cortex test hooks are only available in test environments.');
    }
    return __TEST_HOOKS__.getImplicitCalibration();
}

/**
 * Test-only hook to reset the implicit calibration state to defaults.
 * Only available when process.env.NODE_ENV === 'test'.
 */
export function resetImplicitCalibrationForTests() {
    if (!__TEST_HOOKS__) {
        throw new Error('Cortex test hooks are only available in test environments.');
    }
    return __TEST_HOOKS__.resetImplicitCalibration();
}

/**
 * Test-only hook to run interference self-check logic.
 */
export function debugInterferenceSelfCheckForTests(options) {
    if (!__TEST_HOOKS__) {
        throw new Error('Cortex test hooks are only available in test environments.');
    }
    return __TEST_HOOKS__.debugInterferenceSelfCheck(options);
}
