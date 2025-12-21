import { estimateThetaRasch } from '../js/core/item-irt.js';
import assert from 'assert';

console.log('Running IRT Tests...');

// Test 1: Basic Estimation
{
    const items = [0, 0, 0]; // 3 medium items
    const outcomes = [1, 1, 1]; // All correct
    const { theta, se } = estimateThetaRasch(items, outcomes);
    
    assert.ok(theta > 0, 'Theta should be positive for all correct');
    assert.ok(se > 0, 'SE should be positive');
}

// Test 2: Mixed Outcomes
{
    const items = [-1, 0, 1]; // Easy, Medium, Hard
    const outcomes = [1, 1, 0]; // Correct on Easy/Medium, Wrong on Hard
    const { theta } = estimateThetaRasch(items, outcomes);
    
    assert.ok(theta > -1 && theta < 1, 'Theta should be around 0');
}

// Test 3: All Wrong
{
    const items = [0, 0, 0];
    const outcomes = [0, 0, 0];
    const { theta } = estimateThetaRasch(items, outcomes);
    
    assert.ok(theta < 0, 'Theta should be negative for all wrong');
}

console.log('IRT Tests Passed!');
