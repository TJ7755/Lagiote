/**
 * LLM Grading Module
 * Optional support for grading long answers using Gemini.
 */

/**
 * Grades a long answer using Gemini.
 * @param {Object} params
 * @param {string} params.prompt The question prompt
 * @param {string} params.rubric The marking rubric or key points
 * @param {string} params.studentAnswer The student's answer
 * @param {number} params.maxMarks Maximum marks available
 * @param {string} params.apiKey Gemini API Key
 * @returns {Promise<Object>} { marks, rationale }
 */
export async function gradeLongAnswerWithGemini({ prompt, rubric, studentAnswer, maxMarks, apiKey }) {
    if (!apiKey) {
        throw new Error("No API Key provided for LLM grading.");
    }

    const systemPrompt = `You are an expert examiner. Grade the following student answer based on the question and rubric provided.
    
    Question: ${prompt}
    Rubric/Key Points: ${rubric}
    Max Marks: ${maxMarks}
    
    Student Answer: ${studentAnswer}
    
    Provide a JSON response with:
    - "marks": number (integer or half-mark, 0 to ${maxMarks})
    - "rationale": string (brief explanation of the grade, max 50 words)
    
    Be strict but fair. Do not hallucinate marks. If the answer is irrelevant, give 0.`;

    try {
        const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-pro:generateContent?key=${apiKey}`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                contents: [{
                    parts: [{
                        text: systemPrompt
                    }]
                }]
            })
        });

        if (!response.ok) {
            throw new Error(`Gemini API Error: ${response.statusText}`);
        }

        const data = await response.json();
        const text = data.candidates[0].content.parts[0].text;
        
        // Parse JSON from text (handle potential markdown wrapping)
        const jsonMatch = text.match(/\{[\s\S]*\}/);
        if (!jsonMatch) {
            throw new Error("Invalid response format from LLM");
        }
        
        const result = JSON.parse(jsonMatch[0]);
        return {
            marks: Math.min(maxMarks, Math.max(0, Number(result.marks))),
            rationale: result.rationale
        };

    } catch (error) {
        console.error("LLM Grading Failed:", error);
        return { marks: 0, rationale: "Grading failed: " + error.message };
    }
}
