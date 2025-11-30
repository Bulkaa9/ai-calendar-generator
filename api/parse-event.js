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
You are a highly accurate date calculator. 
User's Current Reference Time: "${referenceTime}"
User Input: "${input}"

Instructions:
1. Parse the input into an ARRAY of events.
2. RECURRENCE RULES:
   - Be EXHAUSTIVE. If the user says "every Monday in December", you MUST find EVERY single Monday in that month.
   - Check the FIRST week and the LAST week of the month carefully.
   - Do not stop until you have covered the entire requested date range.
3. If no specific range is given (e.g., just "every Monday"), assume the next 4 occurrences.
4. Return ONLY a JSON object with this structure:
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
- Return times in ISO 8601 WITHOUT timezone (Floating Time). No 'Z' at the end.
- Use 24-hour format for the time (e.g., 17:00:00).
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
            content: "You are a precise calendar assistant. You never miss a date in a sequence.",
          },
          {
            role: "user",
            content: prompt,
          },
        ],
        temperature: 0.1, // Lower temperature = more strict/mathematical
        max_tokens: 1500,
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