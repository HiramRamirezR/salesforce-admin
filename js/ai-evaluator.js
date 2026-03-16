
export async function evaluateMastery(userAnswer, unit, history = []) {
    // We now call our own secure Netlify Function instead of the direct Gemini API
    const url = '/.netlify/functions/evaluate';

    try {
        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ userAnswer, unit, history })
        });

        if (!response.ok) {
            const errData = await response.json();
            throw new Error(errData.error || "Server error");
        }

        const responseText = await response.text();
        
        try {
            return JSON.parse(responseText);
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
