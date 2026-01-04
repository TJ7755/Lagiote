export class FSRSAlgorithm {
    constructor() {
        this.State = null;
        this.Rating = null;
        this.fsrsClient = null;
        this.fsrsRepeat = null;
        this.isAvailable = true;
        this.remoteFsrsPromise = null;
        this.fallbackReady = false;
        this.defaultImplicitBaseline = {
            latency: 2500,
            corrections: 1,
            attempts: 1,
            fluency: 5
        };
        this.fallbackActive = false;
        this._fallbackNoticeLogged = false;
    }

    async init() {
        if (this.fsrsRepeat || this.fsrsClient) {
            this.isAvailable = true;
            return;
        }

        if (typeof window !== 'undefined' && window.electronAPI?.getFsrsEnums && window.electronAPI?.fsrsRepeat) {
            const enums = await window.electronAPI.getFsrsEnums();
            this.State = enums?.State || null;
            this.Rating = enums?.Rating || null;
            this.fsrsRepeat = (card, now) => window.electronAPI.fsrsRepeat(card, now);
            this.isAvailable = true;
            this.fallbackActive = false;
            return;
        }

        if (typeof window !== 'undefined' && typeof window.fsrs === 'function') {
            this.fsrsClient = window._fsrsInstance || window.fsrs();
            window._fsrsInstance = this.fsrsClient;
            this.State = window.State || this.fsrsClient.State || null;
            this.Rating = window.Rating || this.fsrsClient.Rating || null;
            this.isAvailable = true;
            this.fallbackActive = false;
            return;
        }

        // No native engine yet; mark as available so fallback pathways can run.
        this.isAvailable = true;
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

    async loadRemoteFsrs() {
        if (this.fsrsClient?.repeat || typeof window === 'undefined' || window.electronAPI) {
            return this.fsrsClient;
        }
        if (this.remoteFsrsPromise) return this.remoteFsrsPromise;
        const remoteUrl = (typeof window !== 'undefined' && window.TS_FSRS_CDN)
            ? window.TS_FSRS_CDN
            : 'https://cdn.jsdelivr.net/npm/ts-fsrs@5.2.3/dist/index.mjs';
        this.remoteFsrsPromise = import(/* @vite-ignore */ /* webpackIgnore: true */ remoteUrl)
            .then(module => {
                const factory = module?.fsrs || module?.FSRS || module?.default?.fsrs || module?.default;
                if (typeof factory !== 'function') {
                    throw new Error('Remote FSRS module missing scheduler factory');
                }
                const client = window._fsrsInstance || factory();
                if (typeof window !== 'undefined') {
                    window._fsrsInstance = client;
                }
                this.fsrsClient = client;
                this.State = module.State || client.State || this.State;
                this.Rating = module.Rating || client.Rating || this.Rating;
                this.isAvailable = true;
                this.fallbackActive = false;
                return client;
            })
            .catch(err => {
                console.warn('Failed to load remote FSRS scheduler:', err);
                this.remoteFsrsPromise = null;
                return null;
            });
        return this.remoteFsrsPromise;
    }

    enableFallback() {
        if (!this.fallbackReady) {
            this.fallbackReady = true;
        }
        this.isAvailable = true;
        if (!this.fallbackActive && !this._fallbackNoticeLogged) {
            console.warn('FSRS fallback heuristic active — schedules may be less precise until the full engine loads.');
            this._fallbackNoticeLogged = true;
        }
        this.fallbackActive = true;
    }

    isFallbackActive() {
        return this.fallbackActive;
    }

    buildFallbackRepeat(card, evaluationDate) {
        const ratings = this.getRatings();
        const now = evaluationDate instanceof Date ? evaluationDate : new Date(evaluationDate);
        const baseStability = Number.isFinite(card?.stability) && card.stability > 0 ? card.stability : 1.0;
        const baseDifficulty = Number.isFinite(card?.difficulty) && card.difficulty > 0 ? card.difficulty : 5.0;
        const baseReps = Number.isFinite(card?.reps) ? card.reps : 0;
        const baseLapses = Number.isFinite(card?.lapses) ? card.lapses : 0;
        const clampValue = (val, min, max) => Math.min(Math.max(val, min), max);
        const profiles = [
            { key: 'Again', rating: ratings.Again, stabilityMultiplier: 0.5, difficultyDelta: 0.7, intervalMultiplier: 0.2, minIntervalDays: 0.25, lapsesDelta: 1 },
            { key: 'Hard', rating: ratings.Hard, stabilityMultiplier: 0.85, difficultyDelta: 0.2, intervalMultiplier: 0.8, minIntervalDays: 1, lapsesDelta: 0 },
            { key: 'Good', rating: ratings.Good, stabilityMultiplier: 1.15, difficultyDelta: -0.1, intervalMultiplier: 1.4, minIntervalDays: 2, lapsesDelta: 0 },
            { key: 'Easy', rating: ratings.Easy, stabilityMultiplier: 1.4, difficultyDelta: -0.25, intervalMultiplier: 2.1, minIntervalDays: 4, lapsesDelta: 0 }
        ];
        const results = {};
        for (const profile of profiles) {
            const stability = clampValue(baseStability * profile.stabilityMultiplier, 0.2, 3650);
            const difficulty = clampValue(baseDifficulty + profile.difficultyDelta, 1, 10);
            const intervalDays = Math.max(profile.minIntervalDays, stability * profile.intervalMultiplier);
            const dueDate = new Date(now.getTime() + intervalDays * 86400000);
            const state =
                profile.rating === ratings.Again
                    ? (this.State?.Relearning ?? 3)
                    : (this.State?.Review ?? 2);
            const updatedCard = {
                ...card,
                state,
                reps: baseReps + 1,
                lapses: baseLapses + profile.lapsesDelta,
                stability,
                difficulty,
                scheduled_days: intervalDays,
                elapsed_days: 0,
                due: dueDate,
                last_review: now
            };
            const entry = {
                card: updatedCard,
                log: {
                    rating: profile.rating,
                    state,
                    due: dueDate.toISOString(),
                    review: now.toISOString()
                }
            };
            if (typeof profile.rating === 'number') {
                results[profile.rating] = entry;
            }
            results[profile.key] = entry;
        }
        return results;
    }

    async getRepeatResult(preparedCard, evaluationDate) {
        await this.init();
        const evalDate = evaluationDate instanceof Date ? evaluationDate : new Date(evaluationDate);

        if (this.fsrsRepeat) {
            try {
                const ipcResult = await this.fsrsRepeat(preparedCard, evalDate.toISOString());
                if (ipcResult) return ipcResult;
            } catch (err) {
                console.warn('Electron FSRS repeat failed, attempting fallback path:', err);
            }
        }

        if (this.fsrsClient?.repeat) {
            try {
                const clientResult = this.fsrsClient.repeat(preparedCard, evalDate);
                if (clientResult) return clientResult;
            } catch (err) {
                console.warn('Local FSRS repeat failed:', err);
            }
        }

        if (typeof window !== 'undefined' && window.__TEST_MODE__) {
            this.enableFallback();
            return this.buildFallbackRepeat(preparedCard, evalDate);
        }

        await this.loadRemoteFsrs();
        if (this.fsrsClient?.repeat) {
            try {
                const remoteResult = this.fsrsClient.repeat(preparedCard, evalDate);
                if (remoteResult) return remoteResult;
            } catch (err) {
                console.warn('Remote FSRS repeat failed:', err);
            }
        }

        this.enableFallback();
        return this.buildFallbackRepeat(preparedCard, evalDate);
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
