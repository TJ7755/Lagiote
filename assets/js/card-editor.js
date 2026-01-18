import { queueForSync } from './syncManager.js';

// Card type constants (mirrored from card-types.js for use in editor)
export const EDITOR_CARD_TYPES = {
    BASIC: 'basic',
    BASIC_REVERSED: 'basic_reversed',
    BASIC_OPTIONAL_REVERSED: 'basic_optional_reversed',
    BASIC_TYPE_ANSWER: 'basic_type_answer',
    CLOZE: 'cloze',
    IMAGE_OCCLUSION: 'image_occlusion',
    SEQUENCE: 'sequence'
};

// Note: The main editor functions (handleCardTypeChange, editorAddNewStandardCard, editorSaveDeck)
// are implemented in dashboard.js where they have access to the full application state.
// This file provides the card type constants for reference.

export { queueForSync };