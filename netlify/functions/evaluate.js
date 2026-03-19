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
      4. Language: English.
    `;
  } else if (mode === 'quiz_generation') {
    const topic = safeConcepts.length > 0 ? safeConcepts[0].category : "Salesforce";
    sysInstruction = `
      You are a Salesforce Certification Exam Writer. 
      Generate 10 high-quality practice questions for the topic: "${topic}".
      Target Concepts: ${safeConcepts.map(c => c.concept).join(", ")}.

      RULES:
      1. COMPOSITION: Generate exactly 10 questions. 
         - Mix Single Choice (Radio) and Multiple Choice (Checkbox).
      2. FORMAT: 
         - Use scenario-based questions (Business cases).
         - Each question must have 4 or 5 options.
         - For Multiple Choice, explicitly state "Choose 2", "Choose 3", etc. in the question text.
         - CRITICAL: If you state "Choose X", you MUST mark EXACTLY X options as isCorrect: true. Don't mismatch.
      3. OUTPUT: MUST BE A VALID JSON ARRAY with the following structure:
      [
        {
          "question": "Scenario text... (Choose X)",
          "category": "${topic}",
          "concept": "Name of the concept from the Target Concepts list. If related to multiple, Pick the most relevant one(s) and comma-separate them.",
          "explanation": "Detailed why...",
          "options": [
            { "text": "Option A", "isCorrect": boolean },
            { "text": "Option B", "isCorrect": boolean }
          ]
        }
      ]
      4. Language: English. No intro/outro text.
    `;
  } else {
    // STUDY MODE: Explaining Teacher
    sysInstruction = `
      You are an expert Salesforce Instructor. Your goal is to explain concepts clearly but CONCISELY.
      Target Concept: "${unit ? unit.concept : 'General Salesforce'}".
      Detailed Explanation: "${unit ? unit.referenceAnswer : ''}".
      Key Terms: ${unit && unit.keyTerms ? unit.keyTerms.join(", ") : ''}.

      RULES:
      1. TEACHER MODE: Provide direct, high-impact explanations. Avoid long introductions.
      2. CONCISENESS: Limit your initial response to max 2-3 short paragraphs. Use bullet points for technical details.
      3. Encourage the user to ask follow-up questions if they need more depth.
      4. Answer in the same language as the user's input (English).
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

    // This function is intended to be a helper for database operations.
    // For a Netlify function, it would typically be defined outside the handler
    // or imported from another file. If it relies on 'db', 'collection', etc.,
    // those would also need to be imported/defined in this scope.
    // As per the instruction, it's placed here, but note the typical structure.
    // Assuming 'db', 'collection', 'where', 'query', 'getDocs', 'doc', 'updateDoc',
    // 'increment', 'MASTERY_COL', 'clearCache' are defined or imported elsewhere
    // in the actual project setup for this file to be syntactically correct.
    async function recordUnitExamFailure(conceptString, category) {
        // Placeholder for actual Firebase/Firestore imports and initialization
        // const { db, collection, where, query, getDocs, doc, updateDoc, increment } = require('./firebase-config'); // Example
        // const MASTERY_COL = "mastery"; // Example
        // const clearCache = () => {}; // Example

        const colRef = collection(db, MASTERY_COL);
        // Split by comma in case the AI combined multiple concepts
        const conceptNames = conceptString.split(',').map(c => c.trim());
        
        for (const conceptName of conceptNames) {
            // Try exact match first
            const q = query(colRef, where("concept", "==", conceptName), where("category", "==", category));
            let snapshot = await getDocs(q);
            
            // If not found, try a more flexible match (if possible with Firestore)
            // For now, let's stick to exact or name-based if categorized is too strict
            if (snapshot.empty) {
                const q2 = query(colRef, where("concept", "==", conceptName));
                snapshot = await getDocs(q2);
            }

            if (!snapshot.empty) {
                const docRef = doc(db, MASTERY_COL, snapshot.docs[0].id);
                await updateDoc(docRef, {
                    examFailures: increment(1)
                });
                clearCache();
            }
        }
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
