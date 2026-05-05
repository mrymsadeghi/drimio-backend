const { authenticate } = require("../../../_lib/auth");
const { handleOptions, requireMethod, sendError, sendJSON } = require("../../../_lib/utils");
const { createPortalSessionForUser } = require("../../../_lib/billing");

module.exports = async function handler(req, res) {
  try {
    if (handleOptions(req, res)) return;
    requireMethod(req, "POST");

    const user = await authenticate(req);
    const url = await createPortalSessionForUser({
      userId: user.id
    });

    return sendJSON(req, res, 200, { url });
  } catch (error) {
    return sendError(req, res, error);
  }
};
