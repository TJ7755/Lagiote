/**
 * Test Form Generation Module
 * Generates a test form (list of items per section) based on a blueprint.
 */

import { shuffleArray } from './utils.js';
import { ensureAnchorsForSection } from './anchor-bank.js';

class SeededRNG {
    constructor(seed) {
        this.seed = seed ? this._hashString(seed) : Math.floor(Math.random() * 2147483647);
    }

    _hashString(str) {
        let hash = 0;
        for (let i = 0; i < str.length; i++) {
            const char = str.charCodeAt(i);
            hash = ((hash << 5) - hash) + char;
            hash = hash & hash; // Convert to 32bit integer
        }
        return Math.abs(hash);
    }

    // Returns a float between 0 and 1
    next() {
        this.seed = (this.seed * 16807) % 2147483647;
        return (this.seed - 1) / 2147483646;
    }

    // Returns an integer between min (inclusive) and max (exclusive)
    nextInt(min, max) {
        return Math.floor(this.next() * (max - min)) + min;
    }
}

/**
 * Generates a test form based on the blueprint.
 * @param {Object} blueprint The exam blueprint.
 * @param {Object} allDecks Object containing all decks keyed by ID.
 * @param {Object} knowledgeState Optional knowledge state (for difficulty targeting).
 * @returns {Object} { sections: Array, totalMarks: number, seed: string }
 */
export async function generateTestForm(blueprint, allDecks, knowledgeState = {}, userID = 'default_user') {
    const seed = blueprint.generation.seed || Math.random().toString(36).substring(7);
    const rng = new SeededRNG(seed);
    
    const sections = [];
    let currentTotalMarks = 0;
    const warnings = [];
    const questionCountLimit = resolvePositiveInt(blueprint?.questionCount ?? blueprint?.composition?.questionCount);

    // 1. Build Global Candidate Pool
    let candidateCards = [];
    const candidateCountsByDeck = new Map();
    const selectedDeckIds = blueprint.selection.selectedDeckIds;
    
    // If no decks selected, use all available (or handle as error/empty)
    const deckIdsToUse = (selectedDeckIds && selectedDeckIds.length > 0) 
        ? selectedDeckIds 
        : Object.keys(allDecks);

    for (const deckId of deckIdsToUse) {
        const deck = allDecks[deckId];
        if (!deck || !deck.cards) continue;
        
        for (const card of deck.cards) {
            // Filter: Excluded IDs
            if (blueprint.selection.excludedCardIds && blueprint.selection.excludedCardIds.includes(card.id)) continue;
            
            // Filter: Tags (Include)
            if (blueprint.selection.tagInclude && blueprint.selection.tagInclude.length > 0) {
                const hasTag = card.tags && card.tags.some(t => blueprint.selection.tagInclude.includes(t));
                if (!hasTag) continue;
            }

            // Filter: Tags (Exclude)
            if (blueprint.selection.tagExclude && blueprint.selection.tagExclude.length > 0) {
                const hasExcludedTag = card.tags && card.tags.some(t => blueprint.selection.tagExclude.includes(t));
                if (hasExcludedTag) continue;
            }

            // Filter: Exam Tagged Only
            if (blueprint.selection.onlyExamTagged) {
                const isExamTagged = card.tags && card.tags.some(t => t.toLowerCase().includes('exam'));
                if (!isExamTagged) continue;
            }

            candidateCards.push({ ...card, deckId }); // Attach deckId for reference
            candidateCountsByDeck.set(deckId, (candidateCountsByDeck.get(deckId) || 0) + 1);
        }
    }

    const mcqOptionCount = resolvePositiveInt(blueprint?.composition?.questionRules?.mcqOptionCount) || 4;
    const mcqEnabled = Array.isArray(blueprint?.composition?.sections)
        ? blueprint.composition.sections.some(section => {
            const types = Array.isArray(section?.types) ? section.types : [];
            if (!types.length || types.includes('mixed')) return true;
            return types.some(type => isMcqType(type));
        })
        : true;
    const insufficientMcqDecks = new Set();
    if (mcqEnabled && mcqOptionCount > 1) {
        const deckIds = deckIdsToUse || [];
        for (const deckId of deckIds) {
            const count = candidateCountsByDeck.get(deckId) || 0;
            if (count > 0 && count < mcqOptionCount) {
                insufficientMcqDecks.add(deckId);
            }
        }
        if (insufficientMcqDecks.size > 0) {
            const deckLabels = Array.from(insufficientMcqDecks).sort().map(deckId => {
                const deck = allDecks?.[deckId];
                const label = deck?.name || deckId;
                const count = candidateCountsByDeck.get(deckId) || 0;
                return `${label} (${count})`;
            });
            warnings.push(`Some decks are too small for ${mcqOptionCount}-option MCQs and will downgrade to typed recall: ${deckLabels.join(', ')}.`);
        }
    }

    let remainingGlobalQuestions = questionCountLimit;

    // 2. Generate Sections
    for (const sectionConfig of blueprint.composition.sections) {
        const sectionItems = [];
        let sectionMarks = 0;
        let remainingSectionQuestions = resolvePositiveInt(sectionConfig?.questionCount);
        
        // Determine number of items needed (approximate based on marks)
        // For now, assume 1 mark per item if not specified, or try to fill marks.
        // Simple strategy: Pick items until marks target reached.
        
        // Filter candidates for this section (e.g. by type if specified)
        let sectionCandidates = candidateCards.filter(c => {
            if (sectionConfig.types && sectionConfig.types.length > 0 && !sectionConfig.types.includes('mixed')) {
                // Map card type to section types (simplified mapping)
                const cardType = c.type || 'mcq'; // Default to mcq
                // TODO: Better type mapping
                return sectionConfig.types.includes(cardType);
            }
            return true;
        });

        // Handle Anchors
        if (blueprint.generation.anchorItems && blueprint.generation.anchorItems.enabled) {
            const anchorCount = blueprint.generation.anchorItems.countPerSection || 0;
            if (anchorCount > 0) {
                const { anchors } = await ensureAnchorsForSection({
                    userID,
                    blueprintId: blueprint.name,
                    sectionId: sectionConfig.id,
                    candidates: sectionCandidates,
                    count: anchorCount,
                    rng
                });
                
                anchors.forEach(card => {
                    if (remainingGlobalQuestions !== null && remainingGlobalQuestions <= 0) return;
                    if (remainingSectionQuestions !== null && remainingSectionQuestions <= 0) return;
                    if (sectionMarks >= sectionConfig.marks) return;
                    const marksAvailable = card.marks || 1;
                    if (sectionMarks + marksAvailable > sectionConfig.marks + 1) return;
                    const isMcq = isMcqType(card.type || card.cardType || 'mcq');
                    const shouldDowngrade = isMcq && insufficientMcqDecks.has(card.deckId);
                    const resolvedType = shouldDowngrade ? 'type' : normalizeCardTypeForTest(card.type || card.cardType || 'mcq');
                    
                    const itemData = {
                        cardId: card.id,
                        deckId: card.deckId,
                        type: resolvedType,
                        cardType: card.cardType || card.type || 'basic',
                        marksAvailable: marksAvailable,
                        question: card.question,
                        answer: card.answer,
                        isAnchor: true
                    };
                    
                    // Add type-specific data
                    if (resolvedType === 'mcq' && !shouldDowngrade) {
                        itemData.options = card.options;
                    }
                    if (resolvedType === 'cloze' || card.cardType === 'cloze') {
                        itemData.text = card.text || card.question;
                    }
                    if (resolvedType === 'sequence' || card.cardType === 'sequence') {
                        itemData.steps = card.steps;
                    }
                    
                    sectionItems.push(itemData);
                    sectionMarks += marksAvailable;
                    if (remainingSectionQuestions !== null) remainingSectionQuestions -= 1;
                    if (remainingGlobalQuestions !== null) remainingGlobalQuestions -= 1;
                });
                
                if (!blueprint.composition.questionRules.allowRepeats) {
                    const anchorIds = anchors.map(a => a.id);
                    sectionCandidates = sectionCandidates.filter(c => !anchorIds.includes(c.id));
                }
            }
        }

        // Apply Topic Weights (Weighted Sampling)
        // If topicWeights are present, we prioritise cards with those topics.
        // For simplicity in this version: Shuffle, but sort by weight bucket?
        // Or just simple shuffle for now.
        
        // Shuffle candidates using seeded RNG
        sectionCandidates = shuffleWithRng(sectionCandidates, rng);

        // Select items
        for (const card of sectionCandidates) {
            if (remainingGlobalQuestions !== null && remainingGlobalQuestions <= 0) break;
            if (remainingSectionQuestions !== null && remainingSectionQuestions <= 0) break;
            if (sectionMarks >= sectionConfig.marks) break;

            // Check if card already used in previous sections (if repeats not allowed)
            if (!blueprint.composition.questionRules.allowRepeats) {
                const alreadyUsed = sections.some(s => s.items.some(i => i.cardId === card.id));
                if (alreadyUsed) continue;
            }

            // Determine marks for this card
            // If card has intrinsic marks, use it. Else default to 1.
            const marksAvailable = card.marks || 1;
            
            // Don't exceed section marks significantly (optional strictness)
            if (sectionMarks + marksAvailable > sectionConfig.marks + 1) continue;
            if (remainingGlobalQuestions !== null && remainingGlobalQuestions <= 0) break;
            if (remainingSectionQuestions !== null && remainingSectionQuestions <= 0) break;

            const isMcq = isMcqType(card.type || card.cardType || 'mcq');
            const shouldDowngrade = isMcq && insufficientMcqDecks.has(card.deckId);
            const resolvedType = shouldDowngrade ? 'type' : normalizeCardTypeForTest(card.type || card.cardType || 'mcq');
            
            const itemData = {
                cardId: card.id,
                deckId: card.deckId,
                type: resolvedType,
                cardType: card.cardType || card.type || 'basic', // Preserve original cardType
                marksAvailable: marksAvailable,
                question: card.question, // Snapshot content
                answer: card.answer,
                fingerprintAtStart: null // To be filled at runtime if needed
            };
            
            // Add type-specific data
            if (resolvedType === 'mcq' && !shouldDowngrade) {
                itemData.options = card.options;
            }
            if (resolvedType === 'cloze' || card.cardType === 'cloze') {
                itemData.text = card.text || card.question;
            }
            if (resolvedType === 'sequence' || card.cardType === 'sequence') {
                itemData.steps = card.steps;
            }
            
            sectionItems.push(itemData);
            sectionMarks += marksAvailable;
            if (remainingSectionQuestions !== null) remainingSectionQuestions -= 1;
            if (remainingGlobalQuestions !== null) remainingGlobalQuestions -= 1;
        }

        sections.push({
            id: sectionConfig.id,
            name: sectionConfig.name,
            items: sectionItems,
            totalMarks: sectionMarks
        });
        currentTotalMarks += sectionMarks;
        if (remainingGlobalQuestions !== null && remainingGlobalQuestions <= 0) break;
    }

    return {
        sections,
        totalMarks: currentTotalMarks,
        seed,
        warnings
    };
}

function shuffleWithRng(array, rng) {
    const newArray = [...array];
    for (let i = newArray.length - 1; i > 0; i--) {
        const j = rng.nextInt(0, i + 1);
        [newArray[i], newArray[j]] = [newArray[j], newArray[i]];
    }
    return newArray;
}

function resolvePositiveInt(value) {
    const num = Number(value);
    if (!Number.isFinite(num) || num <= 0) return null;
    return Math.floor(num);
}

function isMcqType(type) {
    const normalized = String(type || '').toLowerCase();
    return normalized.includes('mcq') || normalized.includes('multiple');
}

/**
 * Maps internal cardType to test form type for rendering
 * @param {string} cardType The card's cardType field
 * @returns {string} The normalized type for test forms
 */
export function normalizeCardTypeForTest(cardType) {
    const type = String(cardType || '').toLowerCase();
    
    // MCQ types
    if (type === 'mcq' || type.includes('multiple')) {
        return 'mcq';
    }
    
    // Cloze cards - render as type-in for tests
    if (type === 'cloze') {
        return 'cloze';
    }
    
    // Type-in answer cards
    if (type === 'basic_type_answer' || type === 'type_answer' || type === 'type') {
        return 'type';
    }
    
    // Image occlusion - treated as type-in for text-based fallback
    if (type === 'image_occlusion') {
        return 'image_occlusion';
    }
    
    // Sequence cards
    if (type === 'sequence') {
        return 'sequence';
    }
    
    // All flashcard-like types default to type-in for exams
    // (basic, basic_reversed, basic_optional_reversed, flashcard, vocab)
    return 'type';
}
