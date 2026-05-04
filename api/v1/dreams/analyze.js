const { callOpenAIJSON } = require("../../_lib/ai");
const { authenticate } = require("../../_lib/auth");
const { handleOptions, readBody, requireMethod, requireString, sendError, sendJSON } = require("../../_lib/utils");

module.exports = async function handler(req, res) {
  try {
    if (handleOptions(req, res)) return;
    requireMethod(req, "POST");
    await authenticate(req);

    const body = await readBody(req);
    const dream = requireString(body?.dream, "dream");
    const userName = requireString(body?.user_name, "user_name");
    const model = process.env.OPENAI_MODEL_ANALYZE || "gpt-4.1";

    const result = await callOpenAIJSON({
      model,
      systemPrompt:
        "You are a reflective dream guide. You read users dream and return a short supportive reflection and 5 follow-up questions that would help with the jungian dream interpretation. Return strictly JSON with keys: output, Q1, Q2, Q3, optionally Q4 and Q5.",
      userPrompt: `User name: ${userName}\nDream:\n${dream}`
    });

    const payload = {
      output: requireString(result?.output, "output"),
      Q1: requireString(result?.Q1, "Q1"),
      Q2: requireString(result?.Q2, "Q2"),
      Q3: requireString(result?.Q3, "Q3")
    };

    if (typeof result?.Q4 === "string" && result.Q4.trim()) payload.Q4 = result.Q4.trim();
    if (typeof result?.Q5 === "string" && result.Q5.trim()) payload.Q5 = result.Q5.trim();

    return sendJSON(req, res, 200, payload);
  } catch (error) {
    return sendError(req, res, error);
  }
};
