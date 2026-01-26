/**
 * Exam Mode UI Controller
 * 
 * Comprehensive UI controller for Exam Mode providing:
 * - Hub dashboard with predictions and completeness
 * - Session player with keyboard shortcuts
 * - Path map for topic browsing
 * - Editors for atoms, questions, and mark schemes
 * - Error atom management
 */

import { initDB, getDataFromDB, saveDataToDB, getAllDataFromDB, deleteDataFromDB } from '../core/db.js';
import {
    createAtom,
    createErrorAtom,
    createQuestion,
    createExamSpec,
    generateExamPaper,
    createExamSitting,
    submitExamSitting,
    predictExamScore,
    computeRevisionCompleteness,
    estimateTimeToTarget,
    rankQuestionsForPractice,
    composeOptimalSession,
    createExamKeyboardHandler,
    EXAM_MODE_SHORTCUTS,
    generateUUID
} from '../core/exam/exam-mode.js';
import { gradeQuestion, createMarkScheme, createPointsSchemePoint } from '../core/exam/marking.js';
import { applyMarkingRecordToAtoms } from '../core/exam/atom-updates.js';
import { computeEffectiveMasteryMap } from '../core/exam/atom-dynamics.js';

// --- State ---

const examModeUIState = {
    deckId: null,
    deck: null,
    examSpec: null,
    atoms: new Map(),
    errorAtoms: new Map(),
    questions: [],
    markSchemes: new Map(),
    currentSession: null,
    currentSitting: null,
    currentQuestionIndex: 0,
    responses: {},
    timing: {},
    timerInterval: null,
    remainingSeconds: 0,
    isPaused: false,
    keyboardHandler: null,
    activeView: 'hub', // hub, session, pathMap, editors
    editingAtomId: null,
    editingQuestionId: null,
    editingMarkSchemeId: null
};

// --- View Management ---

function hideAllExamViews() {
    document.getElementById('examModeHubView')?.classList.add('hidden');
    document.getElementById('examModeSessionView')?.classList.add('hidden');
    document.getElementById('examModePathMapView')?.classList.add('hidden');
    document.getElementById('examModeEditorsView')?.classList.add('hidden');
}

function showView(viewId) {
    hideAllExamViews();
    const view = document.getElementById(viewId);
    if (view) {
        view.classList.remove('hidden');
    }
}

// --- Hub Functions ---

export async function openExamModeHub(deckId) {
    // If no deckId provided, show deck selector
    if (!deckId) {
        if (typeof window.showExamHubDeckSelector === 'function') {
            window.showExamHubDeckSelector();
        } else {
            showToast('Deck selector is unavailable. Please try again later.', 'error');
        }
        return;
    }
    
    examModeUIState.deckId = deckId;
    examModeUIState.activeView = 'hub';
    
    // Hide other views
    document.getElementById('dashboard')?.classList.add('hidden');
    document.getElementById('deckDetailView')?.classList.add('hidden');
    
    // Load deck data
    await loadDeckData(deckId);
    
    // Show hub view
    showView('examModeHubView');
    
    // Populate hub data
    await refreshHubData();
    
    // Setup keyboard shortcuts for hub
    setupHubKeyboardShortcuts();
}

export function closeExamModeHub() {
    hideAllExamViews();
    document.getElementById('dashboard')?.classList.remove('hidden');
    document.getElementById('deckDetailView')?.classList.remove('hidden');
    examModeUIState.activeView = null;
    removeKeyboardHandler();
}

async function loadDeckData(deckId) {
    await initDB();
    
    // Load deck
    const deck = await getDataFromDB('decks', deckId);
    examModeUIState.deck = deck;
    
    // Load or create exam spec for this deck
    let examSpec = await getDataFromDB('examSpecs', deckId);
    if (!examSpec) {
        examSpec = createExamSpec({
            id: deckId,
            name: deck?.name || 'Exam',
            examDate: null,
            totalMarks: 100,
            targetScore: 70
        });
        await saveDataToDB('examSpecs', examSpec);
    }
    examModeUIState.examSpec = examSpec;
    
    // Load atoms for this deck
    const allAtoms = await getAllDataFromDB('examAtoms') || [];
    examModeUIState.atoms = new Map(
        allAtoms
            .filter(a => a.deckId === deckId && !a.isDeleted)
            .map(a => [a.id, a])
    );
    
    // Load error atoms
    const allErrorAtoms = await getAllDataFromDB('examErrorAtoms') || [];
    examModeUIState.errorAtoms = new Map(
        allErrorAtoms
            .filter(a => a.deckId === deckId && !a.isDeleted)
            .map(a => [a.id, a])
    );
    
    // Load questions
    const allQuestions = await getAllDataFromDB('examQuestions') || [];
    examModeUIState.questions = allQuestions.filter(q => q.deckId === deckId && !q.isDeleted);
    
    // Load mark schemes
    const allSchemes = await getAllDataFromDB('examMarkSchemes') || [];
    examModeUIState.markSchemes = new Map(
        allSchemes
            .filter(s => s.deckId === deckId && !s.isDeleted)
            .map(s => [s.id, s])
    );
}

async function refreshHubData() {
    const now = new Date();
    const examDate = examModeUIState.examSpec?.examDate
        ? new Date(examModeUIState.examSpec.examDate)
        : null;
    const targetScore = examModeUIState.examSpec?.targetScore || 70;
    
    // Update deck name
    const deckNameEl = document.getElementById('examHubDeckName');
    if (deckNameEl) {
        deckNameEl.textContent = examModeUIState.deck?.name || 'Unknown Deck';
    }
    
    // Update countdown
    updateCountdown(examDate);
    
    // Compute predictions
    const prediction = predictExamScore(
        examModeUIState.examSpec,
        examModeUIState.questions,
        examModeUIState.atoms,
        now,
        examDate || now
    );
    
    // Update prediction display
    updatePredictionDisplay(prediction, targetScore);
    
    // Compute completeness
    const completeness = computeRevisionCompleteness(
        examModeUIState.examSpec,
        examModeUIState.atoms,
        now,
        examDate || now,
        targetScore
    );
    
    // Update completeness display
    updateCompletenessDisplay(completeness);
    
    // Compute time estimate
    const timeEstimate = estimateTimeToTarget(
        examModeUIState.examSpec,
        examModeUIState.atoms,
        now,
        examDate || now,
        targetScore
    );
    
    // Update time estimate display
    updateTimeEstimateDisplay(timeEstimate);
    
    // Get weak areas
    const ranked = rankQuestionsForPractice(
        examModeUIState.questions,
        examModeUIState.atoms,
        now,
        examDate || now
    );
    
    // Update weak areas display
    updateWeakAreasDisplay(ranked.slice(0, 5));
    
    // Update error atoms display
    updateErrorAtomsDisplay();
}

function updateCountdown(examDate) {
    const countdownValue = document.getElementById('examHubCountdownValue');
    const examDateEl = document.getElementById('examHubExamDate');
    
    if (!examDate) {
        if (countdownValue) countdownValue.textContent = '--';
        if (examDateEl) examDateEl.textContent = 'No exam date set';
        return;
    }
    
    const now = new Date();
    const diff = examDate.getTime() - now.getTime();
    const days = Math.max(0, Math.floor(diff / (1000 * 60 * 60 * 24)));
    
    if (countdownValue) {
        countdownValue.textContent = days.toString();
        countdownValue.style.color = days < 7 ? 'var(--danger-color)' : 'var(--primary-color)';
    }
    
    if (examDateEl) {
        const options = { year: 'numeric', month: 'long', day: 'numeric' };
        examDateEl.textContent = examDate.toLocaleDateString('en-GB', options);
    }
}

function updatePredictionDisplay(prediction, targetScore) {
    const scoreEl = document.getElementById('examHubPredictedScore');
    const rangeEl = document.getElementById('examHubScoreRange');
    const probEl = document.getElementById('examHubGradeProbability');
    const targetEl = document.getElementById('examHubTargetGrade');
    
    if (!prediction) {
        if (scoreEl) scoreEl.textContent = '--%';
        if (rangeEl) rangeEl.textContent = 'No prediction available';
        if (probEl) probEl.textContent = '--%';
        if (targetEl) targetEl.textContent = '';
        return;
    }
    
    const expectedPercent = Math.round(prediction.expectedMarks || 0);
    const lower = Math.round(prediction.confidenceInterval?.lower || 0);
    const upper = Math.round(prediction.confidenceInterval?.upper || 0);
    const probability = Math.round((prediction.probability || 0) * 100);
    
    if (scoreEl) {
        scoreEl.textContent = `${expectedPercent}%`;
        scoreEl.style.color = expectedPercent >= targetScore ? 'var(--success-color)' : 'var(--danger-color)';
    }
    
    if (rangeEl) {
        rangeEl.textContent = `Range: ${lower}% - ${upper}%`;
    }
    
    if (probEl) {
        probEl.textContent = `${probability}%`;
        probEl.style.color = probability >= 70 ? 'var(--success-color)' : 'var(--primary-color)';
    }
    
    if (targetEl) {
        targetEl.textContent = `Target: ${targetScore}%`;
    }
}

function updateCompletenessDisplay(completeness) {
    const percentEl = document.getElementById('examHubCompletionPercent');
    const barEl = document.getElementById('examHubCompletionBar');
    const coverageEl = document.getElementById('examHubCoverageScore');
    const fragilityEl = document.getElementById('examHubFragilityScore');
    const techniqueEl = document.getElementById('examHubTechniqueScore');
    
    if (!completeness) {
        if (percentEl) percentEl.textContent = '0%';
        if (barEl) barEl.style.width = '0%';
        if (coverageEl) coverageEl.textContent = '--';
        if (fragilityEl) fragilityEl.textContent = '--';
        if (techniqueEl) techniqueEl.textContent = '--';
        return;
    }
    
    const overall = Math.round((completeness.overall || 0) * 100);
    const coverage = Math.round((completeness.coverage || 0) * 100);
    const fragility = Math.round((1 - (completeness.fragilityRisk || 0)) * 100);
    const technique = Math.round((completeness.techniqueReadiness || 0) * 100);
    
    if (percentEl) percentEl.textContent = `${overall}%`;
    if (barEl) barEl.style.width = `${overall}%`;
    if (coverageEl) coverageEl.textContent = `${coverage}%`;
    if (fragilityEl) fragilityEl.textContent = `${fragility}%`;
    if (techniqueEl) techniqueEl.textContent = `${technique}%`;
}

function updateTimeEstimateDisplay(timeEstimate) {
    const hoursEl = document.getElementById('examHubHoursNeeded');
    const safeEl = document.getElementById('examHubSafeHours');
    
    if (!timeEstimate) {
        if (hoursEl) hoursEl.textContent = '-- hrs';
        if (safeEl) safeEl.textContent = '';
        return;
    }
    
    const likely = Math.round(timeEstimate.likelyHours || 0);
    const safe = Math.round(timeEstimate.safeHours || 0);
    
    if (hoursEl) hoursEl.textContent = `${likely} hrs`;
    if (safeEl) safeEl.textContent = `Safe estimate: ${safe} hrs`;
}

function updateWeakAreasDisplay(weakAreas) {
    const container = document.getElementById('examHubWeakAreasList');
    if (!container) return;
    
    if (!weakAreas || weakAreas.length === 0) {
        container.innerHTML = `
            <div style="text-align: center; padding: 40px; color: var(--secondary-text);">
                No weak areas identified yet. Complete some practice sessions to identify areas needing attention.
            </div>
        `;
        return;
    }
    
    container.innerHTML = weakAreas.map((area, index) => {
        const question = examModeUIState.questions.find(q => q.id === area.questionId);
        const topic = question?.tags?.[0] || 'General';
        const mastery = Math.round((area.readiness || 0) * 100);
        const impact = Math.round((area.expectedGain || 0) * 100);
        
        return `
            <div class="weak-area-item" style="display: flex; justify-content: space-between; align-items: center; padding: 15px; background: var(--input-bg); border-radius: 8px; border-left: 4px solid ${mastery < 50 ? 'var(--danger-color)' : 'var(--primary-color)'};">
                <div>
                    <div style="font-weight: 600;">${topic}</div>
                    <div style="color: var(--secondary-text); font-size: 0.9rem; margin-top: 4px;">
                        ${question?.prompt?.substring(0, 80) || 'Question ' + (index + 1)}...
                    </div>
                </div>
                <div style="text-align: right;">
                    <div style="font-weight: 600; color: ${mastery < 50 ? 'var(--danger-color)' : 'var(--success-color)'};">${mastery}% mastery</div>
                    <div style="color: var(--secondary-text); font-size: 0.85rem;">+${impact}% potential gain</div>
                </div>
            </div>
        `;
    }).join('');
}

function updateErrorAtomsDisplay() {
    const container = document.getElementById('examHubErrorAtomsList');
    if (!container) return;
    
    const errorAtoms = Array.from(examModeUIState.errorAtoms.values());
    
    if (errorAtoms.length === 0) {
        container.innerHTML = `
            <div style="text-align: center; padding: 40px; color: var(--secondary-text);">
                No failure patterns detected yet. Complete some practice sessions to identify patterns.
            </div>
        `;
        return;
    }
    
    const sortedErrors = errorAtoms
        .sort((a, b) => (b.frequency || 0) - (a.frequency || 0))
        .slice(0, 5);
    
    container.innerHTML = sortedErrors.map(error => {
        const frequency = Math.round((error.frequency || 0) * 100);
        const risk = Math.round((error.risk || 0) * 100);
        
        return `
            <div class="error-atom-item" style="display: flex; justify-content: space-between; align-items: center; padding: 15px; background: var(--input-bg); border-radius: 8px; border-left: 4px solid var(--danger-color);">
                <div>
                    <div style="font-weight: 600;">${error.name || 'Unknown Error'}</div>
                    <div style="color: var(--secondary-text); font-size: 0.9rem; margin-top: 4px;">
                        ${error.description || 'No description available'}
                    </div>
                </div>
                <div style="text-align: right;">
                    <div style="font-weight: 600; color: var(--danger-color);">${frequency}% frequency</div>
                    <div style="color: var(--secondary-text); font-size: 0.85rem;">${risk}% mark risk</div>
                </div>
            </div>
        `;
    }).join('');
}

// --- Session Functions ---

export async function startExamModeOptimalSession() {
    const now = new Date();
    const examDate = examModeUIState.examSpec?.examDate
        ? new Date(examModeUIState.examSpec.examDate)
        : now;
    
    // Compose optimal session
    const session = composeOptimalSession(
        examModeUIState.questions,
        examModeUIState.atoms,
        now,
        examDate,
        { targetMinutes: 30 }
    );
    
    if (!session || !session.phases || session.phases.length === 0) {
        showToast('No questions available for practice session.', 'error');
        return;
    }
    
    examModeUIState.currentSession = session;
    examModeUIState.currentQuestionIndex = 0;
    examModeUIState.responses = {};
    examModeUIState.timing = {};
    examModeUIState.remainingSeconds = (session.totalMinutes || 30) * 60;
    examModeUIState.isPaused = false;
    examModeUIState.activeView = 'session';
    
    // Show session view
    showView('examModeSessionView');
    
    // Start timer
    startSessionTimer();
    
    // Display first question
    displayCurrentQuestion();
    
    // Setup keyboard shortcuts for session
    setupSessionKeyboardShortcuts();
}

function startSessionTimer() {
    if (examModeUIState.timerInterval) {
        clearInterval(examModeUIState.timerInterval);
    }
    
    examModeUIState.timerInterval = setInterval(() => {
        if (examModeUIState.isPaused) return;
        
        examModeUIState.remainingSeconds = Math.max(0, examModeUIState.remainingSeconds - 1);
        updateTimerDisplay();
        
        if (examModeUIState.remainingSeconds <= 0) {
            endExamSession();
        }
    }, 1000);
}

function updateTimerDisplay() {
    const timerEl = document.getElementById('examSessionTimer');
    if (!timerEl) return;
    
    const minutes = Math.floor(examModeUIState.remainingSeconds / 60);
    const seconds = examModeUIState.remainingSeconds % 60;
    timerEl.textContent = `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
    
    if (examModeUIState.remainingSeconds < 60) {
        timerEl.style.color = 'var(--danger-color)';
    } else if (examModeUIState.remainingSeconds < 300) {
        timerEl.style.color = 'var(--primary-color)';
    } else {
        timerEl.style.color = 'var(--text-color)';
    }
}

function displayCurrentQuestion() {
    const session = examModeUIState.currentSession;
    if (!session) return;
    
    // Get all question IDs from all phases
    const allQuestionIds = session.phases.flatMap(phase => phase.questions || []);
    const totalQuestions = allQuestionIds.length;
    const currentIndex = examModeUIState.currentQuestionIndex;
    
    if (currentIndex >= totalQuestions) {
        endExamSession();
        return;
    }
    
    const questionId = allQuestionIds[currentIndex];
    const question = examModeUIState.questions.find(q => q.id === questionId);
    
    if (!question) {
        console.error('Question not found:', questionId);
        return;
    }
    
    // Determine current phase
    let questionCount = 0;
    let currentPhase = null;
    for (const phase of session.phases) {
        const phaseQuestionCount = phase.questions?.length || 0;
        if (currentIndex < questionCount + phaseQuestionCount) {
            currentPhase = phase;
            break;
        }
        questionCount += phaseQuestionCount;
    }
    
    // Update phase label
    const phaseLabel = document.getElementById('examSessionPhaseLabel');
    if (phaseLabel && currentPhase) {
        const phaseNames = {
            warm_up: 'Warm-up',
            targeted_struggle: 'Targeted Practice',
            technique_drill: 'Technique Drill',
            timed_chunk: 'Timed Practice',
            recap: 'Recap'
        };
        phaseLabel.textContent = phaseNames[currentPhase.type] || currentPhase.type;
    }
    
    // Update progress
    const progressEl = document.getElementById('examSessionProgress');
    if (progressEl) {
        progressEl.textContent = `Question ${currentIndex + 1} of ${totalQuestions}`;
    }
    
    // Display question prompt
    const promptEl = document.getElementById('examSessionQuestionPrompt');
    if (promptEl) {
        promptEl.textContent = question.prompt || 'No question text available';
    }
    
    // Hide all input types and answer displays
    document.getElementById('examSessionMcqOptions')?.classList.add('hidden');
    document.getElementById('examSessionTextInput')?.classList.add('hidden');
    document.getElementById('examSessionNumericInput')?.classList.add('hidden');
    document.getElementById('examSessionAnswerDisplay')?.classList.add('hidden');
    document.getElementById('examSessionMarkingFeedback')?.classList.add('hidden');
    document.getElementById('examSessionSelfAssessment')?.classList.add('hidden');
    
    // Show appropriate input type
    if (question.type === 'mcq_single' || question.type === 'mcq_multi') {
        displayMcqOptions(question);
    } else if (question.type === 'numeric') {
        document.getElementById('examSessionNumericInput')?.classList.remove('hidden');
        document.getElementById('examSessionAnswerNumeric').value = '';
    } else {
        document.getElementById('examSessionTextInput')?.classList.remove('hidden');
        document.getElementById('examSessionAnswerText').value = '';
    }
    
    // Update button states
    document.getElementById('examSessionShowAnswerBtn')?.classList.remove('hidden');
    document.getElementById('examSessionSubmitBtn')?.classList.add('hidden');
    document.getElementById('examSessionNextBtn')?.classList.add('hidden');
    
    // Show why this question
    updateWhyThisDisplay(question, currentPhase);
    
    // Record start time for this question
    examModeUIState.timing[questionId] = {
        startTime: Date.now(),
        endTime: null
    };
}

function displayMcqOptions(question) {
    const container = document.getElementById('examSessionMcqOptions');
    if (!container) return;
    
    container.classList.remove('hidden');
    container.style.display = 'grid';
    
    const options = question.options || [];
    container.innerHTML = options.map((option, index) => `
        <button class="mcq-option-btn" data-index="${index}" onclick="selectMcqOption(${index})" 
                style="padding: 15px; text-align: left; border: 2px solid var(--border-color); border-radius: 8px; background: var(--input-bg); color: var(--text-color); cursor: pointer; transition: all 0.2s;">
            <span style="font-weight: 600; margin-right: 10px;">${index + 1}.</span>
            ${typeof option === 'string' ? option : option.text || option}
        </button>
    `).join('');
}

function updateWhyThisDisplay(question, phase) {
    const container = document.getElementById('examSessionWhyThis');
    const explanationEl = document.getElementById('examSessionWhyThisExplanation');
    
    if (!container || !explanationEl) return;
    
    container.classList.remove('hidden');
    
    const reasons = [];
    
    if (phase) {
        const phaseReasons = {
            warm_up: 'This is a warm-up question to get you started with familiar content.',
            targeted_struggle: 'This question targets an area where you need improvement.',
            technique_drill: 'This question practises exam technique and method marks.',
            timed_chunk: 'This is a timed practice question to build exam stamina.',
            recap: 'This is a recap question to consolidate your learning.'
        };
        reasons.push(phaseReasons[phase.type] || '');
    }
    
    // Add atom-specific reasons
    if (question.atomMap && question.atomMap.length > 0) {
        const lowMasteryAtoms = question.atomMap
            .map(mapping => examModeUIState.atoms.get(mapping.atomId))
            .filter(atom => atom && (atom.mastery || 0) < 0.5);
        
        if (lowMasteryAtoms.length > 0) {
            reasons.push(`Targets ${lowMasteryAtoms.length} atom(s) with low mastery.`);
        }
    }
    
    explanationEl.textContent = reasons.filter(r => r).join(' ');
}

export function pauseExamSession() {
    examModeUIState.isPaused = !examModeUIState.isPaused;
    
    const pauseBtn = document.getElementById('examSessionPauseBtn');
    if (pauseBtn) {
        pauseBtn.textContent = examModeUIState.isPaused ? 'Resume' : 'Pause';
    }
}

export async function endExamSession() {
    if (examModeUIState.timerInterval) {
        clearInterval(examModeUIState.timerInterval);
        examModeUIState.timerInterval = null;
    }
    
    // Calculate session results
    const totalQuestions = examModeUIState.currentSession?.phases
        ?.flatMap(p => p.questions || []).length || 0;
    const answeredQuestions = Object.keys(examModeUIState.responses).length;
    
    // Show results and return to hub
    showToast(`Session complete: ${answeredQuestions}/${totalQuestions} questions answered.`, 'success');
    
    examModeUIState.currentSession = null;
    examModeUIState.activeView = 'hub';
    
    showView('examModeHubView');
    await refreshHubData();
    setupHubKeyboardShortcuts();
}

export function showExamSessionAnswer() {
    const session = examModeUIState.currentSession;
    if (!session) return;
    
    const allQuestionIds = session.phases.flatMap(phase => phase.questions || []);
    const questionId = allQuestionIds[examModeUIState.currentQuestionIndex];
    const question = examModeUIState.questions.find(q => q.id === questionId);
    
    if (!question) return;
    
    // Show answer display
    const answerDisplay = document.getElementById('examSessionAnswerDisplay');
    const correctAnswer = document.getElementById('examSessionCorrectAnswer');
    
    if (answerDisplay && correctAnswer) {
        answerDisplay.classList.remove('hidden');
        
        // Get correct answer based on question type
        let answerText = 'Answer not available';
        if (question.type === 'mcq_single' || question.type === 'mcq_multi') {
            const correctIndices = question.correctIndices || [0];
            const options = question.options || [];
            answerText = correctIndices.map(i => options[i] || `Option ${i + 1}`).join(', ');
        } else if (question.correctAnswer) {
            answerText = question.correctAnswer;
        }
        
        correctAnswer.textContent = answerText;
    }
    
    // Show self-assessment buttons
    document.getElementById('examSessionSelfAssessment')?.classList.remove('hidden');
    
    // Hide show answer button, show next button
    document.getElementById('examSessionShowAnswerBtn')?.classList.add('hidden');
    document.getElementById('examSessionNextBtn')?.classList.remove('hidden');
}

export function markExamSessionQuestion(score) {
    const session = examModeUIState.currentSession;
    if (!session) return;
    
    // score can be boolean or number [0, 1]
    const numericScore = typeof score === 'boolean' ? (score ? 1 : 0) : Number(score);
    const isCorrect = numericScore === 1;
    const isPartial = numericScore > 0 && numericScore < 1;
    
    const allQuestionIds = session.phases.flatMap(phase => phase.questions || []);
    const questionId = allQuestionIds[examModeUIState.currentQuestionIndex];
    
    // Record response
    examModeUIState.responses[questionId] = {
        score: numericScore,
        correct: isCorrect,
        partial: isPartial,
        timestamp: Date.now()
    };
    
    // Record timing
    if (examModeUIState.timing[questionId]) {
        examModeUIState.timing[questionId].endTime = Date.now();
    }
    
    // Update atom states based on response
    updateAtomsFromResponse(questionId, numericScore);
    
    // Move to next question
    nextExamSessionQuestion();
}

async function updateAtomsFromResponse(questionId, score) {
    const question = examModeUIState.questions.find(q => q.id === questionId);
    if (!question || !question.atomMap) return;
    
    const isCorrect = score === 1;
    const isPartial = score > 0 && score < 1;
    
    for (const mapping of question.atomMap) {
        const atom = examModeUIState.atoms.get(mapping.atomId);
        if (!atom) continue;
        
        // Mastery update based on score [0, 1]
        const weight = mapping.weight || 1.0;
        let masteryDelta;
        
        if (score === 1) {
            masteryDelta = 0.1 * weight;
        } else if (score === 0) {
            masteryDelta = -0.15 * weight;
        } else {
            // Partial credit
            masteryDelta = 0.05 * weight * (score - 0.5) * 2; // Scales from -0.05 to 0.05
        }
        
        atom.mastery = Math.max(0, Math.min(1, (atom.mastery || 0) + masteryDelta));
        atom.updatedAt = new Date().toISOString();
        
        // Update stability
        if (score > 0.5) {
            atom.stabilityDays = (atom.stabilityDays || 7) * (1 + 0.2 * score);
        } else {
            atom.stabilityDays = Math.max(1, (atom.stabilityDays || 7) * (0.7 + 0.1 * score));
            atom.fragility = Math.min(1, (atom.fragility || 0.5) + (1 - score) * 0.1);
        }
        
        examModeUIState.atoms.set(atom.id, atom);
        
        // Save to database
        await saveDataToDB('examAtoms', atom);
    }
}

export function nextExamSessionQuestion() {
    examModeUIState.currentQuestionIndex++;
    
    const session = examModeUIState.currentSession;
    if (!session) return;
    
    const allQuestionIds = session.phases.flatMap(phase => phase.questions || []);
    
    if (examModeUIState.currentQuestionIndex >= allQuestionIds.length) {
        endExamSession();
    } else {
        displayCurrentQuestion();
    }
}

export function prevExamSessionQuestion() {
    if (examModeUIState.currentQuestionIndex > 0) {
        examModeUIState.currentQuestionIndex--;
        displayCurrentQuestion();
    }
}

export function flagExamSessionQuestion() {
    const session = examModeUIState.currentSession;
    if (!session) return;
    
    const allQuestionIds = session.phases.flatMap(phase => phase.questions || []);
    const questionId = allQuestionIds[examModeUIState.currentQuestionIndex];
    
    if (!examModeUIState.responses[questionId]) {
        examModeUIState.responses[questionId] = {};
    }
    
    examModeUIState.responses[questionId].flagged = !examModeUIState.responses[questionId].flagged;
    
    const flagBtn = document.getElementById('examSessionFlagBtn');
    if (flagBtn) {
        flagBtn.textContent = examModeUIState.responses[questionId].flagged
            ? 'Unflag (F)'
            : 'Flag for Review (F)';
    }
    
    showToast(examModeUIState.responses[questionId].flagged
        ? 'Question flagged for review'
        : 'Flag removed', 'info');
}

// --- MCQ Selection ---

window.selectMcqOption = function(index) {
    const session = examModeUIState.currentSession;
    if (!session) return;
    
    const allQuestionIds = session.phases.flatMap(phase => phase.questions || []);
    const questionId = allQuestionIds[examModeUIState.currentQuestionIndex];
    
    // Update visual selection
    const buttons = document.querySelectorAll('.mcq-option-btn');
    buttons.forEach((btn, i) => {
        if (i === index) {
            btn.style.borderColor = 'var(--primary-color)';
            btn.style.background = 'var(--primary-color)';
            btn.style.color = 'white';
        } else {
            btn.style.borderColor = 'var(--border-color)';
            btn.style.background = 'var(--input-bg)';
            btn.style.color = 'var(--text-color)';
        }
    });
    
    // Store response
    examModeUIState.responses[questionId] = {
        ...examModeUIState.responses[questionId],
        selectedIndex: index,
        timestamp: Date.now()
    };
    
    // Show submit button
    document.getElementById('examSessionSubmitBtn')?.classList.remove('hidden');
};

// --- Path Map Functions ---

export function showExamModePathMap() {
    examModeUIState.activeView = 'pathMap';
    showView('examModePathMapView');
    populatePathMap();
    setupPathMapKeyboardShortcuts();
}

export function closeExamModePathMap() {
    examModeUIState.activeView = 'hub';
    showView('examModeHubView');
    setupHubKeyboardShortcuts();
}

function populatePathMap() {
    const container = document.getElementById('pathMapNodesContainer');
    if (!container) return;
    
    // Group questions by first tag (topic)
    const topicMap = new Map();
    
    for (const question of examModeUIState.questions) {
        const topic = question.tags?.[0] || 'General';
        if (!topicMap.has(topic)) {
            topicMap.set(topic, []);
        }
        topicMap.get(topic).push(question);
    }
    
    if (topicMap.size === 0) {
        container.innerHTML = `
            <div style="grid-column: 1 / -1; text-align: center; padding: 60px; color: var(--secondary-text);">
                No topics available. Add questions with tags to populate the topic map.
            </div>
        `;
        return;
    }
    
    const now = new Date();
    const examDate = examModeUIState.examSpec?.examDate
        ? new Date(examModeUIState.examSpec.examDate)
        : now;
    
    // Calculate readiness for each topic
    const topicNodes = [];
    
    for (const [topic, questions] of topicMap) {
        let totalMastery = 0;
        let atomCount = 0;
        let fragilitySum = 0;
        
        for (const question of questions) {
            for (const mapping of (question.atomMap || [])) {
                const atom = examModeUIState.atoms.get(mapping.atomId);
                if (atom) {
                    totalMastery += atom.mastery || 0;
                    fragilitySum += atom.fragility || 0.5;
                    atomCount++;
                }
            }
        }
        
        const avgMastery = atomCount > 0 ? totalMastery / atomCount : 0;
        const avgFragility = atomCount > 0 ? fragilitySum / atomCount : 0.5;
        
        topicNodes.push({
            topic,
            questionCount: questions.length,
            mastery: avgMastery,
            fragility: avgFragility,
            atomCount
        });
    }
    
    // Sort by mastery (low to high) by default
    topicNodes.sort((a, b) => a.mastery - b.mastery);
    
    container.innerHTML = topicNodes.map(node => {
        const masteryPercent = Math.round(node.mastery * 100);
        const fragilityPercent = Math.round(node.fragility * 100);
        const statusColor = masteryPercent < 40 ? 'var(--danger-color)' :
                           masteryPercent < 70 ? 'var(--primary-color)' : 'var(--success-color)';
        
        return `
            <div class="path-map-node" onclick="startTopicPractice('${node.topic}')" 
                 style="background: var(--card-bg); border-radius: 12px; padding: 20px; cursor: pointer; transition: all 0.2s; border: 2px solid var(--border-color); border-left: 6px solid ${statusColor};">
                <div style="font-weight: 600; font-size: 1.1rem; margin-bottom: 10px;">${node.topic}</div>
                <div style="display: flex; justify-content: space-between; color: var(--secondary-text); font-size: 0.9rem; margin-bottom: 15px;">
                    <span>${node.questionCount} questions</span>
                    <span>${node.atomCount} atoms</span>
                </div>
                <div style="margin-bottom: 10px;">
                    <div style="display: flex; justify-content: space-between; font-size: 0.85rem; margin-bottom: 4px;">
                        <span>Mastery</span>
                        <span style="color: ${statusColor}; font-weight: 600;">${masteryPercent}%</span>
                    </div>
                    <div style="background: var(--border-color); border-radius: 4px; height: 8px; overflow: hidden;">
                        <div style="background: ${statusColor}; height: 100%; width: ${masteryPercent}%;"></div>
                    </div>
                </div>
                ${fragilityPercent > 50 ? `
                    <div style="font-size: 0.8rem; color: var(--danger-color); margin-top: 10px;">
                        High fragility risk
                    </div>
                ` : ''}
            </div>
        `;
    }).join('');
}

window.startTopicPractice = async function(topic) {
    // Filter questions for this topic
    const topicQuestions = examModeUIState.questions.filter(q =>
        (q.tags || []).includes(topic)
    );
    
    if (topicQuestions.length === 0) {
        showToast('No questions available for this topic.', 'error');
        return;
    }
    
    // Create a focused session for this topic
    const session = {
        phases: [{
            type: 'targeted_struggle',
            questions: topicQuestions.map(q => q.id)
        }],
        totalMinutes: 15,
        topic
    };
    
    examModeUIState.currentSession = session;
    examModeUIState.currentQuestionIndex = 0;
    examModeUIState.responses = {};
    examModeUIState.timing = {};
    examModeUIState.remainingSeconds = 15 * 60;
    examModeUIState.isPaused = false;
    examModeUIState.activeView = 'session';
    
    showView('examModeSessionView');
    startSessionTimer();
    displayCurrentQuestion();
    setupSessionKeyboardShortcuts();
};

// --- Editor Functions ---

export function showExamModeEditors() {
    examModeUIState.activeView = 'editors';
    showView('examModeEditorsView');
    showEditorTab('atoms');
}

export function closeExamModeEditors() {
    examModeUIState.activeView = 'hub';
    showView('examModeHubView');
    setupHubKeyboardShortcuts();
}

window.showEditorTab = function(tabName) {
    // Update tab buttons
    document.querySelectorAll('.editor-tab').forEach(tab => {
        tab.classList.remove('active');
        tab.style.color = 'var(--secondary-text)';
        tab.style.borderBottom = 'none';
    });
    
    const activeTab = document.getElementById(`editorTab${tabName.charAt(0).toUpperCase() + tabName.slice(1)}`);
    if (activeTab) {
        activeTab.classList.add('active');
        activeTab.style.color = 'var(--primary-color)';
        activeTab.style.borderBottom = '2px solid var(--primary-color)';
    }
    
    // Show appropriate panel
    document.querySelectorAll('.editor-panel').forEach(panel => {
        panel.classList.add('hidden');
    });
    
    const panelMap = {
        atoms: 'editorPanelAtoms',
        questions: 'editorPanelQuestions',
        markSchemes: 'editorPanelMarkSchemes',
        errorAtoms: 'editorPanelErrorAtoms'
    };
    
    const panel = document.getElementById(panelMap[tabName]);
    if (panel) {
        panel.classList.remove('hidden');
    }
    
    // Populate the panel content
    switch (tabName) {
        case 'atoms':
            populateAtomsEditor();
            break;
        case 'questions':
            populateQuestionsEditor();
            break;
        case 'markSchemes':
            populateMarkSchemesEditor();
            break;
        case 'errorAtoms':
            populateErrorAtomsEditor();
            break;
    }
};

function populateAtomsEditor() {
    const container = document.getElementById('atomsListContainer');
    if (!container) return;
    
    const atoms = Array.from(examModeUIState.atoms.values());
    
    if (atoms.length === 0) {
        container.innerHTML = `
            <div style="text-align: center; padding: 40px; color: var(--secondary-text);">
                No atoms created yet. Click "Create Atom" to add your first atom.
            </div>
        `;
        return;
    }
    
    container.innerHTML = atoms.map(atom => {
        const masteryPercent = Math.round((atom.mastery || 0) * 100);
        const typeLabels = {
            knowledge: 'Knowledge',
            procedure: 'Procedure',
            exam_technique: 'Exam Technique',
            representation: 'Representation'
        };
        
        return `
            <div class="atom-item" style="display: flex; justify-content: space-between; align-items: center; padding: 15px; background: var(--input-bg); border-radius: 8px;">
                <div>
                    <div style="font-weight: 600;">${atom.name || 'Unnamed Atom'}</div>
                    <div style="color: var(--secondary-text); font-size: 0.85rem; margin-top: 4px;">
                        ${typeLabels[atom.type] || atom.type} | Mastery: ${masteryPercent}% | Stability: ${Math.round(atom.stabilityDays || 0)} days
                    </div>
                </div>
                <div style="display: flex; gap: 10px;">
                    <button class="btn btn-secondary" onclick="editAtom('${atom.id}')" style="padding: 8px 16px;">Edit</button>
                    <button class="btn btn-danger" onclick="deleteAtom('${atom.id}')" style="padding: 8px 16px;">Delete</button>
                </div>
            </div>
        `;
    }).join('');
}

function populateQuestionsEditor() {
    const container = document.getElementById('questionsListContainer');
    if (!container) return;
    
    const questions = examModeUIState.questions;
    
    if (questions.length === 0) {
        container.innerHTML = `
            <div style="text-align: center; padding: 40px; color: var(--secondary-text);">
                No questions created yet. Click "Create Question" to add your first question.
            </div>
        `;
        return;
    }
    
    container.innerHTML = questions.map(question => {
        const typeLabels = {
            mcq_single: 'MCQ (Single)',
            mcq_multi: 'MCQ (Multi)',
            numeric: 'Numeric',
            short_text: 'Short Text',
            structured: 'Structured',
            essay: 'Essay'
        };
        
        return `
            <div class="question-item" style="display: flex; justify-content: space-between; align-items: center; padding: 15px; background: var(--input-bg); border-radius: 8px;">
                <div style="flex: 1; overflow: hidden;">
                    <div style="font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">
                        ${question.prompt?.substring(0, 80) || 'No question text'}...
                    </div>
                    <div style="color: var(--secondary-text); font-size: 0.85rem; margin-top: 4px;">
                        ${typeLabels[question.type] || question.type} | ${(question.atomMap || []).length} linked atoms
                    </div>
                </div>
                <div style="display: flex; gap: 10px; margin-left: 15px;">
                    <button class="btn btn-secondary" onclick="editQuestion('${question.id}')" style="padding: 8px 16px;">Edit</button>
                    <button class="btn btn-danger" onclick="deleteQuestion('${question.id}')" style="padding: 8px 16px;">Delete</button>
                </div>
            </div>
        `;
    }).join('');
}

function populateMarkSchemesEditor() {
    const container = document.getElementById('markSchemesListContainer');
    if (!container) return;
    
    const schemes = Array.from(examModeUIState.markSchemes.values());
    
    if (schemes.length === 0) {
        container.innerHTML = `
            <div style="text-align: center; padding: 40px; color: var(--secondary-text);">
                No mark schemes created yet. Click "Create Mark Scheme" to add your first mark scheme.
            </div>
        `;
        return;
    }
    
    container.innerHTML = schemes.map(scheme => {
        const totalMarks = scheme.points?.reduce((sum, p) => sum + (p.marks || 0), 0) || 0;
        
        return `
            <div class="scheme-item" style="display: flex; justify-content: space-between; align-items: center; padding: 15px; background: var(--input-bg); border-radius: 8px;">
                <div>
                    <div style="font-weight: 600;">${scheme.name || 'Unnamed Scheme'}</div>
                    <div style="color: var(--secondary-text); font-size: 0.85rem; margin-top: 4px;">
                        ${scheme.type === 'rubric' ? 'Rubric' : 'Points-based'} | ${totalMarks} marks | ${(scheme.points || []).length} points
                    </div>
                </div>
                <div style="display: flex; gap: 10px;">
                    <button class="btn btn-secondary" onclick="editMarkScheme('${scheme.id}')" style="padding: 8px 16px;">Edit</button>
                    <button class="btn btn-danger" onclick="deleteMarkScheme('${scheme.id}')" style="padding: 8px 16px;">Delete</button>
                </div>
            </div>
        `;
    }).join('');
}

function populateErrorAtomsEditor() {
    const container = document.getElementById('errorAtomsListContainer');
    if (!container) return;
    
    const errorAtoms = Array.from(examModeUIState.errorAtoms.values());
    
    if (errorAtoms.length === 0) {
        container.innerHTML = `
            <div style="text-align: center; padding: 40px; color: var(--secondary-text);">
                No error atoms created yet. These are automatically detected during practice sessions.
            </div>
        `;
        return;
    }
    
    container.innerHTML = errorAtoms.map(error => {
        const frequencyPercent = Math.round((error.frequency || 0) * 100);
        
        return `
            <div class="error-item" style="display: flex; justify-content: space-between; align-items: center; padding: 15px; background: var(--input-bg); border-radius: 8px; border-left: 4px solid var(--danger-color);">
                <div>
                    <div style="font-weight: 600;">${error.name || 'Unnamed Error'}</div>
                    <div style="color: var(--secondary-text); font-size: 0.85rem; margin-top: 4px;">
                        ${error.description || 'No description'} | Frequency: ${frequencyPercent}%
                    </div>
                </div>
                <div style="display: flex; gap: 10px;">
                    <button class="btn btn-secondary" onclick="editErrorAtom('${error.id}')" style="padding: 8px 16px;">Edit</button>
                    <button class="btn btn-danger" onclick="deleteErrorAtom('${error.id}')" style="padding: 8px 16px;">Delete</button>
                </div>
            </div>
        `;
    }).join('');
}

// --- Atom Editor Modal ---

window.createNewAtom = function() {
    examModeUIState.editingAtomId = null;
    
    // Reset form
    document.getElementById('atomEditorName').value = '';
    document.getElementById('atomEditorType').value = 'knowledge';
    document.getElementById('atomEditorDifficulty').value = '0.5';
    document.getElementById('atomEditorDifficultyValue').textContent = '0.5';
    document.getElementById('atomEditorDepth').value = '0.5';
    document.getElementById('atomEditorDepthValue').textContent = '0.5';
    document.getElementById('atomEditorTransferability').value = '0.5';
    document.getElementById('atomEditorTransferabilityValue').textContent = '0.5';
    document.getElementById('atomEditorTimeSensitivity').value = '0.5';
    document.getElementById('atomEditorTimeSensitivityValue').textContent = '0.5';
    document.getElementById('atomEditorTags').value = '';
    document.getElementById('atomEditorPrerequisites').value = '';
    
    document.getElementById('atomEditorTitle').textContent = 'Create Atom';
    document.getElementById('atomEditorModal').classList.add('show');
};

window.editAtom = function(atomId) {
    const atom = examModeUIState.atoms.get(atomId);
    if (!atom) return;
    
    examModeUIState.editingAtomId = atomId;
    
    // Populate form
    document.getElementById('atomEditorName').value = atom.name || '';
    document.getElementById('atomEditorType').value = atom.type || 'knowledge';
    document.getElementById('atomEditorDifficulty').value = atom.difficulty || 0.5;
    document.getElementById('atomEditorDifficultyValue').textContent = atom.difficulty || 0.5;
    document.getElementById('atomEditorDepth').value = atom.depth || 0.5;
    document.getElementById('atomEditorDepthValue').textContent = atom.depth || 0.5;
    document.getElementById('atomEditorTransferability').value = atom.transferability || 0.5;
    document.getElementById('atomEditorTransferabilityValue').textContent = atom.transferability || 0.5;
    document.getElementById('atomEditorTimeSensitivity').value = atom.timeSensitivity || 0.5;
    document.getElementById('atomEditorTimeSensitivityValue').textContent = atom.timeSensitivity || 0.5;
    document.getElementById('atomEditorTags').value = (atom.tags || []).join(', ');
    document.getElementById('atomEditorPrerequisites').value = (atom.prerequisites || [])
        .map(p => p.atomId).join(', ');
    
    document.getElementById('atomEditorTitle').textContent = 'Edit Atom';
    document.getElementById('atomEditorModal').classList.add('show');
};

window.closeAtomEditorModal = function() {
    document.getElementById('atomEditorModal').classList.remove('show');
    examModeUIState.editingAtomId = null;
};

window.deleteAtom = async function(atomId) {
    if (!confirm('Are you sure you want to delete this atom?')) return;
    
    const atom = examModeUIState.atoms.get(atomId);
    if (atom) {
        atom.isDeleted = true;
        atom.updatedAt = new Date().toISOString();
        await saveDataToDB('examAtoms', atom);
        examModeUIState.atoms.delete(atomId);
    }
    
    populateAtomsEditor();
    showToast('Atom deleted.', 'success');
};

// Atom form submission
document.getElementById('atomEditorForm')?.addEventListener('submit', async function(e) {
    e.preventDefault();
    
    const name = document.getElementById('atomEditorName').value.trim();
    const type = document.getElementById('atomEditorType').value;
    const difficulty = parseFloat(document.getElementById('atomEditorDifficulty').value);
    const depth = parseFloat(document.getElementById('atomEditorDepth').value);
    const transferability = parseFloat(document.getElementById('atomEditorTransferability').value);
    const timeSensitivity = parseFloat(document.getElementById('atomEditorTimeSensitivity').value);
    const tags = document.getElementById('atomEditorTags').value.split(',').map(t => t.trim()).filter(t => t);
    const prereqIds = document.getElementById('atomEditorPrerequisites').value.split(',').map(t => t.trim()).filter(t => t);
    
    const prerequisites = prereqIds.map(id => ({ atomId: id, weight: 1.0 }));
    
    let atom;
    if (examModeUIState.editingAtomId) {
        atom = examModeUIState.atoms.get(examModeUIState.editingAtomId);
        atom.name = name;
        atom.type = type;
        atom.difficulty = difficulty;
        atom.depth = depth;
        atom.transferability = transferability;
        atom.timeSensitivity = timeSensitivity;
        atom.tags = tags;
        atom.prerequisites = prerequisites;
        atom.updatedAt = new Date().toISOString();
        atom.version = (atom.version || 1) + 1;
    } else {
        atom = createAtom({
            name,
            type,
            difficulty,
            depth,
            transferability,
            timeSensitivity,
            tags,
            prerequisites
        });
        atom.deckId = examModeUIState.deckId;
    }
    
    await saveDataToDB('examAtoms', atom);
    examModeUIState.atoms.set(atom.id, atom);
    
    closeAtomEditorModal();
    populateAtomsEditor();
    showToast('Atom saved.', 'success');
});

// --- Question Editor Modal ---

window.createNewQuestion = function() {
    examModeUIState.editingQuestionId = null;
    
    // Reset form
    document.getElementById('questionEditorPrompt').value = '';
    document.getElementById('questionEditorType').value = 'mcq_single';
    document.getElementById('questionEditorDifficulty').value = '0.5';
    document.getElementById('questionEditorDifficultyValue').textContent = '0.5';
    document.getElementById('questionEditorAtomMap').value = '';
    document.getElementById('questionEditorTags').value = '';
    
    document.getElementById('questionEditorTitle').textContent = 'Create Question';
    updateQuestionTypeFields();
    document.getElementById('questionEditorModal').classList.add('show');
};

window.editQuestion = function(questionId) {
    const question = examModeUIState.questions.find(q => q.id === questionId);
    if (!question) return;
    
    examModeUIState.editingQuestionId = questionId;
    
    // Populate form
    document.getElementById('questionEditorPrompt').value = question.prompt || '';
    document.getElementById('questionEditorType').value = question.type || 'mcq_single';
    document.getElementById('questionEditorDifficulty').value = question.difficulty || 0.5;
    document.getElementById('questionEditorDifficultyValue').textContent = question.difficulty || 0.5;
    document.getElementById('questionEditorAtomMap').value = JSON.stringify(question.atomMap || []);
    document.getElementById('questionEditorTags').value = (question.tags || []).join(', ');
    
    document.getElementById('questionEditorTitle').textContent = 'Edit Question';
    updateQuestionTypeFields();
    document.getElementById('questionEditorModal').classList.add('show');
};

window.closeQuestionEditorModal = function() {
    document.getElementById('questionEditorModal').classList.remove('show');
    examModeUIState.editingQuestionId = null;
};

window.updateQuestionTypeFields = function() {
    const type = document.getElementById('questionEditorType').value;
    const mcqSection = document.getElementById('questionEditorMcqOptions');
    
    if (type === 'mcq_single' || type === 'mcq_multi') {
        mcqSection.style.display = 'block';
    } else {
        mcqSection.style.display = 'none';
    }
};

window.deleteQuestion = async function(questionId) {
    if (!confirm('Are you sure you want to delete this question?')) return;
    
    const question = examModeUIState.questions.find(q => q.id === questionId);
    if (question) {
        question.isDeleted = true;
        question.updatedAt = new Date().toISOString();
        await saveDataToDB('examQuestions', question);
        examModeUIState.questions = examModeUIState.questions.filter(q => q.id !== questionId);
    }
    
    populateQuestionsEditor();
    showToast('Question deleted.', 'success');
};

// Question form submission
document.getElementById('questionEditorForm')?.addEventListener('submit', async function(e) {
    e.preventDefault();
    
    const prompt = document.getElementById('questionEditorPrompt').value.trim();
    const type = document.getElementById('questionEditorType').value;
    const difficulty = parseFloat(document.getElementById('questionEditorDifficulty').value);
    const tags = document.getElementById('questionEditorTags').value.split(',').map(t => t.trim()).filter(t => t);
    
    let atomMap = [];
    try {
        const atomMapStr = document.getElementById('questionEditorAtomMap').value.trim();
        if (atomMapStr) {
            atomMap = JSON.parse(atomMapStr);
        }
    } catch (err) {
        showToast('Invalid atom map JSON format.', 'error');
        return;
    }
    
    let question;
    if (examModeUIState.editingQuestionId) {
        question = examModeUIState.questions.find(q => q.id === examModeUIState.editingQuestionId);
        question.prompt = prompt;
        question.type = type;
        question.difficulty = difficulty;
        question.tags = tags;
        question.atomMap = atomMap;
        question.updatedAt = new Date().toISOString();
        question.version = (question.version || 1) + 1;
    } else {
        question = createQuestion({
            prompt,
            type,
            difficulty,
            tags,
            atomMap
        });
        question.deckId = examModeUIState.deckId;
        examModeUIState.questions.push(question);
    }
    
    await saveDataToDB('examQuestions', question);
    
    closeQuestionEditorModal();
    populateQuestionsEditor();
    showToast('Question saved.', 'success');
});

// --- Mark Scheme Editor ---

window.createNewMarkScheme = function() {
    examModeUIState.editingMarkSchemeId = null;
    
    document.getElementById('markSchemeEditorName').value = '';
    document.getElementById('markSchemeEditorType').value = 'points';
    document.getElementById('markSchemePointsContainer').innerHTML = '';
    document.getElementById('markSchemeRubricContainer').innerHTML = '';
    
    document.getElementById('markSchemeEditorTitle').textContent = 'Create Mark Scheme';
    updateMarkSchemeTypeFields();
    addMarkSchemePoint(); // Add first point
    document.getElementById('markSchemeEditorModal').classList.add('show');
};

window.closeMarkSchemeEditorModal = function() {
    document.getElementById('markSchemeEditorModal').classList.remove('show');
    examModeUIState.editingMarkSchemeId = null;
};

window.updateMarkSchemeTypeFields = function() {
    const type = document.getElementById('markSchemeEditorType').value;
    
    if (type === 'points') {
        document.getElementById('markSchemePointsSection').classList.remove('hidden');
        document.getElementById('markSchemeRubricSection').classList.add('hidden');
    } else {
        document.getElementById('markSchemePointsSection').classList.add('hidden');
        document.getElementById('markSchemeRubricSection').classList.remove('hidden');
    }
};

window.addMarkSchemePoint = function() {
    const container = document.getElementById('markSchemePointsContainer');
    const pointIndex = container.children.length;
    
    const pointHtml = `
        <div class="mark-scheme-point" data-index="${pointIndex}" style="padding: 15px; background: var(--input-bg); border-radius: 8px; border: 1px solid var(--border-color);">
            <div style="display: grid; grid-template-columns: 1fr 1fr 100px auto; gap: 10px; margin-bottom: 10px;">
                <div>
                    <label style="font-size: 0.85rem;">Point Code</label>
                    <input type="text" class="point-code" placeholder="e.g., M1, A1" style="width: 100%; padding: 8px; border: 1px solid var(--border-color); border-radius: 4px; background: var(--card-bg); color: var(--text-color);">
                </div>
                <div>
                    <label style="font-size: 0.85rem;">Description</label>
                    <input type="text" class="point-description" placeholder="What must be shown" style="width: 100%; padding: 8px; border: 1px solid var(--border-color); border-radius: 4px; background: var(--card-bg); color: var(--text-color);">
                </div>
                <div>
                    <label style="font-size: 0.85rem;">Marks</label>
                    <input type="number" class="point-marks" value="1" min="1" max="10" style="width: 100%; padding: 8px; border: 1px solid var(--border-color); border-radius: 4px; background: var(--card-bg); color: var(--text-color);">
                </div>
                <div style="display: flex; align-items: flex-end;">
                    <button type="button" class="btn btn-danger" onclick="removeMarkSchemePoint(${pointIndex})" style="padding: 8px 12px;">Remove</button>
                </div>
            </div>
            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px;">
                <div>
                    <label style="font-size: 0.85rem;">Accept (comma-separated)</label>
                    <input type="text" class="point-accept" placeholder="e.g., correct answer, alternative" style="width: 100%; padding: 8px; border: 1px solid var(--border-color); border-radius: 4px; background: var(--card-bg); color: var(--text-color);">
                </div>
                <div>
                    <label style="font-size: 0.85rem;">Linked Atom ID</label>
                    <input type="text" class="point-atom" placeholder="atom-123" style="width: 100%; padding: 8px; border: 1px solid var(--border-color); border-radius: 4px; background: var(--card-bg); color: var(--text-color);">
                </div>
            </div>
        </div>
    `;
    
    container.insertAdjacentHTML('beforeend', pointHtml);
};

window.removeMarkSchemePoint = function(index) {
    const container = document.getElementById('markSchemePointsContainer');
    const point = container.querySelector(`[data-index="${index}"]`);
    if (point) {
        point.remove();
    }
};

window.deleteMarkScheme = async function(schemeId) {
    if (!confirm('Are you sure you want to delete this mark scheme?')) return;
    
    const scheme = examModeUIState.markSchemes.get(schemeId);
    if (scheme) {
        scheme.isDeleted = true;
        scheme.updatedAt = new Date().toISOString();
        await saveDataToDB('examMarkSchemes', scheme);
        examModeUIState.markSchemes.delete(schemeId);
    }
    
    populateMarkSchemesEditor();
    showToast('Mark scheme deleted.', 'success');
};

// Mark scheme form submission
document.getElementById('markSchemeEditorForm')?.addEventListener('submit', async function(e) {
    e.preventDefault();
    
    const name = document.getElementById('markSchemeEditorName').value.trim();
    const type = document.getElementById('markSchemeEditorType').value;
    
    // Collect points
    const points = [];
    const pointElements = document.querySelectorAll('.mark-scheme-point');
    
    pointElements.forEach(el => {
        const code = el.querySelector('.point-code').value.trim();
        const description = el.querySelector('.point-description').value.trim();
        const marks = parseInt(el.querySelector('.point-marks').value) || 1;
        const accept = el.querySelector('.point-accept').value.split(',').map(s => s.trim()).filter(s => s);
        const atomId = el.querySelector('.point-atom').value.trim();
        
        if (code || description) {
            points.push({
                id: generateUUID(),
                code,
                description,
                marks,
                accept,
                atomLinks: atomId ? [{ atomId, weight: 1.0 }] : []
            });
        }
    });
    
    const scheme = createMarkScheme({
        id: examModeUIState.editingMarkSchemeId || generateUUID(),
        name,
        type,
        points
    });
    scheme.deckId = examModeUIState.deckId;
    
    await saveDataToDB('examMarkSchemes', scheme);
    examModeUIState.markSchemes.set(scheme.id, scheme);
    
    closeMarkSchemeEditorModal();
    populateMarkSchemesEditor();
    showToast('Mark scheme saved.', 'success');
});

// --- Settings Modal ---

export function showExamModeSettings() {
    const spec = examModeUIState.examSpec || {};
    
    // Populate form
    document.getElementById('examModeExamDate').value = spec.examDate
        ? spec.examDate.split('T')[0]
        : '';
    document.getElementById('examModeTargetScore').value = spec.targetScore || 70;
    document.getElementById('examModeTargetScoreValue').textContent = spec.targetScore || 70;
    document.getElementById('examModeTotalMarks').value = spec.totalMarks || 100;
    document.getElementById('examModeDuration').value = spec.durationMinutes || 120;
    
    const boundaries = spec.gradeBoundaries || {};
    document.getElementById('examModeGradeA').value = boundaries.A || 90;
    document.getElementById('examModeGradeB').value = boundaries.B || 80;
    document.getElementById('examModeGradeC').value = boundaries.C || 70;
    
    document.getElementById('examModeSettingsModal').classList.add('show');
}

window.closeExamModeSettingsModal = function() {
    document.getElementById('examModeSettingsModal').classList.remove('show');
};

// Settings form submission
document.getElementById('examModeSettingsForm')?.addEventListener('submit', async function(e) {
    e.preventDefault();
    
    const examDate = document.getElementById('examModeExamDate').value;
    const targetScore = parseInt(document.getElementById('examModeTargetScore').value);
    const totalMarks = parseInt(document.getElementById('examModeTotalMarks').value);
    const durationMinutes = parseInt(document.getElementById('examModeDuration').value);
    
    const gradeBoundaries = {
        A: parseInt(document.getElementById('examModeGradeA').value),
        B: parseInt(document.getElementById('examModeGradeB').value),
        C: parseInt(document.getElementById('examModeGradeC').value)
    };
    
    examModeUIState.examSpec = {
        ...examModeUIState.examSpec,
        examDate: examDate ? new Date(examDate).toISOString() : null,
        targetScore,
        totalMarks,
        durationMinutes,
        gradeBoundaries,
        updatedAt: new Date().toISOString()
    };
    
    await saveDataToDB('examSpecs', examModeUIState.examSpec);
    
    closeExamModeSettingsModal();
    await refreshHubData();
    showToast('Settings saved.', 'success');
});

// --- Keyboard Shortcuts ---

function setupHubKeyboardShortcuts() {
    removeKeyboardHandler();
    
    examModeUIState.keyboardHandler = function(event) {
        if (examModeUIState.activeView !== 'hub') return;
        if (event.target.tagName === 'INPUT' || event.target.tagName === 'TEXTAREA') return;
        
        const key = event.key.toLowerCase();
        
        if (key === 's' && !event.ctrlKey && !event.metaKey) {
            event.preventDefault();
            startExamModeOptimalSession();
        } else if (key === 't' && !event.ctrlKey && !event.metaKey) {
            event.preventDefault();
            showExamModePathMap();
        } else if (key === 'e' && !event.ctrlKey && !event.metaKey) {
            event.preventDefault();
            showExamModeEditors();
        } else if (key === 'escape') {
            event.preventDefault();
            closeExamModeHub();
        }
    };
    
    document.addEventListener('keydown', examModeUIState.keyboardHandler);
}

function setupSessionKeyboardShortcuts() {
    removeKeyboardHandler();
    
    examModeUIState.keyboardHandler = function(event) {
        if (examModeUIState.activeView !== 'session') return;
        if (event.target.tagName === 'INPUT' || event.target.tagName === 'TEXTAREA') return;
        
        const key = event.key.toLowerCase();
        
        if (key === 'arrowleft') {
            event.preventDefault();
            prevExamSessionQuestion();
        } else if (key === 'arrowright') {
            event.preventDefault();
            nextExamSessionQuestion();
        } else if (key === '1') {
            event.preventDefault();
            const selfAssessment = document.getElementById('examSessionSelfAssessment');
            if (selfAssessment && !selfAssessment.classList.contains('hidden')) {
                // If answer is shown, 1 = Incorrect
                markExamSessionQuestion(0); // 0 = Incorrect
            } else {
                selectMcqOption(0);
            }
        } else if (key === '2') {
            event.preventDefault();
            const selfAssessment = document.getElementById('examSessionSelfAssessment');
            if (selfAssessment && !selfAssessment.classList.contains('hidden')) {
                // If answer is shown, 2 = Partially Correct
                markExamSessionQuestion(0.5); // 0.5 = Partial
            } else {
                selectMcqOption(1);
            }
        } else if (key === '3') {
            event.preventDefault();
            const selfAssessment = document.getElementById('examSessionSelfAssessment');
            if (selfAssessment && !selfAssessment.classList.contains('hidden')) {
                // If answer is shown, 3 = Correct
                markExamSessionQuestion(1); // 1 = Correct
            } else {
                selectMcqOption(2);
            }
        } else if (key === '4') {
            event.preventDefault();
            selectMcqOption(3);
        } else if (key === 'enter') {
            event.preventDefault();
            const showBtn = document.getElementById('examSessionShowAnswerBtn');
            const selfAssessment = document.getElementById('examSessionSelfAssessment');
            
            if (showBtn && !showBtn.classList.contains('hidden')) {
                showExamSessionAnswer();
            } else if (selfAssessment && !selfAssessment.classList.contains('hidden')) {
                // If answer already shown, Enter could mean 'Next' or 'Mark Correct'
                // Spec says ArrowRight for Next, so let's keep Enter for showing only
            }
        } else if (key === 'f') {
            event.preventDefault();
            flagExamSessionQuestion();
        } else if (key === 'escape') {
            event.preventDefault();
            pauseExamSession();
        } else if (key === 's' && (event.ctrlKey || event.metaKey)) {
            event.preventDefault();
            endExamSession();
        }
    };
    
    document.addEventListener('keydown', examModeUIState.keyboardHandler);
}

function setupPathMapKeyboardShortcuts() {
    removeKeyboardHandler();
    
    examModeUIState.keyboardHandler = function(event) {
        if (examModeUIState.activeView !== 'pathMap') return;
        
        if (event.key === 'Escape') {
            event.preventDefault();
            closeExamModePathMap();
        }
    };
    
    document.addEventListener('keydown', examModeUIState.keyboardHandler);
}

function removeKeyboardHandler() {
    if (examModeUIState.keyboardHandler) {
        document.removeEventListener('keydown', examModeUIState.keyboardHandler);
        examModeUIState.keyboardHandler = null;
    }
}

// --- Toast Helper ---

function showToast(message, type = 'info') {
    const bar = document.getElementById('messageBar');
    if (!bar) {
        console.log(`[${type.toUpperCase()}] ${message}`);
        return;
    }
    bar.textContent = message;
    bar.className = 'message-bar';
    bar.classList.add(type);
    bar.classList.remove('hidden');
    bar.classList.add('show');
    setTimeout(() => {
        bar.classList.remove('show');
        setTimeout(() => bar.classList.add('hidden'), 300);
    }, 3000);
}

// --- Global Exports ---

window.openExamModeHub = openExamModeHub;
window.closeExamModeHub = closeExamModeHub;
window.showExamModeSettings = showExamModeSettings;
window.showExamModePathMap = showExamModePathMap;
window.closeExamModePathMap = closeExamModePathMap;
window.startExamModeOptimalSession = startExamModeOptimalSession;
window.pauseExamSession = pauseExamSession;
window.endExamSession = endExamSession;
window.showExamSessionAnswer = showExamSessionAnswer;
window.markExamSessionQuestion = markExamSessionQuestion;
window.nextExamSessionQuestion = nextExamSessionQuestion;
window.prevExamSessionQuestion = prevExamSessionQuestion;
window.flagExamSessionQuestion = flagExamSessionQuestion;
window.showExamModeEditors = showExamModeEditors;
window.closeExamModeEditors = closeExamModeEditors;
