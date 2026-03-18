
export async function evaluateMastery(userAnswer, unit, history = [], mode = 'mastery') {
    // We now call our own secure Netlify Function instead of the direct Gemini API

    try {
        const concepts = arguments[4]?.concepts; // Extra context if needed
        const response = await fetch('/.netlify/functions/evaluate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ userAnswer, unit, history, mode, concepts })
        });

        if (!response.ok) {
            const errData = await response.json();
            throw new Error(errData.error || "Server error");
        }

        const responseText = (await response.text()).trim();
        
        try {
            // Remove markdown code blocks if the AI included them
            const cleanJSON = responseText.replace(/^```json\s*/i, '').replace(/\s*```$/i, '');
            return JSON.parse(cleanJSON);
        } catch (parseError) {
            console.error("Raw response that failed to parse:", responseText);
            throw new Error("Invalid server response format.");
        }
    } catch (error) {
        console.error("AI Evaluation Error:", error);
        return { 
            score: 0, 
            isCorrect: false, 
            feedback: "Error connecting to AI: " + error.message, 
            masteryIncrement: false,
            missingTerms: []
        };
    }
}
