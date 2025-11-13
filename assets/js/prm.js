// Predictive Recall Model (PRM) Functions

/**
 * Calculates the predicted probability of recall for a given knowledge state
 * @param {Object} state - The knowledge state object from userKnowledgeState store
 * @returns {number} - Probability between 0 and 1
 */
function calculatePRecall(state) {
    // Calculate time delta in days
    const now = new Date();
    const lastReviewed = new Date(state.lastReviewed);
    const deltaTime = (now - lastReviewed) / (1000 * 60 * 60 * 24); // Convert ms to days

    // Get half-life from stability
    const halfLife = state.stability;

    // Calculate and return predicted recall probability
    return Math.pow(2, (-deltaTime / halfLife));
}

export { calculatePRecall };