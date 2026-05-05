const { authenticate } = require("../../../_lib/auth");
const {
  handleOptions,
  readBody,
  requireMethod,
  requireString,
  sendError,
  sendJSON
} = require("../../../_lib/utils");
const { createCheckoutSessionForUser } = require("../../../_lib/billing");

module.exports = async function handler(req, res) {
  try {
    if (handleOptions(req, res)) return;
    requireMethod(req, "POST");

    const user = await authenticate(req);
    const body = await readBody(req);
    const plan = requireString(body?.plan, "plan").toLowerCase();

    const url = await createCheckoutSessionForUser({
      userId: user.id,
      email: user.email,
      plan
    });

    return sendJSON(req, res, 200, { url });
  } catch (error) {
    return sendError(req, res, error);
  }
};
