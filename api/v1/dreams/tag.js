const { authenticate } = require("../../_lib/auth");
const { generateDreamGraphTags } = require("../../_lib/dream-graph-tagger");
const { getSupabaseAdmin } = require("../../_lib/supabase-admin");
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
    const user = await authenticate(req);

    const body = await readBody(req);
    const dreamId = requireString(body?.dream_id, "dream_id");
    const dreamContent = requireString(body?.dream_content, "dream_content");
    const interpretationBody = optionalString(body?.interpretation_body);
    const interpretationKeyThemes = Array.isArray(body?.interpretation_key_themes)
      ? body.interpretation_key_themes
          .map((v) => String(v || "").trim())
          .filter(Boolean)
      : [];
    const userPersonalInfo = optionalString(body?.user_personal_info);
    const userSoul = optionalString(body?.user_soul);

    if (!user?.id) {
      throw new Error("Unauthorized: missing user");
    }

    const supabase = getSupabaseAdmin();

    // Verify the dream belongs to this user before doing anything expensive.
    const { data: dreamRow, error: dreamErr } = await supabase
      .from("dreams")
      .select("id,user_id")
      .eq("id", dreamId)
      .single();

    if (dreamErr || !dreamRow) {
      throw new Error("Dream not found");
    }
    if (dreamRow.user_id !== user.id) {
      throw new Error("Unauthorized: dream does not belong to user");
    }

    const { emotionalTone, tags } = await generateDreamGraphTags({
      supabase,
      userId: user.id,
      dreamContent,
      interpretationBody,
      interpretationKeyThemes,
      userPersonalInfo,
      userSoul
    });

    if (emotionalTone) {
      const { error: toneErr } = await supabase
        .from("dreams")
        .update({ emotional_tone: emotionalTone })
        .eq("id", dreamId)
        .eq("user_id", user.id);
      if (toneErr) console.warn("Failed to update emotional_tone:", toneErr.message);
    }

    if (tags.length > 0) {
      // Replace any existing tags for this dream so re-runs are idempotent.
      await supabase.from("dream_symbols").delete().eq("dream_id", dreamId);
      const rows = tags.map((t) => ({
        user_id: user.id,
        dream_id: dreamId,
        layer: t.layer,
        canonical: t.canonical,
        raw: t.raw,
        salience: t.salience,
        emotional_charge: t.emotional_charge,
        element_kind: t.element_kind,
        intensity: t.intensity,
        familiarity: t.familiarity,
        personal_association: t.personal_association,
        is_shadow: t.is_shadow,
        shadow_reason: t.shadow_reason
      }));
      const { error: insertErr } = await supabase
        .from("dream_symbols")
        .insert(rows);
      if (insertErr) {
        console.error("Failed to insert dream_symbols:", insertErr.message);
        throw new Error("Failed to persist tags");
      }
    }

    return sendJSON(req, res, 200, {
      emotional_tone: emotionalTone,
      tags
    });
  } catch (error) {
    return sendError(req, res, error);
  }
};
