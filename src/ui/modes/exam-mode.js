/**
 * Exam Mode UI Adapter
 * 
 * Connects the exam engine to the mode registry for integration with the main UI.
 * Provides a consistent interface for exam sessions.
 */

import {
    createExamSpec,
    generateExamPaper,
    createExamSitting,
    recordSittingResponse,
    submitExamSitting,
    predictExamScore,
    computeRevisionCompleteness,
    estimateTimeToTarget,
    rankQuestionsForPractice,
    composeOptimalSession,
    createExamKeyboardHandler,
    EXAM_MODE_SHORTCUTS
} from '../../core/exam/exam-mode.js';

import { gradeQuestion } from '../../core/exam/marking.js';
import { applyMarkingRecordToAtoms } from '../../core/exam/atom-updates.js';
import { initDB, getDataFromDB, saveDataToDB, getAllDataFromDB } from '../../core/db.js';

/**
 * Exam Mode State
 */
const examModeState = {
    currentExamSpec: null,
    currentPaper: null,
    currentSitting: null,
    questions: [],
    atoms: new Map(),
    currentQuestionIndex: 0,
    timerInterval: null,
    keyboardHandler: null,
    isActive: false
};

/**
 * Creates the Exam Mode adapter for the mode registry.
 * @param {Object} api Application API object
 * @returns {Object} Mode adapter
 */
export function createExamModeAdapter(api = {}) {
    return {
        name: 'exam',
        
        async init(options = {}) {
            await initDB();
            examModeState.isActive = false;
            
            // Load atoms and questions from database
            const atoms = await getAllDataFromDB('atoms') || [];
            const questions = await getAllDataFromDB('questions') || [];
            
            examModeState.atoms = new Map(atoms.map(a => [a.id, a]));
            examModeState.questions = questions;
            
            return { success: true };
        },
        
        async start(options = {}) {
            examModeState.isActive = true;
            
            // Create or resume exam spec
            if (options.examSpecId) {
                examModeState.currentExamSpec = await getDataFromDB('examSpecs', options.examSpecId);
            } else if (options.examSpec) {
                examModeState.currentExamSpec = createExamSpec(options.examSpec);
                await saveDataToDB('examSpecs', examModeState.currentExamSpec);
            }
            
            // Generate paper if not provided
            if (options.examPaperId) {
                examModeState.currentPaper = await getDataFromDB('examPapers', options.examPaperId);
            } else if (examModeState.currentExamSpec) {
                examModeState.currentPaper = generateExamPaper(
                    examModeState.currentExamSpec,
                    examModeState.questions,
                    { seed: options.seed }
                );
                await saveDataToDB('examPapers', examModeState.currentPaper);
            }
            
            // Create sitting
            if (options.sittingId) {
                examModeState.currentSitting = await getDataFromDB('examSittings', options.sittingId);
            } else if (examModeState.currentPaper) {
                examModeState.currentSitting = createExamSitting(examModeState.currentPaper, {
                    userId: options.userId || 'default_user'
                });
                examModeState.currentSitting.status = 'in_progress';
                examModeState.currentSitting.startedAt = new Date().toISOString();
                await saveDataToDB('examSittings', examModeState.currentSitting);
            }
            
            examModeState.currentQuestionIndex = 0;
            
            // Setup keyboard handler
            this.setupKeyboardHandler();
            
            // Start timer if timed
            if (examModeState.currentPaper?.navigation?.showTimer) {
                this.startTimer();
            }
            
            return {
                success: true,
                sitting: examModeState.currentSitting,
                paper: examModeState.currentPaper
            };
        },
        
        setupKeyboardHandler() {
            if (examModeState.keyboardHandler) {
                document.removeEventListener('keydown', examModeState.keyboardHandler);
            }
            
            examModeState.keyboardHandler = createExamKeyboardHandler({
                nextQuestion: () => this.nextQuestion(),
                previousQuestion: () => this.previousQuestion(),
                selectOption: (index) => this.selectOption(index),
                submitAnswer: () => this.submitAnswer(),
                flagQuestion: () => this.flagQuestion(),
                submitExam: () => this.submitExam(),
                pauseExam: () => this.pauseExam()
            });
            
            document.addEventListener('keydown', examModeState.keyboardHandler);
        },
        
        startTimer() {
            if (examModeState.timerInterval) {
                clearInterval(examModeState.timerInterval);
            }
            
            examModeState.timerInterval = setInterval(() => {
                if (!examModeState.currentSitting) return;
                
                const remaining = examModeState.currentSitting.remainingSeconds - 1;
                examModeState.currentSitting.remainingSeconds = Math.max(0, remaining);
                
                if (remaining <= 0 && examModeState.currentPaper?.navigation?.autoSubmitOnTime) {
                    this.submitExam();
                }
            }, 1000);
        },
        
        stopTimer() {
            if (examModeState.timerInterval) {
                clearInterval(examModeState.timerInterval);
                examModeState.timerInterval = null;
            }
        },
        
        getCurrentQuestion() {
            if (!examModeState.currentPaper) return null;
            
            const allQuestions = examModeState.currentPaper.sections.flatMap(s => s.questions);
            const currentItem = allQuestions[examModeState.currentQuestionIndex];
            
            if (!currentItem) return null;
            
            return examModeState.questions.find(q => q.id === currentItem.questionId);
        },
        
        async nextQuestion() {
            const allQuestions = examModeState.currentPaper?.sections.flatMap(s => s.questions) || [];
            if (examModeState.currentQuestionIndex < allQuestions.length - 1) {
                examModeState.currentQuestionIndex++;
                return { success: true, index: examModeState.currentQuestionIndex };
            }
            return { success: false, reason: 'at_end' };
        },
        
        async previousQuestion() {
            if (!examModeState.currentPaper?.navigation?.allowBack) {
                return { success: false, reason: 'back_not_allowed' };
            }
            
            if (examModeState.currentQuestionIndex > 0) {
                examModeState.currentQuestionIndex--;
                return { success: true, index: examModeState.currentQuestionIndex };
            }
            return { success: false, reason: 'at_start' };
        },
        
        async selectOption(index) {
            const question = this.getCurrentQuestion();
            if (!question) return { success: false };
            
            const response = question.type === 'mcq_multi'
                ? { selectedIndices: [index] }
                : { selectedIndex: index };
            
            examModeState.currentSitting = recordSittingResponse(
                examModeState.currentSitting,
                question.id,
                response
            );
            
            await saveDataToDB('examSittings', examModeState.currentSitting);
            
            return { success: true, response };
        },
        
        async submitAnswer() {
            // Auto-advance to next question
            return this.nextQuestion();
        },
        
        async flagQuestion() {
            const question = this.getCurrentQuestion();
            if (!question) return { success: false };
            
            const flagged = examModeState.currentSitting.flagged || [];
            const isFlagged = flagged.includes(question.id);
            
            if (isFlagged) {
                examModeState.currentSitting.flagged = flagged.filter(id => id !== question.id);
            } else {
                examModeState.currentSitting.flagged = [...flagged, question.id];
            }
            
            await saveDataToDB('examSittings', examModeState.currentSitting);
            
            return { success: true, flagged: !isFlagged };
        },
        
        async submitExam() {
            this.stopTimer();
            
            examModeState.currentSitting = submitExamSitting(examModeState.currentSitting);
            await saveDataToDB('examSittings', examModeState.currentSitting);
            
            // Grade all responses
            const results = await this.gradeAllResponses();
            
            // Update atom states
            for (const result of results) {
                if (result.markingRecordId) {
                    await applyMarkingRecordToAtoms({
                        markingRecordId: result.markingRecordId
                    });
                }
            }
            
            return {
                success: true,
                results,
                totalMarks: results.reduce((sum, r) => sum + (r.awardedMarks || 0), 0)
            };
        },
        
        async gradeAllResponses() {
            const results = [];
            const responses = examModeState.currentSitting?.responses || {};
            
            for (const [questionId, response] of Object.entries(responses)) {
                if (response === null) continue;
                
                const question = examModeState.questions.find(q => q.id === questionId);
                if (!question) continue;
                
                const markScheme = question.markSchemeId
                    ? await getDataFromDB('markSchemes', question.markSchemeId)
                    : null;
                
                if (!markScheme) continue;
                
                const gradeResult = gradeQuestion({
                    question,
                    markScheme,
                    response,
                    context: { examSittingId: examModeState.currentSitting.id }
                });
                
                await saveDataToDB('markingRecords', gradeResult);
                
                results.push({
                    questionId,
                    awardedMarks: gradeResult.totalAwardedMarks,
                    markingRecordId: gradeResult.id,
                    confidence: gradeResult.confidence
                });
            }
            
            return results;
        },
        
        async pauseExam() {
            this.stopTimer();
            
            examModeState.currentSitting.status = 'paused';
            examModeState.currentSitting.pausedAt = new Date().toISOString();
            await saveDataToDB('examSittings', examModeState.currentSitting);
            
            return { success: true };
        },
        
        async resumeExam() {
            examModeState.currentSitting.status = 'in_progress';
            examModeState.currentSitting.pausedAt = null;
            await saveDataToDB('examSittings', examModeState.currentSitting);
            
            if (examModeState.currentPaper?.navigation?.showTimer) {
                this.startTimer();
            }
            
            return { success: true };
        },
        
        getState() {
            return {
                isActive: examModeState.isActive,
                sitting: examModeState.currentSitting,
                paper: examModeState.currentPaper,
                spec: examModeState.currentExamSpec,
                currentIndex: examModeState.currentQuestionIndex,
                currentQuestion: this.getCurrentQuestion(),
                remainingSeconds: examModeState.currentSitting?.remainingSeconds || 0
            };
        },
        
        async finish() {
            return this.teardown();
        },
        
        teardown() {
            this.stopTimer();
            
            if (examModeState.keyboardHandler) {
                document.removeEventListener('keydown', examModeState.keyboardHandler);
                examModeState.keyboardHandler = null;
            }
            
            examModeState.isActive = false;
            examModeState.currentExamSpec = null;
            examModeState.currentPaper = null;
            examModeState.currentSitting = null;
            
            return { success: true };
        },
        
        // --- Prediction and Planning APIs ---
        
        async getPrediction(examDate) {
            const targetDate = examDate ? new Date(examDate) : new Date();
            const now = new Date();
            
            return predictExamScore(
                examModeState.currentExamSpec || createExamSpec({}),
                examModeState.questions,
                examModeState.atoms,
                now,
                targetDate
            );
        },
        
        async getCompleteness(targetScore = 70) {
            const now = new Date();
            const examDate = examModeState.currentExamSpec?.examDate
                ? new Date(examModeState.currentExamSpec.examDate)
                : now;
            
            return computeRevisionCompleteness(
                examModeState.currentExamSpec || createExamSpec({}),
                examModeState.atoms,
                now,
                examDate,
                targetScore
            );
        },
        
        async getTimeEstimate(targetScore = 70) {
            const now = new Date();
            const examDate = examModeState.currentExamSpec?.examDate
                ? new Date(examModeState.currentExamSpec.examDate)
                : now;
            
            return estimateTimeToTarget(
                examModeState.currentExamSpec || createExamSpec({}),
                examModeState.atoms,
                now,
                examDate,
                targetScore
            );
        },
        
        async getRankedPractice() {
            const now = new Date();
            const examDate = examModeState.currentExamSpec?.examDate
                ? new Date(examModeState.currentExamSpec.examDate)
                : now;
            
            return rankQuestionsForPractice(
                examModeState.questions,
                examModeState.atoms,
                now,
                examDate
            );
        },
        
        async getOptimalSession(options = {}) {
            const now = new Date();
            const examDate = examModeState.currentExamSpec?.examDate
                ? new Date(examModeState.currentExamSpec.examDate)
                : now;
            
            return composeOptimalSession(
                examModeState.questions,
                examModeState.atoms,
                now,
                examDate,
                options
            );
        }
    };
}

/**
 * Keyboard shortcuts reference
 */
export { EXAM_MODE_SHORTCUTS };

export default createExamModeAdapter;
