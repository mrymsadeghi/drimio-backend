const { callOpenAIJSON } = require("../../../_lib/ai");
const { authenticate } = require("../../../_lib/auth");
const { handleOptions, readBody, requireMethod, requireString, sendError, sendJSON } = require("../../../_lib/utils");

module.exports = async function handler(req, res) {
  try {
    if (handleOptions(req, res)) return;
    requireMethod(req, "POST");
    await authenticate(req);

    const body = await readBody(req);
    const dream = requireString(body?.dream, "dream");
    const conversations = Array.isArray(body?.conversations) ? body.conversations : [];
    if (!conversations.length) {
      throw new Error("Invalid field: conversations");
    }

    const normalizedConversations = conversations.map((pair, index) => ({
      question: requireString(pair?.question, `conversations[${index}].question`),
      answer: requireString(pair?.answer, `conversations[${index}].answer`)
    }));

    const model = process.env.OPENAI_MODEL || "gpt-4.1-mini";
    const result = await callOpenAIJSON({
      model,
      systemPrompt:
        "You summarize user dream Q&A into one concise distilled insight. Return strictly JSON: {\"text\":\"...\"}.",
      userPrompt: `Dream:\n${dream}\n\nQ&A:\n${JSON.stringify(normalizedConversations, null, 2)}`
    });

    const text = requireString(result?.text, "text");
    return sendJSON(req, res, 200, { response: { text } });
  } catch (error) {
    return sendError(req, res, error);
  }
};
