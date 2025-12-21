import { strict as assert } from 'assert';
import { applyEvalExposureLog, resetEvalExposureState, shouldLogMcqExposure } from '../js/core/eval-exposure-dedupe.js';

console.log('Running eval-exposure-dedupe tests...');

{
    let state = resetEvalExposureState(null, 'card-1');
    const events = [];

    const first = applyEvalExposureLog(state, 'card-1', 'token-1');
    state = first.state;
    if (first.shouldLog) events.push('exposure');

    const second = applyEvalExposureLog(state, 'card-1', 'token-2');
    state = second.state;
    if (second.shouldLog) events.push('exposure');

    assert.equal(events.length, 1);
}

{
    let state = resetEvalExposureState(null, 'card-mcq');
    const events = [];
    const recallWasCorrect = false;

    if (shouldLogMcqExposure('recall', recallWasCorrect)) {
        const recall = applyEvalExposureLog(state, 'card-mcq', 'token-recall');
        state = recall.state;
        if (recall.shouldLog) events.push('recall');
    }

    assert.equal(events.length, 0);

    if (shouldLogMcqExposure('recognition', recallWasCorrect)) {
        const recognition = applyEvalExposureLog(state, 'card-mcq', 'token-recognition');
        state = recognition.state;
        if (recognition.shouldLog) events.push('recognition');
    }

    const repeat = applyEvalExposureLog(state, 'card-mcq', 'token-repeat');
    state = repeat.state;
    if (repeat.shouldLog) events.push('repeat');

    assert.deepEqual(events, ['recognition']);
}

console.log('eval-exposure-dedupe tests passed!');
