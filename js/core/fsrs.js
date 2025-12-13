export class FSRSAlgorithm {
    constructor() {
        this.State = null;
        this.Rating = null;
        this.fsrsClient = null;
        this.fsrsRepeat = null;
        this.isAvailable = false;
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
            this.isAvailable = true;
            return;
        }

        if (typeof window.fsrs === 'function') {
            this.fsrsClient = window._fsrsInstance || window.fsrs();
            window._fsrsInstance = this.fsrsClient;
            this.State = window.State || this.fsrsClient.State || null;
            this.Rating = window.Rating || this.fsrsClient.Rating || null;
            this.isAvailable = true;
            return;
        }

        // Instead of throwing here, mark the engine unavailable so callers can
        // still use non-FSRS helpers (prepareCard/getRatings) without crashing.
        // Methods that actually require the engine (repeat/reviewCard) will still
        // throw if they are used while the engine is unavailable.
        this.isAvailable = false;
        return;
    }

    getRatings() {
        return this.Rating || { Again: 0, Hard: 1, Good: 2, Easy: 3 };
    }

    prepareCard(card) {
        const now = new Date();
        const source = card?.fsrs || card || {};
        const prepared = {
            state: typeof source.state === 'number' ? source.state : this.State?.New ?? 0,
            stability: typeof source.stability === 'number' ? source.stability : 0,
            difficulty: typeof source.difficulty === 'number' ? source.difficulty : 0,
            reps: typeof source.reps === 'number' ? source.reps : 0,
            lapses: typeof source.lapses === 'number' ? source.lapses : 0,
            elapsed_days: typeof source.elapsed_days === 'number' ? source.elapsed_days : 0,
            scheduled_days: typeof source.scheduled_days === 'number' ? source.scheduled_days : 0,
            due: source.due ? new Date(source.due) : now,
            last_review: source.last_review ? new Date(source.last_review) : now
        };
        return prepared;
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
        const fsrsState = cardState?.fsrs || cardState;
        if (!fsrsState || fsrsState.state === (this.State?.New ?? 0)) {
            return 1.0;
        }
        const lastReview = fsrsState.last_review || cardState?.lastReviewed || now;
        const lastReviewDate = new Date(lastReview);
        const elapsedDays = Math.max(0, (now.getTime() - lastReviewDate.getTime()) / (1000 * 3600 * 24));
        const stability = fsrsState.stability || 0;
        if (stability <= 0) return 1.0;
        const retention = Math.exp(-elapsedDays / stability);
        return Math.max(0, Math.min(1, retention));
    }

    getImplicitGrade(interactionData, userBaseline = {}) {
        const ratings = this.getRatings();
        const baseline = { ...this.defaultImplicitBaseline, ...(userBaseline || {}) };

        if (!interactionData?.wasCorrect) return ratings.Again;

        const latency = typeof interactionData.recallLatency === 'number' ? interactionData.recallLatency : baseline.latency;
        const corrections = typeof interactionData.totalCorrections === 'number' ? interactionData.totalCorrections : baseline.corrections;
        const attempts = typeof interactionData.attemptCount === 'number' ? interactionData.attemptCount : baseline.attempts;
        const fluency = typeof interactionData.answerFluency === 'number' ? interactionData.answerFluency : baseline.fluency;

        const latencyScore = Math.exp(-Math.max(0, latency - baseline.latency) / (baseline.latency * 1.8));
        const correctionScore = 1 / (1 + Math.max(0, corrections) * 0.4);
        const attemptScore = 1 / (1 + Math.max(0, attempts - 1) * 0.35);
        const fluencyScore = Math.min(1, fluency / (baseline.fluency || 5));

        const composite = (latencyScore * 0.35) + (fluencyScore * 0.35) + (correctionScore * 0.15) + (attemptScore * 0.15);

        if (composite >= 0.8) return ratings.Easy;
        if (composite >= 0.55) return ratings.Good;
        if (composite >= 0.3) return ratings.Hard;
        return ratings.Again;
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
        const ratingIndex = typeof rating === 'number' ? rating : ratings.Good;
        const outcome = Array.isArray(repeatResult)
            ? repeatResult[ratingIndex]
            : repeatResult?.[ratingIndex] ?? repeatResult?.[ratings.Good];

        if (!outcome) {
            throw new Error('FSRS repeat result missing for rating: ' + ratingIndex);
        }

        const updatedFsrs = {
            ...preparedCard,
            ...(outcome.card || outcome)
        };
        if (updatedFsrs.due) updatedFsrs.due = new Date(updatedFsrs.due);
        if (outcome?.log?.review) {
            updatedFsrs.last_review = new Date(outcome.log.review);
        } else if (updatedFsrs.last_review) {
            updatedFsrs.last_review = new Date(updatedFsrs.last_review);
        } else {
            updatedFsrs.last_review = evaluationDate;
        }

        return {
            ...cardState,
            fsrs: updatedFsrs
        };
    }
}
