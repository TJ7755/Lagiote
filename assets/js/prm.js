

function calculatePRecall(state) {
    
    const now = new Date();
    const lastReviewed = new Date(state.lastReviewed);
    const deltaTime = (now - lastReviewed) / (1000 * 60 * 60 * 24); 

    
    const halfLife = state.stability;

    
    return Math.pow(2, (-deltaTime / halfLife));
}

export { calculatePRecall };