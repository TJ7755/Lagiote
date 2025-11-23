const { GoogleGenerativeAI } = require("@google/generative-ai");

function stripCodeFences(text) {
    return text.replace(/```json/g, '').replace(/```/g, '').trim();
}

exports.handler = async function (event, context) {
    if (event.httpMethod !== 'POST') {
        return { statusCode: 405, body: 'Method Not Allowed' };
    }

    try {
        const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
        const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });

        const body = JSON.parse(event.body || '{}');
        const { question, answer } = body;

        if (!question || !answer) {
            return { statusCode: 400, body: JSON.stringify({ error: "Missing question or answer" }) };
        }

        const prompt = `You are an expert teacher creating multiple choice questions.
Given the following flashcard:
Question: ${question}
Answer: ${answer}

Generate 3 plausible but incorrect answers (distractors) that are similar in length and style to the correct answer.
Return ONLY a JSON array of strings. Do not include any other text.
Example: ["Distractor 1", "Distractor 2", "Distractor 3"]`;

        const result = await model.generateContent(prompt);
        const response = await result.response;
        const text = await response.text();
        const cleaned = stripCodeFences(text).trim();

        let distractors;
        try {
            distractors = JSON.parse(cleaned);
        } catch (e) {
            console.error("Failed to parse JSON from AI:", cleaned);
            return { statusCode: 500, body: JSON.stringify({ error: "Failed to parse AI response" }) };
        }

        return {
            statusCode: 200,
            body: JSON.stringify({ distractors }),
        };

    } catch (error) {
        console.error("AI Distractor Generation Error:", error);
        return {
            statusCode: 500,
            body: JSON.stringify({ error: "An error occurred while generating distractors." }),
        };
    }
};
