/**
 * Import Utils Module
 * 
 * Handles parsing and normalization of deck data from various formats:
 * - JSON (Internal, Sequence, Auth0)
 * - CSV/TSV/DSV
 * - Markdown Tables
 * - Simple text (Q&A per line)
 */

import { CARD_TYPES, normalizeCardType, detectCardType, expandCard } from './card-types.js';

/**
 * Detects the delimiter used in a DSV (Delimiter Separated Values) string
 * @param {string} text - The text to analyze
 * @returns {string} - The detected delimiter
 */
export function detectDelimiter(text) {
    const commonDelimiters = ['\t', ',', ';', '|'];
    const lines = text.split('\n').slice(0, 5).filter(line => line.trim().length > 0);
    
    if (lines.length === 0) return ',';

    let bestDelimiter = ',';
    let maxFields = 0;

    for (const delim of commonDelimiters) {
        let fieldCounts = lines.map(line => line.split(delim).length);
        let avgFields = fieldCounts.reduce((a, b) => a + b, 0) / fieldCounts.length;
        let variance = fieldCounts.reduce((a, b) => a + Math.pow(b - avgFields, 2), 0) / fieldCounts.length;

        // We want a delimiter that produces at least 2 fields and has low variance in field count
        if (avgFields >= 2 && variance < 0.5) {
            if (avgFields > maxFields) {
                maxFields = avgFields;
                bestDelimiter = delim;
            }
        }
    }

    return bestDelimiter;
}

/**
 * Parses Markdown table into array of objects
 * @param {string} text 
 * @returns {Array|null}
 */
export function parseMarkdownTable(text) {
    const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
    if (lines.length < 3) return null;

    // Check for markdown table structure: | Header | Header |
    //                                   | --- | --- |
    if (!lines[0].includes('|') || !lines[1].includes('|') || !lines[1].includes('-')) return null;

    const parseRow = (row) => row.split('|').map(c => c.trim()).filter((c, i, a) => i > 0 && i < a.length - 1);
    
    const headers = parseRow(lines[0]);
    const cards = [];

    for (let i = 2; i < lines.length; i++) {
        const values = parseRow(lines[i]);
        if (values.length >= 2) {
            const card = {};
            headers.forEach((h, idx) => {
                const key = h.toLowerCase().replace(/\s+/g, '');
                card[key] = values[idx] || '';
            });
            cards.push(card);
        }
    }

    return cards.length > 0 ? cards : null;
}

/**
 * Parses simple Q&A format where question is on one line and answer is on the next
 * Separated by empty lines or specific prefixes like "Q:" and "A:"
 * @param {string} text 
 * @returns {Array|null}
 */
export function parseSimpleQA(text) {
    const lines = text.split('\n').map(l => l.trim());
    const cards = [];
    let currentCard = {};

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (!line) continue;

        if (line.toLowerCase().startsWith('q:') || line.toLowerCase().startsWith('question:')) {
            if (currentCard.front && currentCard.back) cards.push(currentCard);
            currentCard = { front: line.replace(/^(q|question):/i, '').trim() };
        } else if (line.toLowerCase().startsWith('a:') || line.toLowerCase().startsWith('answer:')) {
            currentCard.back = line.replace(/^(a|answer):/i, '').trim();
            cards.push(currentCard);
            currentCard = {};
        } else if (!currentCard.front) {
            currentCard.front = line;
        } else if (!currentCard.back) {
            currentCard.back = line;
            cards.push(currentCard);
            currentCard = {};
        }
    }

    if (currentCard.front && currentCard.back) cards.push(currentCard);
    
    return cards.length > 0 ? cards : null;
}

/**
 * Main entry point for parsing text data
 * @param {string} text - Raw text input
 * @param {Object} options - { delimiter, typeHint }
 * @returns {Object} - { cards, sequenceMeta }
 */
export function parseImportText(text, options = {}) {
    const { typeHint = 'General' } = options;
    let { delimiter } = options;

    if (!text || !text.trim()) return { cards: [], sequenceMeta: {} };

    // Try JSON first
    if (text.trim().startsWith('{') || text.trim().startsWith('[')) {
        try {
            const data = JSON.parse(text);
            let importedCards = Array.isArray(data) ? data : (data.cards || []);
            
            // Normalize JSON cards
            const normalizedCards = importedCards.map(c => {
                const front = c.front || c.question || c.term || '';
                const back = c.back || c.answer || c.definition || '';
                const base = {
                    ...c,
                    id: c.id || crypto.randomUUID(),
                    question: front,
                    answer: back,
                    front: front,
                    back: back,
                    cardType: c.cardType || c.type || (typeHint ? normalizeCardType(typeHint) : detectCardType({front, back})),
                    isNew: true
                };
                return expandCard(base);
            }).flat();

            return { cards: normalizedCards, sequenceMeta: data.sequenceMeta || {} };
        } catch (e) {
            // Not valid JSON, continue with text parsing
        }
    }

    // Try Markdown Table
    const mdCards = parseMarkdownTable(text);
    if (mdCards) {
        return { 
            cards: mdCards.map(c => ({
                front: c.front || c.question || c.term || '',
                back: c.back || c.answer || c.definition || '',
                type: c.type || null
            })),
            sequenceMeta: {}
        };
    }

    // Determine delimiter if not provided
    if (!delimiter) {
        delimiter = detectDelimiter(text);
    }

    const lines = text.split('\n').map(line => line.trim()).filter(Boolean);
    
    // SEQUENCE DECK SPECIAL HANDLING
    if (typeHint === 'Sequence') {
        const sequenceMap = new Map();
        lines.forEach((line) => {
            const parts = line.split(delimiter);
            if (parts.length >= 2 && parts[0].trim() && parts[1].trim()) {
                const seqTitle = parts[0].trim();
                const stepText = parts[1].trim();
                const notes = parts[2] ? parts[2].trim() : '';
                if (!sequenceMap.has(seqTitle)) {
                    sequenceMap.set(seqTitle, { id: crypto.randomUUID(), steps: [] });
                }
                sequenceMap.get(seqTitle).steps.push({ question: stepText, answer: notes });
            }
        });
        
        const cards = [];
        const sequenceMeta = {};
        Array.from(sequenceMap.entries()).forEach(([title, data], seqIdx) => {
            sequenceMeta[data.id] = { title: title || `Sequence ${seqIdx + 1}` };
            data.steps.forEach((step, stepIdx) => {
                cards.push({
                    id: crypto.randomUUID(),
                    question: step.question,
                    answer: step.answer || '',
                    sequenceId: data.id,
                    sequenceTitle: sequenceMeta[data.id].title,
                    stepIndex: stepIdx,
                    order: stepIdx,
                    cardType: CARD_TYPES.SEQUENCE,
                    isNew: true
                });
            });
        });
        return { cards, sequenceMeta };
    }

    // Check for Anki-style headers
    const normalizeHeader = (value) => value.replace(/\s+/g, '').toLowerCase();
    const headerKeys = new Set(['front', 'back', 'question', 'answer', 'type', 'cloze', 'addreverse', 'term', 'definition']);
    const firstRowParts = lines[0].split(delimiter).map(h => h.trim());
    const matchedHeadersCount = firstRowParts
        .map(h => normalizeHeader(h))
        .filter(h => headerKeys.has(h)).length;
    
    const hasHeader = matchedHeadersCount >= 2;
    let headers = null;
    let dataStartIndex = 0;

    if (hasHeader) {
        headers = firstRowParts.map(h => normalizeHeader(h));
        dataStartIndex = 1;
    }

    const allCards = [];

    for (let i = dataStartIndex; i < lines.length; i++) {
        const line = lines[i];
        const parts = line.split(delimiter);
        
        let rawCard = {};
        if (parts.length < 2) {
            // Single column - could be a cloze or just a front without back
            // Only allow if it's likely a cloze or if we have a typeHint
            const isCloze = line.includes('{{c') || line.includes('[') || typeHint.toLowerCase().includes('cloze');
            if (!isCloze) continue;
            
            rawCard.front = line;
            rawCard.back = '';
        } else if (headers) {
            headers.forEach((header, idx) => {
                if (parts[idx] !== undefined) rawCard[header] = parts[idx].trim();
            });
            rawCard.front = rawCard.front || rawCard.question || rawCard.term || '';
            rawCard.back = rawCard.back || rawCard.answer || rawCard.definition || '';
            rawCard.addReverse = rawCard.addreverse || rawCard['addreverse'] || '';
        } else {
            rawCard.front = parts[0]?.trim() || '';
            rawCard.back = parts[1]?.trim() || '';
            if (parts[2]) rawCard.type = parts[2].trim();
            if (parts[3]) rawCard.addReverse = parts[3].trim();
        }

        if (!rawCard.front && !rawCard.back) continue;

        // Detect card type
        let cardType = rawCard.type ? normalizeCardType(rawCard.type) : null;
        if (!cardType) {
            if (typeHint === 'Cloze' || typeHint === 'cloze') {
                cardType = CARD_TYPES.CLOZE;
            } else if (typeHint === 'Basic (and reversed card)' || typeHint === 'BasicReversed') {
                cardType = CARD_TYPES.BASIC_REVERSED;
            } else if (typeHint === 'Basic (type in the answer)' || typeHint === 'TypeAnswer') {
                cardType = CARD_TYPES.BASIC_TYPE_ANSWER;
            } else {
                cardType = detectCardType({ question: rawCard.front, answer: rawCard.back, addReverse: rawCard.addReverse });
            }
        }

        const baseCard = {
            id: crypto.randomUUID(),
            question: rawCard.front,
            answer: rawCard.back,
            cardType: cardType,
            addReverse: rawCard.addReverse || '',
            isNew: true,
            order: 0
        };

        const expanded = expandCard(baseCard);
        allCards.push(...expanded);
    }

    // If still no cards, try Simple QA
    if (allCards.length === 0) {
        const qaCards = parseSimpleQA(text);
        if (qaCards) {
            qaCards.forEach(c => {
                const base = {
                    id: crypto.randomUUID(),
                    question: c.front,
                    answer: c.back,
                    cardType: typeHint ? normalizeCardType(typeHint) : detectCardType(c),
                    isNew: true,
                    order: 0
                };
                allCards.push(...expandCard(base));
            });
        }
    }

    return { cards: allCards, sequenceMeta: {} };
}
