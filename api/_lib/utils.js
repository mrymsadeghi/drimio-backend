function getAllowedOrigin(req) {
  const allowed = process.env.ALLOWED_ORIGIN || "*";
  if (allowed === "*") return "*";

  const list = allowed
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);

  const requestOrigin = req.headers.origin;
  if (!requestOrigin) return list[0] || "*";
  return list.includes(requestOrigin) ? requestOrigin : list[0] || "*";
}

function applyCORS(req, res) {
  const origin = getAllowedOrigin(req);
  res.setHeader("Access-Control-Allow-Origin", origin);
  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
}

function handleOptions(req, res) {
  applyCORS(req, res);
  if (req.method === "OPTIONS") {
    res.status(204).end();
    return true;
  }
  return false;
}

function requireMethod(req, method) {
  if (req.method !== method) {
    throw new HttpError(405, "Method not allowed");
  }
}

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function requireString(value, fieldName) {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new HttpError(400, `Invalid field: ${fieldName}`);
  }
  return value.trim();
}

function optionalString(value) {
  return typeof value === "string" ? value.trim() : "";
}

async function readBody(req) {
  if (req.body && typeof req.body === "object") {
    return req.body;
  }

  if (typeof req.body === "string") {
    return req.body ? JSON.parse(req.body) : {};
  }

  const chunks = [];
  for await (const chunk of req) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
  }
  const raw = Buffer.concat(chunks).toString("utf8");
  if (!raw) return {};
  return JSON.parse(raw);
}

function sendJSON(req, res, status, payload) {
  applyCORS(req, res);
  res.status(status).json(payload);
}

function sendError(req, res, error) {
  if (error instanceof HttpError) {
    return sendJSON(req, res, error.status, { error: error.message });
  }

  const message = error instanceof Error ? error.message : "Unknown error";
  if (message === "Missing bearer token" || message.startsWith("Unauthorized:")) {
    return sendJSON(req, res, 401, { error: message });
  }

  return sendJSON(req, res, 400, { error: message });
}

module.exports = {
  HttpError,
  handleOptions,
  optionalString,
  readBody,
  requireMethod,
  requireString,
  sendError,
  sendJSON
};
