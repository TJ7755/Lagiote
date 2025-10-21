// netlify/functions/getAiCompletion.js

const { GoogleGenerativeAI } = require("@google/generative-ai");

exports.handler = async function (event, context) {
  // Ensure the request is a POST
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  try {
    // Initialize the AI with your API key from Netlify environment variables
    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    
    // Use the updated, faster model
    const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });

    // Parse the documents sent from the front-end
    const { documents } = JSON.parse(event.body);

    // Combine all document content into a single string for the prompt
    const combinedContent = documents.map(doc => `Title: ${doc.name}\nContent: ${doc.content}`).join('\n---\n');
    
    const prompt = `
      You are an expert learning assistant. Generate high-quality flashcards from the following content.
      RULES:
      - Each card must be a concise, self-contained piece of knowledge.
      - Extract only the most meaningful and testable information.
      - Export in this exact format: TheQuestion<TAB>TheAnswer
      - Each flashcard must be on a new line.

      CONTENT TO PROCESS:
      ${combinedContent}
    `;

    const result = await model.generateContent(prompt);
    const response = await result.response;
    const text = response.text();

    // Send the raw text back to the client
    return {
      statusCode: 200,
      body: JSON.stringify({ flashcardText: text }),
    };

  } catch (error) {
    console.error("AI Generation Error in Netlify Function:", error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: "An error occurred while generating the flashcards." }),
    };
  }
};