async function updateKnowledgeState(cardId, iqs) {
    if (!db) {
        console.error("Database not available for updating knowledge state.");
        return;
    }

    try {
        const transaction = db.transaction(['userKnowledgeState'], 'readwrite');
        const store = transaction.objectStore('userKnowledgeState');
        
        // Get existing state
        const compositeKey = ['default_user', cardId];
        const existingState = await new Promise((resolve, reject) => {
            const request = store.get(compositeKey);
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });

        // Create default state if none exists
        const state = existingState || {
            userID: 'default_user',
            cardID: cardId,
            masteryScore: 0.0,
            stability: 1.0,
            lastReviewed: new Date().toISOString()
        };

        // Update mastery score using the formula
        const oldMastery = state.masteryScore;
        state.masteryScore = oldMastery + (1 - oldMastery) * ((iqs * 2) - 1);
        
        // Clamp mastery score between 0 and 1
        state.masteryScore = Math.max(0, Math.min(1, state.masteryScore));
        
        // Update stability if in 'spaced' mode
        if (studyState.currentMode === 'spaced') {
            if (iqs > 0.5) {
                // Correct answer
                state.stability = state.stability * (1 + (iqs * 2.0));
            } else {
                // Incorrect answer
                state.stability = state.stability * 0.5;
            }
        }

        // Update last reviewed timestamp
        state.lastReviewed = new Date().toISOString();

        // Save updated state back to the database
        await new Promise((resolve, reject) => {
            const request = store.put(state);
            request.onsuccess = () => resolve();
            request.onerror = () => reject(request.error);
        });

        // Update in-memory study state
        studyState.knowledgeStates.set(cardId, state.masteryScore);

    } catch (error) {
        console.error("Error updating knowledge state:", error);
    }
}