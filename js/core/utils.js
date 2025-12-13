export function levenshteinDistance(s1, s2) {
    const a = (s1 || '').toLowerCase();
    const b = (s2 || '').toLowerCase();
    const aLen = a.length;
    const bLen = b.length;
    if (aLen === 0) return bLen;
    if (bLen === 0) return aLen;

    let previous = new Uint16Array(bLen + 1);
    let current = new Uint16Array(bLen + 1);

    for (let j = 0; j <= bLen; j++) previous[j] = j;

    for (let i = 0; i < aLen; i++) {
        current[0] = i + 1;
        const aCode = a.charCodeAt(i);
        for (let j = 0; j < bLen; j++) {
            const cost = aCode === b.charCodeAt(j) ? 0 : 1;
            const deletion = previous[j + 1] + 1;
            const insertion = current[j] + 1;
            const substitution = previous[j] + cost;
            current[j + 1] = Math.min(deletion, insertion, substitution);
        }
        [previous, current] = [current, previous];
    }

    return previous[bLen];
}

export function shuffleArray(array) {
    const newArray = [...array];
    for (let i = newArray.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [newArray[i], newArray[j]] = [newArray[j], newArray[i]];
    }
    return newArray;
}

export function compressImage(dataUrl, quality = 0.7, maxSizeKB = 150) {
    return new Promise((resolve) => {
        const img = new Image();
        img.onload = () => {
            const canvas = document.createElement('canvas');
            const ctx = canvas.getContext && canvas.getContext('2d') || null;
            if (!ctx) {
                // Could not get a 2D context - fallback to original dataUrl
                resolve(dataUrl);
                return;
            }

            let width = img.width;
            let height = img.height;
            const MAX_WIDTH = 1024;
            const MAX_HEIGHT = 1024;

            if (width > height) {
                if (width > MAX_WIDTH) {
                    height *= MAX_WIDTH / width;
                    width = MAX_WIDTH;
                }
            } else if (height > MAX_HEIGHT) {
                width *= MAX_HEIGHT / height;
                height = MAX_HEIGHT;
            }

            canvas.width = width;
            canvas.height = height;
            ctx.drawImage(img, 0, 0, width, height);

            let compressedDataUrl = canvas.toDataURL('image/jpeg', quality);

            const head = 'data:image/jpeg;base64,';
            const imageSizeKB = Math.round((compressedDataUrl.length - head.length) * 3 / 4 / 1024);

            if (imageSizeKB > maxSizeKB) {
                console.log(`Image too large (${imageSizeKB}KB), further compression needed.`);
            }

            resolve(compressedDataUrl);
        };
        img.onerror = () => resolve(dataUrl);
        img.src = dataUrl;
    });
}

export function getCanvasContext(canvas) {
    if (!canvas) return null;
    try {
        return (canvas.getContext && canvas.getContext('2d')) || null;
    } catch (e) {
        console.warn('getCanvasContext: failed to get context', e);
        return null;
    }
}

// Also attach to window for non-module scripts that don't import this module
if (typeof window !== 'undefined') {
    window.getCanvasContext = getCanvasContext;
    window.compressImage = compressImage;
}

export function getQueryParam(param, search = window.location.search) {
    const params = new URLSearchParams(search || '');
    return params.get(param);
}

export function calculateIQS(logData, userBaseline = { latency: 1500, fluency: 10 }) {
    const baselineLatency = Math.max(300, userBaseline.latency || 1500);
    const baselineFluency = Math.max(1, userBaseline.fluency || 10);

    const recallLatency = typeof logData.recallLatency === 'number' ? logData.recallLatency : baselineLatency;
    const answerFluency = typeof logData.answerFluency === 'number' ? logData.answerFluency : baselineFluency / 2;
    const totalCorrections = typeof logData.totalCorrections === 'number' ? logData.totalCorrections : 0;
    const attemptCount = typeof logData.attemptCount === 'number' && logData.attemptCount > 0 ? logData.attemptCount : 1;

    const latencyScore = Math.exp(-Math.max(0, recallLatency) / (baselineLatency * 1.5));
    const fluencyScore = Math.min(1, answerFluency / baselineFluency);
    const correctionScore = 1 / (1 + totalCorrections * 0.7);
    const attemptScore = 1 / (1 + (attemptCount - 1) * 0.6);

    const iqs = (latencyScore * 0.45) + (fluencyScore * 0.35) + (correctionScore * 0.1) + (attemptScore * 0.1);
    const bounded = Math.max(0, Math.min(1, iqs));
    return Number.isFinite(bounded) ? bounded : 0.5;
}
