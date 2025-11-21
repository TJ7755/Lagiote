// netlify/functions/gemini-autocomplete.js

const { GoogleGenerativeAI } = require("@google/generative-ai");

function stripCodeFences(text) {
  return text.replace(/```json/g, '').replace(/```/g, '').trim();
}

exports.handler = async function (event, context) {
  // Ensure the request is a POST
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  try {
    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });

    const body = JSON.parse(event.body || '{}');
    const { deckContent = [], currentCard = {}, fieldType = 'question' } = body;

    // Build context from existing deck content
    const deckContext = deckContent.map((card, index) => {
      return `Card ${index + 1}:
Question: ${card.question || ''}
Answer: ${card.answer || ''}`;
    }).join('\n\n');

    // Get current card content
    const currentQuestion = currentCard.question || '';
    const currentAnswer = currentCard.answer || '';
    const isCompletingQuestion = fieldType === 'question';
    const currentText = isCompletingQuestion ? currentQuestion : currentAnswer;
    const otherField = isCompletingQuestion ? currentAnswer : currentQuestion;

    const prompt = `You are an expert learning assistant helping to create flashcards. The user is manually creating a deck and needs help completing the current card they're working on.

EXISTING DECK CONTENT (for context and consistency):
${deckContext || '(No cards created yet)'}

CURRENT CARD BEING EDITED:
${isCompletingQuestion ? 'Question (in progress):' : 'Answer (in progress):'} ${currentText}
${isCompletingQuestion ? 'Answer:' : 'Question:'} ${otherField || '(not started)'}

INSTRUCTIONS:
- Based on the existing deck content, help complete the ${fieldType} field of the current card.
- The ${fieldType} field currently contains: "${currentText}"
- Your task is to suggest a completion that:
  1. Is consistent with the style and content of the existing cards
  2. Completes the thought started by the user
  3. Is concise and appropriate for a flashcard
  4. Maintains the same level of detail and format as other cards

Return ONLY the suggested completion text (the part that should be added to finish the ${fieldType}), without repeating what the user has already typed. If the ${fieldType} seems complete, return a short, helpful suggestion for improvement or the next logical card.

Do not include any explanations, markdown, or additional text - just return the completion suggestion.`;

    const result = await model.generateContent(prompt);
    const response = await result.response;
    const text = await response.text();
    const cleaned = stripCodeFences(text).trim();

    return {
      statusCode: 200,
      body: JSON.stringify({ suggestion: cleaned }),
    };

  } catch (error) {
    console.error("AI Autocomplete Error in Netlify Function:", error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: "An error occurred while generating the autocomplete suggestion." }),
    };
  }
};

