// Utility functions

// Calculate Levenshtein distance between two strings
export function levenshteinDistance(s1, s2) {
    s1 = s1.toLowerCase();
    s2 = s2.toLowerCase();

    const costs = [];
    for (let i = 0; i <= s1.length; i++) {
        let lastValue = i;
        for (let j = 0; j <= s2.length; j++) {
            if (i === 0) {
                costs[j] = j;
            } else {
                if (j > 0) {
                    let newValue = costs[j - 1];
                    if (s1.charAt(i - 1) !== s2.charAt(j - 1)) {
                        newValue = Math.min(Math.min(newValue, lastValue), costs[j]) + 1;
                    }
                    costs[j - 1] = lastValue;
                    lastValue = newValue;
                }
            }
        }
        if (i > 0) costs[s2.length] = lastValue;
    }
    return costs[s2.length];
}

// Calculate Interaction Quality Score (IQS)
export function calculateIQS(logData, userBaseline = { latency: 1500, fluency: 10 }) {
    const v_latency = 1 - (Math.min(logData.recallLatency / userBaseline.latency, 2) / 2);
    const v_fluency = Math.min(logData.answerFluency / userBaseline.fluency, 1.5) / 1.5;
    const v_corrections = 1 / (1 + logData.totalCorrections);
    const v_attempts = 1 / logData.attemptCount;

    const W_latency = 0.30;
    const W_fluency = 0.20;
    const W_corrections = 0.25;
    const W_attempts = 0.25;

    const iqs = (W_latency * v_latency) + (W_fluency * v_fluency) + 
                (W_corrections * v_corrections) + (W_attempts * v_attempts);

    return Math.max(0, Math.min(1, iqs));
}

// Get bucket name based on index and max buckets
export function getBucketName(index, maxBuckets) {
    if (index === 0) return 'Learning';
    if (index === maxBuckets - 1) return 'Mastered';
    return `Bucket ${index + 1}`;
}

// Format date for display
export function formatDate(dateString) {
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', { 
        year: 'numeric', 
        month: 'short', 
        day: 'numeric' 
    });
}

// Format duration in seconds to human-readable string
export function formatDuration(seconds) {
    if (seconds < 60) return `${seconds}s`;
    if (seconds < 3600) {
        const minutes = Math.floor(seconds / 60);
        return `${minutes}m`;
    }
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    return `${hours}h ${minutes}m`;
}

// Chunk an array into smaller arrays
export function chunkArray(array, size = 7) {
    const chunks = [];
    for (let i = 0; i < array.length; i += size) {
        chunks.push(array.slice(i, i + size));
    }
    return chunks;
}

// Shuffle an array
export function shuffleArray(array) {
    const newArray = [...array];
    for (let i = newArray.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [newArray[i], newArray[j]] = [newArray[j], newArray[i]];
    }
    return newArray;
}

// Generate a unique ID
export function generateId() {
    return Date.now() + Math.random().toString(36).substr(2, 9);
}

// Show a toast message
export function showToast(message, type = 'info') {
    const container = document.getElementById('toast-container');
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.textContent = message;
    container.appendChild(toast);
    
    // Trigger reflow
    toast.offsetHeight;
    
    toast.classList.add('show');
    setTimeout(() => {
        toast.classList.remove('show');
        setTimeout(() => toast.remove(), 500);
    }, 3000);
}

// Debounce function
export function debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
        const later = () => {
            clearTimeout(timeout);
            func(...args);
        };
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
    };
}

// Deep clone an object
export function deepClone(obj) {
    if (obj === null || typeof obj !== 'object') return obj;
    if (obj instanceof Date) return new Date(obj);
    if (obj instanceof Array) return obj.map(item => deepClone(item));
    if (obj instanceof Object) {
        return Object.fromEntries(
            Object.entries(obj).map(([key, value]) => [key, deepClone(value)])
        );
    }
}