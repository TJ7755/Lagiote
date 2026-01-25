/**
 * Exam Hub - Dashboard Component
 * 
 * The central hub for Exam Mode providing:
 * - Exam date countdown
 * - Predicted score distribution and probability
 * - Revision completeness and time remaining estimates
 * - "Start next optimal session" action
 * - Weak mark-loss drivers display
 */

import {
    predictExamScore,
    computeRevisionCompleteness,
    estimateTimeToTarget,
    rankQuestionsForPractice,
    composeOptimalSession,
    createExamSpec
} from '../../core/exam/exam-mode.js';
import { computeEffectiveMasteryMap } from '../../core/exam/atom-dynamics.js';

/**
 * Creates the Exam Hub state manager.
 * @returns {Object} Hub state manager
 */
export function createExamHub() {
    const state = {
        examSpec: null,
        examDate: null,
        targetScore: 70,
        atoms: new Map(),
        questions: [],
        prediction: null,
        completeness: null,
        timeEstimate: null,
        weakAreas: [],
        loading: false,
        lastUpdated: null
    };
    
    return {
        /**
         * Initialises the hub with data.
         * @param {Object} options Configuration options
         */
        async init(options = {}) {
            state.loading = true;
            
            if (options.examSpec) {
                state.examSpec = options.examSpec;
                state.examDate = options.examSpec.examDate
                    ? new Date(options.examSpec.examDate)
                    : null;
            }
            
            if (options.atoms) {
                state.atoms = options.atoms instanceof Map
                    ? options.atoms
                    : new Map(Object.entries(options.atoms || {}));
            }
            
            if (options.questions) {
                state.questions = options.questions;
            }
            
            if (options.targetScore !== undefined) {
                state.targetScore = options.targetScore;
            }
            
            await this.refresh();
            state.loading = false;
        },
        
        /**
         * Refreshes all prediction data.
         */
        async refresh() {
            const now = new Date();
            const targetDate = state.examDate || now;
            const spec = state.examSpec || createExamSpec({});
            
            // Compute prediction
            state.prediction = predictExamScore(
                spec,
                state.questions,
                state.atoms,
                now,
                targetDate
            );
            
            // Compute completeness
            state.completeness = computeRevisionCompleteness(
                spec,
                state.atoms,
                now,
                targetDate,
                state.targetScore
            );
            
            // Compute time estimate
            state.timeEstimate = estimateTimeToTarget(
                spec,
                state.atoms,
                now,
                targetDate,
                state.targetScore
            );
            
            // Get weak areas
            const ranked = rankQuestionsForPractice(
                state.questions,
                state.atoms,
                now,
                targetDate
            );
            
            state.weakAreas = ranked.slice(0, 5).map(item => ({
                questionId: item.questionId,
                topic: item.question?.tags?.[0] || 'Unknown',
                mastery: item.readiness,
                impact: item.expectedGain,
                fragility: item.fragility
            }));
            
            state.lastUpdated = now;
        },
        
        /**
         * Gets the countdown to exam date.
         * @returns {Object} Countdown info
         */
        getCountdown() {
            if (!state.examDate) {
                return { days: null, hours: null, minutes: null, text: 'No exam date set' };
            }
            
            const now = new Date();
            const diff = state.examDate.getTime() - now.getTime();
            
            if (diff < 0) {
                return { days: 0, hours: 0, minutes: 0, text: 'Exam date has passed' };
            }
            
            const days = Math.floor(diff / (1000 * 60 * 60 * 24));
            const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
            const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
            
            let text;
            if (days > 0) {
                text = `${days} day${days !== 1 ? 's' : ''} remaining`;
            } else if (hours > 0) {
                text = `${hours} hour${hours !== 1 ? 's' : ''} remaining`;
            } else {
                text = `${minutes} minute${minutes !== 1 ? 's' : ''} remaining`;
            }
            
            return { days, hours, minutes, text };
        },
        
        /**
         * Gets the predicted score summary.
         * @returns {Object} Prediction summary
         */
        getPrediction() {
            if (!state.prediction) {
                return {
                    expected: 0,
                    lower: 0,
                    upper: 0,
                    probability: 0,
                    grade: null
                };
            }
            
            const p = state.prediction;
            
            // Determine most likely grade
            let likelyGrade = null;
            let maxProb = 0;
            for (const [grade, prob] of Object.entries(p.gradeProbabilities || {})) {
                if (prob > maxProb) {
                    maxProb = prob;
                    likelyGrade = grade;
                }
            }
            
            return {
                expected: Math.round(p.expectedMarks),
                lower: Math.round(p.confidenceInterval.lower),
                upper: Math.round(p.confidenceInterval.upper),
                probability: Math.round(p.probability * 100),
                gradeProbabilities: p.gradeProbabilities,
                likelyGrade
            };
        },
        
        /**
         * Gets revision completeness summary.
         * @returns {Object} Completeness summary
         */
        getCompleteness() {
            if (!state.completeness) {
                return {
                    overall: 0,
                    scoreProgress: 0,
                    coverageProgress: 0,
                    fragilityRisk: 0,
                    techniqueProgress: 0
                };
            }
            
            const c = state.completeness;
            
            return {
                overall: Math.round(c.overall * 100),
                scoreProgress: Math.round(c.scoreProgress * 100),
                coverageProgress: Math.round(c.coverageProgress * 100),
                fragilityRisk: Math.round(c.fragilityRisk * 100),
                techniqueProgress: Math.round(c.techniqueProgress * 100),
                breakdown: c.breakdown
            };
        },
        
        /**
         * Gets time estimate summary.
         * @returns {Object} Time estimate summary
         */
        getTimeEstimate() {
            if (!state.timeEstimate) {
                return {
                    likelyHours: 0,
                    safeHours: 0,
                    sessionsNeeded: 0,
                    topActions: []
                };
            }
            
            return {
                likelyHours: Math.round(state.timeEstimate.likelyHours * 10) / 10,
                safeHours: Math.round(state.timeEstimate.safeHours * 10) / 10,
                sessionsNeeded: state.timeEstimate.sessionsNeeded,
                topActions: state.timeEstimate.topActions
            };
        },
        
        /**
         * Gets weak areas that need attention.
         * @returns {Array} Weak areas list
         */
        getWeakAreas() {
            return state.weakAreas.map(area => ({
                ...area,
                mastery: Math.round(area.mastery * 100),
                impact: Math.round(area.impact * 10) / 10,
                fragility: Math.round(area.fragility * 100)
            }));
        },
        
        /**
         * Gets an optimal practice session.
         * @param {Object} options Session options
         * @returns {Object} Session plan
         */
        async getOptimalSession(options = {}) {
            const now = new Date();
            const targetDate = state.examDate || now;
            
            return composeOptimalSession(
                state.questions,
                state.atoms,
                now,
                targetDate,
                {
                    sessionMinutes: options.sessionMinutes || 30,
                    phase: options.phase || 'build'
                }
            );
        },
        
        /**
         * Gets the current state.
         * @returns {Object} Hub state
         */
        getState() {
            return {
                loading: state.loading,
                hasExamDate: state.examDate !== null,
                examDate: state.examDate,
                targetScore: state.targetScore,
                lastUpdated: state.lastUpdated,
                atomCount: state.atoms.size,
                questionCount: state.questions.length
            };
        },
        
        /**
         * Sets the exam date.
         * @param {Date|string} date Exam date
         */
        async setExamDate(date) {
            state.examDate = date ? new Date(date) : null;
            if (state.examSpec) {
                state.examSpec.examDate = state.examDate?.toISOString() || null;
            }
            await this.refresh();
        },
        
        /**
         * Sets the target score.
         * @param {number} score Target score percentage
         */
        async setTargetScore(score) {
            state.targetScore = Math.max(0, Math.min(100, Number(score) || 70));
            await this.refresh();
        }
    };
}

/**
 * Renders the Exam Hub dashboard HTML.
 * @param {Object} hub Hub instance
 * @returns {string} HTML string
 */
export function renderExamHubHTML(hub) {
    const countdown = hub.getCountdown();
    const prediction = hub.getPrediction();
    const completeness = hub.getCompleteness();
    const timeEstimate = hub.getTimeEstimate();
    const weakAreas = hub.getWeakAreas();
    const state = hub.getState();
    
    return `
        <div class="exam-hub">
            <header class="exam-hub-header">
                <h1>Exam Hub</h1>
                ${state.hasExamDate ? `
                    <div class="exam-countdown">
                        <span class="countdown-value">${countdown.days || 0}</span>
                        <span class="countdown-label">${countdown.text}</span>
                    </div>
                ` : `
                    <div class="exam-countdown no-date">
                        <span class="countdown-label">Set your exam date to see countdown</span>
                    </div>
                `}
            </header>
            
            <section class="exam-hub-section prediction-section">
                <h2>Predicted Score</h2>
                <div class="prediction-display">
                    <div class="prediction-main">
                        <span class="prediction-value">${prediction.expected}</span>
                        <span class="prediction-unit">%</span>
                    </div>
                    <div class="prediction-range">
                        <span>${prediction.lower}% - ${prediction.upper}%</span>
                        <span class="prediction-confidence">(90% confidence)</span>
                    </div>
                    ${prediction.likelyGrade ? `
                        <div class="prediction-grade">
                            Likely grade: <strong>${prediction.likelyGrade}</strong>
                        </div>
                    ` : ''}
                </div>
            </section>
            
            <section class="exam-hub-section completeness-section">
                <h2>Revision Completeness</h2>
                <div class="completeness-display">
                    <div class="completeness-bar">
                        <div class="completeness-fill" style="width: ${completeness.overall}%"></div>
                    </div>
                    <span class="completeness-value">${completeness.overall}%</span>
                </div>
                <div class="completeness-breakdown">
                    <div class="breakdown-item">
                        <span class="breakdown-label">Score progress</span>
                        <span class="breakdown-value">${completeness.scoreProgress}%</span>
                    </div>
                    <div class="breakdown-item">
                        <span class="breakdown-label">Coverage</span>
                        <span class="breakdown-value">${completeness.coverageProgress}%</span>
                    </div>
                    <div class="breakdown-item">
                        <span class="breakdown-label">Technique</span>
                        <span class="breakdown-value">${completeness.techniqueProgress}%</span>
                    </div>
                    <div class="breakdown-item ${completeness.fragilityRisk > 50 ? 'warning' : ''}">
                        <span class="breakdown-label">Fragility risk</span>
                        <span class="breakdown-value">${completeness.fragilityRisk}%</span>
                    </div>
                </div>
            </section>
            
            <section class="exam-hub-section time-section">
                <h2>Time to Target</h2>
                <div class="time-display">
                    <div class="time-main">
                        <span class="time-value">${timeEstimate.likelyHours}</span>
                        <span class="time-unit">hours</span>
                    </div>
                    <div class="time-safe">
                        <span>Safe estimate: ${timeEstimate.safeHours} hours</span>
                        <span>(${timeEstimate.sessionsNeeded} sessions)</span>
                    </div>
                </div>
            </section>
            
            <section class="exam-hub-section weak-areas-section">
                <h2>Weak Areas</h2>
                ${weakAreas.length > 0 ? `
                    <ul class="weak-areas-list">
                        ${weakAreas.map(area => `
                            <li class="weak-area-item">
                                <span class="weak-area-topic">${area.topic}</span>
                                <span class="weak-area-mastery">${area.mastery}% mastery</span>
                                <span class="weak-area-impact">Impact: ${area.impact}</span>
                            </li>
                        `).join('')}
                    </ul>
                ` : `
                    <p class="no-weak-areas">No weak areas identified. Keep practising!</p>
                `}
            </section>
            
            <section class="exam-hub-section actions-section">
                <button class="btn btn-primary start-session-btn" data-action="start-optimal-session">
                    Start Optimal Session
                </button>
                <button class="btn btn-secondary" data-action="take-mock">
                    Take Mock Exam
                </button>
                <button class="btn btn-secondary" data-action="review-weak">
                    Review Weak Areas
                </button>
            </section>
            
            <footer class="exam-hub-footer">
                <p class="last-updated">
                    Last updated: ${state.lastUpdated ? state.lastUpdated.toLocaleTimeString() : 'Never'}
                </p>
                <p class="stats">
                    ${state.atomCount} atoms | ${state.questionCount} questions
                </p>
            </footer>
        </div>
    `;
}

/**
 * Gets the CSS styles for the Exam Hub.
 * @returns {string} CSS styles
 */
export function getExamHubStyles() {
    return `
        .exam-hub {
            max-width: 800px;
            margin: 0 auto;
            padding: 20px;
        }
        
        .exam-hub-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 30px;
            padding-bottom: 20px;
            border-bottom: 1px solid var(--border-color);
        }
        
        .exam-hub-header h1 {
            margin: 0;
            font-size: 1.75rem;
        }
        
        .exam-countdown {
            text-align: right;
        }
        
        .countdown-value {
            font-size: 2rem;
            font-weight: 700;
            color: var(--primary-color);
        }
        
        .countdown-label {
            display: block;
            font-size: 0.875rem;
            color: var(--secondary-text);
        }
        
        .exam-hub-section {
            background: var(--card-bg);
            border-radius: 8px;
            padding: 20px;
            margin-bottom: 20px;
            box-shadow: 0 1px 3px var(--shadow-color);
        }
        
        .exam-hub-section h2 {
            margin: 0 0 15px 0;
            font-size: 1.125rem;
            color: var(--text-color);
        }
        
        .prediction-display {
            text-align: center;
        }
        
        .prediction-main {
            margin-bottom: 10px;
        }
        
        .prediction-value {
            font-size: 3rem;
            font-weight: 700;
            color: var(--primary-color);
        }
        
        .prediction-unit {
            font-size: 1.5rem;
            color: var(--secondary-text);
        }
        
        .prediction-range {
            color: var(--secondary-text);
            font-size: 0.875rem;
        }
        
        .prediction-confidence {
            font-size: 0.75rem;
        }
        
        .prediction-grade {
            margin-top: 10px;
            font-size: 1rem;
        }
        
        .completeness-display {
            display: flex;
            align-items: center;
            gap: 15px;
            margin-bottom: 15px;
        }
        
        .completeness-bar {
            flex: 1;
            height: 12px;
            background: var(--input-bg);
            border-radius: 6px;
            overflow: hidden;
        }
        
        .completeness-fill {
            height: 100%;
            background: var(--primary-color);
            transition: width 0.3s ease;
        }
        
        .completeness-value {
            font-size: 1.25rem;
            font-weight: 600;
            min-width: 50px;
        }
        
        .completeness-breakdown {
            display: grid;
            grid-template-columns: repeat(2, 1fr);
            gap: 10px;
        }
        
        .breakdown-item {
            display: flex;
            justify-content: space-between;
            font-size: 0.875rem;
        }
        
        .breakdown-label {
            color: var(--secondary-text);
        }
        
        .breakdown-item.warning .breakdown-value {
            color: var(--danger-color);
        }
        
        .time-display {
            text-align: center;
        }
        
        .time-value {
            font-size: 2.5rem;
            font-weight: 700;
            color: var(--primary-color);
        }
        
        .time-unit {
            font-size: 1rem;
            color: var(--secondary-text);
        }
        
        .time-safe {
            margin-top: 10px;
            color: var(--secondary-text);
            font-size: 0.875rem;
        }
        
        .weak-areas-list {
            list-style: none;
            padding: 0;
            margin: 0;
        }
        
        .weak-area-item {
            display: flex;
            justify-content: space-between;
            padding: 10px 0;
            border-bottom: 1px solid var(--border-color);
        }
        
        .weak-area-item:last-child {
            border-bottom: none;
        }
        
        .weak-area-topic {
            font-weight: 500;
        }
        
        .weak-area-mastery,
        .weak-area-impact {
            color: var(--secondary-text);
            font-size: 0.875rem;
        }
        
        .no-weak-areas {
            text-align: center;
            color: var(--secondary-text);
            font-style: italic;
        }
        
        .actions-section {
            display: flex;
            gap: 10px;
            flex-wrap: wrap;
        }
        
        .start-session-btn {
            flex: 1;
            min-width: 200px;
        }
        
        .exam-hub-footer {
            text-align: center;
            margin-top: 20px;
            color: var(--secondary-text);
            font-size: 0.75rem;
        }
        
        .exam-hub-footer p {
            margin: 5px 0;
        }
    `;
}

export default createExamHub;
