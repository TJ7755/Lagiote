export function levenshteinDistance(s1, s2) {
    s1 = (s1 || '').toLowerCase();
    s2 = (s2 || '').toLowerCase();

    const costs = [];
    for (let i = 0; i <= s1.length; i++) {
        let lastValue = i;
        for (let j = 0; j <= s2.length; j++) {
            if (i === 0) {
                costs[j] = j;
            } else if (j > 0) {
                let newValue = costs[j - 1];
                if (s1.charAt(i - 1) !== s2.charAt(j - 1)) {
                    newValue = Math.min(Math.min(newValue, lastValue), costs[j]) + 1;
                }
                costs[j - 1] = lastValue;
                lastValue = newValue;
            }
        }
        if (i > 0) costs[s2.length] = lastValue;
    }
    return costs[s2.length];
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
            const ctx = canvas.getContext('2d');

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

export function getQueryParam(param, search = window.location.search) {
    const params = new URLSearchParams(search || '');
    return params.get(param);
}

export function calculateIQS(logData, userBaseline = { latency: 1500, fluency: 10 }) {
    const recallLatency = (typeof logData.recallLatency === 'number') ? logData.recallLatency : userBaseline.latency;
    const answerFluency = (typeof logData.answerFluency === 'number') ? logData.answerFluency : 0;
    const totalCorrections = (typeof logData.totalCorrections === 'number') ? logData.totalCorrections : 0;
    const attemptCount = (typeof logData.attemptCount === 'number' && logData.attemptCount > 0) ? logData.attemptCount : 1;
    const v_latency = 1 - (Math.min(recallLatency / userBaseline.latency, 2) / 2);
    const v_fluency = Math.min(answerFluency / userBaseline.fluency, 1.5) / 1.5;
    const v_corrections = 1 / (1 + totalCorrections);
    const v_attempts = 1 / attemptCount;
    const W_latency = 0.15;
    const W_fluency = 0.15;
    const W_corrections = 0.40;
    const W_attempts = 0.30;
    const iqs = (W_latency * v_latency) + (W_fluency * v_fluency) + (W_corrections * v_corrections) + (W_attempts * v_attempts);

    return isNaN(iqs) ? 0.5 : Math.max(0, Math.min(1, iqs));
}
