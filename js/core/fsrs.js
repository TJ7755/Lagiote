import { fsrs, State, Rating } from 'ts-fsrs';

export class FSRSAlgorithm {
    constructor() {
        this.State = State;
        this.Rating = Rating;
        this.fsrsClient = fsrs();
        this.isAvailable = true;
        this.defaultImplicitBaseline = {
            latency: 2500,
            corrections: 1,
            attempts: 1,
            fluency: 5
        };
    }

    async init() {
        return this.fsrsClient;
    }

    getRatings() {
        return { Again: Rating.Again, Hard: Rating.Hard, Good: Rating.Good, Easy: Rating.Easy };
    }

    prepareCard(card) {
        const now = new Date();
        const source = card?.fsrs || card || {};
        const state = typeof source.state === 'number' ? source.state : State.New;
        const reviewed = state !== State.New;
        const prepared = {
            state,
            stability: Number.isFinite(source.stability) && source.stability > 0 ? source.stability : (reviewed ? 0.1 : 0),
            difficulty: Number.isFinite(source.difficulty) && source.difficulty > 0 ? Math.min(10, source.difficulty) : (reviewed || source.stability > 0 ? 5 : 0),
            reps: typeof source.reps === 'number' ? source.reps : 0,
            lapses: typeof source.lapses === 'number' ? source.lapses : 0,
            elapsed_days: typeof source.elapsed_days === 'number' ? source.elapsed_days : 0,
            scheduled_days: typeof source.scheduled_days === 'number' ? source.scheduled_days : 0,
            due: source.due ? new Date(source.due) : now,
            last_review: source.last_review ? new Date(source.last_review) : now
        };
        return prepared;
    }

    convertSm2ToFsrs(sm2Data) {
        if (!sm2Data || typeof sm2Data !== 'object') return null;

        const now = new Date();

        const intervalRaw =
            sm2Data.interval ??
            sm2Data.scheduled_days ??
            sm2Data.scheduledDays ??
            sm2Data.I;

        const repsRaw =
            sm2Data.repetition ??
            sm2Data.repetitions ??
            sm2Data.reps ??
            sm2Data.n ??
            0;

        const efRaw =
            sm2Data.easinessFactor ??
            sm2Data.easeFactor ??
            sm2Data.ef ??
            sm2Data.ease ??
            sm2Data.EF;

        const lastRaw =
            sm2Data.lastReview ??
            sm2Data.lastReviewed ??
            sm2Data.last_review ??
            sm2Data.lastReviewDate;

        const dueRaw =
            sm2Data.due ??
            sm2Data.nextReview ??
            sm2Data.nextDue ??
            sm2Data.nextReviewDate;

        const intervalDays = Number.isFinite(Number(intervalRaw)) ? Math.max(0, Number(intervalRaw)) : 0;
        const reps = Number.isFinite(Number(repsRaw)) ? Math.max(0, Math.floor(Number(repsRaw))) : 0;

        const ef = Number.isFinite(Number(efRaw)) ? Number(efRaw) : 2.5;

        const clamp = (v, min, max) => Math.min(max, Math.max(min, v));
        const diff = clamp(10 - ((ef - 1.3) * (9 / (2.8 - 1.3))), 1, 10);

        const lastReview = lastRaw ? new Date(lastRaw) : now;
        const due = dueRaw
            ? new Date(dueRaw)
            : new Date(lastReview.getTime() + intervalDays * 86400000);

        const state = reps > 0 ? (this.State?.Review ?? 2) : (this.State?.New ?? 0);

        return {
            state,
            stability: Math.max(0.1, intervalDays || 0.1),
            difficulty: diff,
            reps,
            lapses: Number.isFinite(Number(sm2Data.lapses)) ? Math.max(0, Math.floor(Number(sm2Data.lapses))) : 0,
            elapsed_days: intervalDays,
            scheduled_days: intervalDays,
            due,
            last_review: lastReview
        };
    }

    async getRepeatResult(preparedCard, evaluationDate) {
        const now = evaluationDate instanceof Date ? evaluationDate : new Date(evaluationDate);
        return this.fsrsClient.repeat(preparedCard, now);
    }

    async repeat(card, now = new Date()) {
        const preparedCard = this.prepareCard(card);
        const evaluationDate = now instanceof Date ? now : new Date(now);
        return this.getRepeatResult(preparedCard, evaluationDate);
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
        const retention = Math.exp((Math.log(0.9) * elapsedDays) / stability);
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
        const evaluationDate = now instanceof Date ? now : new Date(now);
        const preparedCard = this.prepareCard(cardState);

        const repeatResult = await this.getRepeatResult(preparedCard, evaluationDate);

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
