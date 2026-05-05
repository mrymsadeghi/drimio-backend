const { handleStripeWebhook } = require("../_lib/billing");
const { handleOptions, requireMethod, sendError, sendJSON } = require("../_lib/utils");

async function getRawBodyBuffer(req) {
  if (Buffer.isBuffer(req.body)) {
    return req.body;
  }

  if (typeof req.body === "string") {
    return Buffer.from(req.body, "utf8");
  }

  if (req.body && typeof req.body === "object") {
    return Buffer.from(JSON.stringify(req.body), "utf8");
  }

  const chunks = [];
  for await (const chunk of req) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
  }
  return Buffer.concat(chunks);
}

module.exports = async function handler(req, res) {
  try {
    if (handleOptions(req, res)) return;
    requireMethod(req, "POST");

    const rawBody = await getRawBodyBuffer(req);
    const signature = req.headers["stripe-signature"];

    await handleStripeWebhook(rawBody, signature);
    return sendJSON(req, res, 200, { received: true });
  } catch (error) {
    return sendError(req, res, error);
  }
};
