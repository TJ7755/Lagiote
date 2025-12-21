import { getDataFromDB, saveDataToDB } from './db.js';

/**
 * Item Response Theory (Rasch-lite) Module
 * Estimates person ability (theta) and item difficulty (b).
 */

/**
 * Estimates theta using Newton-Raphson method for Rasch model.
 * P(correct) = 1 / (1 + exp(-(theta - b)))
 * @param {Array<number>} items Array of item difficulties (b)
 * @param {Array<number>} outcomes Array of 0/1 outcomes
 * @param {Object} opts Options { maxIters, tolerance, minTheta, maxTheta }
 * @returns {Object} { theta, se }
 */
export function estimateThetaRasch(items, outcomes, opts = {}) {
    const maxIters = opts.maxIters || 20;
    const tolerance = opts.tolerance || 0.01;
    const minTheta = opts.minTheta || -4.0;
    const maxTheta = opts.maxTheta || 4.0;

    let theta = 0.0; // Start at average ability
    let se = 1.0;

    // Handle degenerate cases (all correct or all wrong)
    const totalScore = outcomes.reduce((a, b) => a + b, 0);
    const maxScore = outcomes.length;

    if (totalScore === 0) {
        return { theta: minTheta, se: 2.0 }; // Arbitrary large SE
    }
    if (totalScore === maxScore) {
        return { theta: maxTheta, se: 2.0 };
    }

    for (let iter = 0; iter < maxIters; iter++) {
        let scoreExpected = 0;
        let info = 0;

        for (let i = 0; i < items.length; i++) {
            const b = items[i];
            const p = 1 / (1 + Math.exp(-(theta - b)));
            scoreExpected += p;
            info += p * (1 - p);
        }

        const diff = totalScore - scoreExpected;
        
        // Avoid division by zero
        if (info < 1e-9) break;

        const change = diff / info;
        theta += change;

        // Clamp theta
        theta = Math.max(minTheta, Math.min(maxTheta, theta));

        if (Math.abs(change) < tolerance) break;
    }

    // Calculate final SE
    let info = 0;
    for (let i = 0; i < items.length; i++) {
        const b = items[i];
        const p = 1 / (1 + Math.exp(-(theta - b)));
        info += p * (1 - p);
    }
    se = info > 1e-9 ? 1 / Math.sqrt(info) : 2.0;

    return { theta, se };
}

/**
 * Updates item difficulties based on new outcomes.
 * Uses a simple moving average approach for stability.
 * @param {string} userID
 * @param {Array<Object>} attemptItems Array of { id, ... }
 * @param {Array<number>} outcomes Array of 0/1
 * @param {Object} opts Options { learningRate }
 * @returns {Promise<void>}
 */
export async function updateItemDifficulties(userID, attemptItems, outcomes, opts = {}) {
    const learningRate = opts.learningRate || 0.05;
    const key = `test:itemDifficulty:${userID}`;
    
    let difficulties = await getDataFromDB('appData', key);
    if (!difficulties) difficulties = { key }; // Ensure key property for saving

    for (let i = 0; i < attemptItems.length; i++) {
        const itemId = attemptItems[i].id;
        const outcome = outcomes[i];
        
        // Skip if outcome is not 0 or 1 (e.g. partial credit or ungraded)
        if (outcome !== 0 && outcome !== 1) continue;

        let itemData = difficulties[itemId] || { b: 0, n: 0, updatedAt: null };
        
        itemData.n += 1;
        
        // Update running average of correctness (p)
        const currentP = itemData.p !== undefined ? itemData.p : 0.5;
        const newP = currentP * (1 - learningRate) + outcome * learningRate;
        itemData.p = newP;
        
        // Convert p to b (logit), clamped
        // p = 1 / (1 + exp(b))  => exp(b) = (1-p)/p => b = ln((1-p)/p)
        // If p is high (easy), b is negative.
        const clampedP = Math.max(0.01, Math.min(0.99, newP));
        itemData.b = Math.log((1 - clampedP) / clampedP);
        
        itemData.updatedAt = new Date().toISOString();
        difficulties[itemId] = itemData;
    }

    await saveDataToDB('appData', difficulties);
}

/**
 * Gets item difficulties for a list of items.
 * @param {string} userID
 * @param {Array<string>} itemIds
 * @returns {Promise<Object>} Map of itemId -> b
 */
export async function getItemDifficulties(userID, itemIds) {
    const key = `test:itemDifficulty:${userID}`;
    const difficulties = await getDataFromDB('appData', key) || {};
    
    const result = {};
    for (const id of itemIds) {
        result[id] = difficulties[id]?.b || 0; // Default to 0 (medium)
    }
    return result;
}
