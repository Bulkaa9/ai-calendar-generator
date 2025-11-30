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

  // Extract input AND userContext (the user's local time string)
  const { input, userContext } = req.body || {};
  
  if (!input) {
    return res.status(400).json({ error: "No input provided" });
  }

  try {
    // We use the user's local time string to ensure "tomorrow" is calculated based on THEIR timezone, not the server's.
    const referenceTime = userContext || new Date().toString();

    const prompt = `
You are a calendar event parser. Parse the following natural language input into a structured event.

User's Current Reference Time: "${referenceTime}"
User Input: "${input}"

Return ONLY a JSON object with this exact structure (no markdown, no explanations):
{
  "title": "event title",
  "start": "YYYY-MM-DDTHH:mm:ss",
  "end": "YYYY-MM-DDTHH:mm:ss",
  "location": "location if mentioned, otherwise empty string",
  "description": "any additional details, otherwise empty string"
}

IMPORTANT Rules:
1. Use the "User's Current Reference Time" to calculate relative dates (like "tomorrow", "next Friday", "in 2 hours").
2. Return the "start" and "end" times as ISO 8601 strings WITHOUT timezone information (Floating Time). 
   - CORRECT: "2025-11-30T16:00:00"
   - INCORRECT: "2025-11-30T16:00:00Z" (Do not add 'Z')
   - INCORRECT: "2025-11-30T16:00:00-05:00"
3. If no specific time is given, use 9:00 AM (09:00:00) as default start.
4. If no duration is given, default to 1 hour.
5. Return only the JSON object.
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
            content:
              "You are a helpful calendar assistant. You process dates based on the user's local time context. Always respond with valid JSON only.",
          },
          {
            role: "user",
            content: prompt,
          },
        ],
        temperature: 0.3,
        max_tokens: 200,
      }),
    });

    if (!response.ok) {
      const errorData = await response.json();
      return res
        .status(response.status)
        .json({ error: "OpenAI API error", details: errorData });
    }

    const data = await response.json();

    let content = data.choices[0].message.content.trim();

    // Remove ```json or ``` wrappers if present
    if (content.startsWith("```")) {
      content = content.replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
    }

    const parsedEvent = JSON.parse(content);
    return res.status(200).json(parsedEvent);
  } catch (err) {
    console.error("Server error:", err);
    return res.status(500).json({
      error: "Internal error",
      details: err.message,
    });
  }
}

