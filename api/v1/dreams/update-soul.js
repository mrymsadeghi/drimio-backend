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
    const coreInformation = optionalString(body?.core_information);
    const newInformation = requireString(body?.new_information, "new_information");
    const model = process.env.OPENAI_MODEL_UPDATE_SOUL || "gpt-4.1";

    const result = await callOpenAIJSON({
      model,
      systemPrompt:
        "You merge prior profile memory with new user info into one improved 'soul' profile. Return strictly JSON: {\"soul\":\"...\"}.",
      userPrompt: `Core information:\n${coreInformation || "(none yet)"}\n\nNew information:\n${newInformation}`
    });

    const soul = requireString(result?.soul, "soul");
    return sendJSON(req, res, 200, { soul });
  } catch (error) {
    return sendError(req, res, error);
  }
};
