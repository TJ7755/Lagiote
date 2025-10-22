// netlify/functions/generateDistractors.js

const { GoogleGenerativeAI } = require("@google/generative-ai");

exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  try {
    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash-lite" });

    const { question, answer } = JSON.parse(event.body);

    const prompt = `
      For the following flashcard, generate exactly three plausible but incorrect answer options (distractors).
      
      RULES:
      - The distractors must be in the same language and format as the correct answer.
      - Do not include the correct answer in your response.
      - Provide ONLY the distractors, each on a new line. Do not add any other text, labels, or numbers.
      - Make sure the distractors are similar in length and complexity to the correct answer.

      Question: "${question}"
      Correct Answer: "${answer}"

      Incorrect Options:
    `;

    const result = await model.generateContent(prompt);
    const response = await result.response;
    const text = response.text();

    const distractors = text.split('\n').map(d => d.trim()).filter(Boolean);

    return {
      statusCode: 200,
      body: JSON.stringify({ distractors }),
    };

  } catch (error) {
    console.error("Distractor Generation Error:", error);
    return { statusCode: 500, body: JSON.stringify({ error: "Failed to generate distractors." }) };
  }
};