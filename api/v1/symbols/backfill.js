const { generateDreamGraphTags } = require("../../_lib/dream-graph-tagger");
const { getSupabaseAdmin } = require("../../_lib/supabase-admin");
const {
  handleOptions,
  readBody,
  requireMethod,
  sendError,
  sendJSON
} = require("../../_lib/utils");

function isAuthorized(req) {
  const expected = process.env.BACKFILL_SECRET;
  if (!expected) return false;
  const provided = req.headers["x-backfill-secret"];
  return typeof provided === "string" && provided === expected;
}

function toPositiveInt(value, fallback, max) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.min(Math.floor(n), max);
}

function afterCursor(row, cursorCreatedAt, cursorId) {
  if (!cursorCreatedAt || !cursorId) return true;
  if (row.created_at > cursorCreatedAt) return true;
  if (row.created_at < cursorCreatedAt) return false;
  return row.id > cursorId;
}

module.exports = async function handler(req, res) {
  try {
    if (handleOptions(req, res)) return;
    requireMethod(req, "POST");
    if (!isAuthorized(req)) {
      return sendJSON(req, res, 401, { error: "Unauthorized backfill request" });
    }

    const body = await readBody(req);
    const userId = typeof body?.user_id === "string" ? body.user_id.trim() : null;
    const dryRun = Boolean(body?.dry_run);
    const force = Boolean(body?.force);
    const batchSize = toPositiveInt(body?.batch_size, 25, 100);
    const cursorCreatedAt =
      typeof body?.cursor_created_at === "string" ? body.cursor_created_at : null;
    const cursorId = typeof body?.cursor_id === "string" ? body.cursor_id : null;

    const supabase = getSupabaseAdmin();

    let dreamQuery = supabase
      .from("dreams")
      .select(
        "id,user_id,content,interpretation_body,interpretation_key_themes,created_at"
      )
      .order("created_at", { ascending: true })
      .order("id", { ascending: true })
      .limit(cursorCreatedAt && cursorId ? batchSize * 3 : batchSize);

    if (userId) {
      dreamQuery = dreamQuery.eq("user_id", userId);
    }
    if (cursorCreatedAt) {
      dreamQuery = dreamQuery.gte("created_at", cursorCreatedAt);
    }

    const { data: dreamRows, error: dreamErr } = await dreamQuery;
    if (dreamErr) throw new Error(`Failed to load dreams: ${dreamErr.message}`);

    const ordered = (dreamRows || [])
      .filter((row) => afterCursor(row, cursorCreatedAt, cursorId))
      .slice(0, batchSize);
    if (ordered.length === 0) {
      return sendJSON(req, res, 200, {
        batch_size: batchSize,
        processed: 0,
        completed: true
      });
    }

    const dreamIds = ordered.map((d) => d.id);
    const userIds = [...new Set(ordered.map((d) => d.user_id))];

    const [{ data: existingTags, error: tagsErr }, { data: profiles, error: profileErr }] =
      await Promise.all([
        supabase
          .from("dream_symbols")
          .select("dream_id,element_kind,intensity,familiarity")
          .in("dream_id", dreamIds),
        supabase.from("profiles").select("id,identity,soul").in("id", userIds)
      ]);
    if (tagsErr) throw new Error(`Failed to load existing tags: ${tagsErr.message}`);
    if (profileErr) throw new Error(`Failed to load profiles: ${profileErr.message}`);

    const tagsByDream = new Map();
    for (const row of existingTags || []) {
      if (!tagsByDream.has(row.dream_id)) tagsByDream.set(row.dream_id, []);
      tagsByDream.get(row.dream_id).push(row);
    }

    const profileById = new Map();
    for (const profile of profiles || []) {
      profileById.set(profile.id, profile);
    }

    let success = 0;
    let skipped = 0;
    let failed = 0;
    const failures = [];

    for (const dream of ordered) {
      const existing = tagsByDream.get(dream.id) || [];
      const alreadyV1 =
        existing.length > 0 &&
        existing.every(
          (row) =>
            row.element_kind !== null &&
            row.intensity !== null &&
            row.familiarity !== null
        );
      if (!force && alreadyV1) {
        skipped += 1;
        continue;
      }
      if (!dream.content || !String(dream.content).trim()) {
        skipped += 1;
        continue;
      }

      if (dryRun) {
        success += 1;
        continue;
      }

      try {
        const profile = profileById.get(dream.user_id);
        const { emotionalTone, tags } = await generateDreamGraphTags({
          supabase,
          userId: dream.user_id,
          dreamContent: dream.content,
          interpretationBody: dream.interpretation_body || "",
          interpretationKeyThemes: Array.isArray(dream.interpretation_key_themes)
            ? dream.interpretation_key_themes
            : [],
          userPersonalInfo: profile?.identity || "",
          userSoul: profile?.soul || ""
        });

        await supabase.from("dream_symbols").delete().eq("dream_id", dream.id);

        if (tags.length > 0) {
          const rows = tags.map((t) => ({
            user_id: dream.user_id,
            dream_id: dream.id,
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
          const { error: insertErr } = await supabase.from("dream_symbols").insert(rows);
          if (insertErr) throw new Error(`Insert failed: ${insertErr.message}`);
        }

        if (emotionalTone) {
          const { error: toneErr } = await supabase
            .from("dreams")
            .update({ emotional_tone: emotionalTone })
            .eq("id", dream.id);
          if (toneErr) {
            console.warn("Failed to update dream tone:", toneErr.message);
          }
        }
        success += 1;
      } catch (error) {
        failed += 1;
        failures.push({
          dream_id: dream.id,
          error: error instanceof Error ? error.message : "Unknown error"
        });
      }
    }

    const last = ordered[ordered.length - 1];
    return sendJSON(req, res, 200, {
      batch_size: batchSize,
      processed: ordered.length,
      succeeded: success,
      skipped,
      failed,
      dry_run: dryRun,
      force,
      next_cursor: {
        cursor_created_at: last.created_at,
        cursor_id: last.id
      },
      completed: ordered.length < batchSize,
      failures: failures.slice(0, 20)
    });
  } catch (error) {
    return sendError(req, res, error);
  }
};
