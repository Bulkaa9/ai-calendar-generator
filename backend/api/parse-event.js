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

  const { input } = req.body || {};
  if (!input) {
    return res.status(400).json({ error: "No input provided" });
  }

  try {
    const prompt = `
You are a calendar event parser. Parse the following natural language input into a structured event.

Current date and time: ${new Date().toISOString()}

User input: "${input}"

Return ONLY a JSON object with this exact structure (no markdown, no explanations):
{
  "title": "event title",
  "start": "ISO 8601 datetime",
  "end": "ISO 8601 datetime",
  "location": "location if mentioned, otherwise empty string",
  "description": "any additional details, otherwise empty string"
}

Rules:
- If no specific time given, use 9:00 AM as default start
- If no duration given, default to 1 hour
- If "tomorrow" mentioned, use tomorrow's date
- If "next [day]" mentioned, find the next occurrence of that day
- Always return valid ISO 8601 datetime strings
- Return only the JSON object, nothing else`;

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
              "You are a helpful calendar assistant that parses natural language into structured event data. Always respond with valid JSON only.",
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
    return res.status(500).json({
      error: "Internal error",
      details: err.message,
    });
  }
}

