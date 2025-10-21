// In your main.js file for Electron

const { ipcMain } = require('electron');
const fetch = require('node-fetch'); // You may need to install this: npm install node-fetch

// The URL of your deployed Netlify site
const NETLIFY_FUNCTION_URL = 'https://lagiote-revise.netlify.app/.netlify/functions/getAiCompletion';

// This listener is triggered by window.electronAPI.generateDeck in the front-end
ipcMain.handle('generate-deck', async (event, { documents }) => {
  try {
    // The main process securely calls your cloud function
    const response = await fetch(NETLIFY_FUNCTION_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ documents }),
    });

    if (!response.ok) {
      throw new Error(`Netlify function failed with status: ${response.status}`);
    }

    const result = await response.json();

    // Parse the text response from the Netlify function into card objects
    const flashcards = result.flashcardText.split('\n').map(line => {
        const parts = line.split('\t');
        return parts.length === 2 && parts[0].trim() && parts[1].trim()
            ? { question: parts[0].trim(), answer: parts[1].trim() }
            : null;
    }).filter(Boolean);

    return flashcards; // Return the final array of card objects to the front-end

  } catch (error) {
    console.error("Error calling Netlify function from Electron:", error);
    // Propagate the error back to the front-end so it can be handled
    throw new Error("Failed to generate flashcards from the cloud service.");
  }
});

ipcMain.handle('generate-distractors', async (event, { question, answer }) => {
  try {
    const response = await fetch('https://lagiote-revise.netlify.app/.netlify/functions/generateDistractors', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ question, answer }),
    });

    if (!response.ok) {
      throw new Error(`Distractor function failed with status: ${response.status}`);
    }

    const result = await response.json();
    return result.distractors; // Return just the array of strings

  } catch (error) {
    console.error("Error calling distractor function from Electron:", error);
    throw new Error("Failed to generate distractors from the cloud service.");
  }
});