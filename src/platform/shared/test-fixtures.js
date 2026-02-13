const NOW = new Date().toISOString();

const learnDeck = {
    id: 'deck-learn',
    name: 'Learn Mode Deck',
    category: 'Science',
    notes: 'Test learn deck',
    typeHint: 'General',
    settings: {
        learnMode: 'flashcard',
        reviewMode: 'flashcard',
        adaptiveModes: { auto: false, mcq: true, cloze: true }
    },
    cards: [
        {
            id: 'learn-1',
            question: 'Water formula?',
            answer: 'H2O',
            distractors: ['Oxygen', 'Hydrogen', 'Carbon'],
            testQuestionType: 'Flashcard'
        },
        {
            id: 'learn-2',
            question: 'Capital of France?',
            answer: 'Paris',
            distractors: ['Berlin', 'Madrid', 'Rome'],
            testQuestionType: 'Type'
        },
        {
            id: 'learn-3',
            question: 'Photosynthesis happens in the chloroplast.',
            answer: 'chloroplast',
            distractors: ['mitochondria', 'ribosome', 'nucleus'],
            testQuestionType: 'Cloze'
        },
        {
            id: 'learn-4',
            question: 'Largest planet in the Solar System?',
            answer: 'Jupiter',
            distractors: ['Mars', 'Earth', 'Venus'],
            testQuestionType: 'MultipleChoice'
        }
    ]
};

const reviewDeck = {
    id: 'deck-review',
    name: 'Review Deck',
    category: 'History',
    notes: 'Review and spaced deck',
    typeHint: 'General',
    settings: {
        learnMode: 'write',
        reviewMode: 'flashcard',
        adaptiveModes: { auto: true, mcq: true, cloze: true }
    },
    cards: [
        { id: 'review-1', question: 'Year the Berlin Wall fell?', answer: '1989', distractors: ['1979', '1991', '1985'] },
        { id: 'review-2', question: 'First President of the USA?', answer: 'George Washington', distractors: ['John Adams', 'Thomas Jefferson', 'James Madison'] },
        { id: 'review-3', question: 'Roman numeral for 50?', answer: 'L', distractors: ['V', 'C', 'D'] },
        { id: 'review-4', question: 'Empire that built the Colosseum?', answer: 'Roman Empire', distractors: ['Ottoman Empire', 'Mongol Empire', 'British Empire'] },
        { id: 'review-5', question: 'Renaissance city-state famous for art?', answer: 'Florence', distractors: ['Venice', 'Milan', 'Rome'] }
    ]
};

const sequenceDeck = {
    id: 'deck-sequence',
    name: 'Water Cycle',
    category: 'Science',
    notes: 'Sequence deck',
    typeHint: 'Sequence',
    sequenceMeta: {
        'seq-1': {
            title: 'Water Cycle',
            description: 'Core steps'
        }
    },
    cards: [
        { id: 'seq-1-1', sequenceId: 'seq-1', sequenceTitle: 'Water Cycle', order: 0, question: 'Evaporation', answer: 'Evaporation' },
        { id: 'seq-1-2', sequenceId: 'seq-1', sequenceTitle: 'Water Cycle', order: 1, question: 'Condensation', answer: 'Condensation' },
        { id: 'seq-1-3', sequenceId: 'seq-1', sequenceTitle: 'Water Cycle', order: 2, question: 'Precipitation', answer: 'Precipitation' },
        { id: 'seq-1-4', sequenceId: 'seq-1', sequenceTitle: 'Water Cycle', order: 3, question: 'Collection', answer: 'Collection' }
    ],
    settings: {
        sequenceMixingThreshold: 0.8,
        sequenceAllowMixed: true
    }
};

const legacySequenceDeck = {
    id: 'deck-sequence-legacy',
    name: 'Legacy Sequence',
    category: 'Science',
    notes: 'Legacy sequence deck without metadata',
    sequenceSteps: [
        'Stage One',
        'Stage Two',
        'Stage Three'
    ],
    cards: []
};

const sequenceOrderDeck = {
    id: 'deck-sequence-order',
    name: 'Sequence Order Deck',
    category: 'Science',
    notes: 'Sequence deck with numeric card ids for order tasks',
    typeHint: 'Sequence',
    sequenceMeta: {
        'seq-order-1': {
            title: 'Assembly Steps',
            description: 'Order the steps'
        }
    },
    cards: [
        { id: 12, sequenceId: 'seq-order-1', sequenceTitle: 'Assembly Steps', order: 0, question: 'Unbox parts', answer: 'Unbox parts' },
        { id: 13, sequenceId: 'seq-order-1', sequenceTitle: 'Assembly Steps', order: 1, question: 'Attach base', answer: 'Attach base' },
        { id: 14, sequenceId: 'seq-order-1', sequenceTitle: 'Assembly Steps', order: 2, question: 'Secure fasteners', answer: 'Secure fasteners' },
        { id: 15, sequenceId: 'seq-order-1', sequenceTitle: 'Assembly Steps', order: 3, question: 'Check alignment', answer: 'Check alignment' },
        { id: 16, sequenceId: 'seq-order-1', sequenceTitle: 'Assembly Steps', order: 4, question: 'Power on', answer: 'Power on' }
    ],
    settings: {
        sequenceMixingThreshold: 0.8,
        sequenceAllowMixed: true
    }
};

const practiceDeck = {
    id: 'deck-practice',
    name: 'Practice Test Deck',
    category: 'Maths',
    notes: 'Practice test deck',
    typeHint: 'General',
    settings: {
        learnMode: 'write',
        reviewMode: 'flashcard',
        adaptiveModes: { auto: true, mcq: true, cloze: true }
    },
    cards: [
        { id: 'practice-1', question: '2 + 2', answer: '4', options: ['3', '5', '6'] },
        { id: 'practice-2', question: '5 x 6', answer: '30', type: 'type' },
        { id: 'practice-3', question: 'Square root of 81', answer: '9', options: ['7', '8', '10'] },
        { id: 'practice-4', question: '12 / 3', answer: '4', type: 'type' }
    ]
};

export function getTestFixtures() {
    return {
        seededAt: NOW,
        categories: ['Science', 'Maths', 'Language', 'History', 'Other'],
        decks: [learnDeck, reviewDeck, sequenceDeck, legacySequenceDeck, sequenceOrderDeck, practiceDeck]
    };
}
