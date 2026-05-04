const { handleOptions, requireMethod, sendError, sendJSON } = require("./_lib/utils");

module.exports = async function handler(req, res) {
  try {
    if (handleOptions(req, res)) return;
    requireMethod(req, "GET");
    return sendJSON(req, res, 200, { ok: true, service: "drimio-backend" });
  } catch (error) {
    return sendError(req, res, error);
  }
};
