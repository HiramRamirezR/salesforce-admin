exports.handler = async (event, context) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method Not Allowed" };
  }

  let body;
  try {
    body = JSON.parse(event.body);
  } catch (err) {
    return { statusCode: 400, body: "Invalid JSON in request body" };
  }

  const { userAnswer, unit, history = [], mode = 'mastery', concepts = [] } = body;
  const apiKey = process.env.GEMINI_API_KEY;

  if (!apiKey) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: "API Key missing on server" })
    };
  }

  // Model selection: gemini-2.5-flash as requested by the user.
  const model = "gemini-2.5-flash";
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

  let sysInstruction = "";

  // Ensure concepts is an array for safe processing
  const safeConcepts = Array.isArray(concepts) ? concepts : [];

  if (mode === 'mastery') {
    sysInstruction = `
      You are a Salesforce Certification Tutor using an Aristotelian/Socratic learning method.
      Target Concept: "${unit.concept}".
      Reference Answer: "${unit.referenceAnswer}".
      Key Terms: ${unit.keyTerms.join(", ")}.

      RULES:
      1. EVALUATION: Calculate a "score" (0-100). 
         - Use the "Reference Answer" as the maximum standard for 100%. If the user's answer is technically equivalent in content and logic to the reference answer, you MUST award a 100%.
         - Focus ONLY on technical accuracy and the presence of "Key Terms". Do not penalize for writing style, brevity, or minor grammar issues.
         - If the user answer covers all major points of the concept correctly, award 100%.
      2. SOCRATIC MODE: 
         - If the score is 100, congratulate the user briefly.
         - If the score is < 100, DO NOT GIVE THE ANSWER. Instead, formulate a question or a hint that guides the user to discover the missing concepts or terms themselves.
         - If the answer is almost perfect (approx 95%), round up to 100% to encourage the user.
      3. JSON OUTPUT IS MANDATORY:
      {
        "score": number,
        "isCorrect": boolean,
        "feedback": "Your Socratic response",
        "masteryIncrement": boolean (true ONLY if score == 100 and no previous history)
      }
      }
      4. Language: English.
    `;
  } else if (mode === 'distractor_analysis') {
    sysInstruction = `
      You are a Salesforce Certification Coach. 
      The user chose an INCORRECT option in a scenario-based question.
      
      TASK: 
      1. CRACK THE TRAP: Identify why a student would pick the user's incorrect choice (what's the "trap"?).
      2. ELIMINATION LOGIC: Explain the technical reason why it's wrong in 1-2 surgical sentences.
      3. GUIDANCE: Remind the user of the "Rule of Thumb" for this specific Salesforce feature.
      
      Keep it brief, encouraging, and highly technical. No intro/outro.
      Use <b>tags for emphasis.
      
      JSON OUTPUT:
      {
        "feedback": "Your surgical trap analysis..."
      }
    `;
  } else if (mode === 'quiz_generation') {
    const topic = safeConcepts.length > 0 ? safeConcepts[0].category : "Salesforce";
    sysInstruction = `
      You are a Salesforce Certification Exam Writer. 
      Generate 10 high-quality practice questions for the topic: "${topic}".
      Target Concepts: ${safeConcepts.map(c => c.concept).join(", ")}.

      RULES:
      1. COMPOSITION: Generate exactly 10 items. 
         - 7 or 8 items MUST be scenario-based (Multiple Choice / Checkbox).
         - 2 or 3 items MUST be INTERACTIVE PUZZLES (type: 'drag_and_drop').
      
      2. MULTIPLE CHOICE FORMAT: 
         - Each MCQ must have 4 or 5 options.
         - Explicitly state "Choose X" in the question text.
         - Mark exactly X options as isCorrect: true.
      
      3. INTERACTIVE PUZZLE FORMAT (DRAG AND DROP):
         {
           "type": "drag_and_drop",
           "question": "Arrange these in the correct Order of Execution:",
           "category": "${topic}",
           "concept": "Order of Execution / Process Flow",
           "items": ["Workflows", "Before Triggers", "Escalation Rules", "Validation Rules"], (GENERATE SHUFFLED)
           "correctOrder": ["Validation Rules", "Before Triggers", "Workflows", "Escalation Rules"], (GENERATE CORRECT ORDER)
           "explanation": "Provide the technical sequencing logic of Salesforce for these specific items."
         }
         - Puzzles can be about Order of Execution, Setup Paths (First Step to Last), or Relationship Hierarchy.

      4. OUTPUT: MUST BE A VALID JSON ARRAY with a mix of regular and interactive objects.
      5. Language: English. No intro/outro text.
    `;
  } else if (mode === 'blueprint') {
    sysInstruction = `
      You are a Salesforce Architect providing a TECHNICAL BLUEPRINT.
      Target Concept: "${unit ? unit.concept : 'General Salesforce'}".
      Context: "${unit ? unit.referenceAnswer : ''}".
      
      MANDATORY SURGICAL FORMAT:
      1. SETUP PATH: (Arrow format: Setup > Object > ...)
      2. WORKFLOW: (Exactly 3 short bullet points)
      3. LIMITS: (Exactly 3 most important technical limits)
      
      RULES:
      - NO INTRO/OUTRO. 
      - Be direct and concise.
      - Use <b> tags for emphasis, NO Markdown **bolding**.
      
      { "feedback": "Your structured blueprint here" }
    `;
  } else if (mode === 'practice_challenge') {
    sysInstruction = `
      You are a Salesforce Mentor. 
      Target: "${unit ? unit.concept : 'General Salesforce'}".
      
      TASK: Generate a single, challenging hands-on task for a Developer Edition org.
      FORMAT:
      - MISSION: One-sentence high-level goal.
      - REQUIREMENTS: 3 specific technical criteria they must build to prove mastery.
      - TIP: One surgical tip about a common mistake in this setup.
      
      Keep it brief and professional.
      { "feedback": "Your practice mission here" }
    `;
  } else {
    // GENERAL STUDY / CHAT TUTOR (Conversational)
    sysInstruction = `
      You are an expert Salesforce Certification Tutor. 
      Target Concept: "${unit ? unit.concept : 'General Salesforce'}".
      Reference Data: "${unit ? unit.referenceAnswer : ''}".

      TASK: Answer the user's question about this concept.
      RULES:
      1. STYLE: Be conversational, helpful, and professional. 
      2. CONTENT: Focus on explaining the "Why" and "How". 
      3. DO NOT repeat the flashcard definition unless asked.
      4. If the user is confused, use analogies or simpler comparisons.
      5. Keep it technical but readable.
      6. USE <b> tags for emphasis. NO Markdown **asterisks**.

      JSON OUTPUT:
      {
        "feedback": "Your conversational explanation here."
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

  if (mode !== 'quiz_generation') {
    contents.push({
      role: 'user',
      parts: [{ text: mode === 'mastery' ? `User Answer: ${userAnswer}` : `User Question/Comment: ${userAnswer}` }]
    });
  } else {
    // For quiz generation, providing a simple prompt to trigger the generation
    contents.push({
      role: 'user',
      parts: [{ text: "Generate the Salesforce quiz based on the provided instructions." }]
    });
  }

  try {
    const payload = {
      system_instruction: {
        parts: [{ text: sysInstruction }]
      },
      contents: contents,
      generationConfig: {
        response_mime_type: "application/json",
        max_output_tokens: 8192
      }
    };

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Gemini API error (${response.status}): ${errorText}`);
    }

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
