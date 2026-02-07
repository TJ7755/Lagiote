/**
 * AI Grading Assistant - Evidence Extraction and Scheme Matching
 * 
 * Implements Phase 11 of the Exam Mode specification:
 * - Evidence extraction (claims, steps, calculations)
 * - Scheme point matcher assistant (suggest which points are satisfied)
 * - Feedback writer (based on awarded points)
 * - Confidence estimator (high/medium/low)
 * 
 * This module does NOT replace deterministic grading - it assists human markers
 * by extracting and highlighting evidence in student responses.
 */

import { generateUUID } from './exam-mode.js';

// --- Utility Functions ---

/**
 * Escapes special characters in a string for use in a RegExp.
 * @param {string} str String to escape
 * @returns {string} Escaped string
 */
function escapeRegExp(str) {
    return str.replace(/[.*+?^${}()|\\[\]\-]/g, '\\$&');
}

// --- Evidence Extraction ---

/**
 * Extracts numerical calculations from text.
 * @param {string} text Response text
 * @returns {Array} Extracted calculations with positions
 */
export function extractCalculations(text) {
    if (!text || typeof text !== 'string') return [];
    
    const calculations = [];
    
    // Pattern: number operator number = result (e.g., "5 + 3 = 8" or "5+3=8")
    const calcPattern = /(-?\d+\.?\d*)\s*([+\-*/×÷])\s*(-?\d+\.?\d*)\s*=\s*(-?\d+\.?\d*)/gi;
    let match;
    
    while ((match = calcPattern.exec(text)) !== null) {
        calculations.push({
            type: 'calculation',
            full: match[0],
            operand1: parseFloat(match[1]),
            operator: match[2],
            operand2: parseFloat(match[3]),
            result: parseFloat(match[4]),
            index: match.index,
            verified: verifyCalculation(
                parseFloat(match[1]),
                match[2],
                parseFloat(match[3]),
                parseFloat(match[4])
            )
        });
    }
    
    // Pattern: standalone numbers with units (e.g., "10 m/s", "5.2 kg")
    const unitPattern = /(-?\d+\.?\d*)\s*([a-zA-Z]+[\/\^]?[a-zA-Z]*)/gi;
    const usedRanges = new Set(calculations.map(c => `${c.index}-${c.index + c.full.length}`));
    
    while ((match = unitPattern.exec(text)) !== null) {
        const range = `${match.index}-${match.index + match[0].length}`;
        if (!usedRanges.has(range)) {
            calculations.push({
                type: 'value_with_unit',
                full: match[0],
                value: parseFloat(match[1]),
                unit: match[2],
                index: match.index
            });
        }
    }
    
    return calculations;
}

/**
 * Verifies a mathematical calculation.
 * @param {number} a First operand
 * @param {string} op Operator
 * @param {number} b Second operand
 * @param {number} expected Expected result
 * @returns {boolean} Whether calculation is correct
 */
function verifyCalculation(a, op, b, expected) {
    let actual;
    switch (op) {
        case '+': actual = a + b; break;
        case '-': actual = a - b; break;
        case '*':
        case '×': actual = a * b; break;
        case '/':
        case '÷': actual = b !== 0 ? a / b : Infinity; break;
        default: return false;
    }
    return Math.abs(actual - expected) < 0.0001;
}

/**
 * Extracts key claims or statements from text.
 * @param {string} text Response text
 * @returns {Array} Extracted claims
 */
export function extractClaims(text) {
    if (!text || typeof text !== 'string') return [];
    
    const claims = [];
    const sentences = text.split(/[.!?]+/).filter(s => s.trim().length > 0);
    
    sentences.forEach((sentence, idx) => {
        const trimmed = sentence.trim();
        if (trimmed.length < 5) return;
        
        // Identify claim types
        let claimType = 'statement';
        if (/^\s*(therefore|thus|hence|so)[,;]?\s+/i.test(trimmed)) {
            claimType = 'conclusion';
        } else if (/^\s*(because|since|as)\s+/i.test(trimmed)) {
            claimType = 'reasoning';
        } else if (/\b(is|are|was|were|equals?|equivalent)\s+/i.test(trimmed)) {
            claimType = 'definition';
        } else if (/(increase|decrease|rise|fall|higher|lower)/i.test(trimmed)) {
            claimType = 'comparison';
        }
        
        claims.push({
            type: claimType,
            text: trimmed,
            index: text.indexOf(trimmed),
            length: trimmed.length,
            hasEvidence: trimmed.length > 20
        });
    });
    
    return claims;
}

/**
 * Extracts all evidence from a response.
 * @param {string} responseText Student response
 * @param {string} questionType Type of question
 * @returns {Object} Structured evidence
 */
export function extractEvidence(responseText, questionType = 'structured') {
    const evidence = {
        calculations: extractCalculations(responseText),
        claims: extractClaims(responseText),
        keyTerms: extractKeyTerms(responseText),
        structure: analyzeStructure(responseText)
    };
    
    // Question-type specific extraction
    if (questionType === 'essay') {
        evidence.paragraphs = extractParagraphs(responseText);
        evidence.argumentFlow = analyzeArgumentFlow(evidence.claims);
    }
    
    return evidence;
}

/**
 * Extracts key terms (capitalized words, technical terms).
 * @param {string} text Response text
 * @returns {Array} Key terms found
 */
function extractKeyTerms(text) {
    if (!text) return [];
    
    const terms = new Set();
    
    // Capitalized phrases (potential proper nouns)
    const properNounPattern = /\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*\b/g;
    let match;
    while ((match = properNounPattern.exec(text)) !== null) {
        if (match[0].length > 3 && !commonWords.has(match[0].toLowerCase())) {
            terms.add(match[0]);
        }
    }
    
    // Technical patterns (Greek letters, subscripts)
    const technicalPattern = /\b[α-ωΑ-Ω](?:_[a-zA-Z0-9]+)?\b|\b[A-Z]_[a-zA-Z0-9]+\b/g;
    while ((match = technicalPattern.exec(text)) !== null) {
        terms.add(match[0]);
    }
    
    return Array.from(terms).map(term => ({
        term,
        index: text.indexOf(term),
        category: categorizeTerm(term)
    }));
}

const commonWords = new Set([
    'the', 'and', 'for', 'are', 'but', 'not', 'you', 'all', 'can', 'had', 'her', 'was',
    'one', 'our', 'out', 'day', 'get', 'has', 'him', 'his', 'how', 'man', 'new', 'now',
    'old', 'see', 'two', 'way', 'who', 'boy', 'did', 'its', 'let', 'put', 'say', 'she',
    'too', 'use', 'answer', 'question', 'following', 'following'
]);

function categorizeTerm(term) {
    if (/^[A-Z][a-z]+\s+[A-Z]/.test(term)) return 'proper_noun';
    if (/^[α-ωΑ-Ω]/.test(term)) return 'greek_symbol';
    if (/_.+/.test(term)) return 'subscripted';
    return 'technical';
}

/**
 * Analyzes the structure of a response.
 * @param {string} text Response text
 * @returns {Object} Structure analysis
 */
function analyzeStructure(text) {
    const paragraphs = text.split(/\n\s*\n/).filter(p => p.trim().length > 0);
    const sentences = text.split(/[.!?]+/).filter(s => s.trim().length > 0);
    const wordCount = text.split(/\s+/).filter(w => w.length > 0).length;
    
    return {
        paragraphCount: paragraphs.length,
        sentenceCount: sentences.length,
        wordCount,
        averageSentenceLength: sentences.length > 0 ? wordCount / sentences.length : 0,
        hasIntroduction: paragraphs.length > 0 && paragraphs[0].length > 50,
        hasConclusion: paragraphs.length > 2 && paragraphs[paragraphs.length - 1].length > 30
    };
}

function extractParagraphs(text) {
    return text.split(/\n\s*\n/)
        .filter(p => p.trim().length > 0)
        .map((p, i) => ({
            index: i,
            text: p.trim(),
            wordCount: p.split(/\s+/).filter(w => w.length > 0).length
        }));
}

function analyzeArgumentFlow(claims) {
    const flow = [];
    let lastWasReasoning = false;
    
    claims.forEach((claim, idx) => {
        if (claim.type === 'reasoning') lastWasReasoning = true;
        else if (claim.type === 'conclusion' && lastWasReasoning) {
            flow.push({ type: 'reasoned_conclusion', claimIndex: idx });
            lastWasReasoning = false;
        }
    });
    
    return flow;
}

// --- Scheme Point Matching ---

/**
 * Suggests which mark scheme points are satisfied by evidence.
 * @param {Object} evidence Extracted evidence
 * @param {Object} markScheme Mark scheme with points
 * @param {Object} question Question object
 * @returns {Array} Suggested points with confidence
 */
export function suggestPointsFromEvidence(evidence, markScheme, question) {
    if (!markScheme?.points || !Array.isArray(markScheme.points)) {
        return [];
    }
    
    const suggestions = [];
    const evidenceText = JSON.stringify(evidence).toLowerCase();
    
    markScheme.points.forEach(point => {
        const suggestion = analyzePointMatch(point, evidence, evidenceText, question);
        if (suggestion.confidence !== 'low') {
            suggestions.push(suggestion);
        }
    });
    
    return suggestions.sort((a, b) => confidenceRank(b.confidence) - confidenceRank(a.confidence));
}

function confidenceRank(confidence) {
    return confidence === 'high' ? 3 : confidence === 'medium' ? 2 : 1;
}

function analyzePointMatch(point, evidence, evidenceText, question) {
    const pointId = point.id || point.pointId;
    const condition = (point.condition || '').toLowerCase();
    const marks = point.marks || 1;
    
    let confidence = 'low';
    const evidenceSnippets = [];
    const reasons = [];
    
    // Check for calculation evidence
    if (evidence.calculations?.length > 0 &&
        (/calculate|compute|find|determine/i.test(condition) || point.grading?.kind === 'calculation')) {
        const correctCalcs = evidence.calculations.filter(c => c.verified);
        if (correctCalcs.length > 0) {
            confidence = point.grading?.kind === 'calculation' ? 'medium' : 'high';
            evidenceSnippets.push(...correctCalcs.slice(0, 2).map(c => c.full));
            reasons.push(`${correctCalcs.length} verified calculation(s) found`);
        }
    }
    
    // Check for claim evidence
    if (evidence.claims?.length > 0) {
        const relevantClaims = evidence.claims.filter(c => 
            condition.includes(c.text.toLowerCase().substring(0, 20)) ||
            c.text.toLowerCase().includes(condition.substring(0, 20))
        );
        if (relevantClaims.length > 0) {
            confidence = confidence === 'low' ? 'medium' : confidence;
            evidenceSnippets.push(relevantClaims[0].text);
            reasons.push('Relevant claim found');
        }
    }
    
    // Check for keyword matches
    if (point.grading?.accepted?.length > 0) {
        const matches = point.grading.accepted.filter(a => evidenceText.includes(a.toLowerCase()));
        if (matches.length > 0) {
            confidence = 'high';
            evidenceSnippets.push(...matches.slice(0, 2));
            reasons.push(`Matched accepted answers: ${matches.join(', ')}`);
        }
    }

    // Check for numeric value match (accuracy marks)
    if (point.grading?.kind === 'numeric' && point.grading?.value !== undefined) {
        const targetValue = point.grading.value;
        const tolerance = point.grading.toleranceAbs || 0;
        // Check calculations first
        const numericMatches = evidence.calculations?.filter(c => {
            const val = c.type === 'value_with_unit' ? c.value : c.result;
            return val !== undefined && Math.abs(val - targetValue) <= tolerance;
        });
        if (numericMatches?.length > 0) {
            confidence = confidence === 'low' ? 'medium' : 'high';
            evidenceSnippets.push(numericMatches[0].full);
            reasons.push(`Numeric value ${targetValue} found in response`);
        } else {
            // Check raw text for the numeric value using improved regex that handles negative numbers
            const valuePattern = new RegExp(`(?<!\\S)${escapeRegExp(String(targetValue))}(?:\\b|\\s)`);
            if (valuePattern.test(evidenceText)) {
                confidence = confidence === 'low' ? 'medium' : confidence;
                reasons.push(`Value ${targetValue} appears in response text`);
            }
        }
    }
    
    // Check for numeric value match (accuracy marks)
    if (point.grading?.kind === 'numeric' && point.grading?.value !== undefined) {
        const targetValue = point.grading.value;
        const tolerance = point.grading.toleranceAbs || 0;
        // Check calculations first
        const numericMatches = evidence.calculations?.filter(c => {
            const val = c.type === 'value_with_unit' ? c.value : c.result;
            return val !== undefined && Math.abs(val - targetValue) <= tolerance;
        });
        if (numericMatches?.length > 0) {
            confidence = confidence === 'low' ? 'medium' : 'high';
            evidenceSnippets.push(numericMatches[0].full);
            reasons.push(`Numeric value ${targetValue} found in response`);
        } else {
            // Check raw text for the numeric value
            const escapedValue = String(targetValue).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            const numPattern = new RegExp(`\\b${escapedValue}\\b`);
            if (numPattern.test(evidenceText)) {
                confidence = confidence === 'low' ? 'medium' : confidence;
                reasons.push(`Value ${targetValue} appears in response text`);
            }
        }
    }
    
    // Check method mark indicators
    if (/^M\d+$/.test(pointId)) {
        // Verified calculations count as method evidence
        if (evidence.calculations?.some(c => c.verified)) {
            confidence = confidence === 'low' ? 'medium' : confidence;
            reasons.push('Verified calculation shows method');
        }
        const methodIndicators = ['method', 'approach', 'substitute', 'formula', 'equation'];
        if (methodIndicators.some(m => evidenceText.includes(m))) {
            confidence = confidence === 'low' ? 'medium' : confidence;
            reasons.push('Method indicators present');
        }
    }
    
    // Check reasoning indicators
    if (/^R\d+$/.test(pointId)) {
        const reasoningIndicators = ['because', 'since', 'therefore', 'thus', 'hence', 'as'];
        if (reasoningIndicators.some(r => evidenceText.includes(r))) {
            confidence = confidence === 'low' ? 'medium' : confidence;
            reasons.push('Reasoning connectors found');
        }
    }
    
    return {
        pointId,
        marks,
        confidence,
        suggestedAward: confidence === 'high' ? marks : confidence === 'medium' ? marks * 0.5 : 0,
        evidenceSnippets: evidenceSnippets.slice(0, 3),
        reasons,
        requiresReview: confidence !== 'high'
    };
}

// --- Feedback Generation ---

/**
 * Generates feedback based on awarded points and missed opportunities.
 * @param {Array} awardedPoints Points that were awarded
 * @param {Array} missedPoints Points that could have been awarded
 * @param {Object} markScheme Full mark scheme
 * @returns {Object} Structured feedback
 */
export function generateFeedback(awardedPoints, missedPoints, markScheme) {
    const feedback = {
        summary: {
            totalAwarded: awardedPoints.reduce((sum, p) => sum + (p.awardedMarks || 0), 0),
            totalPossible: markScheme.points?.reduce((sum, p) => sum + (p.marks || 0), 0) || 0,
            pointsCount: awardedPoints.length
        },
        positive: [],
        improvements: [],
        nextSteps: []
    };
    
    // Generate positive feedback
    if (awardedPoints.length > 0) {
        const methodPoints = awardedPoints.filter(p => /^M\d+$/.test(p.pointId));
        if (methodPoints.length > 0) {
            feedback.positive.push('Good method shown in working');
        }
        
        const accuracyPoints = awardedPoints.filter(p => /^A\d+$/.test(p.pointId));
        if (accuracyPoints.length > 0) {
            feedback.positive.push('Accurate calculations');
        }
    }
    
    // Generate improvement suggestions
    missedPoints.forEach(point => {
        if (point.reasons?.length > 0) {
            feedback.improvements.push({
                pointId: point.pointId,
                suggestion: point.reasons[0],
                evidence: point.evidenceSnippets?.[0] || null
            });
        }
    });
    
    // Generate next steps
    if (missedPoints.some(p => /^M\d+$/.test(p.pointId))) {
        feedback.nextSteps.push('Show your method clearly - method marks are available even with wrong answers');
    }
    if (missedPoints.some(p => /^R\d+$/.test(p.pointId))) {
        feedback.nextSteps.push('Explain your reasoning - use words like "because", "therefore"');
    }
    if (feedback.summary.totalAwarded < feedback.summary.totalPossible * 0.5) {
        feedback.nextSteps.push('Review the topic fundamentals and try practice questions');
    }
    
    return feedback;
}

// --- Confidence Scoring ---

/**
 * Calculates overall confidence in grading suggestion.
 * @param {Array} suggestions Point suggestions
 * @param {Object} evidence Extracted evidence
 * @returns {Object} Confidence breakdown
 */
export function calculateGradingConfidence(suggestions, evidence) {
    const highConf = suggestions.filter(s => s.confidence === 'high').length;
    const mediumConf = suggestions.filter(s => s.confidence === 'medium').length;
    const lowConf = suggestions.filter(s => s.confidence === 'low').length;
    const total = suggestions.length || 1;
    
    const overallScore = (highConf * 3 + mediumConf * 2 + lowConf * 1) / (total * 3);
    
    let overall;
    if (overallScore >= 0.7) overall = 'high';
    else if (overallScore >= 0.5) overall = 'medium';
    else overall = 'low';
    
    return {
        overall,
        score: overallScore,
        breakdown: { high: highConf, medium: mediumConf, low: lowConf },
        requiresManualReview: overall !== 'high',
        reasoning: overall === 'low' 
            ? 'Insufficient clear evidence in response'
            : overall === 'medium'
            ? 'Some evidence found but interpretation needed'
            : 'Strong evidence for most points'
    };
}

// --- Main Assistant Interface ---

/**
 * Main AI grading assistant function.
 * Analyzes a response and provides grading assistance.
 * 
 * @param {Object} params Assistant parameters
 * @param {string} params.responseText Student response text
 * @param {Object} params.question Question object
 * @param {Object} params.markScheme Mark scheme
 * @returns {Object} Complete grading assistance result
 */
export function aiGradingAssistant({ responseText, question, markScheme }) {
    const startTime = performance.now();
    
    // Step 1: Extract evidence
    const evidence = extractEvidence(responseText, question?.type);
    
    // Step 2: Suggest point matches
    const suggestions = suggestPointsFromEvidence(evidence, markScheme, question);
    
    // Step 3: Calculate confidence
    const confidence = calculateGradingConfidence(suggestions, evidence);
    
    // Step 4: Generate preliminary feedback
    const awardedPoints = suggestions.filter(s => s.suggestedAward > 0);
    const missedPoints = suggestions.filter(s => s.suggestedAward === 0 && s.confidence !== 'low');
    const preliminaryFeedback = generateFeedback(awardedPoints, missedPoints, markScheme);
    
    const processingTime = performance.now() - startTime;
    
    return {
        id: generateUUID(),
        timestamp: new Date().toISOString(),
        evidence,
        suggestions,
        confidence,
        preliminaryFeedback,
        processingTimeMs: Math.round(processingTime),
        disclaimer: 'AI ASSISTANCE ONLY - Final marks require human verification'
    };
}

// --- Export Module ---

export default {
    extractEvidence,
    extractCalculations,
    extractClaims,
    suggestPointsFromEvidence,
    generateFeedback,
    calculateGradingConfidence,
    aiGradingAssistant
};
