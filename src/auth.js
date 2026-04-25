const { createRemoteJWKSet, jwtVerify } = require("jose");

let jwksCache = null;
let jwksUrl = null;

function getJWKS() {
  const supabaseUrl = process.env.SUPABASE_URL;
  if (!supabaseUrl) {
    throw new Error("SUPABASE_URL env var is required for auth verification");
  }

  const expectedUrl = `${supabaseUrl.replace(/\/$/, "")}/auth/v1/.well-known/jwks.json`;
  if (jwksCache && jwksUrl === expectedUrl) {
    return jwksCache;
  }

  jwksUrl = expectedUrl;
  jwksCache = createRemoteJWKSet(new URL(expectedUrl));
  return jwksCache;
}

function extractBearerToken(req) {
  const header = req.headers.authorization || req.headers.Authorization;
  if (typeof header !== "string") return null;
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : null;
}

async function requireAuth(req, res, next) {
  if (process.env.REQUIRE_AUTH === "false") {
    return next();
  }

  const token = extractBearerToken(req);
  if (!token) {
    return res.status(401).json({ error: "Missing bearer token" });
  }

  try {
    const jwks = getJWKS();
    const { payload } = await jwtVerify(token, jwks, {
      issuer: `${process.env.SUPABASE_URL.replace(/\/$/, "")}/auth/v1`
    });

    if (!payload.sub) {
      return res.status(401).json({ error: "Invalid token: missing subject" });
    }

    req.user = { id: payload.sub, email: payload.email };
    next();
  } catch (error) {
    const message = error instanceof Error ? error.message : "Auth failed";
    return res.status(401).json({ error: `Unauthorized: ${message}` });
  }
}

module.exports = { requireAuth };
