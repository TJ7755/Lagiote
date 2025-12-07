export class FSRSAlgorithm {
    constructor() {
        this.State = null;
        this.Rating = null;
        this.fsrsClient = null;
        this.fsrsRepeat = null;
        this.adaptiveBaseline = null;
        this.defaultImplicitBaseline = {
            latency: 2500,
            corrections: 1,
            attempts: 1,
            fluency: 5
        };
    }

    async init() {
        if (this.fsrsRepeat || this.fsrsClient) return;

        if (window.electronAPI?.getFsrsEnums && window.electronAPI?.fsrsRepeat) {
            const enums = await window.electronAPI.getFsrsEnums();
            this.State = enums?.State || null;
            this.Rating = enums?.Rating || null;
            this.fsrsRepeat = (card, now) => window.electronAPI.fsrsRepeat(card, now);
            return;
        }

        if (typeof window.fsrs === 'function') {
            // Browser build of ts-fsrs exposed on window
            this.fsrsClient = window._fsrsInstance || window.fsrs();
            window._fsrsInstance = this.fsrsClient;
            this.State = window.State || this.fsrsClient.State || null;
            this.Rating = window.Rating || this.fsrsClient.Rating || null;
            return;
        }

        throw new Error('FSRS engine is not available in this environment.');
    }

    getRatings() {
        return this.Rating || { Again: 0, Hard: 1, Good: 2, Easy: 3 };
    }

    setAdaptiveBaseline(baseline = null) {
        if (baseline && typeof baseline === 'object') {
            this.adaptiveBaseline = {
                ...baseline
            };
        } else {
            this.adaptiveBaseline = null;
        }
    }

    prepareCard(card) {
        const now = new Date();
        const baseCard = {
            due: now,
            stability: 0,
            difficulty: 0,
            elapsed_days: 0,
            scheduled_days: 0,
            reps: 0,
            lapses: 0,
            state: this.State?.New ?? 0,
            last_review: now
        };

        if (!card) return baseCard;

        return {
            ...baseCard,
            ...card,
            due: card.due ? new Date(card.due) : now,
            last_review: card.last_review ? new Date(card.last_review) : now
        };
    }

    async repeat(card, now = new Date()) {
        await this.init();
        const preparedCard = this.prepareCard(card);
        const evaluationDate = now instanceof Date ? now : new Date(now);

        if (this.fsrsRepeat) {
            return this.fsrsRepeat(preparedCard, evaluationDate.toISOString());
        }

        if (this.fsrsClient?.repeat) {
            return this.fsrsClient.repeat(preparedCard, evaluationDate);
        }

        throw new Error('FSRS repeat method unavailable.');
    }

    calculateRetrievability(cardState, now = new Date()) {
        if (!cardState || !cardState.fsrs || cardState.fsrs.state === (this.State?.New ?? 0)) {
            return 1.0;
        }
        const lastReview = cardState.fsrs.last_review || cardState.lastReviewed || cardState.fsrs.due || now;
        const elapsedDays = (now.getTime() - new Date(lastReview).getTime()) / (1000 * 3600 * 24);
        const stability = cardState.fsrs.stability || cardState.stability || 0;
        if (stability <= 0) return 1.0;
        return Math.pow(1 + elapsedDays / (9 * stability), -1);
    }

    getImplicitGrade(interactionData, userBaseline = {}) {
        const ratings = this.getRatings();
        const baseline = {
            ...this.defaultImplicitBaseline,
            ...(this.adaptiveBaseline || {}),
            ...(userBaseline || {})
        };

        if (!interactionData?.wasCorrect) return ratings.Again;

        const latency = typeof interactionData.recallLatency === 'number'
            ? interactionData.recallLatency
            : baseline.latency;
        const corrections = typeof interactionData.totalCorrections === 'number'
            ? interactionData.totalCorrections
            : baseline.corrections;
        const attempts = typeof interactionData.attemptCount === 'number'
            ? interactionData.attemptCount
            : baseline.attempts;
        const fluency = typeof interactionData.answerFluency === 'number'
            ? interactionData.answerFluency
            : baseline.fluency;

        // Scores are normalized against baseline to form an implicit 1-4 grade
        const latencyScore = 1 - (Math.min(latency / baseline.latency, 2) / 2);
        const correctionScore = 1 - (Math.min(corrections / (baseline.corrections || 1), 1.5) / 1.5);
        const attemptScore = 1 - (Math.min(Math.max(attempts - 1, 0) / (baseline.attempts || 1), 1));
        const fluencyScore = Math.min(fluency / (baseline.fluency || 5), 1.5) / 1.5;

        const composite = (latencyScore * 0.4) + (correctionScore * 0.2) + (attemptScore * 0.2) + (fluencyScore * 0.2);

        if (composite >= 0.75) return ratings.Easy;
        if (composite >= 0.50) return ratings.Good;
        if (composite >= 0.30) return ratings.Hard;
        return ratings.Again;
    }

    convertSm2ToFsrs(sm2Data, now = new Date()) {
        if (!sm2Data) return null;
        const dueDate = sm2Data.dueDate ? new Date(sm2Data.dueDate) : now;
        return this.prepareCard({
            due: dueDate,
            last_review: dueDate,
            stability: Math.max(1, sm2Data.interval || 0),
            difficulty: Math.max(0, (sm2Data.factor || 2.5) - 1.3),
            reps: sm2Data.repetition || 0,
            lapses: 0
        });
    }

    async reviewCard(cardState, rating, now = new Date()) {
        await this.init();
        const evaluationDate = now instanceof Date ? now : new Date(now);
        const preparedCard = this.prepareCard(cardState);

        let repeatResult = null;
        if (this.fsrsRepeat) {
            repeatResult = await this.fsrsRepeat(preparedCard, evaluationDate.toISOString());
        } else if (this.fsrsClient?.repeat) {
            repeatResult = this.fsrsClient.repeat(preparedCard, evaluationDate);
        } else {
            throw new Error('FSRS repeat method unavailable.');
        }

        const ratings = this.getRatings();
        const selected = repeatResult?.[rating] ?? repeatResult?.[ratings.Good];
        const updatedCard = selected?.card || preparedCard;
        updatedCard.last_review = selected?.log?.review ? new Date(selected.log.review) : evaluationDate;
        return updatedCard;
    }
}
