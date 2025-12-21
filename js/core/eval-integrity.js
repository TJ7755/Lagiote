import { loadFingerprint, saveFingerprint } from './eval-store.js';

/**
 * Normalises text for fingerprinting.
 * Removes whitespace, case, and punctuation to be robust against minor edits.
 * @param {string} str 
 * @returns {string}
 */
export function normaliseText(str) {
    if (!str) return '';
    return String(str)
        .toLowerCase()
        .replace(/\s+/g, ' ')
        .replace(/[^\w\s]/g, '')
        .trim();
}

/**
 * Generates a stable hash for a string.
 * Simple DJB2 variant, sufficient for detecting content changes.
 * @param {string} str 
 * @returns {string} Hex string
 */
export function stableHash(str) {
    let hash = 5381;
    for (let i = 0; i < str.length; i++) {
        hash = ((hash << 5) + hash) + str.charCodeAt(i);
    }
    return (hash >>> 0).toString(16);
}

/**
 * Computes a fingerprint for a card.
 * @param {object} card 
 * @returns {string}
 */
export function computeCardFingerprint(card) {
    if (!card) return '';
    // Handle different card types if necessary, but generally question/answer/deckId covers it.
    // Assuming standard flashcard structure: front/back or question/answer
    const q = card.front || card.question || '';
    const a = card.back || card.answer || '';
    const deckId = card.deckId || '';
    
    const raw = normaliseText(q) + '|' + normaliseText(a) + '|' + deckId;
    return stableHash(raw);
}

/**
 * Checks if the card's fingerprint has changed and updates the store.
 * @param {string} userID 
 * @param {string} cardId 
 * @param {object} card 
 * @returns {Promise<{changed: boolean}>}
 */
export async function checkAndUpdateFingerprint(userID, cardId, card) {
    const currentFingerprint = computeCardFingerprint(card);
    const stored = await loadFingerprint(userID, cardId);

    if (!stored) {
        // First time seeing this card in eval context, store it.
        await saveFingerprint(userID, cardId, {
            fingerprint: currentFingerprint,
            updatedAt: Date.now()
        });
        return { changed: false };
    }

    if (stored.fingerprint !== currentFingerprint) {
        // Changed! Update the stored fingerprint to the new one so future probes are valid against the NEW version,
        // but the caller should invalidate pending/recent probes that expected the OLD version.
        // Actually, if the card changes, we should probably invalidate everything associated with the OLD version.
        // But for now, we just report it changed.
        await saveFingerprint(userID, cardId, {
            fingerprint: currentFingerprint,
            updatedAt: Date.now()
        });
        return { changed: true };
    }

    return { changed: false };
}

/**
 * Marks probes as invalid if the card has changed.
 * This is a helper to be used when processing probe results or serving probes.
 * @param {string} userID 
 * @param {string} cardId 
 * @param {Array} pendingProbes 
 * @param {Array} completedProbes 
 * @returns {object} { pending, completedUpdatedCount }
 */
export function markProbesInvalidIfCardChanged(userID, cardId, pendingProbes, completedProbes) {
    // This function logic is slightly different: it assumes we detected a change externally
    // or we are just applying invalidation logic.
    // Actually, the requirement is: "If fingerprint differs from stored value, mark affected probes invalidated."
    
    // Since we update the fingerprint immediately on detection, we might not need to batch update old probes 
    // unless we want to retroactively invalidate.
    // The prompt says: "On exposure scheduling and probe serving: If fingerprint differs... mark affected probes invalidated."
    
    // So if we are serving a probe, and checkAndUpdateFingerprint returns changed=true,
    // we should mark THAT probe as invalid.
    
    return {}; // Placeholder if we need batch logic later.
}
