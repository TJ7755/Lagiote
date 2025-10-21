function handleArchetypeChange(select) {
    const cardItem = select.closest('.flashcard-item');
    const standardInputs = cardItem.querySelector('.standard-inputs');
    const sequenceInputs = cardItem.querySelector('.sequence-inputs');
    
    if (select.value === 'SEQUENCE') {
        standardInputs.classList.add('hidden');
        sequenceInputs.classList.remove('hidden');
    } else {
        standardInputs.classList.remove('hidden');
        sequenceInputs.classList.add('hidden');
    }
}

function editorSaveDeck() {
    const saveBtn = document.querySelector('.editor-container .actions-section .btn-success');
    const originalText = saveBtn.innerHTML;
    saveBtn.innerHTML = '<span class="spinner" style="border-width:2px; width:16px; height:16px;"></span> Saving...';
    saveBtn.disabled = true;
    const name = document.getElementById('deckTitle').value.trim();
    const category = document.getElementById('deckCategory').value;
    const notes = document.getElementById('deckNotes').value.trim();
    if (!name) { 
        showToast('Please enter a title for your deck.', 'error');
        return;
    }
    
    const cards = Array.from(document.querySelectorAll('#editorView .flashcard-item')).map(el => {
        const archetype = el.querySelector('.archetype-select').value;
        const baseCard = {
            id: Date.now() + Math.random(),
            archetype,
            isNew: true,
            questionImage: el.querySelector('.question-image-input')?.value.trim() || '',
            answerImage: el.querySelector('.answer-image-input')?.value.trim() || ''
        };
        
        if (archetype === 'SEQUENCE') {
            const sequenceText = el.querySelector('.sequence-input').value;
            const items = sequenceText.split('\n')
                .map(item => item.trim())
                .filter(item => item.length > 0);
            return {
                ...baseCard,
                question: 'Arrange in correct order:',
                answer: items.join(' → '),
                content: { items }
            };
        } else {
            return {
                ...baseCard,
                question: el.querySelector('.question-input').value.trim(),
                answer: el.querySelector('.solution-input').value.trim()
            };
        }
    }).filter(c => (c.archetype === 'SEQUENCE' ? c.content?.items?.length > 0 : (c.question || c.questionImage)));

    if (cards.length === 0) { 
        showToast('Please add at least one complete flashcard.', 'error');
        saveBtn.innerHTML = originalText;
        saveBtn.disabled = false;
        return;
    }
    
    if (currentDeckId) {
        const deck = decks[currentDeckId];
        deck.name = name;
        deck.category = category;
        deck.cards = cards;
        deck.notes = notes;
        deck.learnState = {
            buckets: [[...cards], ...Array.from({length: deck.settings.maxBuckets - 1}, () => [])],
            currentRound: 1,
            maxBuckets: deck.settings.maxBuckets
        };
        deck.reviewState = { 
            stillLearning: [...cards],
            correct: [],
            currentRound: 1,
            lastRoundIncorrect: []
        };
        saveDataToDB('decks', deck).then(() => {
            showToast('Deck saved successfully!');
            backToDashboard();
        }).catch(error => {
            showToast('Error saving deck', 'error');
            console.error('Error saving deck:', error);
        });
    } else {
        createNewDeck(name, category, cards, notes).then(() => {
            showToast('Deck created successfully!');
            backToDashboard();
        }).catch(error => {
            showToast('Error creating deck', 'error');
            console.error('Error creating deck:', error);
        });
    }
    saveBtn.innerHTML = originalText;
    saveBtn.disabled = false;
}