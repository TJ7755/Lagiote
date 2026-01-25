import { describe, it, expect, beforeEach } from 'vitest';
import { createExamHub, renderExamHubHTML, getExamHubStyles } from '../../js/core/exam/exam-hub.js';
import { createAtom, createQuestion, createExamSpec } from '../../js/core/exam/exam-mode.js';

describe('Exam Hub - Initialisation', () => {
    it('creates hub with default state', () => {
        const hub = createExamHub();
        const state = hub.getState();
        
        expect(state.loading).toBe(false);
        expect(state.hasExamDate).toBe(false);
        expect(state.atomCount).toBe(0);
        expect(state.questionCount).toBe(0);
    });
    
    it('initialises with provided data', async () => {
        const hub = createExamHub();
        const atoms = {
            'atom-1': createAtom({ id: 'atom-1', name: 'Test Atom', mastery: 0.5 })
        };
        const questions = [
            createQuestion({ id: 'q-1', prompt: 'Test Question' })
        ];
        const examSpec = createExamSpec({
            name: 'Test Exam',
            examDate: '2025-06-15T09:00:00Z'
        });
        
        await hub.init({ atoms, questions, examSpec });
        
        const state = hub.getState();
        expect(state.hasExamDate).toBe(true);
        expect(state.atomCount).toBe(1);
        expect(state.questionCount).toBe(1);
    });
});

describe('Exam Hub - Countdown', () => {
    it('returns no date message when exam date not set', () => {
        const hub = createExamHub();
        const countdown = hub.getCountdown();
        
        expect(countdown.days).toBeNull();
        expect(countdown.text).toBe('No exam date set');
    });
    
    it('calculates days remaining', async () => {
        const hub = createExamHub();
        const futureDate = new Date();
        futureDate.setDate(futureDate.getDate() + 10);
        
        await hub.setExamDate(futureDate);
        const countdown = hub.getCountdown();
        
        expect(countdown.days).toBeGreaterThanOrEqual(9);
        expect(countdown.days).toBeLessThanOrEqual(10);
    });
    
    it('shows passed message for past dates', async () => {
        const hub = createExamHub();
        const pastDate = new Date();
        pastDate.setDate(pastDate.getDate() - 5);
        
        await hub.setExamDate(pastDate);
        const countdown = hub.getCountdown();
        
        expect(countdown.days).toBe(0);
        expect(countdown.text).toBe('Exam date has passed');
    });
});

describe('Exam Hub - Prediction', () => {
    it('returns zero prediction without data', () => {
        const hub = createExamHub();
        const prediction = hub.getPrediction();
        
        expect(prediction.expected).toBe(0);
        expect(prediction.lower).toBe(0);
        expect(prediction.upper).toBe(0);
    });
    
    it('calculates prediction from atom mastery', async () => {
        const hub = createExamHub();
        const atoms = {
            'atom-1': createAtom({ mastery: 0.7, stabilityDays: 100 })
        };
        const questions = [
            createQuestion({
                difficulty: 0.5,
                marksAvailable: 100,
                atomMap: [{ atomId: 'atom-1', weight: 1 }]
            })
        ];
        
        await hub.init({ atoms, questions, targetScore: 70 });
        const prediction = hub.getPrediction();
        
        expect(prediction.expected).toBeGreaterThan(50);
        expect(prediction.lower).toBeLessThan(prediction.expected);
        expect(prediction.upper).toBeGreaterThan(prediction.expected);
    });
});

describe('Exam Hub - Completeness', () => {
    it('returns zero completeness without data', () => {
        const hub = createExamHub();
        const completeness = hub.getCompleteness();
        
        expect(completeness.overall).toBe(0);
    });
    
    it('calculates completeness metrics', async () => {
        const hub = createExamHub();
        const atoms = {
            'atom-1': createAtom({ mastery: 0.8, fragility: 0.2 }),
            'atom-2': createAtom({ mastery: 0.3, fragility: 0.7 })
        };
        
        await hub.init({ atoms, questions: [], targetScore: 70 });
        const completeness = hub.getCompleteness();
        
        expect(completeness.overall).toBeGreaterThan(0);
        expect(completeness.scoreProgress).toBeDefined();
        expect(completeness.coverageProgress).toBeDefined();
        expect(completeness.fragilityRisk).toBeDefined();
    });
});

describe('Exam Hub - Time Estimate', () => {
    it('returns zero estimate without data', () => {
        const hub = createExamHub();
        const estimate = hub.getTimeEstimate();
        
        expect(estimate.likelyHours).toBe(0);
        expect(estimate.sessionsNeeded).toBe(0);
    });
    
    it('calculates time to target', async () => {
        const hub = createExamHub();
        const atoms = {
            'atom-1': createAtom({ mastery: 0.3, name: 'Topic 1' }),
            'atom-2': createAtom({ mastery: 0.4, name: 'Topic 2' })
        };
        
        await hub.init({ atoms, questions: [], targetScore: 80 });
        const estimate = hub.getTimeEstimate();
        
        expect(estimate.likelyHours).toBeGreaterThan(0);
        expect(estimate.safeHours).toBeGreaterThanOrEqual(estimate.likelyHours);
        expect(estimate.topActions.length).toBeGreaterThan(0);
    });
});

describe('Exam Hub - Weak Areas', () => {
    it('returns empty weak areas without questions', () => {
        const hub = createExamHub();
        const weakAreas = hub.getWeakAreas();
        
        expect(weakAreas).toHaveLength(0);
    });
    
    it('identifies weak areas from questions', async () => {
        const hub = createExamHub();
        const atoms = {
            'weak-atom': createAtom({ mastery: 0.1, fragility: 0.9 }),
            'strong-atom': createAtom({ mastery: 0.9, fragility: 0.1 })
        };
        const questions = [
            createQuestion({
                id: 'q-weak',
                tags: ['Difficult Topic'],
                atomMap: [{ atomId: 'weak-atom', weight: 1 }]
            }),
            createQuestion({
                id: 'q-strong',
                tags: ['Easy Topic'],
                atomMap: [{ atomId: 'strong-atom', weight: 1 }]
            })
        ];
        
        await hub.init({ atoms, questions });
        const weakAreas = hub.getWeakAreas();
        
        expect(weakAreas.length).toBeGreaterThan(0);
        expect(weakAreas[0].topic).toBe('Difficult Topic');
    });
});

describe('Exam Hub - Optimal Session', () => {
    it('generates session with phases', async () => {
        const hub = createExamHub();
        const atoms = {
            'atom-1': createAtom({ mastery: 0.5 })
        };
        const questions = [
            createQuestion({ atomMap: [{ atomId: 'atom-1', weight: 1 }] })
        ];
        
        await hub.init({ atoms, questions });
        const session = await hub.getOptimalSession({ sessionMinutes: 30 });
        
        expect(session.phases.length).toBeGreaterThan(0);
        expect(session.totalMinutes).toBe(30);
        expect(session.explanation).toBeDefined();
    });
});

describe('Exam Hub - Configuration', () => {
    it('updates target score', async () => {
        const hub = createExamHub();
        await hub.init({});
        
        await hub.setTargetScore(85);
        const state = hub.getState();
        
        expect(state.targetScore).toBe(85);
    });
    
    it('clamps target score to valid range', async () => {
        const hub = createExamHub();
        await hub.init({});
        
        await hub.setTargetScore(150);
        expect(hub.getState().targetScore).toBe(100);
        
        await hub.setTargetScore(-10);
        expect(hub.getState().targetScore).toBe(0);
    });
    
    it('updates exam date', async () => {
        const hub = createExamHub();
        await hub.init({});
        
        const examDate = new Date('2025-07-01');
        await hub.setExamDate(examDate);
        
        const state = hub.getState();
        expect(state.hasExamDate).toBe(true);
    });
    
    it('clears exam date with null', async () => {
        const hub = createExamHub();
        await hub.init({});
        await hub.setExamDate(new Date());
        await hub.setExamDate(null);
        
        const state = hub.getState();
        expect(state.hasExamDate).toBe(false);
    });
});

describe('Exam Hub - HTML Rendering', () => {
    it('renders hub HTML', async () => {
        const hub = createExamHub();
        await hub.init({});
        
        const html = renderExamHubHTML(hub);
        
        expect(html).toContain('exam-hub');
        expect(html).toContain('Predicted Score');
        expect(html).toContain('Revision Completeness');
        expect(html).toContain('Time to Target');
        expect(html).toContain('Weak Areas');
        expect(html).toContain('Start Optimal Session');
    });
    
    it('renders countdown when exam date set', async () => {
        const hub = createExamHub();
        const futureDate = new Date();
        futureDate.setDate(futureDate.getDate() + 30);
        
        await hub.init({ examSpec: createExamSpec({ examDate: futureDate }) });
        const html = renderExamHubHTML(hub);
        
        expect(html).toContain('remaining');
    });
    
    it('shows message when no exam date', async () => {
        const hub = createExamHub();
        await hub.init({});
        
        const html = renderExamHubHTML(hub);
        
        expect(html).toContain('Set your exam date');
    });
});

describe('Exam Hub - Styles', () => {
    it('returns CSS styles', () => {
        const styles = getExamHubStyles();
        
        expect(styles).toContain('.exam-hub');
        expect(styles).toContain('.prediction-display');
        expect(styles).toContain('.completeness-bar');
        expect(styles).toContain('.weak-areas-list');
    });
});
