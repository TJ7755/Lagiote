/**
 * Calibration Harness - Grading Consistency and System Validation
 * 
 * Provides tools for:
 * - Inter-rater reliability testing
 * - Mark scheme validation
 * - Grading consistency checks
 * - System drift detection
 * - Golden response testing
 */

import { generateUUID } from './exam-mode.js';
import { gradeQuestion } from './marking.js';
import { aiGradingAssistant } from './ai-grading-assistant.js';

// --- Golden Response Testing ---

/**
 * Pre-defined responses with known correct marks for testing.
 */
export const GOLDEN_RESPONSES = {
    mcq_single: [
        {
            name: 'Correct selection',
            response: { selectedIndex: 1 },
            expectedMarks: 1,
            expectedPoints: [{ pointId: 'A1', marks: 1 }]
        },
        {
            name: 'Wrong selection',
            response: { selectedIndex: 0 },
            expectedMarks: 0,
            expectedPoints: [{ pointId: 'A1', marks: 0 }]
        },
        {
            name: 'No selection',
            response: { selectedIndex: -1 },
            expectedMarks: 0,
            expectedPoints: [{ pointId: 'A1', marks: 0 }]
        }
    ],
    numeric: [
        {
            name: 'Exact correct',
            response: { value: 10, unit: 'm' },
            expectedMarks: 1,
            tolerance: 0
        },
        {
            name: 'Within tolerance',
            response: { value: 10.4, unit: 'm' },
            expectedMarks: 1,
            tolerance: 0.5
        },
        {
            name: 'Outside tolerance',
            response: { value: 11, unit: 'm' },
            expectedMarks: 0,
            tolerance: 0.5
        },
        {
            name: 'Wrong unit',
            response: { value: 10, unit: 'cm' },
            expectedMarks: 0,
            tolerance: 0
        }
    ],
    short_text: [
        {
            name: 'Exact match',
            response: { text: 'photosynthesis' },
            expectedMarks: 1
        },
        {
            name: 'Case insensitive match',
            response: { text: 'Photosynthesis' },
            expectedMarks: 1
        },
        {
            name: 'Wrong answer',
            response: { text: 'respiration' },
            expectedMarks: 0
        }
    ]
};

/**
 * Runs golden response tests to validate grading consistency.
 * @param {Object} markScheme Mark scheme to test
 * @param {Object} question Question to test
 * @returns {Object} Test results
 */
export function runGoldenTests(markScheme, question) {
    const results = [];
    const goldenSet = GOLDEN_RESPONSES[question?.type];
    
    if (!goldenSet) {
        return { passed: false, error: 'No golden responses for question type', results: [] };
    }
    
    let passed = 0;
    let failed = 0;
    
    goldenSet.forEach(test => {
        const gradeResult = gradeQuestion({
            question,
            markScheme,
            response: test.response
        });
        
        const matches = gradeResult.totalAwardedMarks === test.expectedMarks;
        
        const result = {
            testName: test.name,
            passed: matches,
            expectedMarks: test.expectedMarks,
            actualMarks: gradeResult.totalAwardedMarks,
            response: test.response,
            gradeResult: matches ? null : gradeResult
        };
        
        results.push(result);
        
        if (matches) passed++;
        else failed++;
    });
    
    return {
        passed: failed === 0,
        passedCount: passed,
        failedCount: failed,
        totalTests: results.length,
        passRate: passed / results.length,
        results
    };
}

// --- Inter-Rater Reliability ---

/**
 * Calculates Cohen's Kappa for inter-rater agreement.
 * @param {Array} rater1Marks Marks from rater 1
 * @param {Array} rater2Marks Marks from rater 2
 * @returns {Object} Kappa statistics
 */
export function calculateCohensKappa(rater1Marks, rater2Marks) {
    if (rater1Marks.length !== rater2Marks.length || rater1Marks.length === 0) {
        return { error: 'Invalid input arrays' };
    }
    
    const n = rater1Marks.length;
    
    // Create agreement matrix (simplified for binary: agree/disagree)
    let agreements = 0;
    const categories = new Set([...rater1Marks, ...rater2Marks]);
    const catArray = Array.from(categories);
    
    // For each possible mark value
    const matrix = {};
    catArray.forEach(c1 => {
        matrix[c1] = {};
        catArray.forEach(c2 => {
            matrix[c1][c2] = 0;
        });
    });
    
    for (let i = 0; i < n; i++) {
        matrix[rater1Marks[i]][rater2Marks[i]]++;
        if (rater1Marks[i] === rater2Marks[i]) agreements++;
    }
    
    // Observed agreement (Po)
    const po = agreements / n;
    
    // Expected agreement by chance (Pe)
    let pe = 0;
    catArray.forEach(c => {
        const rowSum = catArray.reduce((sum, c2) => sum + matrix[c][c2], 0);
        const colSum = catArray.reduce((sum, c1) => sum + matrix[c1][c], 0);
        pe += (rowSum / n) * (colSum / n);
    });
    
    // Cohen's Kappa
    const kappa = (po - pe) / (1 - pe);
    
    // Interpretation
    let interpretation;
    if (kappa < 0) interpretation = 'poor';
    else if (kappa < 0.2) interpretation = 'slight';
    else if (kappa < 0.4) interpretation = 'fair';
    else if (kappa < 0.6) interpretation = 'moderate';
    else if (kappa < 0.8) interpretation = 'substantial';
    else interpretation = 'almost_perfect';
    
    return {
        kappa: Math.round(kappa * 1000) / 1000,
        observedAgreement: Math.round(po * 1000) / 1000,
        expectedAgreement: Math.round(pe * 1000) / 1000,
        interpretation,
        sampleSize: n,
        isAcceptable: kappa >= 0.6
    };
}

/**
 * Tests agreement between human and AI grading.
 * @param {Array} humanMarks Array of human grading results
 * @param {Array} aiMarks Array of AI assistant suggestions
 * @returns {Object} Agreement analysis
 */
export function testHumanAIAgreement(humanMarks, aiMarks) {
    const humanTotal = humanMarks.map(m => m.totalAwardedMarks);
    const aiSuggested = aiMarks.map(m => m.suggestions?.reduce((s, sug) => s + sug.suggestedAward, 0) || 0);
    
    const kappa = calculateCohensKappa(humanTotal, aiSuggested);
    
    // Detailed comparison
    const comparisons = humanMarks.map((h, i) => ({
        questionId: h.questionId,
        humanMarks: h.totalAwardedMarks,
        aiSuggestion: aiSuggested[i],
        difference: Math.abs(h.totalAwardedMarks - aiSuggested[i]),
        agreed: h.totalAwardedMarks === aiSuggested[i]
    }));
    
    const exactAgreements = comparisons.filter(c => c.agreed).length;
    const withinOneMark = comparisons.filter(c => c.difference <= 1).length;
    
    return {
        cohensKappa: kappa,
        exactAgreementRate: exactAgreements / comparisons.length,
        withinOneMarkRate: withinOneMark / comparisons.length,
        comparisons: comparisons.slice(0, 10), // First 10 for detail
        recommendation: kappa.kappa >= 0.6 
            ? 'AI suggestions are reliable for this mark scheme'
            : 'AI suggestions need calibration - review disagreements'
    };
}

// --- Mark Scheme Validation ---

/**
 * Validates a mark scheme for consistency and completeness.
 * @param {Object} markScheme Mark scheme to validate
 * @param {Object} question Associated question
 * @returns {Object} Validation results
 */
export function validateMarkScheme(markScheme, question) {
    const issues = [];
    const warnings = [];
    
    if (!markScheme) {
        return { valid: false, issues: ['No mark scheme provided'] };
    }
    
    // Check points exist
    if (!markScheme.points || markScheme.points.length === 0) {
        issues.push('Mark scheme has no points defined');
    } else {
        // Validate each point
        markScheme.points.forEach((point, idx) => {
            const pointId = point.id || point.pointId;
            
            if (!pointId) {
                issues.push(`Point ${idx} has no ID`);
            }
            
            if (!point.marks && point.marks !== 0) {
                warnings.push(`Point ${pointId} has no marks defined`);
            }
            
            // Check dependencies exist
            if (point.requires?.length > 0) {
                point.requires.forEach(reqId => {
                    const exists = markScheme.points.some(p => (p.id || p.pointId) === reqId);
                    if (!exists) {
                        issues.push(`Point ${pointId} requires non-existent point ${reqId}`);
                    }
                });
            }
            
            // Check grading configuration
            if (!point.grading && markScheme.schemeType === 'points') {
                warnings.push(`Point ${pointId} has no grading configuration`);
            }
        });
        
        // Check for circular dependencies
        const cycles = detectCircularDependencies(markScheme.points);
        if (cycles.length > 0) {
            issues.push(`Circular dependencies detected: ${cycles.join(', ')}`);
        }
    }
    
    // Check total marks match question
    if (question?.marksAvailable) {
        const schemeTotal = markScheme.points?.reduce((sum, p) => sum + (p.marks || 0), 0);
        if (schemeTotal !== question.marksAvailable) {
            warnings.push(`Scheme total (${schemeTotal}) does not match question marks (${question.marksAvailable})`);
        }
    }
    
    return {
        valid: issues.length === 0,
        issues,
        warnings,
        pointCount: markScheme.points?.length || 0,
        totalMarks: markScheme.points?.reduce((sum, p) => sum + (p.marks || 0), 0) || 0
    };
}

function detectCircularDependencies(points) {
    const cycles = [];
    const visited = new Set();
    
    points.forEach(point => {
        const path = [];
        const pointId = point.id || point.pointId;
        
        function dfs(currentId, path) {
            if (path.includes(currentId)) {
                const cycleStart = path.indexOf(currentId);
                cycles.push(path.slice(cycleStart).concat([currentId]).join(' → '));
                return;
            }
            
            if (visited.has(currentId)) return;
            
            const p = points.find(pt => (pt.id || pt.pointId) === currentId);
            if (!p?.requires?.length) return;
            
            p.requires.forEach(reqId => {
                dfs(reqId, [...path, currentId]);
            });
        }
        
        dfs(pointId, []);
        visited.add(pointId);
    });
    
    return [...new Set(cycles)];
}

// --- System Drift Detection ---

/**
 * Detects grading drift over time.
 * @param {Array} gradingHistory Array of grading results over time
 * @returns {Object} Drift analysis
 */
export function detectGradingDrift(gradingHistory) {
    if (gradingHistory.length < 10) {
        return { sufficientData: false, message: 'Need at least 10 grading sessions' };
    }
    
    // Sort by date
    const sorted = [...gradingHistory].sort((a, b) => 
        new Date(a.timestamp) - new Date(b.timestamp)
    );
    
    // Split into early and recent
    const midPoint = Math.floor(sorted.length / 2);
    const early = sorted.slice(0, midPoint);
    const recent = sorted.slice(midPoint);
    
    // Compare average marks
    const earlyAvg = early.reduce((s, g) => s + g.averageMarks, 0) / early.length;
    const recentAvg = recent.reduce((s, g) => s + g.averageMarks, 0) / recent.length;
    
    const drift = recentAvg - earlyAvg;
    const driftPercent = (drift / earlyAvg) * 100;
    
    let driftDirection;
    if (Math.abs(driftPercent) < 5) driftDirection = 'stable';
    else if (driftPercent > 0) driftDirection = 'lenient';
    else driftDirection = 'strict';
    
    return {
        sufficientData: true,
        driftDirection,
        driftAmount: Math.round(drift * 100) / 100,
        driftPercent: Math.round(driftPercent * 10) / 10,
        earlyAverage: Math.round(earlyAvg * 100) / 100,
        recentAverage: Math.round(recentAvg * 100) / 100,
        needsRecalibration: Math.abs(driftPercent) > 10,
        recommendation: Math.abs(driftPercent) > 10 
            ? 'Significant drift detected - recalibrate marking standards'
            : 'Grading consistency is acceptable'
    };
}

// --- Comprehensive Test Suite ---

/**
 * Runs full calibration suite on a mark scheme.
 * @param {Object} markScheme Mark scheme to test
 * @param {Object} question Question to test
 * @returns {Object} Complete calibration report
 */
export function runCalibrationSuite(markScheme, question) {
    const report = {
        id: generateUUID(),
        timestamp: new Date().toISOString(),
        markSchemeId: markScheme?.id,
        questionId: question?.id,
        validations: {},
        goldenTests: {},
        recommendations: []
    };
    
    // 1. Validate mark scheme structure
    report.validations.structure = validateMarkScheme(markScheme, question);
    
    // 2. Run golden tests
    report.goldenTests = runGoldenTests(markScheme, question);
    
    // 3. Generate recommendations
    const recs = [];
    
    if (!report.validations.structure.valid) {
        recs.push({
            priority: 'critical',
            issue: 'Mark scheme has structural issues',
            fix: `Fix: ${report.validations.structure.issues.join(', ')}`
        });
    }
    
    if (report.goldenTests.passRate < 1) {
        recs.push({
            priority: 'high',
            issue: `Golden tests failing (${report.goldenTests.passRate * 100}% pass rate)`,
            fix: 'Review accept/reject lists and tolerances'
        });
    }
    
    if (report.validations.structure.warnings.length > 0) {
        recs.push({
            priority: 'medium',
            issue: `${report.validations.structure.warnings.length} warnings in mark scheme`,
            fix: 'Review warnings and improve scheme completeness'
        });
    }
    
    report.recommendations = recs;
    report.calibrated = recs.filter(r => r.priority === 'critical').length === 0;
    
    return report;
}

// --- Batch Calibration ---

/**
 * Calibrates multiple questions/mark schemes.
 * @param {Array} items Array of {question, markScheme} objects
 * @returns {Object} Batch calibration results
 */
export function runBatchCalibration(items) {
    const results = items.map(({ question, markScheme }) => ({
        questionId: question?.id,
        markSchemeId: markScheme?.id,
        result: runCalibrationSuite(markScheme, question)
    }));
    
    const calibrated = results.filter(r => r.result.calibrated).length;
    const needsWork = results.filter(r => !r.result.calibrated).length;
    
    return {
        totalItems: items.length,
        calibrated,
        needsWork,
        calibrationRate: calibrated / items.length,
        results: results.sort((a, b) => {
            const aCrit = a.result.recommendations.filter(r => r.priority === 'critical').length;
            const bCrit = b.result.recommendations.filter(r => r.priority === 'critical').length;
            return bCrit - aCrit; // Most critical first
        })
    };
}

// --- Export Module ---

export default {
    GOLDEN_RESPONSES,
    runGoldenTests,
    calculateCohensKappa,
    testHumanAIAgreement,
    validateMarkScheme,
    detectGradingDrift,
    runCalibrationSuite,
    runBatchCalibration
};
