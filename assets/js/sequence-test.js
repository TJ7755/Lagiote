// Sequence Test Mode Logic
let testSequenceOrder = [];
let correctSequenceOrder = [];

function initSequenceTest(cards) {
    // Get the original order of cards
    correctSequenceOrder = [...cards].sort((a, b) => a.order - b.order);
    // Create a shuffled version for testing
    testSequenceOrder = [...cards].sort(() => Math.random() - 0.5);
    
    // Show sequence view and hide regular view
    document.getElementById('testSequenceView').classList.remove('hidden');
    document.getElementById('testRegularView').classList.add('hidden');
    
    // Populate the drag-drop list
    const listContainer = document.getElementById('testDragDropList');
    listContainer.innerHTML = '';
    
    testSequenceOrder.forEach((card, index) => {
        const itemDiv = document.createElement('div');
        itemDiv.className = 'drag-item';
        itemDiv.setAttribute('data-id', card.id);
        itemDiv.style.padding = '15px';
        itemDiv.style.marginBottom = '10px';
        itemDiv.style.background = 'var(--card-bg)';
        itemDiv.style.border = '2px solid var(--border-color)';
        itemDiv.style.borderRadius = '10px';
        itemDiv.style.cursor = 'grab';
        itemDiv.innerHTML = card.question;
        listContainer.appendChild(itemDiv);
    });

    // Initialize Sortable
    new Sortable(listContainer, {
        animation: 150,
        ghostClass: 'drag-ghost',
        chosenClass: 'drag-chosen'
    });
}

function checkTestSequence() {
    const currentOrder = Array.from(document.getElementById('testDragDropList').children)
        .map(item => item.getAttribute('data-id'));
    
    const correctIds = correctSequenceOrder.map(card => card.id);
    const isCorrect = currentOrder.every((id, index) => id === correctIds[index]);
    
    if (isCorrect) {
        practiceTestState.correctCount++;
        showToast("Correct sequence!", "success");
    } else {
        practiceTestState.incorrectCount++;
        showToast("That's not quite right. Keep practicing!", "error");
    }
    
    // Show the next question or finish the test
    nextTestQuestion();
}