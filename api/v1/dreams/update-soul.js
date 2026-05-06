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
        "You update a user's long-term profile memory ('soul'). Return strictly JSON: {\"soul\":\"...\"}.\n\nThe soul must be a compact persistent profile that captures and updates:\n1) Core characteristics/personality traits\n2) Important life events\n3) Important people in their life, and each person's relationship/role to this user\n4) Major themes/challenges the user is currently going through\n\nWriting rules:\n- Write in third person only.\n- Use phrasing like \"This person is...\" and never \"You are...\".\n- Every time you receive new information text, extract only important and meaningful user information from it.\n- Keep enduring facts and important context from prior memory unless contradicted by new information.\n- Integrate new information carefully; do not invent facts.\n- Resolve direct conflicts by prioritizing newer explicit information.\n- Output only the merged soul text in the JSON field.",
      userPrompt: `Core information:\n${coreInformation || "(none yet)"}\n\nNew information:\n${newInformation}`
    });

    const soul = requireString(result?.soul, "soul");
    return sendJSON(req, res, 200, { soul });
  } catch (error) {
    return sendError(req, res, error);
  }
};
