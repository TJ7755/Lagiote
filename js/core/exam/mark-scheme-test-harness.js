/**
 * Mark Scheme Test Harness
 * 
 * Interactive testing tool for mark schemes:
 * - Paste sample responses
 * - View scoring breakdown
 * - Debug accept/reject lists
 * - Validate point dependencies
 */

import { gradeQuestion } from './marking.js';
import { aiGradingAssistant } from './ai-grading-assistant.js';
import { validateMarkScheme, runGoldenTests } from './calibration-harness.js';
import { generateUUID } from './exam-mode.js';

/**
 * Creates a test harness instance for a mark scheme.
 * @param {Object} markScheme Mark scheme to test
 * @param {Object} question Associated question
 * @returns {Object} Test harness interface
 */
export function createMarkSchemeTestHarness(markScheme, question) {
    const history = [];
    
    return {
        /**
         * Tests a response against the mark scheme.
         * @param {string|Object} response Response to test
         * @param {Object} options Test options
         * @returns {Object} Detailed test result
         */
        testResponse(response, options = {}) {
            const startTime = performance.now();
            
            // Normalize text response if needed
            const normalizedResponse = typeof response === 'string' 
                ? normalizeTextResponse(response, question?.type)
                : response;
            
            // Grade the response
            const gradeResult = gradeQuestion({
                question,
                markScheme,
                response: normalizedResponse,
                context: { examSittingId: 'test_harness', questionId: question?.id }
            });
            
            // Get AI assistance if enabled
            let aiAssistance = null;
            if (options.includeAI && typeof response === 'string') {
                aiAssistance = aiGradingAssistant({
                    responseText: response,
                    question,
                    markScheme
                });
            }
            
            const processingTime = performance.now() - startTime;
            
            const result = {
                id: generateUUID(),
                timestamp: new Date().toISOString(),
                response: normalizedResponse,
                responseText: typeof response === 'string' ? response : JSON.stringify(response),
                gradeResult,
                aiAssistance,
                processingTimeMs: Math.round(processingTime),
                pointBreakdown: this.explainPointDecisions(gradeResult, markScheme)
            };
            
            history.push(result);
            return result;
        },
        
        /**
         * Explains why each point was or wasn't awarded.
         * @param {Object} gradeResult Grading result
         * @param {Object} markScheme Mark scheme
         * @returns {Array} Point explanations
         */
        explainPointDecisions(gradeResult, markScheme) {
            if (!markScheme?.points) return [];
            
            return markScheme.points.map(point => {
                const pointId = point.id || point.pointId;
                const awarded = gradeResult.awardedPoints?.find(ap => ap.pointId === pointId);
                const marksAwarded = awarded?.awardedMarks || 0;
                const marksAvailable = point.marks || 1;
                
                let reason;
                if (awarded?.requirementsFailed) {
                    reason = `Prerequisite not met: requires ${point.requires?.join(', ')}`;
                } else if (marksAwarded === marksAvailable) {
                    reason = 'Criteria satisfied';
                } else if (marksAwarded > 0) {
                    reason = `Partial credit: ${marksAwarded}/${marksAvailable}`;
                } else {
                    reason = this.explainWhyNotAwarded(point, gradeResult);
                }
                
                return {
                    pointId,
                    pointType: this.inferPointType(pointId),
                    description: point.condition || 'No condition specified',
                    marksAwarded,
                    marksAvailable,
                    status: marksAwarded === marksAvailable ? 'awarded' : marksAwarded > 0 ? 'partial' : 'not_awarded',
                    reason,
                    dependencies: point.requires || [],
                    allowECF: point.allowECF || false
                };
            });
        },
        
        /**
         * Explains why a point was not awarded.
         * @param {Object} point Mark scheme point
         * @param {Object} gradeResult Grade result
         * @returns {string} Explanation
         */
        explainWhyNotAwarded(point, gradeResult) {
            const grading = point.grading;
            if (!grading) return 'No grading criteria defined';
            
            switch (grading.kind) {
                case 'mcq_single':
                    return `Expected index ${grading.correctIndices?.join(' or ')}, got different`;
                case 'mcq_multi':
                    return `Expected indices [${grading.correctIndices?.join(', ')}], got different`;
                case 'numeric':
                    if (grading.requireUnit) {
                        return `Value or unit incorrect (expected ${grading.value} ${grading.requireUnit}, tolerance ±${grading.toleranceAbs || 0})`;
                    }
                    return `Value incorrect (expected ${grading.value}, tolerance ±${grading.toleranceAbs || 0})`;
                case 'short_text':
                    const accepted = grading.accepted?.join(', ') || 'specific terms';
                    return `Response did not match accepted: ${accepted}`;
                default:
                    return 'Response did not match criteria';
            }
        },
        
        /**
         * Infers point type from ID.
         * @param {string} pointId Point ID
         * @returns {string} Point type
         */
        inferPointType(pointId) {
            if (/^M\d+$/i.test(pointId)) return 'method';
            if (/^A\d+$/i.test(pointId)) return 'accuracy';
            if (/^R\d+$/i.test(pointId)) return 'reasoning';
            if (/^B\d+$/i.test(pointId)) return 'independent';
            if (/^C\d+$/i.test(pointId)) return 'comprehension';
            return 'unknown';
        },
        
        /**
         * Runs batch tests on multiple responses.
         * @param {Array} responses Array of {name, response} objects
         * @returns {Object} Batch results
         */
        testBatch(responses) {
            const results = responses.map(({ name, response }) => {
                const result = this.testResponse(response);
                return { name, ...result };
            });
            
            const stats = {
                total: results.length,
                fullMarks: results.filter(r => 
                    r.gradeResult.totalAwardedMarks === this.getTotalMarks()
                ).length,
                zeroMarks: results.filter(r => r.gradeResult.totalAwardedMarks === 0).length,
                partialMarks: results.filter(r => {
                    const m = r.gradeResult.totalAwardedMarks;
                    return m > 0 && m < this.getTotalMarks();
                }).length,
                averageMarks: results.reduce((s, r) => s + r.gradeResult.totalAwardedMarks, 0) / results.length
            };
            
            return { results, stats };
        },
        
        /**
         * Validates the mark scheme structure.
         * @returns {Object} Validation results
         */
        validate() {
            return validateMarkScheme(markScheme, question);
        },
        
        /**
         * Runs golden tests on the mark scheme.
         * @returns {Object} Golden test results
         */
        runGoldenTests() {
            return runGoldenTests(markScheme, question);
        },
        
        /**
         * Generates an interactive HTML report for the harness.
         * @returns {string} HTML string
         */
        generateReport() {
            const validation = this.validate();
            const golden = this.runGoldenTests();
            
            return `
                <div class="test-harness-report">
                    <h2>Mark Scheme Test Harness Report</h2>
                    
                    <section class="validation-section">
                        <h3>Structure Validation</h3>
                        <p class="status ${validation.valid ? 'valid' : 'invalid'}">
                            ${validation.valid ? '✓ Valid' : '✗ Invalid'}
                        </p>
                        ${validation.issues.length > 0 ? `
                            <div class="issues">
                                <h4>Issues:</h4>
                                <ul>${validation.issues.map(i => `<li>${i}</li>`).join('')}</ul>
                            </div>
                        ` : ''}
                    </section>
                    
                    <section class="golden-tests-section">
                        <h3>Golden Response Tests</h3>
                        <p class="status ${golden.passed ? 'passed' : 'failed'}">
                            ${golden.passedCount}/${golden.totalTests} passed 
                            (${Math.round(golden.passRate * 100)}%)
                        </p>
                        ${!golden.passed ? `
                            <div class="failures">
                                <h4>Failed Tests:</h4>
                                <ul>
                                    ${golden.results.filter(r => !r.passed).map(r => `
                                        <li>${r.testName}: expected ${r.expectedMarks}, got ${r.actualMarks}</li>
                                    `).join('')}
                                </ul>
                            </div>
                        ` : ''}
                    </section>
                    
                    <section class="history-section">
                        <h3>Test History (${history.length} tests)</h3>
                        ${history.length === 0 ? '<p>No tests run yet</p>' : `
                            <table class="history-table">
                                <thead>
                                    <tr><th>Time</th><th>Response</th><th>Marks</th><th>Time (ms)</th></tr>
                                </thead>
                                <tbody>
                                    ${history.slice(-10).map(h => `
                                        <tr>
                                            <td>${new Date(h.timestamp).toLocaleTimeString()}</td>
                                            <td class="response-preview">${this.truncate(h.responseText, 50)}</td>
                                            <td>${h.gradeResult.totalAwardedMarks}</td>
                                            <td>${h.processingTimeMs}</td>
                                        </tr>
                                    `).join('')}
                                </tbody>
                            </table>
                        `}
                    </section>
                </div>
            `;
        },
        
        /**
         * Gets the total marks available in the scheme.
         * @returns {number} Total marks
         */
        getTotalMarks() {
            return markScheme?.points?.reduce((sum, p) => sum + (p.marks || 0), 0) || 0;
        },
        
        /**
         * Gets test history.
         * @returns {Array} History array
         */
        getHistory() {
            return [...history];
        },
        
        /**
         * Clears test history.
         */
        clearHistory() {
            history.length = 0;
        },
        
        /**
         * Truncates text for display.
         */
        truncate(text, maxLength) {
            if (!text || text.length <= maxLength) return text;
            return text.substring(0, maxLength) + '...';
        }
    };
}

/**
 * Normalizes a text response based on question type.
 * @param {string} text Response text
 * @param {string} questionType Question type
 * @returns {Object} Normalized response
 */
function normalizeTextResponse(text, questionType) {
    switch (questionType) {
        case 'numeric':
            // Try to extract number and unit
            const match = text.match(/(-?\d+\.?\d*)\s*([a-zA-Z\/]+)?/);
            if (match) {
                return {
                    value: parseFloat(match[1]),
                    unit: match[2] || undefined,
                    rawValue: text
                };
            }
            return { value: null, rawValue: text };
            
        case 'short_text':
            return { text: text.trim() };
            
        case 'mcq_single':
            // Try to parse letter or number
            const letterMatch = text.match(/^[A-Da-d]$/);
            if (letterMatch) {
                return { selectedIndex: letterMatch[0].toUpperCase().charCodeAt(0) - 65 };
            }
            const numMatch = text.match(/^(\d)$/);
            if (numMatch) {
                return { selectedIndex: parseInt(numMatch[1]) };
            }
            return { text: text.trim() };
            
        default:
            return { text: text.trim() };
    }
}

/**
 * Creates a quick test for a mark scheme with sample responses.
 * @param {Object} markScheme Mark scheme
 * @param {Object} question Question
 * @param {Array} sampleResponses Sample responses to test
 * @returns {Object} Quick test results
 */
export function quickTestMarkScheme(markScheme, question, sampleResponses) {
    const harness = createMarkSchemeTestHarness(markScheme, question);
    
    // Validate first
    const validation = harness.validate();
    if (!validation.valid) {
        return {
            success: false,
            error: 'Mark scheme validation failed',
            validation
        };
    }
    
    // Run golden tests
    const golden = harness.runGoldenTests();
    
    // Test samples
    const sampleResults = sampleResponses.map((sample, idx) => {
        const result = harness.testResponse(sample.response);
        return {
            name: sample.name || `Sample ${idx + 1}`,
            expectedMarks: sample.expectedMarks,
            actualMarks: result.gradeResult.totalAwardedMarks,
            matches: result.gradeResult.totalAwardedMarks === sample.expectedMarks,
            result
        };
    });
    
    const allMatch = sampleResults.every(r => r.matches);
    
    return {
        success: golden.passed && allMatch,
        validation,
        goldenTests: golden,
        sampleResults,
        harness
    };
}

// --- Export Module ---

export default {
    createMarkSchemeTestHarness,
    quickTestMarkScheme
};
