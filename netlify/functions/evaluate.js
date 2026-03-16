exports.handler = async (event, context) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method Not Allowed" };
  }

  const { userAnswer, unit, history = [], mode = 'mastery' } = JSON.parse(event.body);
  const apiKey = process.env.GEMINI_API_KEY;

  if (!apiKey) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: "API Key missing on server" })
    };
  }

  const model = "gemini-2.5-flash"; 
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

  let sysInstruction = "";

  if (mode === 'mastery') {
    sysInstruction = `
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
      3. JSON OUTPUT IS MANDATORY:
      {
        "score": number,
        "isCorrect": boolean,
        "feedback": "Your Socratic response",
        "masteryIncrement": boolean (true ONLY if score == 100 and no previous history)
      }
    `;
  } else {
    // STUDY MODE: Explaining Teacher
    sysInstruction = `
      You are an expert Salesforce Instructor. Your goal is to explain concepts clearly but CONCISELY.
      Target Concept: "${unit.concept}".
      Detailed Explanation: "${unit.referenceAnswer}".
      Key Terms: ${unit.keyTerms.join(", ")}.

      RULES:
      1. TEACHER MODE: Provide direct, high-impact explanations. Avoid long introductions.
      2. CONCISENESS: Limit your initial response to max 2-3 short paragraphs. Use bullet points for technical details.
      3. Encourage the user to ask follow-up questions if they need more depth.
      4. Answer in the same language as the user's input (Spanish).
      5. JSON OUTPUT IS MANDATORY:
      {
        "score": 0,
        "isCorrect": true,
        "feedback": "Your concise teacher explanation.",
        "masteryIncrement": false
      }
    `;
  }

  const contents = [];
  history.forEach(msg => {
    contents.push({
      role: msg.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: msg.content }]
    });
  });

  contents.push({
    role: 'user',
    parts: [{ text: mode === 'mastery' ? `User Answer: ${userAnswer}` : `User Question/Comment: ${userAnswer}` }]
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

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: data.candidates[0].content.parts[0].text
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
