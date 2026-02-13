import { getDataFromDB, saveDataToDB } from './db.js';

/**
 * Anchor Bank Module
 * Manages stable anchor items for test equating.
 */

/**
 * Loads the anchor bank for a specific user and blueprint.
 * @param {string} userID 
 * @param {string} blueprintId 
 * @returns {Promise<Object>} Map of sectionId -> cardId[]
 */
export async function loadAnchorBank(userID, blueprintId) {
    const key = `test:anchors:${userID}:${blueprintId}`;
    const bank = await getDataFromDB('appData', key);
    return bank || {};
}

/**
 * Saves the anchor bank.
 * @param {string} userID 
 * @param {string} blueprintId 
 * @param {Object} bank 
 */
export async function saveAnchorBank(userID, blueprintId, bank) {
    const key = `test:anchors:${userID}:${blueprintId}`;
    await saveDataToDB('appData', { key, ...bank });
}

/**
 * Ensures anchors exist for a section, filling from candidates if needed.
 * @param {Object} params
 * @param {string} params.userID
 * @param {string} params.blueprintId
 * @param {string} params.sectionId
 * @param {Array} params.candidates Array of candidate card objects
 * @param {number} params.count Number of anchors needed
 * @param {Object} params.rng SeededRNG instance
 * @returns {Promise<Object>} { anchors: Array, bankUpdated: boolean }
 */
export async function ensureAnchorsForSection({ userID, blueprintId, sectionId, candidates, count, rng }) {
    const bank = await loadAnchorBank(userID, blueprintId);
    let sectionAnchors = bank[sectionId] || [];
    let bankUpdated = false;

    // Validate existing anchors (ensure they still exist in candidates)
    const validAnchors = sectionAnchors.filter(id => candidates.some(c => c.id === id));
    
    if (validAnchors.length < sectionAnchors.length) {
        sectionAnchors = validAnchors;
        bankUpdated = true;
    }

    // Fill if needed
    if (sectionAnchors.length < count) {
        const needed = count - sectionAnchors.length;
        const available = candidates.filter(c => !sectionAnchors.includes(c.id));
        
        // Sort available deterministically by ID before shuffling with RNG to ensure stability given same seed/candidates
        available.sort((a, b) => a.id.localeCompare(b.id));
        
        // Shuffle using the provided RNG
        const picked = [];
        const pool = [...available];
        
        for (let i = 0; i < needed && pool.length > 0; i++) {
            const idx = rng.nextInt(0, pool.length);
            picked.push(pool[idx]);
            pool.splice(idx, 1);
        }
        
        sectionAnchors = [...sectionAnchors, ...picked.map(c => c.id)];
        bankUpdated = true;
    }

    // Update bank if changed
    if (bankUpdated) {
        bank[sectionId] = sectionAnchors;
        await saveAnchorBank(userID, blueprintId, bank);
    }

    // Return full card objects for the anchors
    const anchorCards = sectionAnchors
        .map(id => candidates.find(c => c.id === id))
        .filter(c => c); // Filter out any that might be missing (though we validated above)

    return { anchors: anchorCards, bankUpdated };
}
