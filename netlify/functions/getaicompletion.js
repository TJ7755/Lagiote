// netlify/functions/getAiCompletion.js

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
    const { documents = [], cardType = 'flashcard', maxPerDocument = 'auto', language = 'auto' } = body;

    const combinedContent = documents.map(doc => `Title: ${doc.name}\nContent: ${doc.content}`).join('\n---\n');

    let prompt;
    if (cardType === 'sequence') {
      prompt = `You are an expert in instructional design and cognitive science. From the CONTENT TO PROCESS below, extract and create sequence-style study items (e.g., historical event timelines, biological processes, procedural steps). For each sequence, output a JSON array (minified, no extra text) of objects with the following shape:
      {"title":"Short title","description":"One-line description (optional)","steps":["step 1","step 2", ...]}

      RULES:
      - Each object must represent a single sequence (atomic).
      - Steps should be short, ordered, and concise.
      - Do not include commentary, explanations, or markdown; only return the JSON array.

      CONTENT TO PROCESS:
      ${combinedContent}`;
    } else {
      // default: flashcards
      prompt = `You are an expert learning assistant. Generate high-quality flashcards from the following content.
      RULES:
      - Each card must be a concise, self-contained piece of knowledge.
      - Extract only the most meaningful and testable information.
      - Return a JSON array (minified) where each element is {"question":"...","answer":"..."}.
      - Do not include any additional text or commentary.

      CONTENT TO PROCESS:
      ${combinedContent}`;
    }

    const result = await model.generateContent(prompt);
    const response = await result.response;
    const text = await response.text();
    const cleaned = stripCodeFences(text);

    // Try to parse JSON. If parsing fails for flashcards, fall back to returning raw text in flashcardText.
    try {
      const parsed = JSON.parse(cleaned);
      if (cardType === 'sequence') {
        return {
          statusCode: 200,
          body: JSON.stringify({ type: 'sequence', sequences: parsed }),
        };
      } else {
        return {
          statusCode: 200,
          body: JSON.stringify({ type: 'flashcard', cards: parsed }),
        };
      }
    } catch (err) {
      // If JSON parsing fails for flashcards, try to fall back to legacy tab-separated format
      if (cardType === 'flashcard') {
        return {
          statusCode: 200,
          body: JSON.stringify({ type: 'flashcard-legacy', flashcardText: cleaned }),
        };
      }
      console.error('Failed to parse AI response as JSON for sequences:', err);
      return {
        statusCode: 500,
        body: JSON.stringify({ error: 'Failed to parse AI response.' }),
      };
    }

  } catch (error) {
    console.error("AI Generation Error in Netlify Function:", error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: "An error occurred while generating the flashcards." }),
    };
  }
};