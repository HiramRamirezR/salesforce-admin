
// Node 22 has native fetch, no need for node-fetch
exports.handler = async (event, context) => {
  // Solo permitir peticiones POST
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method Not Allowed" };
  }

  const { userAnswer, unit } = JSON.parse(event.body);
  const apiKey = process.env.GEMINI_API_KEY;

  if (!apiKey) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: "API Key missing on server" })
    };
  }

  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`;

  const systemPrompt = `
    You are a strict Salesforce Certification Proctor. 
    Evaluate the User Answer against the Reference Answer for the concept: "${unit.concept}".

    RULES:
    1. Be extremely strict with technical terms. 
    2. Check if the user mentioned these key terms: ${unit.keyTerms.join(", ")}.
    3. If the logic is correct and terms are used, score high.
    4. If the logic is flawed or terms are missing, score low.

    Output MUST be a valid JSON:
    {
      "score": number (0-100),
      "isCorrect": boolean (true if score >= 85),
      "feedback": "Short feedback in English explaining what was missed.",
      "masteryIncrement": boolean (true if score >= 90),
      "missingTerms": ["list", "of", "missing", "key", "terms"]
    }
  `;

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{
          parts: [{
            text: `${systemPrompt}\n\nReference Answer: ${unit.referenceAnswer}\nUser Answer: ${userAnswer}`
          }]
        }]
      })
    });

    const data = await response.json();
    console.log("Gemini Raw Response:", JSON.stringify(data));

    if (!data.candidates || !data.candidates[0].content.parts[0].text) {
      throw new Error("Invalid response from Gemini API: " + JSON.stringify(data));
    }

    const resultText = data.candidates[0].content.parts[0].text;
    const cleanJson = resultText.replace(/```json/g, "").replace(/```/g, "").trim();

    console.log("Cleaned JSON for frontend:", cleanJson);

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: cleanJson
    };
  } catch (error) {
    console.error("Function Error:", error);
    return {
      statusCode: 500,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ error: "AI Evaluation Failed", details: error.message })
    };
  }
};
