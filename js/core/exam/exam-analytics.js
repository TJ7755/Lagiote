/**
 * Exam Analytics Module - Mark-Loss Attribution and Performance Analysis
 * 
 * Implements Phase 12 analytics features:
 * - Mark-loss attribution by type (knowledge, technique, timing, etc.)
 * - Command word analysis
 * - Time sink identification
 * - Fragility tracking
 * - Weak area trends over time
 */

import { generateUUID } from './exam-mode.js';
import { clamp01 } from './atom-dynamics.js';

// --- Mark-Loss Attribution ---

/**
 * Categories of mark loss.
 */
export const MARK_LOSS_CATEGORIES = {
    KNOWLEDGE_GAP: 'knowledge_gap',      // Didn't know the content
    METHOD_ERROR: 'method_error',        // Wrong approach
    CALCULATION_ERROR: 'calculation',    // Arithmetic slip
    UNITS_ERROR: 'units',                // Wrong/missing units
    READING_ERROR: 'reading',            // Misread question
    TECHNIQUE_ERROR: 'technique',        // Exam technique issue
    TIME_PRESSURE: 'time_pressure',      // Ran out of time
    CARELESSNESS: 'carelessness',        // Silly mistake
    COMPLEXITY: 'complexity'             // Question too complex
};

/**
 * Command words and their cognitive demands.
 */
export const COMMAND_WORDS = {
    low_demand: ['state', 'list', 'name', 'identify', 'give', 'define', 'what', 'when', 'where'],
    medium_demand: ['describe', 'explain', 'outline', 'compare', 'contrast', 'distinguish'],
    high_demand: ['analyse', 'evaluate', 'assess', 'discuss', 'justify', 'to what extent', 'synthesise', 'critique']
};

/**
 * Analyzes a single marking record for mark-loss patterns.
 * @param {Object} markingRecord The marking record
 * @param {Object} question Associated question
 * @param {Object} markScheme Associated mark scheme
 * @returns {Object} Mark-loss analysis
 */
export function analyseMarkLoss(markingRecord, question, markScheme) {
    if (!markingRecord?.awardedPoints) {
        return null;
    }
    
    const awardedPoints = markingRecord.awardedPoints;
    const totalPoints = markScheme?.points || [];
    const losses = [];
    
    totalPoints.forEach(point => {
        const pointId = point.id || point.pointId;
        const awarded = awardedPoints.find(ap => ap.pointId === pointId);
        
        let marksAwarded;
        let isNotEvaluated = false;
        
        if (!awarded) {
            // Point is completely missing from awardedPoints - track as not evaluated
            marksAwarded = 0;
            isNotEvaluated = true;
        } else {
            marksAwarded = awarded.awardedMarks || 0;
        }
        
        const marksAvailable = point.marks || 1;
        
        if (marksAwarded < marksAvailable) {
            const loss = isNotEvaluated 
                ? { category: MARK_LOSS_CATEGORIES.KNOWLEDGE_GAP, reason: 'Point not evaluated or missing from grading' }
                : classifyPointLoss(point, marksAwarded, question, markingRecord);
            
            losses.push({
                pointId,
                marksLost: marksAvailable - marksAwarded,
                category: loss.category,
                reason: loss.reason,
                atomIds: point.atomLinks?.map(l => l.atomId) || []
            });
        }
    });
    
    return {
        questionId: question?.id,
        totalMarksAvailable: totalPoints.reduce((sum, p) => sum + (p.marks || 1), 0),
        totalMarksAwarded: markingRecord.totalAwardedMarks || 0,
        losses,
        lossRate: losses.length / (totalPoints.length || 1)
    };
}

function classifyPointLoss(point, marksAwarded, question, record) {
    const pointId = point.id || point.pointId;
    
    // Method marks not awarded
    if (/^M\d+$/.test(pointId) && marksAwarded === 0) {
        return {
            category: MARK_LOSS_CATEGORIES.METHOD_ERROR,
            reason: 'Method not shown or incorrect approach'
        };
    }
    
    // Accuracy marks not awarded (but method was)
    if (/^A\d+$/.test(pointId) && marksAwarded === 0) {
        return {
            category: MARK_LOSS_CATEGORIES.CALCULATION_ERROR,
            reason: 'Calculation error or wrong final answer'
        };
    }
    
    // Reasoning marks
    if (/^R\d+$/.test(pointId) && marksAwarded === 0) {
        return {
            category: MARK_LOSS_CATEGORIES.TECHNIQUE_ERROR,
            reason: 'Insufficient explanation or reasoning'
        };
    }
    
    // Units check
    if (question?.type === 'numeric' && marksAwarded === 0) {
        return {
            category: MARK_LOSS_CATEGORIES.UNITS_ERROR,
            reason: 'Missing or incorrect units'
        };
    }
    
    return {
        category: MARK_LOSS_CATEGORIES.KNOWLEDGE_GAP,
        reason: 'General knowledge or understanding gap'
    };
}

/**
 * Aggregates mark-loss analysis across multiple sittings.
 * @param {Array} analyses Array of mark-loss analyses
 * @returns {Object} Aggregated statistics
 */
export function aggregateMarkLoss(analyses) {
    if (!analyses?.length) {
        return null;
    }
    
    const categoryTotals = {};
    const atomLosses = new Map();
    let totalMarksLost = 0;
    let totalMarksAvailable = 0;
    
    analyses.forEach(analysis => {
        totalMarksAvailable += analysis.totalMarksAvailable;
        totalMarksLost += analysis.totalMarksAvailable - analysis.totalMarksAwarded;
        
        analysis.losses.forEach(loss => {
            // Category aggregation
            categoryTotals[loss.category] = (categoryTotals[loss.category] || 0) + loss.marksLost;
            
            // Atom aggregation
            loss.atomIds.forEach(atomId => {
                const current = atomLosses.get(atomId) || { marksLost: 0, occurrences: 0 };
                current.marksLost += loss.marksLost;
                current.occurrences++;
                atomLosses.set(atomId, current);
            });
        });
    });
    
    // Sort by impact
    const categoryBreakdown = Object.entries(categoryTotals)
        .map(([category, marks]) => ({ category, marks, percentage: (marks / totalMarksLost) * 100 }))
        .sort((a, b) => b.marks - a.marks);
    
    const topProblemAtoms = Array.from(atomLosses.entries())
        .map(([atomId, data]) => ({ atomId, ...data }))
        .sort((a, b) => b.marksLost - a.marksLost)
        .slice(0, 10);
    
    return {
        totalMarksLost,
        totalMarksAvailable,
        overallLossRate: totalMarksLost / totalMarksAvailable,
        categoryBreakdown,
        topProblemAtoms,
        sampleSize: analyses.length
    };
}

// --- Command Word Analysis ---

/**
 * Analyses command word usage and performance.
 * @param {Array} questions Array of questions with responses
 * @param {Array} markingRecords Associated marking records
 * @returns {Object} Command word analysis
 */
export function analyseCommandWords(questions, markingRecords) {
    const commandPerformance = {};
    
    questions.forEach((question, idx) => {
        const command = extractCommandWord(question.prompt);
        if (!command) return;
        
        const record = markingRecords[idx];
        if (!record) return;
        
        if (!commandPerformance[command]) {
            commandPerformance[command] = {
                command,
                demandLevel: getCommandDemand(command),
                attempts: 0,
                totalMarks: 0,
                marksAwarded: 0
            };
        }
        
        const perf = commandPerformance[command];
        perf.attempts++;
        perf.totalMarks += question.marksAvailable || 1;
        perf.marksAwarded += record.totalAwardedMarks || 0;
    });
    
    // Calculate averages and sort
    const results = Object.values(commandPerformance).map(p => ({
        ...p,
        averageScore: p.marksAwarded / p.totalMarks,
        averageMarks: p.marksAwarded / p.attempts
    })).sort((a, b) => a.averageScore - b.averageScore);
    
    // Identify weak command words
    const weakCommands = results.filter(r => r.averageScore < 0.7 && r.attempts >= 1);
    
    return {
        commandBreakdown: results,
        weakCommands,
        recommendation: weakCommands.length > 0 
            ? `Focus on practicing "${weakCommands[0].command}" questions (${Math.round(weakCommands[0].averageScore * 100)}% average)`
            : 'Command word performance is balanced'
    };
}

function extractCommandWord(prompt) {
    if (!prompt) return null;
    const text = prompt.toLowerCase();
    
    for (const level of ['high_demand', 'medium_demand', 'low_demand']) {
        for (const word of COMMAND_WORDS[level]) {
            if (text.includes(word)) return word;
        }
    }
    return null;
}

function getCommandDemand(command) {
    if (COMMAND_WORDS.high_demand.includes(command)) return 'high';
    if (COMMAND_WORDS.medium_demand.includes(command)) return 'medium';
    return 'low';
}

// --- Time Analysis ---

/**
 * Analyses time usage patterns.
 * @param {Array} sittings Array of exam sittings with timing data
 * @returns {Object} Time analysis
 */
export function analyseTimeUsage(sittings) {
    if (!sittings?.length) return null;
    
    const questionTimes = [];
    const phaseTimes = {};
    
    sittings.forEach(sitting => {
        if (!sitting.timing) return;
        
        Object.entries(sitting.timing).forEach(([questionId, timing]) => {
            questionTimes.push({
                questionId,
                seconds: timing.totalSeconds || 0,
                attempts: timing.attempts || 1
            });
        });
    });
    
    if (questionTimes.length === 0) return null;
    
    // Calculate statistics
    const times = questionTimes.map(qt => qt.seconds);
    const avgTime = times.reduce((a, b) => a + b, 0) / times.length;
    const maxTime = Math.max(...times);
    const minTime = Math.min(...times);
    
    // Identify time sinks (top 10% by time)
    const sorted = [...times].sort((a, b) => b - a);
    const threshold = sorted[Math.floor(sorted.length * 0.1)] || maxTime;
    const timeSinks = questionTimes.filter(qt => qt.seconds >= threshold);
    
    // Identify rushed questions (bottom 10% by time, less than expected)
    const rushedThreshold = sorted[Math.floor(sorted.length * 0.9)] || minTime;
    const rushedQuestions = questionTimes.filter(qt => qt.seconds <= rushedThreshold && qt.seconds < 30);
    
    return {
        averageTimePerQuestion: avgTime,
        maxTimeObserved: maxTime,
        minTimeObserved: minTime,
        timeSinks: timeSinks.slice(0, 5),
        rushedQuestions: rushedQuestions.slice(0, 5),
        timeEfficiency: calculateTimeEfficiency(questionTimes),
        recommendation: generateTimeRecommendation(timeSinks.length, rushedQuestions.length)
    };
}

function calculateTimeEfficiency(questionTimes) {
    // Efficiency = appropriate time spent (not too fast, not too slow)
    const appropriate = questionTimes.filter(qt => {
        const t = qt.seconds;
        return t >= 30 && t <= 300; // Between 30s and 5min
    }).length;
    
    return appropriate / (questionTimes.length || 1);
}

function generateTimeRecommendation(sinkCount, rushedCount) {
    if (sinkCount > 2) {
        return 'Some questions are taking too long - consider skipping and returning';
    } else if (rushedCount > 3) {
        return 'Many questions rushed - practice pacing and time management';
    }
    return 'Time management is balanced';
}

// --- Fragility Analysis ---

/**
 * Analyses knowledge fragility (performance under variation).
 * @param {Array} atoms Array of atoms with fragility scores
 * @param {Array} questions Array of questions
 * @param {Map} atomsById Map of atoms by ID
 * @returns {Object} Fragility analysis
 */
export function analyseFragility(atoms, questions, atomsById) {
    if (!atoms?.length) return null;
    
    const fragileAtoms = atoms
        .filter(a => (a.fragility || 0) > 0.6)
        .map(a => ({
            atomId: a.id,
            name: a.name,
            fragility: a.fragility,
            mastery: a.mastery,
            type: a.type
        }))
        .sort((a, b) => b.fragility - a.fragility);
    
    // Find questions that test fragile atoms
    const fragileAtomIds = new Set(fragileAtoms.map(a => a.atomId));
    const relevantQuestions = questions.filter(q => 
        q.atomMap?.some(m => fragileAtomIds.has(m.atomId))
    );
    
    return {
        fragileAtomCount: fragileAtoms.length,
        fragileAtoms: fragileAtoms.slice(0, 10),
        relevantQuestions: relevantQuestions.length,
        riskLevel: fragileAtoms.length >= 5 ? 'high' : fragileAtoms.length >= 2 ? 'medium' : 'low',
        recommendation: fragileAtoms.length > 0
            ? `Practice varied questions on: ${fragileAtoms.slice(0, 3).map(a => a.name).join(', ')}`
            : 'Knowledge fragility is low - good retention'
    };
}

// --- Performance Trends ---

/**
 * Analyses performance trends over time.
 * @param {Array} sittings Array of sittings with dates and scores
 * @returns {Object} Trend analysis
 */
export function analyseTrends(sittings) {
    if (!sittings?.length) return null;
    
    const sorted = [...sittings].sort((a, b) => 
        new Date(a.createdAt) - new Date(b.createdAt)
    );
    
    const scores = sorted.map(s => ({
        date: s.createdAt,
        score: s.totalAwardedMarks / s.totalMarks * 100,
        percentage: (s.totalAwardedMarks / s.totalMarks) * 100
    }));
    
    if (scores.length < 2) {
        return { trend: 'insufficient_data', scores };
    }
    
    // Calculate trend
    const splitIndex = Math.ceil(scores.length / 2);
    const firstHalf = scores.slice(0, splitIndex);
    const secondHalf = scores.slice(splitIndex);
    
    const firstAvg = firstHalf.reduce((s, r) => s + r.percentage, 0) / firstHalf.length;
    const secondAvg = secondHalf.reduce((s, r) => s + r.percentage, 0) / secondHalf.length;
    
    const improvement = secondAvg - firstAvg;
    
    let trend;
    if (improvement > 10) trend = 'strong_improvement';
    else if (improvement > 5) trend = 'improving';
    else if (improvement > -5) trend = 'stable';
    else if (improvement > -10) trend = 'declining';
    else trend = 'strong_decline';
    
    return {
        trend,
        improvement: Math.round(improvement * 10) / 10,
        firstHalfAverage: Math.round(firstAvg * 10) / 10,
        secondHalfAverage: Math.round(secondAvg * 10) / 10,
        scores,
        recentAverage: Math.round(secondAvg * 10) / 10
    };
}

// --- Comprehensive Dashboard ---

/**
 * Generates comprehensive analytics dashboard data.
 * @param {Object} params Analytics parameters
 * @returns {Object} Complete analytics report
 */
export function generateAnalyticsDashboard({
    sittings = [],
    questions = [],
    markingRecords = [],
    atoms = [],
    examDate = null
}) {
    const atomsById = new Map(atoms.map(a => [a.id, a]));
    
    // Run all analyses
    const markLosses = markingRecords
        .map((mr, i) => analyseMarkLoss(mr, questions[i], mr.markScheme))
        .filter(Boolean);
    
    const aggregatedLoss = markLosses.length > 0 ? aggregateMarkLoss(markLosses) : null;
    const commandAnalysis = analyseCommandWords(questions, markingRecords);
    const timeAnalysis = analyseTimeUsage(sittings);
    const fragilityAnalysis = analyseFragility(atoms, questions, atomsById);
    const trendAnalysis = analyseTrends(sittings);
    
    // Generate recommendations
    const recommendations = generateRecommendations({
        aggregatedLoss,
        commandAnalysis,
        timeAnalysis,
        fragilityAnalysis,
        trendAnalysis,
        examDate
    });
    
    return {
        id: generateUUID(),
        generatedAt: new Date().toISOString(),
        summary: generateSummary(aggregatedLoss, trendAnalysis, atoms.length),
        markLossAttribution: aggregatedLoss,
        commandWordAnalysis: commandAnalysis,
        timeAnalysis,
        fragilityAnalysis,
        trends: trendAnalysis,
        recommendations,
        priorityActions: recommendations.filter(r => r.priority === 'high').slice(0, 5)
    };
}

function generateSummary(aggregatedLoss, trendAnalysis, atomCount) {
    const overallScore = trendAnalysis?.recentAverage || 0;
    
    return {
        overallScore: Math.round(overallScore),
        trend: trendAnalysis?.trend || 'unknown',
        marksLostRate: aggregatedLoss?.overallLossRate 
            ? Math.round(aggregatedLoss.overallLossRate * 100) 
            : 0,
        atomsTracked: atomCount,
        readiness: overallScore >= 70 ? 'good' : overallScore >= 50 ? 'moderate' : 'needs_work'
    };
}

function generateRecommendations(analyses) {
    const recommendations = [];
    
    // Mark loss recommendations
    if (analyses.aggregatedLoss?.categoryBreakdown?.length > 0) {
        const topLoss = analyses.aggregatedLoss.categoryBreakdown[0];
        recommendations.push({
            type: 'mark_loss',
            priority: topLoss.percentage > 30 ? 'high' : 'medium',
            message: `Focus on reducing ${topLoss.category.replace(/_/g, ' ')} (${Math.round(topLoss.percentage)}% of lost marks)`,
            action: getActionForCategory(topLoss.category)
        });
    }
    
    // Command word recommendations
    if (analyses.commandAnalysis?.weakCommands?.length > 0) {
        const weak = analyses.commandAnalysis.weakCommands[0];
        recommendations.push({
            type: 'command_word',
            priority: 'medium',
            message: analyses.commandAnalysis.recommendation,
            action: `Practice 5 "${weak.command}" questions`
        });
    }
    
    // Time recommendations
    if (analyses.timeAnalysis?.recommendation) {
        recommendations.push({
            type: 'time_management',
            priority: analyses.timeAnalysis.timeEfficiency < 0.6 ? 'high' : 'low',
            message: analyses.timeAnalysis.recommendation,
            action: 'Complete a timed practice paper'
        });
    }
    
    // Fragility recommendations
    if (analyses.fragilityAnalysis?.riskLevel === 'high') {
        recommendations.push({
            type: 'fragility',
            priority: 'high',
            message: analyses.fragilityAnalysis.recommendation,
            action: 'Use varied practice mode'
        });
    }
    
    // Trend recommendations
    if (analyses.trendAnalysis?.trend?.includes('decline')) {
        recommendations.push({
            type: 'trend',
            priority: 'high',
            message: 'Performance declining - review fundamentals',
            action: 'Schedule review session'
        });
    }
    
    // Exam date urgency
    if (analyses.examDate) {
        const daysLeft = Math.ceil((new Date(analyses.examDate) - new Date()) / (1000 * 60 * 60 * 24));
        if (daysLeft < 7 && daysLeft > 0) {
            recommendations.push({
                type: 'urgency',
                priority: 'high',
                message: `Exam in ${daysLeft} days - focus on weak areas only`,
                action: 'Start targeted practice session'
            });
        }
    }
    
    return recommendations.sort((a, b) => {
        const prioRank = { high: 3, medium: 2, low: 1 };
        return prioRank[b.priority] - prioRank[a.priority];
    });
}

function getActionForCategory(category) {
    const actions = {
        [MARK_LOSS_CATEGORIES.KNOWLEDGE_GAP]: 'Review topic notes and flashcards',
        [MARK_LOSS_CATEGORIES.METHOD_ERROR]: 'Practice showing working for method marks',
        [MARK_LOSS_CATEGORIES.CALCULATION_ERROR]: 'Practice mental arithmetic and calculator use',
        [MARK_LOSS_CATEGORIES.UNITS_ERROR]: 'Create unit conversion flashcards',
        [MARK_LOSS_CATEGORIES.READING_ERROR]: 'Practice underlining key question words',
        [MARK_LOSS_CATEGORIES.TECHNIQUE_ERROR]: 'Study mark schemes and command words',
        [MARK_LOSS_CATEGORIES.TIME_PRESSURE]: 'Practice with stricter time limits',
        [MARK_LOSS_CATEGORIES.CARELESSNESS]: 'Implement checking strategy',
        [MARK_LOSS_CATEGORIES.COMPLEXITY]: 'Break down complex problems step-by-step'
    };
    return actions[category] || 'Practice more questions';
}

// --- Export Module ---

export default {
    MARK_LOSS_CATEGORIES,
    COMMAND_WORDS,
    analyseMarkLoss,
    aggregateMarkLoss,
    analyseCommandWords,
    analyseTimeUsage,
    analyseFragility,
    analyseTrends,
    generateAnalyticsDashboard
};
