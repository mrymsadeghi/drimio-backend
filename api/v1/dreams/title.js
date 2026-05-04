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
    const model = process.env.OPENAI_MODEL_TITLE || "gpt-4.1-mini";

    const result = await callOpenAIJSON({
      model,
      systemPrompt:
        "You create short, evocative dream titles. Return strictly JSON: {\"title\":\"...\"}.",
      userPrompt: `Dream:\n${dream}\n\nReturn one concise title (max 8 words).`
    });

    const rawTitle =
      typeof result?.title === "string"
        ? result.title
        : typeof result?.output === "string"
          ? result.output
          : typeof result?.text === "string"
            ? result.text
            : "";
    const title = requireString(rawTitle, "title");
    return sendJSON(req, res, 200, { title });
  } catch (error) {
    return sendError(req, res, error);
  }
};
