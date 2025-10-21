// Test Mode Logic
import state, { DEFAULT_TEST_SETTINGS } from './state.js';
import { saveDataToDB } from './db.js';
import { showToast, shuffleArray, calculateIQS } from './utils.js';
import { showView, transitionSubView } from './ui.js';

// Initialize test session
export async function startTestSession(deckId) {
    state.currentDeckId = deckId;
    state.currentMode = 'test';
    const deck = state.decks[deckId];
    
    if (!deck) {
        showToast('Deck not found', 'error');
        return;
    }

    // Initialize test settings if not present
    deck.testSettings = { ...DEFAULT_TEST_SETTINGS, ...(deck.testSettings || {}) };

    // Initialize test state
    state.testState = {
        settings: deck.testSettings,
        startTime: new Date(),
        questions: generateQuestions(deck),
        currentQuestionIndex: 0,
        answers: [],
        score: 0,
        completed: false
    };

    showView('testMode');
    showNextQuestion();
}

// Question Generation
function generateQuestions(deck) {
    let questions = [];
    const cards = [...deck.cards];

    // Filter out cards based on settings
    const filteredCards = cards.filter(card => {
        if (state.testState.settings.excludeNew && card.isNew) return false;
        if (state.testState.settings.excludeLearned && card.sm2Data?.repetition > 2) return false;
        return true;
    });

    // Shuffle cards
    const shuffledCards = shuffleArray(filteredCards);

    // Take specified number of questions or all if limit not set
    const numQuestions = state.testState.settings.questionLimit || shuffledCards.length;
    const selectedCards = shuffledCards.slice(0, numQuestions);

    // Generate questions from cards
    selectedCards.forEach(card => {
        let question;
        if (state.testState.settings.questionType === 'multiple') {
            question = generateMultipleChoice(card, cards);
        } else {
            question = generateWrittenQuestion(card);
        }
        questions.push(question);
    });

    return questions;
}

function generateMultipleChoice(card, allCards) {
    const question = {
        type: 'multiple',
        cardId: card.id,
        question: card.front,
        correctAnswer: card.back,
        options: [card.back]
    };

    // Get other cards for distractors
    const otherCards = allCards.filter(c => c.id !== card.id);
    const shuffledDistractors = shuffleArray(otherCards);
    
    // Add distractors
    while (question.options.length < 4 && shuffledDistractors.length > 0) {
        const distractor = shuffledDistractors.pop().back;
        if (!question.options.includes(distractor)) {
            question.options.push(distractor);
        }
    }

    // Shuffle options
    question.options = shuffleArray(question.options);
    return question;
}

function generateWrittenQuestion(card) {
    return {
        type: 'written',
        cardId: card.id,
        question: card.front,
        correctAnswer: card.back
    };
}

// Question Navigation
export function showNextQuestion() {
    if (state.testState.currentQuestionIndex >= state.testState.questions.length) {
        finishTest();
        return;
    }

    const question = state.testState.questions[state.testState.currentQuestionIndex];
    displayQuestion(question);
}

function displayQuestion(question) {
    const questionContainer = document.getElementById('questionContainer');
    const questionNumber = state.testState.currentQuestionIndex + 1;
    const totalQuestions = state.testState.questions.length;

    // Update progress display
    document.getElementById('testProgress').textContent = 
        `Question ${questionNumber} of ${totalQuestions}`;

    // Clear previous question
    questionContainer.innerHTML = '';

    // Display question text
    const questionText = document.createElement('div');
    questionText.className = 'question-text';
    questionText.textContent = question.question;
    questionContainer.appendChild(questionText);

    // Create answer input based on question type
    if (question.type === 'multiple') {
        createMultipleChoiceInput(question, questionContainer);
    } else {
        createWrittenInput(questionContainer);
    }
}

function createMultipleChoiceInput(question, container) {
    const optionsContainer = document.createElement('div');
    optionsContainer.className = 'options-container';

    question.options.forEach((option, index) => {
        const optionDiv = document.createElement('div');
        optionDiv.className = 'option';
        
        const radio = document.createElement('input');
        radio.type = 'radio';
        radio.name = 'answer';
        radio.value = option;
        radio.id = `option${index}`;

        const label = document.createElement('label');
        label.htmlFor = `option${index}`;
        label.textContent = option;

        optionDiv.appendChild(radio);
        optionDiv.appendChild(label);
        optionsContainer.appendChild(optionDiv);
    });

    container.appendChild(optionsContainer);

    // Add submit button
    const submitBtn = document.createElement('button');
    submitBtn.textContent = 'Submit Answer';
    submitBtn.onclick = () => submitAnswer();
    container.appendChild(submitBtn);
}

function createWrittenInput(container) {
    const inputContainer = document.createElement('div');
    inputContainer.className = 'input-container';

    const textArea = document.createElement('textarea');
    textArea.className = 'written-answer';
    textArea.placeholder = 'Type your answer here...';
    
    const submitBtn = document.createElement('button');
    submitBtn.textContent = 'Submit Answer';
    submitBtn.onclick = () => submitAnswer();

    inputContainer.appendChild(textArea);
    inputContainer.appendChild(submitBtn);
    container.appendChild(inputContainer);
}

// Answer Handling
export function submitAnswer() {
    const question = state.testState.questions[state.testState.currentQuestionIndex];
    let userAnswer;

    if (question.type === 'multiple') {
        const selectedOption = document.querySelector('input[name="answer"]:checked');
        if (!selectedOption) {
            showToast('Please select an answer', 'warning');
            return;
        }
        userAnswer = selectedOption.value;
    } else {
        const textArea = document.querySelector('.written-answer');
        if (!textArea.value.trim()) {
            showToast('Please enter an answer', 'warning');
            return;
        }
        userAnswer = textArea.value.trim();
    }

    // Calculate score
    const correct = evaluateAnswer(userAnswer, question.correctAnswer);
    const score = calculateScore(correct, question.type);

    // Store answer
    state.testState.answers.push({
        questionIndex: state.testState.currentQuestionIndex,
        cardId: question.cardId,
        userAnswer,
        correctAnswer: question.correctAnswer,
        correct,
        score
    });

    // Update total score
    state.testState.score += score;

    // Show feedback
    showAnswerFeedback(correct, question.correctAnswer);

    // Move to next question
    state.testState.currentQuestionIndex++;
}

function evaluateAnswer(userAnswer, correctAnswer) {
    // For multiple choice, exact match
    if (state.testState.settings.questionType === 'multiple') {
        return userAnswer === correctAnswer;
    }

    // For written answers, use IQS
    const similarity = calculateIQS(userAnswer.toLowerCase(), correctAnswer.toLowerCase());
    return similarity >= state.testState.settings.similarityThreshold;
}

function calculateScore(correct, questionType) {
    if (questionType === 'multiple') {
        return correct ? 1 : 0;
    }
    
    // Written questions may have partial credit based on similarity
    const similarity = calculateIQS(userAnswer.toLowerCase(), correctAnswer.toLowerCase());
    return Math.round(similarity * 100) / 100;
}

function showAnswerFeedback(correct, correctAnswer) {
    const feedbackContainer = document.getElementById('feedbackContainer');
    feedbackContainer.innerHTML = '';

    const feedback = document.createElement('div');
    feedback.className = `feedback ${correct ? 'correct' : 'incorrect'}`;
    
    feedback.innerHTML = `
        <h3>${correct ? 'Correct!' : 'Incorrect'}</h3>
        <p>The correct answer was: ${correctAnswer}</p>
    `;

    const nextBtn = document.createElement('button');
    nextBtn.textContent = 'Next Question';
    nextBtn.onclick = () => {
        feedbackContainer.innerHTML = '';
        showNextQuestion();
    };

    feedback.appendChild(nextBtn);
    feedbackContainer.appendChild(feedback);
}

// Test Completion
async function finishTest() {
    state.testState.completed = true;
    state.testState.endTime = new Date();

    // Calculate final score
    const finalScore = calculateFinalScore();
    
    // Save test results
    await saveTestResults(finalScore);

    // Show results
    showTestResults(finalScore);
}

function calculateFinalScore() {
    const maxScore = state.testState.questions.length;
    const userScore = state.testState.score;
    return {
        score: userScore,
        maxScore,
        percentage: Math.round((userScore / maxScore) * 100),
        timeSpent: (state.testState.endTime - state.testState.startTime) / 1000,
        answers: state.testState.answers
    };
}

async function saveTestResults(results) {
    const deck = state.decks[state.currentDeckId];
    if (!deck.testHistory) deck.testHistory = [];
    
    deck.testHistory.push({
        timestamp: new Date().toISOString(),
        score: results.score,
        maxScore: results.maxScore,
        percentage: results.percentage,
        timeSpent: results.timeSpent,
        settings: state.testState.settings
    });

    await saveDataToDB('decks', deck);
}

function showTestResults(results) {
    const resultsContainer = document.getElementById('resultsContainer');
    resultsContainer.innerHTML = `
        <div class="test-results">
            <h2>Test Complete!</h2>
            <div class="score-display">
                <div class="score-number">${results.percentage}%</div>
                <div class="score-details">
                    Score: ${results.score}/${results.maxScore}
                </div>
                <div class="time-spent">
                    Time: ${Math.round(results.timeSpent)}s
                </div>
            </div>
            <div class="answer-summary">
                ${generateAnswerSummary(results.answers)}
            </div>
            <button onclick="window.location.reload()">Back to Deck</button>
        </div>
    `;
}

function generateAnswerSummary(answers) {
    return answers.map((answer, index) => `
        <div class="answer-item ${answer.correct ? 'correct' : 'incorrect'}">
            <div class="question-number">Q${index + 1}</div>
            <div class="answer-details">
                <div>Your answer: ${answer.userAnswer}</div>
                <div>Correct: ${answer.correctAnswer}</div>
            </div>
            <div class="score-badge">${answer.score}</div>
        </div>
    `).join('');
}