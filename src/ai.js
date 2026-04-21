const OPENAI_URL = "https://api.openai.com/v1/chat/completions";

function extractJSONObject(rawText) {
  if (!rawText) return null;

  const direct = rawText.trim();
  if (direct.startsWith("{") && direct.endsWith("}")) {
    return direct;
  }

  const first = rawText.indexOf("{");
  const last = rawText.lastIndexOf("}");
  if (first === -1 || last === -1 || last <= first) {
    return null;
  }

  return rawText.slice(first, last + 1);
}

async function callOpenAIJSON({ systemPrompt, userPrompt, model }) {
  const apiKey = process.env.OPENAI_API_KEY;
  const resolvedModel = model || process.env.OPENAI_MODEL || "gpt-4.1-mini";

  if (!apiKey) {
    throw new Error("Missing OPENAI_API_KEY");
  }

  const response = await fetch(OPENAI_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model: resolvedModel,
      temperature: 0.7,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt }
      ],
      response_format: { type: "json_object" }
    })
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`OpenAI error ${response.status}: ${errorText}`);
  }

  const data = await response.json();
  const content = data?.choices?.[0]?.message?.content;
  const jsonString = extractJSONObject(content);
  if (!jsonString) {
    throw new Error("Model did not return JSON");
  }

  return JSON.parse(jsonString);
}

module.exports = {
  callOpenAIJSON
};
