// netlify/functions/gemini-generate-deck.js

exports.handler = async (event) => {
  // Only allow POST requests
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  try {
    const { documents } = JSON.parse(event.body);
    const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

    if (!GEMINI_API_KEY) {
      throw new Error("Gemini API key is not configured on the server.");
    }
    
    const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_API_KEY}`;

    // --- This is the same prompt logic from your original main.js ---
    const contextString = documents.map((doc, index) => {
      const content = doc.type.startsWith('image/')
        ? `[Image named: ${doc.name}]`
        : doc.content;
      return `--- Document ${index + 1}: ${doc.name} ---\n${content}\n`;
    }).join('\n');

    const prompt = `You are an expert in cognitive science, tasked with creating scientifically-optimal, atomic flashcards by synthesizing information from the provided documents.

    ${contextString}

    Rules for creating the flashcards:
    1.  **Synthesize:** Base the flashcards on the information contained within the documents.
    2.  **Atomicity:** Each flashcard must test only ONE single, isolated piece of information.
    3.  **Clarity:** The question must be unambiguous and have one clear, correct answer.
    4.  **Brevity:** Keep questions and answers as short as possible.
    5.  **Comprehensiveness:** Cover all key concepts from the documents without redundancy.

    Return the output as a single, minified JSON array of objects, with no other text or explanation.

    Example format: [{"question":"What is the powerhouse of the cell?","answer":"Mitochondria"},{"question":"What is the chemical formula for water?","answer":"H2O"}]`;
    // --- End of prompt logic ---

    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }]
      })
    });

    if (!response.ok) {
      const errorBody = await response.json();
      console.error("Gemini API Error:", errorBody);
      return { statusCode: response.status, body: JSON.stringify(errorBody) };
    }

    const data = await response.json();
    const textResponse = data.candidates[0].content.parts[0].text;
    const cleanedJson = textResponse.replace(/```json/g, '').replace(/```/g, '').trim();
    
    // Return the successful response to the Electron app
    return {
      statusCode: 200,
      body: cleanedJson, // Send the cleaned JSON string directly
    };

  } catch (error) {
    console.error('Netlify Function Error (generate-deck):', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Failed to generate deck.' }),
    };
  }
};