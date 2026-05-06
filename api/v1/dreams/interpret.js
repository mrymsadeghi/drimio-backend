const { callOpenAIJSON } = require("../../_lib/ai");
const { authenticate } = require("../../_lib/auth");
const {
  handleOptions,
  optionalString,
  readBody,
  requireMethod,
  requireString,
  sendError,
  sendJSON
} = require("../../_lib/utils");

module.exports = async function handler(req, res) {
  try {
    if (handleOptions(req, res)) return;
    requireMethod(req, "POST");
    await authenticate(req);

    const body = await readBody(req);
    const dreamContent = requireString(body?.dream_content, "dream_content");
    const userPersonalInfo = optionalString(body?.user_personal_info);
    const userRecurringDreams = optionalString(body?.user_recurring_dreams);
    const userDistilledInfo = optionalString(body?.user_distilled_info);
    const qaPairs = Array.isArray(body?.qa_pairs) ? body.qa_pairs : [];

    const normalizedPairs = qaPairs
      .map((pair) => ({
        question: typeof pair?.question === "string" ? pair.question.trim() : "",
        answer: typeof pair?.answer === "string" ? pair.answer.trim() : ""
      }))
      .filter((pair) => pair.question.length > 0 && pair.answer.length > 0);

    const model = process.env.OPENAI_MODEL_INTERPRET || "gpt-4.1";
    const result = await callOpenAIJSON({
      model,
      systemPrompt:
        "You generate a structured dream interpretation based on the user's dream, personal info, recurring dreams, additional info, and qa pairs. Use Jungian dream interpretation principles to interpret the dream. Make the key themes broad and short. Return strictly JSON with keys: summary, keyThemes (array), interpretation, reflectionPrompt.",
      userPrompt: `- dream_content: ${dreamContent}
- questions that the user answered about this dream: ${JSON.stringify(normalizedPairs, null, 2)}
- user_personal_info: ${userPersonalInfo || "(none provided)"}
- user has this recurring dreams: ${userRecurringDreams || "(none provided)"}
- more information about the user: ${userDistilledInfo || "(none provided)"}`
    });

    const summary = requireString(result?.summary, "summary");
    const interpretation = requireString(result?.interpretation, "interpretation");
    const reflectionPrompt = requireString(result?.reflectionPrompt, "reflectionPrompt");

    const keyThemes = Array.isArray(result?.keyThemes)
      ? result.keyThemes.map((item) => String(item).trim()).filter(Boolean)
      : [];

    if (!keyThemes.length) {
      throw new Error("Invalid field: keyThemes");
    }

    return sendJSON(req, res, 200, {
      summary,
      keyThemes,
      interpretation,
      reflectionPrompt
    });
  } catch (error) {
    return sendError(req, res, error);
  }
};
