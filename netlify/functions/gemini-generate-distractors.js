// netlify/functions/gemini-generate-distractors.js

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  try {
    const { question, answer } = JSON.parse(event.body);
    const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

    if (!GEMINI_API_KEY) {
        throw new Error("Gemini API key is not configured on the server.");
    }

    const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${GEMINI_API_KEY}`;
    
    // --- This is the same prompt logic from your original main.js ---
    const prompt = `You are an expert quiz creator. For the following flashcard, generate exactly three plausible but incorrect multiple-choice options (distractors).

    Question: "${question}"
    Correct Answer: "${answer}"

    Rules:
    1. The distractors must be in the same language as the correct answer.
    2. The distractors should be related to the question's topic to be challenging.
    3. Provide ONLY the three incorrect options, each on a new line.
    4. DO NOT include the correct answer, any numbering, or any extra text.
    5. Make sure the distractors are similar in length and complexity to the correct answer.`;
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
    const distractors = textResponse.split('\n').filter(line => line.trim() !== '');

    return {
      statusCode: 200,
      body: JSON.stringify(distractors),
    };

  } catch (error) {
    console.error('Netlify Function Error (generate-distractors):', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Failed to generate distractors.' }),
    };
  }
};