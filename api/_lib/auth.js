let jwksCache = null;
let jwksUrl = null;
let joseModulePromise = null;

async function getJoseModule() {
  if (!joseModulePromise) {
    joseModulePromise = import("jose");
  }
  return joseModulePromise;
}

async function getJWKS() {
  const supabaseUrl = process.env.SUPABASE_URL;
  if (!supabaseUrl) {
    throw new Error("SUPABASE_URL env var is required for auth verification");
  }

  const expectedUrl = `${supabaseUrl.replace(/\/$/, "")}/auth/v1/.well-known/jwks.json`;
  if (jwksCache && jwksUrl === expectedUrl) {
    return jwksCache;
  }

  const { createRemoteJWKSet } = await getJoseModule();
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

async function authenticate(req) {
  if (process.env.REQUIRE_AUTH === "false") {
    return null;
  }

  const token = extractBearerToken(req);
  if (!token) {
    throw new Error("Missing bearer token");
  }

  try {
    const { jwtVerify } = await getJoseModule();
    const jwks = await getJWKS();
    const { payload } = await jwtVerify(token, jwks, {
      issuer: `${process.env.SUPABASE_URL.replace(/\/$/, "")}/auth/v1`
    });

    if (!payload.sub) {
      throw new Error("Invalid token: missing subject");
    }

    return { id: payload.sub, email: payload.email };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Auth failed";
    throw new Error(`Unauthorized: ${message}`);
  }
}

module.exports = { authenticate };
