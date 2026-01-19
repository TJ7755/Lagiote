import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
    initSessionPlayer,
    startTimer,
    stopTimer,
    pauseSession,
    resumeSession,
    getCurrentQuestion,
    getCurrentPhase,
    nextQuestion,
    previousQuestion,
    jumpToQuestion,
    submitResponse,
    selectOption,
    endSession,
    getPlayerState,
    destroySessionPlayer,
    formatTime,
    renderSessionPlayerHTML,
    getSessionPlayerStyles
} from '../../js/core/exam/exam-session-player.js';
import { createQuestion, composeOptimalSession } from '../../js/core/exam/exam-mode.js';

describe('Session Player - Initialisation', () => {
    afterEach(() => {
        destroySessionPlayer();
    });
    
    it('initialises with session and questions', () => {
        const session = {
            phases: [
                { type: 'warm_up', name: 'Warm-up', questions: ['q1', 'q2'] }
            ],
            totalMinutes: 30
        };
        const questions = [
            createQuestion({ id: 'q1', prompt: 'Question 1' }),
            createQuestion({ id: 'q2', prompt: 'Question 2' })
        ];
        
        const state = initSessionPlayer(session, questions);
        
        expect(state.currentQuestionIndex).toBe(0);
        expect(state.totalQuestions).toBe(2);
        expect(state.isComplete).toBe(false);
        expect(state.isPaused).toBe(false);
    });
    
    it('calculates remaining seconds from session', () => {
        const session = {
            phases: [{ questions: ['q1'] }],
            totalMinutes: 15
        };
        
        const state = initSessionPlayer(session, [createQuestion({ id: 'q1' })]);
        
        expect(state.remainingSeconds).toBe(15 * 60);
    });
});

describe('Session Player - Navigation', () => {
    beforeEach(() => {
        const session = {
            phases: [
                { type: 'main', name: 'Main', questions: ['q1', 'q2', 'q3'] }
            ],
            totalMinutes: 30
        };
        const questions = [
            createQuestion({ id: 'q1' }),
            createQuestion({ id: 'q2' }),
            createQuestion({ id: 'q3' })
        ];
        initSessionPlayer(session, questions);
    });
    
    afterEach(() => {
        destroySessionPlayer();
    });
    
    it('moves to next question', () => {
        const result = nextQuestion();
        
        expect(result.success).toBe(true);
        expect(result.index).toBe(1);
        
        const state = getPlayerState();
        expect(state.currentQuestionIndex).toBe(1);
    });
    
    it('cannot go past last question', () => {
        nextQuestion();
        nextQuestion();
        const result = nextQuestion();
        
        expect(result.success).toBe(false);
        expect(result.reason).toBe('at_end');
    });
    
    it('moves to previous question', () => {
        nextQuestion();
        const result = previousQuestion();
        
        expect(result.success).toBe(true);
        expect(result.index).toBe(0);
    });
    
    it('cannot go before first question', () => {
        const result = previousQuestion();
        
        expect(result.success).toBe(false);
        expect(result.reason).toBe('at_start');
    });
    
    it('jumps to specific question', () => {
        const result = jumpToQuestion(2);
        
        expect(result.success).toBe(true);
        expect(getPlayerState().currentQuestionIndex).toBe(2);
    });
    
    it('rejects invalid jump index', () => {
        const result = jumpToQuestion(10);
        
        expect(result.success).toBe(false);
        expect(result.reason).toBe('invalid_index');
    });
});

describe('Session Player - Phase Tracking', () => {
    beforeEach(() => {
        const session = {
            phases: [
                { type: 'warm_up', name: 'Warm-up', questions: ['q1', 'q2'] },
                { type: 'main', name: 'Main', questions: ['q3', 'q4', 'q5'] }
            ],
            totalMinutes: 30
        };
        const questions = [
            createQuestion({ id: 'q1' }),
            createQuestion({ id: 'q2' }),
            createQuestion({ id: 'q3' }),
            createQuestion({ id: 'q4' }),
            createQuestion({ id: 'q5' })
        ];
        initSessionPlayer(session, questions);
    });
    
    afterEach(() => {
        destroySessionPlayer();
    });
    
    it('starts in first phase', () => {
        const phase = getCurrentPhase();
        
        expect(phase.type).toBe('warm_up');
        expect(phase.name).toBe('Warm-up');
    });
    
    it('transitions to next phase', () => {
        nextQuestion();
        nextQuestion();
        
        const phase = getCurrentPhase();
        expect(phase.type).toBe('main');
    });
    
    it('tracks phase in player state', () => {
        nextQuestion();
        nextQuestion();
        
        const state = getPlayerState();
        expect(state.currentPhaseIndex).toBe(1);
        expect(state.currentPhase.name).toBe('Main');
    });
});

describe('Session Player - Response Handling', () => {
    beforeEach(() => {
        const session = {
            phases: [{ questions: ['q1', 'q2'] }],
            totalMinutes: 30
        };
        const questions = [
            createQuestion({ id: 'q1', type: 'mcq_single', options: ['A', 'B', 'C'] }),
            createQuestion({ id: 'q2', type: 'mcq_multi', options: ['A', 'B', 'C', 'D'] })
        ];
        initSessionPlayer(session, questions);
    });
    
    afterEach(() => {
        destroySessionPlayer();
    });
    
    it('selects MCQ option', () => {
        const result = selectOption(1);
        
        expect(result.success).toBe(true);
        expect(result.response.selectedIndex).toBe(1);
    });
    
    it('toggles MCQ multi options', () => {
        nextQuestion(); // Move to multi-select question
        
        selectOption(0);
        selectOption(2);
        
        const state = getPlayerState();
        expect(state.currentResponse.selectedIndices).toContain(0);
        expect(state.currentResponse.selectedIndices).toContain(2);
        
        // Toggle off
        selectOption(0);
        const stateAfter = getPlayerState();
        expect(stateAfter.currentResponse.selectedIndices).not.toContain(0);
    });
    
    it('submits response', () => {
        selectOption(2);
        const result = submitResponse({ selectedIndex: 2 }, { autoAdvance: false });
        
        expect(result.success).toBe(true);
        expect(result.questionId).toBe('q1');
    });
    
    it('auto-advances after submit by default', () => {
        selectOption(1);
        submitResponse({ selectedIndex: 1 });
        
        const state = getPlayerState();
        expect(state.currentQuestionIndex).toBe(1);
    });
});

describe('Session Player - Pause and Resume', () => {
    beforeEach(() => {
        initSessionPlayer(
            { phases: [{ questions: ['q1'] }], totalMinutes: 30 },
            [createQuestion({ id: 'q1' })]
        );
    });
    
    afterEach(() => {
        destroySessionPlayer();
    });
    
    it('pauses session', () => {
        const result = pauseSession();
        
        expect(result.success).toBe(true);
        expect(getPlayerState().isPaused).toBe(true);
    });
    
    it('resumes session', () => {
        pauseSession();
        const result = resumeSession();
        
        expect(result.success).toBe(true);
        expect(getPlayerState().isPaused).toBe(false);
    });
});

describe('Session Player - Timer', () => {
    afterEach(() => {
        destroySessionPlayer();
    });
    
    it('starts timer', () => {
        initSessionPlayer(
            { phases: [{ questions: ['q1'] }], totalMinutes: 1 },
            [createQuestion({ id: 'q1' })]
        );
        
        startTimer();
        const state = getPlayerState();
        
        expect(state.isTimedMode).toBe(true);
    });
    
    it('stops timer', () => {
        initSessionPlayer(
            { phases: [{ questions: ['q1'] }], totalMinutes: 1 },
            [createQuestion({ id: 'q1' })]
        );
        
        startTimer();
        stopTimer();
        
        const state = getPlayerState();
        expect(state.isTimedMode).toBe(false);
    });
});

describe('Session Player - Session End', () => {
    beforeEach(() => {
        const session = {
            phases: [{ questions: ['q1', 'q2'] }],
            totalMinutes: 30
        };
        initSessionPlayer(session, [
            createQuestion({ id: 'q1' }),
            createQuestion({ id: 'q2' })
        ]);
    });
    
    afterEach(() => {
        destroySessionPlayer();
    });
    
    it('ends session with results', () => {
        selectOption(0);
        const results = endSession();
        
        expect(results.session).toBeDefined();
        expect(results.responses).toBeDefined();
        expect(results.timing).toBeDefined();
        expect(results.questionCount).toBe(2);
        expect(results.answeredCount).toBe(1);
    });
    
    it('marks session as complete', () => {
        endSession();
        
        const state = getPlayerState();
        expect(state.isComplete).toBe(true);
    });
});

describe('Session Player - Time Formatting', () => {
    it('formats seconds as MM:SS', () => {
        expect(formatTime(0)).toBe('00:00');
        expect(formatTime(30)).toBe('00:30');
        expect(formatTime(60)).toBe('01:00');
        expect(formatTime(125)).toBe('02:05');
        expect(formatTime(3600)).toBe('60:00');
    });
});

describe('Session Player - HTML Rendering', () => {
    afterEach(() => {
        destroySessionPlayer();
    });
    
    it('renders session player HTML', () => {
        initSessionPlayer(
            { phases: [{ name: 'Practice', questions: ['q1'] }], totalMinutes: 10 },
            [createQuestion({ id: 'q1', prompt: 'Test question', options: ['A', 'B'] })]
        );
        
        const state = getPlayerState();
        const html = renderSessionPlayerHTML(state);
        
        expect(html).toContain('session-player');
        expect(html).toContain('Practice');
        expect(html).toContain('Test question');
        expect(html).toContain('option-btn');
    });
    
    it('shows timer when timed', () => {
        initSessionPlayer(
            { phases: [{ questions: ['q1'] }], totalMinutes: 5 },
            [createQuestion({ id: 'q1' })]
        );
        startTimer();
        
        const state = getPlayerState();
        const html = renderSessionPlayerHTML(state);
        
        expect(html).toContain('session-timer');
    });
    
    it('shows pause overlay when paused', () => {
        initSessionPlayer(
            { phases: [{ questions: ['q1'] }], totalMinutes: 5 },
            [createQuestion({ id: 'q1' })]
        );
        pauseSession();
        
        const state = getPlayerState();
        const html = renderSessionPlayerHTML(state);
        
        expect(html).toContain('pause-overlay');
        expect(html).toContain('Session Paused');
    });
    
    it('shows progress bar', () => {
        initSessionPlayer(
            { phases: [{ questions: ['q1', 'q2'] }], totalMinutes: 5 },
            [createQuestion({ id: 'q1' }), createQuestion({ id: 'q2' })]
        );
        
        const state = getPlayerState();
        const html = renderSessionPlayerHTML(state);
        
        expect(html).toContain('progress-bar');
        expect(html).toContain('Question 1 of 2');
    });
    
    it('renders numeric input for numeric questions', () => {
        initSessionPlayer(
            { phases: [{ questions: ['q1'] }], totalMinutes: 5 },
            [createQuestion({ id: 'q1', type: 'numeric', prompt: 'Enter value' })]
        );
        
        const state = getPlayerState();
        const html = renderSessionPlayerHTML(state);
        
        expect(html).toContain('numeric-input');
    });
});

describe('Session Player - Styles', () => {
    it('returns CSS styles', () => {
        const styles = getSessionPlayerStyles();
        
        expect(styles).toContain('.session-player');
        expect(styles).toContain('.option-btn');
        expect(styles).toContain('.pause-overlay');
        expect(styles).toContain('.session-timer');
    });
});

describe('Session Player - Callbacks', () => {
    afterEach(() => {
        destroySessionPlayer();
    });
    
    it('calls onQuestionChange callback', () => {
        let callCount = 0;
        
        initSessionPlayer(
            { phases: [{ questions: ['q1', 'q2'] }], totalMinutes: 5 },
            [createQuestion({ id: 'q1' }), createQuestion({ id: 'q2' })],
            { onQuestionChange: () => { callCount++; } }
        );
        
        nextQuestion();
        
        expect(callCount).toBe(1);
    });
    
    it('calls onResponseSubmit callback', () => {
        let submittedData = null;
        
        initSessionPlayer(
            { phases: [{ questions: ['q1'] }], totalMinutes: 5 },
            [createQuestion({ id: 'q1' })],
            { onResponseSubmit: (data) => { submittedData = data; } }
        );
        
        submitResponse({ selectedIndex: 0 }, { autoAdvance: false });
        
        expect(submittedData).not.toBeNull();
        expect(submittedData.questionId).toBe('q1');
    });
    
    it('calls onSessionComplete callback', () => {
        let completed = false;
        
        initSessionPlayer(
            { phases: [{ questions: ['q1'] }], totalMinutes: 5 },
            [createQuestion({ id: 'q1' })],
            { onSessionComplete: () => { completed = true; } }
        );
        
        endSession();
        
        expect(completed).toBe(true);
    });
});
