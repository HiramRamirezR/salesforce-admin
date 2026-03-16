
// Node 22 has native fetch, no need for node-fetch
exports.handler = async (event, context) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method Not Allowed" };
  }

  const { userAnswer, unit, history = [] } = JSON.parse(event.body);
  const apiKey = process.env.GEMINI_API_KEY;

  if (!apiKey) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: "API Key missing on server" })
    };
  }

  // Use the specific model requested by user or fallback
  const model = "gemini-2.5-flash"; // Or use "gemini-2.5-flash" if available/selected by user
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

  const sysInstruction = `
    You are a Salesforce Certification Tutor using an Aristotelian/Socratic learning method.
    Target Concept: "${unit.concept}".
    Reference Answer: "${unit.referenceAnswer}".
    Key Terms: ${unit.keyTerms.join(", ")}.

    RULES:
    1. EVALUATION: Calculate a "score" (0-100) based on how complete and technically accurate the User Answer is. Be extremely strict with technical terms.
    2. SOCRATIC MODE: 
       - If the score is 100, congratulate the user.
       - If the score is < 100, DO NOT GIVE THE ANSWER. Instead, formulate a question or a hint that guides the user to discover the missing concepts or terms themselves.
       - If the user seems stuck after multiple attempts, provide a slightly more direct hint but still avoid giving the full answer.
    3. JSON OUTPUT IS MANDATORY. You must return ONLY a JSON object with this structure:
    {
      "score": number,
      "isCorrect": boolean (true ONLY if score == 100),
      "feedback": "Your Socratic response/hint or Congratulations",
      "masteryIncrement": boolean (true ONLY if score == 100 and there is no previous history),
      "missingTerms": ["list", "of", "missing", "key", "terms"]
    }
  `;

  const contents = [];

  // Add history to contents
  history.forEach(msg => {
    contents.push({
      role: msg.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: msg.content }]
    });
  });

  // Add the current answer
  contents.push({
    role: 'user',
    parts: [{ text: `User Answer: ${userAnswer}` }]
  });

  try {
    const payload = {
      system_instruction: {
        parts: [{ text: sysInstruction }]
      },
      contents: contents,
      generationConfig: {
        response_mime_type: "application/json"
      }
    };

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    const data = await response.json();

    if (!data.candidates || !data.candidates[0].content.parts[0].text) {
      throw new Error("Invalid response from Gemini API: " + JSON.stringify(data));
    }

    const resultText = data.candidates[0].content.parts[0].text;

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: resultText // Already JSON since we requested application/json
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
