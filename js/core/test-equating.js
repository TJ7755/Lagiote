import { getAllDataFromDB } from './db.js';

/**
 * Test Equating Module
 * Adjusts scores based on anchor item performance.
 */

/**
 * Equates a raw score based on anchor performance.
 * @param {Object} params
 * @param {number} params.rawPct Raw percentage score (0-1)
 * @param {number} params.anchorsThisAttempt Score on anchors in this attempt (0-1)
 * @param {number} params.anchorHistory Historical average score on anchors (0-1)
 * @param {Object} params.opts Options { k, maxAdj }
 * @returns {Object} { equatedPct, adjustment }
 */
export function equateScore({ rawPct, anchorsThisAttempt, anchorHistory, opts = {} }) {
    const k = opts.k || 0.35;
    const maxAdj = opts.maxAdj || 0.08;

    // If no history or invalid inputs, return raw score
    if (anchorHistory === null || anchorHistory === undefined || isNaN(anchorHistory)) {
        return { equatedPct: rawPct, adjustment: 0 };
    }

    // Calculate adjustment
    // If current anchor performance is lower than history, it means this form is harder.
    // So we should bump the score up.
    // adjustment = (anchorHistory - anchorsThisAttempt) * k
    let adjustment = (anchorHistory - anchorsThisAttempt) * k;
    
    // Clamp adjustment
    adjustment = Math.max(-maxAdj, Math.min(maxAdj, adjustment));
    
    // Calculate equated score
    let equatedPct = rawPct + adjustment;
    
    // Clamp result
    equatedPct = Math.max(0, Math.min(1, equatedPct));
    
    return { equatedPct, adjustment };
}

/**
 * Computes the historical average score on anchor items for a blueprint.
 * @param {string} userID
 * @param {string} blueprintId
 * @returns {Promise<number|null>} Average anchor score (0-1) or null if insufficient data
 */
export async function computeAnchorHistory(userID, blueprintId) {
    const allData = await getAllDataFromDB('appData');
    const attempts = allData.filter(item => 
        item.key && 
        item.key.startsWith('attempt:') && 
        item.blueprintId === blueprintId
    );

    if (attempts.length === 0) return null;

    let totalAnchorPct = 0;
    let count = 0;

    for (const attempt of attempts) {
        const results = attempt.itemResults;
        if (!results) continue;

        let correctAnchors = 0;
        let totalAnchors = 0;

        for (const res of results) {
            if (res.isAnchor) {
                totalAnchors++;
                // Check correctness. 
                // Assuming `correct` boolean or `marksEarned` === `marks`
                // We'll check for `correct` property first, then fallback to marks.
                const isCorrect = res.correct !== undefined ? res.correct : (res.marksEarned === res.marks);
                
                if (isCorrect) {
                    correctAnchors++;
                }
            }
        }

        if (totalAnchors > 0) {
            totalAnchorPct += (correctAnchors / totalAnchors);
            count++;
        }
    }

    return count > 0 ? totalAnchorPct / count : null;
}
