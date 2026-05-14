const { authenticate } = require("../../_lib/auth");
const { getSupabaseAdmin } = require("../../_lib/supabase-admin");
const {
  handleOptions,
  requireMethod,
  sendError,
  sendJSON
} = require("../../_lib/utils");

// Returns archetype counts over the last N days (default 30) for the
// archetype-balance ring viz. Pure SQL roll-up.
module.exports = async function handler(req, res) {
  try {
    if (handleOptions(req, res)) return;
    requireMethod(req, "GET");
    const user = await authenticate(req);
    if (!user?.id) throw new Error("Unauthorized");

    const url = new URL(req.url, "http://localhost");
    const days = Math.max(
      1,
      Math.min(365, Number(url.searchParams.get("days") || 30))
    );
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase
      .from("dream_symbols")
      .select("canonical")
      .eq("user_id", user.id)
      .eq("layer", "archetype")
      .gte("created_at", since);

    if (error) throw new Error(`Failed to load archetypes: ${error.message}`);

    const counts = new Map();
    for (const row of data || []) {
      counts.set(row.canonical, (counts.get(row.canonical) || 0) + 1);
    }

    const ranked = [...counts.entries()]
      .map(([canonical, count]) => ({ canonical, count }))
      .sort((a, b) => b.count - a.count);

    return sendJSON(req, res, 200, {
      window_days: days,
      archetypes: ranked
    });
  } catch (error) {
    return sendError(req, res, error);
  }
};
