/**
 * Exam Session Player - Interactive Study Session Component
 * 
 * Provides the session player interface for exam mode practice.
 * Handles question presentation, answer submission, marking feedback,
 * and timing.
 */

import { createExamKeyboardHandler, EXAM_MODE_SHORTCUTS } from './exam-mode.js';
import { gradeQuestion } from './marking.js';

/**
 * Session player state.
 */
const playerState = {
    session: null,
    questions: [],
    currentPhaseIndex: 0,
    currentQuestionIndex: 0,
    responses: {},
    timing: {},
    isTimedMode: false,
    timerInterval: null,
    remainingSeconds: 0,
    startTime: null,
    questionStartTime: null,
    isPaused: false,
    isComplete: false,
    keyboardHandler: null,
    callbacks: {}
};

/**
 * Initialises the session player with a session plan.
 * @param {Object} session Session from composeOptimalSession
 * @param {Array} questions Question objects
 * @param {Object} callbacks Event callbacks
 * @returns {Object} Initial state
 */
export function initSessionPlayer(session, questions, callbacks = {}) {
    playerState.session = session;
    playerState.questions = questions;
    playerState.currentPhaseIndex = 0;
    playerState.currentQuestionIndex = 0;
    playerState.responses = {};
    playerState.timing = {};
    playerState.isComplete = false;
    playerState.isPaused = false;
    playerState.callbacks = callbacks;
    
    // Calculate total time
    playerState.remainingSeconds = (session.totalMinutes || 30) * 60;
    playerState.startTime = new Date();
    
    // Setup keyboard handler
    setupKeyboardHandler();
    
    return getPlayerState();
}

/**
 * Starts the session timer.
 */
export function startTimer() {
    if (playerState.timerInterval) {
        clearInterval(playerState.timerInterval);
    }
    
    playerState.isTimedMode = true;
    playerState.questionStartTime = new Date();
    
    playerState.timerInterval = setInterval(() => {
        if (playerState.isPaused) return;
        
        playerState.remainingSeconds = Math.max(0, playerState.remainingSeconds - 1);
        
        if (playerState.callbacks.onTimerTick) {
            playerState.callbacks.onTimerTick(playerState.remainingSeconds);
        }
        
        if (playerState.remainingSeconds <= 0) {
            endSession();
        }
    }, 1000);
}

/**
 * Stops the session timer.
 */
export function stopTimer() {
    if (playerState.timerInterval) {
        clearInterval(playerState.timerInterval);
        playerState.timerInterval = null;
    }
    playerState.isTimedMode = false;
}

/**
 * Pauses the session.
 */
export function pauseSession() {
    playerState.isPaused = true;
    
    if (playerState.callbacks.onPause) {
        playerState.callbacks.onPause();
    }
    
    return { success: true, paused: true };
}

/**
 * Resumes the session.
 */
export function resumeSession() {
    playerState.isPaused = false;
    playerState.questionStartTime = new Date();
    
    if (playerState.callbacks.onResume) {
        playerState.callbacks.onResume();
    }
    
    return { success: true, paused: false };
}

/**
 * Gets the current question in the session.
 * @returns {Object|null} Current question
 */
export function getCurrentQuestion() {
    const phase = getCurrentPhase();
    if (!phase) return null;
    
    const questionIds = phase.questions || [];
    const localIndex = playerState.currentQuestionIndex - getPhaseStartIndex(playerState.currentPhaseIndex);
    
    if (localIndex < 0 || localIndex >= questionIds.length) return null;
    
    const questionId = questionIds[localIndex];
    return playerState.questions.find(q => q.id === questionId) || null;
}

/**
 * Gets the current phase.
 * @returns {Object|null} Current phase
 */
export function getCurrentPhase() {
    const phases = playerState.session?.phases || [];
    return phases[playerState.currentPhaseIndex] || null;
}

/**
 * Gets the index where a phase starts in the overall question sequence.
 * @param {number} phaseIndex Phase index
 * @returns {number} Start index
 */
function getPhaseStartIndex(phaseIndex) {
    const phases = playerState.session?.phases || [];
    let index = 0;
    
    for (let i = 0; i < phaseIndex; i++) {
        index += (phases[i]?.questions?.length || 0);
    }
    
    return index;
}

/**
 * Gets total question count across all phases.
 * @returns {number} Total count
 */
function getTotalQuestionCount() {
    const phases = playerState.session?.phases || [];
    return phases.reduce((sum, phase) => sum + (phase.questions?.length || 0), 0);
}

/**
 * Moves to the next question.
 * @returns {Object} Navigation result
 */
export function nextQuestion() {
    const total = getTotalQuestionCount();
    
    if (playerState.currentQuestionIndex >= total - 1) {
        // Check if we should end the session
        if (playerState.callbacks.onSessionComplete) {
            endSession();
        }
        return { success: false, reason: 'at_end' };
    }
    
    // Record time spent on current question
    recordQuestionTime();
    
    playerState.currentQuestionIndex++;
    updateCurrentPhase();
    playerState.questionStartTime = new Date();
    
    if (playerState.callbacks.onQuestionChange) {
        playerState.callbacks.onQuestionChange(getPlayerState());
    }
    
    return { success: true, index: playerState.currentQuestionIndex };
}

/**
 * Moves to the previous question.
 * @returns {Object} Navigation result
 */
export function previousQuestion() {
    if (playerState.currentQuestionIndex <= 0) {
        return { success: false, reason: 'at_start' };
    }
    
    recordQuestionTime();
    
    playerState.currentQuestionIndex--;
    updateCurrentPhase();
    playerState.questionStartTime = new Date();
    
    if (playerState.callbacks.onQuestionChange) {
        playerState.callbacks.onQuestionChange(getPlayerState());
    }
    
    return { success: true, index: playerState.currentQuestionIndex };
}

/**
 * Jumps to a specific question.
 * @param {number} index Target index
 * @returns {Object} Navigation result
 */
export function jumpToQuestion(index) {
    const total = getTotalQuestionCount();
    
    if (index < 0 || index >= total) {
        return { success: false, reason: 'invalid_index' };
    }
    
    recordQuestionTime();
    
    playerState.currentQuestionIndex = index;
    updateCurrentPhase();
    playerState.questionStartTime = new Date();
    
    if (playerState.callbacks.onQuestionChange) {
        playerState.callbacks.onQuestionChange(getPlayerState());
    }
    
    return { success: true, index };
}

/**
 * Updates the current phase index based on question index.
 */
function updateCurrentPhase() {
    const phases = playerState.session?.phases || [];
    let cumulative = 0;
    
    for (let i = 0; i < phases.length; i++) {
        const phaseQuestionCount = phases[i]?.questions?.length || 0;
        if (playerState.currentQuestionIndex < cumulative + phaseQuestionCount) {
            playerState.currentPhaseIndex = i;
            return;
        }
        cumulative += phaseQuestionCount;
    }
    
    playerState.currentPhaseIndex = phases.length - 1;
}

/**
 * Records time spent on current question.
 */
function recordQuestionTime() {
    const question = getCurrentQuestion();
    if (!question || !playerState.questionStartTime) return;
    
    const now = new Date();
    const secondsSpent = (now.getTime() - playerState.questionStartTime.getTime()) / 1000;
    
    if (!playerState.timing[question.id]) {
        playerState.timing[question.id] = {
            totalSeconds: 0,
            attempts: 0
        };
    }
    
    playerState.timing[question.id].totalSeconds += secondsSpent;
    playerState.timing[question.id].attempts++;
}

/**
 * Submits a response for the current question.
 * @param {*} response The response value
 * @param {Object} options Submission options
 * @returns {Object} Submission result
 */
export function submitResponse(response, options = {}) {
    const question = getCurrentQuestion();
    if (!question) {
        return { success: false, reason: 'no_question' };
    }
    
    recordQuestionTime();
    
    playerState.responses[question.id] = response;
    
    // Grade if mark scheme available
    let gradeResult = null;
    if (options.markScheme && !options.skipGrading) {
        gradeResult = gradeQuestion({
            question,
            markScheme: options.markScheme,
            response
        });
    }
    
    const result = {
        success: true,
        questionId: question.id,
        response,
        gradeResult
    };
    
    if (playerState.callbacks.onResponseSubmit) {
        playerState.callbacks.onResponseSubmit(result);
    }
    
    // Auto-advance if enabled
    if (options.autoAdvance !== false) {
        nextQuestion();
    }
    
    return result;
}

/**
 * Selects an MCQ option.
 * @param {number} optionIndex Option index (0-based)
 * @returns {Object} Selection result
 */
export function selectOption(optionIndex) {
    const question = getCurrentQuestion();
    if (!question) return { success: false };
    
    let response;
    if (question.type === 'mcq_multi') {
        const existing = playerState.responses[question.id] || { selectedIndices: [] };
        const indices = existing.selectedIndices || [];
        
        if (indices.includes(optionIndex)) {
            response = { selectedIndices: indices.filter(i => i !== optionIndex) };
        } else {
            response = { selectedIndices: [...indices, optionIndex] };
        }
    } else {
        response = { selectedIndex: optionIndex };
    }
    
    playerState.responses[question.id] = response;
    
    if (playerState.callbacks.onOptionSelect) {
        playerState.callbacks.onOptionSelect({ questionId: question.id, response });
    }
    
    return { success: true, response };
}

/**
 * Ends the session.
 * @returns {Object} Session results
 */
export function endSession() {
    stopTimer();
    recordQuestionTime();
    
    playerState.isComplete = true;
    
    const results = {
        session: playerState.session,
        responses: { ...playerState.responses },
        timing: { ...playerState.timing },
        totalSeconds: playerState.startTime
            ? (new Date().getTime() - playerState.startTime.getTime()) / 1000
            : 0,
        questionCount: getTotalQuestionCount(),
        answeredCount: Object.keys(playerState.responses).length
    };
    
    if (playerState.callbacks.onSessionComplete) {
        playerState.callbacks.onSessionComplete(results);
    }
    
    return results;
}

/**
 * Gets the current player state.
 * @returns {Object} Player state
 */
export function getPlayerState() {
    const question = getCurrentQuestion();
    const phase = getCurrentPhase();
    const total = getTotalQuestionCount();
    
    return {
        isComplete: playerState.isComplete,
        isPaused: playerState.isPaused,
        isTimedMode: playerState.isTimedMode,
        remainingSeconds: playerState.remainingSeconds,
        currentQuestionIndex: playerState.currentQuestionIndex,
        totalQuestions: total,
        currentPhaseIndex: playerState.currentPhaseIndex,
        currentPhase: phase,
        currentQuestion: question,
        currentResponse: question ? playerState.responses[question.id] : null,
        progress: total > 0 ? (playerState.currentQuestionIndex + 1) / total : 0,
        answeredCount: Object.keys(playerState.responses).length
    };
}

/**
 * Sets up keyboard handler.
 */
function setupKeyboardHandler() {
    // Guard for non-browser environments
    if (typeof document === 'undefined') return;
    
    if (playerState.keyboardHandler) {
        document.removeEventListener('keydown', playerState.keyboardHandler);
    }
    
    playerState.keyboardHandler = createExamKeyboardHandler({
        nextQuestion: () => nextQuestion(),
        previousQuestion: () => previousQuestion(),
        selectOption: (index) => selectOption(index),
        submitAnswer: () => {
            const response = playerState.responses[getCurrentQuestion()?.id];
            if (response !== undefined) {
                submitResponse(response);
            }
        },
        pauseExam: () => {
            if (playerState.isPaused) {
                resumeSession();
            } else {
                pauseSession();
            }
        }
    });
    
    document.addEventListener('keydown', playerState.keyboardHandler);
}

/**
 * Cleans up the session player.
 */
export function destroySessionPlayer() {
    stopTimer();
    
    // Guard for non-browser environments
    if (typeof document !== 'undefined' && playerState.keyboardHandler) {
        document.removeEventListener('keydown', playerState.keyboardHandler);
        playerState.keyboardHandler = null;
    }
    
    playerState.session = null;
    playerState.questions = [];
    playerState.responses = {};
    playerState.timing = {};
    playerState.isComplete = false;
    playerState.callbacks = {};
}

/**
 * Formats seconds as MM:SS.
 * @param {number} seconds Seconds
 * @returns {string} Formatted time
 */
export function formatTime(seconds) {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
}

/**
 * Renders the session player as HTML.
 * @param {Object} state Player state from getPlayerState()
 * @returns {string} HTML string
 */
export function renderSessionPlayerHTML(state) {
    const question = state.currentQuestion;
    const phase = state.currentPhase;
    const response = state.currentResponse;
    
    return `
        <div class="session-player ${state.isPaused ? 'paused' : ''}">
            <header class="session-player-header">
                <div class="session-phase">
                    <span class="phase-name">${phase?.name || 'Practice'}</span>
                    <span class="phase-purpose">${phase?.purpose || ''}</span>
                </div>
                <div class="session-progress">
                    <span class="progress-text">
                        Question ${state.currentQuestionIndex + 1} of ${state.totalQuestions}
                    </span>
                    <div class="progress-bar">
                        <div class="progress-fill" style="width: ${state.progress * 100}%"></div>
                    </div>
                </div>
                ${state.isTimedMode ? `
                    <div class="session-timer ${state.remainingSeconds < 60 ? 'warning' : ''}">
                        ${formatTime(state.remainingSeconds)}
                    </div>
                ` : ''}
            </header>
            
            <main class="session-player-content">
                ${question ? renderQuestionHTML(question, response) : `
                    <div class="no-question">
                        <p>No question to display</p>
                    </div>
                `}
            </main>
            
            <footer class="session-player-footer">
                <div class="session-nav">
                    <button class="btn btn-secondary" data-action="previous" 
                            ${state.currentQuestionIndex === 0 ? 'disabled' : ''}>
                        Previous
                    </button>
                    <button class="btn btn-primary" data-action="next">
                        ${state.currentQuestionIndex === state.totalQuestions - 1 ? 'Finish' : 'Next'}
                    </button>
                </div>
                <div class="session-shortcuts">
                    <span class="shortcut-hint">
                        Keyboard: Arrow keys to navigate, 1-4 to select, Enter to confirm
                    </span>
                </div>
            </footer>
            
            ${state.isPaused ? `
                <div class="pause-overlay">
                    <div class="pause-content">
                        <h3>Session Paused</h3>
                        <p>Press Escape or click Resume to continue</p>
                        <button class="btn btn-primary" data-action="resume">Resume</button>
                    </div>
                </div>
            ` : ''}
        </div>
    `;
}

/**
 * Renders a single question as HTML.
 * @param {Object} question The question
 * @param {*} response Current response if any
 * @returns {string} HTML string
 */
function renderQuestionHTML(question, response) {
    const prompt = question.prompt || 'Question text not available';
    const type = question.type || 'mcq_single';
    
    let optionsHTML = '';
    
    if (type === 'mcq_single' || type === 'mcq_multi') {
        const options = question.options || [];
        const selectedIndex = response?.selectedIndex;
        const selectedIndices = response?.selectedIndices || [];
        
        optionsHTML = `
            <div class="question-options">
                ${options.map((option, index) => {
                    const isSelected = type === 'mcq_multi'
                        ? selectedIndices.includes(index)
                        : selectedIndex === index;
                    
                    return `
                        <button class="option-btn ${isSelected ? 'selected' : ''}"
                                data-action="select-option"
                                data-option-index="${index}">
                            <span class="option-letter">${String.fromCharCode(65 + index)}</span>
                            <span class="option-text">${option}</span>
                        </button>
                    `;
                }).join('')}
            </div>
        `;
    } else if (type === 'numeric') {
        const value = response?.value ?? '';
        optionsHTML = `
            <div class="question-input numeric">
                <input type="number" 
                       class="numeric-input" 
                       value="${value}"
                       placeholder="Enter your answer"
                       data-input="numeric">
                ${question.unit ? `<span class="input-unit">${question.unit}</span>` : ''}
            </div>
        `;
    } else if (type === 'short_text') {
        const text = response?.text ?? '';
        optionsHTML = `
            <div class="question-input text">
                <input type="text" 
                       class="text-input" 
                       value="${text}"
                       placeholder="Enter your answer"
                       data-input="text">
            </div>
        `;
    }
    
    return `
        <div class="question" data-question-id="${question.id}" data-question-type="${type}">
            <div class="question-prompt">
                <p>${prompt}</p>
            </div>
            ${optionsHTML}
        </div>
    `;
}

/**
 * Gets the CSS styles for the session player.
 * @returns {string} CSS styles
 */
export function getSessionPlayerStyles() {
    return `
        .session-player {
            display: flex;
            flex-direction: column;
            height: 100%;
            min-height: 400px;
        }
        
        .session-player-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            padding: 15px 20px;
            background: var(--card-bg);
            border-bottom: 1px solid var(--border-color);
        }
        
        .session-phase {
            display: flex;
            flex-direction: column;
        }
        
        .phase-name {
            font-weight: 600;
            font-size: 1rem;
        }
        
        .phase-purpose {
            font-size: 0.75rem;
            color: var(--secondary-text);
        }
        
        .session-progress {
            flex: 1;
            max-width: 300px;
            margin: 0 20px;
        }
        
        .progress-text {
            display: block;
            text-align: center;
            font-size: 0.875rem;
            margin-bottom: 5px;
        }
        
        .progress-bar {
            height: 8px;
            background: var(--input-bg);
            border-radius: 4px;
            overflow: hidden;
        }
        
        .progress-fill {
            height: 100%;
            background: var(--primary-color);
            transition: width 0.3s ease;
        }
        
        .session-timer {
            font-size: 1.5rem;
            font-weight: 700;
            font-family: monospace;
            padding: 5px 15px;
            background: var(--input-bg);
            border-radius: 6px;
        }
        
        .session-timer.warning {
            background: var(--danger-color);
            color: white;
        }
        
        .session-player-content {
            flex: 1;
            padding: 30px;
            overflow-y: auto;
        }
        
        .question-prompt {
            font-size: 1.125rem;
            margin-bottom: 25px;
            line-height: 1.6;
        }
        
        .question-options {
            display: flex;
            flex-direction: column;
            gap: 12px;
        }
        
        .option-btn {
            display: flex;
            align-items: center;
            gap: 15px;
            padding: 15px 20px;
            background: var(--card-bg);
            border: 2px solid var(--border-color);
            border-radius: 8px;
            cursor: pointer;
            transition: all 0.2s;
            text-align: left;
        }
        
        .option-btn:hover {
            border-color: var(--primary-color);
            background: var(--input-bg);
        }
        
        .option-btn.selected {
            border-color: var(--primary-color);
            background: var(--primary-color);
            color: white;
        }
        
        .option-letter {
            display: flex;
            align-items: center;
            justify-content: center;
            width: 32px;
            height: 32px;
            background: var(--input-bg);
            border-radius: 50%;
            font-weight: 600;
        }
        
        .option-btn.selected .option-letter {
            background: white;
            color: var(--primary-color);
        }
        
        .option-text {
            flex: 1;
        }
        
        .question-input {
            display: flex;
            align-items: center;
            gap: 10px;
        }
        
        .numeric-input,
        .text-input {
            flex: 1;
            padding: 15px;
            font-size: 1.125rem;
            border: 2px solid var(--border-color);
            border-radius: 8px;
            background: var(--card-bg);
        }
        
        .numeric-input:focus,
        .text-input:focus {
            border-color: var(--primary-color);
            outline: none;
        }
        
        .input-unit {
            font-size: 1rem;
            color: var(--secondary-text);
        }
        
        .session-player-footer {
            padding: 15px 20px;
            background: var(--card-bg);
            border-top: 1px solid var(--border-color);
        }
        
        .session-nav {
            display: flex;
            justify-content: space-between;
            gap: 15px;
        }
        
        .session-shortcuts {
            margin-top: 10px;
            text-align: center;
        }
        
        .shortcut-hint {
            font-size: 0.75rem;
            color: var(--secondary-text);
        }
        
        .pause-overlay {
            position: absolute;
            inset: 0;
            background: rgba(0, 0, 0, 0.7);
            display: flex;
            align-items: center;
            justify-content: center;
        }
        
        .pause-content {
            background: var(--card-bg);
            padding: 30px;
            border-radius: 12px;
            text-align: center;
        }
        
        .pause-content h3 {
            margin: 0 0 10px 0;
        }
        
        .pause-content p {
            margin: 0 0 20px 0;
            color: var(--secondary-text);
        }
        
        .no-question {
            text-align: center;
            padding: 50px;
            color: var(--secondary-text);
        }
        
        .session-player.paused .session-player-content {
            filter: blur(5px);
        }
    `;
}

export default {
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
    getSessionPlayerStyles,
    EXAM_MODE_SHORTCUTS
};
