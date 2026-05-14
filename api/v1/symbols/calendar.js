const { authenticate } = require("../../_lib/auth");
const { getSupabaseAdmin } = require("../../_lib/supabase-admin");
const {
  handleOptions,
  requireMethod,
  sendError,
  sendJSON
} = require("../../_lib/utils");

// Returns one row per dream date with its emotional tone, for the requested
// month. Caller passes ?month=YYYY-MM (defaults to current month).
module.exports = async function handler(req, res) {
  try {
    if (handleOptions(req, res)) return;
    requireMethod(req, "GET");
    const user = await authenticate(req);
    if (!user?.id) throw new Error("Unauthorized");

    const url = new URL(req.url, "http://localhost");
    const monthParam = url.searchParams.get("month") || "";

    let year;
    let month0;
    if (/^\d{4}-\d{2}$/.test(monthParam)) {
      const [y, m] = monthParam.split("-").map(Number);
      year = y;
      month0 = m - 1;
    } else {
      const now = new Date();
      year = now.getUTCFullYear();
      month0 = now.getUTCMonth();
    }

    const start = new Date(Date.UTC(year, month0, 1));
    const end = new Date(Date.UTC(year, month0 + 1, 1));
    const startStr = start.toISOString().slice(0, 10);
    const endStr = end.toISOString().slice(0, 10);

    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase
      .from("dreams")
      .select("dream_date,emotional_tone,id")
      .eq("user_id", user.id)
      .gte("dream_date", startStr)
      .lt("dream_date", endStr)
      .order("dream_date", { ascending: true });

    if (error) throw new Error(`Failed to load calendar: ${error.message}`);

    return sendJSON(req, res, 200, {
      month: `${year}-${String(month0 + 1).padStart(2, "0")}`,
      days: (data || []).map((d) => ({
        dream_date: d.dream_date,
        emotional_tone: d.emotional_tone,
        dream_id: d.id
      }))
    });
  } catch (error) {
    return sendError(req, res, error);
  }
};
