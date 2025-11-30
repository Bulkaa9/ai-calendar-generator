export default async function handler(req, res) {
  // CORS headers
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { input, userContext } = req.body || {};
  
  if (!input) {
    return res.status(400).json({ error: "No input provided" });
  }

  try {
    const referenceTime = userContext || new Date().toString();

    const prompt = `
You are a precise calendar assistant.
User's Current Reference Time: "${referenceTime}"
User Input: "${input}"

Instructions:
1. Parse the input into an ARRAY of events.

2. **CRITICAL TIME RULE (FUTURE BIAS):**
   - You must ALWAYS generate dates in the FUTURE relative to the "User's Current Reference Time".
   - If the user mentions a month (e.g., "January") that has already passed in the current year, you MUST assume the NEXT year.

3. **DATE RANGE RULES (Inclusive):**
   - If the user says "from [Month A] to [Month B]", you must include ALL dates in [Month A] AND ALL dates in [Month B] (until the very last day of Month B).
   - Example: "January to March" means "Jan 1st through March 31st".
   - Do not stop at the beginning of the end month.

4. **RECURRENCE RULES:**
   - Be EXHAUSTIVE. Find every occurrence in the requested range.
   - If no specific end date is given (e.g. just "every Monday"), assume the next 4 occurrences.
   - DECISION LOGIC: Only create multiple events if keywords like "every", "weekly", "daily", "recurring" are present. Otherwise, create 1 event.

5. RETURN FORMAT (JSON Only):
{
  "events": [
    {
      "title": "event title",
      "start": "YYYY-MM-DDTHH:mm:ss", 
      "end": "YYYY-MM-DDTHH:mm:ss",
      "location": "location string",
      "description": "description string"
    }
  ]
}

Rules:
- Return times in ISO 8601 WITHOUT timezone (Floating Time).
- Use 24-hour format.
`;

    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: "gpt-3.5-turbo",
        messages: [
          {
            role: "system",
            content: "You are a logical calendar assistant. You treat date ranges as fully inclusive.",
          },
          {
            role: "user",
            content: prompt,
          },
        ],
        temperature: 0.1,
        max_tokens: 2000, // Increased to ensure it can fit 3+ months of weekly events
      }),
    });

    if (!response.ok) {
      const errorData = await response.json();
      return res.status(response.status).json({ error: "OpenAI API error", details: errorData });
    }

    const data = await response.json();
    let content = data.choices[0].message.content.trim();

    if (content.startsWith("```")) {
      content = content.replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
    }

    const parsedResult = JSON.parse(content);
    return res.status(200).json(parsedResult);
    
  } catch (err) {
    console.error("Server error:", err);
    return res.status(500).json({ error: "Internal error", details: err.message });
  }
}