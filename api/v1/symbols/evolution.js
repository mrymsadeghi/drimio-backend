const { authenticate } = require("../../_lib/auth");
const { getSupabaseAdmin } = require("../../_lib/supabase-admin");
const {
  handleOptions,
  readBody,
  requireMethod,
  requireString,
  sendError,
  sendJSON
} = require("../../_lib/utils");

const OPENAI_URL = "https://api.openai.com/v1/chat/completions";

const SYSTEM_PROMPT = `You are Drimio's symbol-evolution writer. The user has dreamt about the same symbol many times. Your job is to describe, in 2 to 4 sentences, how that symbol has changed for THIS USER SPECIFICALLY across their dream history.

You will receive:
- the canonical name of the symbol (e.g. "water", "mother", "Shadow"),
- the layer (symbol, archetype, or theme),
- a chronological timeline of every dream where this symbol appeared:
    each item has a date, a short excerpt of the dream, the salience score,
    and the emotional charge tagged at the time.

Write a short narrative that:

1. Begins with how the symbol first arrived ("Water first appeared as...").
2. Names the most important shift in its emotional charge or role over time (if there is one — never invent shifts not in the data).
3. Ends with where the symbol stands NOW, based on the most recent 2-3 occurrences. This is the line that will appear under the user's constellation.
4. Speaks to the user in second person, warmly but not therapeutically. Never diagnose. Never command. Never use phrases like "your inner child" or other pop-psychology shorthand.
5. Is rooted in Jung's view that symbols belong to the dreamer — what water means for this user is built from this user's dreams, not from a dictionary. Do not generalize ("water often symbolizes..."). Be specific to what their data shows.
6. Total length: 2-4 sentences, max ~80 words.

OUTPUT: respond with strictly valid JSON: { "narrative": "..." }. No preamble.`;

async function callOpenAITextJSON({ systemPrompt, userPrompt, model }) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("Missing OPENAI_API_KEY");

  const response = await fetch(OPENAI_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model: model || process.env.OPENAI_MODEL || "gpt-4.1",
      temperature: 0.8,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt }
      ],
      response_format: { type: "json_object" }
    })
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`OpenAI error ${response.status}: ${errorText}`);
  }

  const data = await response.json();
  const content = data?.choices?.[0]?.message?.content || "";
  return JSON.parse(content);
}

function truncate(s, n) {
  if (!s) return "";
  const trimmed = String(s).trim().replace(/\s+/g, " ");
  return trimmed.length > n ? trimmed.slice(0, n - 1) + "…" : trimmed;
}

module.exports = async function handler(req, res) {
  try {
    if (handleOptions(req, res)) return;
    requireMethod(req, "POST");
    const user = await authenticate(req);
    if (!user?.id) throw new Error("Unauthorized");

    const body = await readBody(req);
    const canonical = requireString(body?.canonical, "canonical");
    const layer = requireString(body?.layer, "layer");
    if (!["symbol", "archetype", "theme"].includes(layer)) {
      throw new Error("Invalid field: layer");
    }
    const force = body?.force === true;

    const supabase = getSupabaseAdmin();

    // Pull all instances of this symbol for this user, joined to dreams.
    const { data: instances, error: instErr } = await supabase
      .from("dream_symbols")
      .select(
        "salience,emotional_charge,created_at,dreams:dream_id(content,dream_date)"
      )
      .eq("user_id", user.id)
      .eq("layer", layer)
      .eq("canonical", canonical)
      .order("created_at", { ascending: true });

    if (instErr) throw new Error(`Failed to load instances: ${instErr.message}`);
    if (!instances || instances.length === 0) {
      throw new Error("No occurrences of that symbol");
    }

    // Check the cache. Regenerate if forced, missing, older than 7 days,
    // or if the user has logged >= 3 new instances since the last build.
    const { data: cached } = await supabase
      .from("symbol_evolutions")
      .select("narrative,occurrences,generated_at")
      .eq("user_id", user.id)
      .eq("layer", layer)
      .eq("canonical", canonical)
      .maybeSingle();

    const occurrences = instances.length;
    const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;
    const stale =
      !cached ||
      Date.now() - new Date(cached.generated_at).getTime() > sevenDaysMs ||
      occurrences - (cached.occurrences || 0) >= 3;

    if (!force && cached && !stale) {
      return sendJSON(req, res, 200, {
        canonical,
        layer,
        narrative: cached.narrative,
        occurrences: cached.occurrences,
        generated_at: cached.generated_at,
        cached: true
      });
    }

    // Sample up to 12 instances evenly across the timeline.
    let sampled = instances;
    if (instances.length > 12) {
      const step = (instances.length - 1) / 11;
      sampled = Array.from(
        { length: 12 },
        (_, i) => instances[Math.round(i * step)]
      );
    }

    const timeline = sampled.map((row) => ({
      date: row.dreams?.dream_date || row.created_at?.slice(0, 10) || null,
      excerpt: truncate(row.dreams?.content || "", 200),
      salience: row.salience,
      emotional_charge: row.emotional_charge
    }));

    const userPrompt = [
      `- canonical: ${canonical}`,
      `- layer: ${layer}`,
      `- total_occurrences: ${occurrences}`,
      `- timeline: ${JSON.stringify(timeline, null, 2)}`
    ].join("\n");

    const result = await callOpenAITextJSON({
      systemPrompt: SYSTEM_PROMPT,
      userPrompt,
      model: process.env.OPENAI_MODEL_EVOLUTION || "gpt-4.1"
    });

    const narrative = requireString(result?.narrative, "narrative");

    const { error: upsertErr } = await supabase
      .from("symbol_evolutions")
      .upsert(
        {
          user_id: user.id,
          layer,
          canonical,
          narrative,
          occurrences,
          generated_at: new Date().toISOString()
        },
        { onConflict: "user_id,layer,canonical" }
      );

    if (upsertErr) {
      console.warn("Failed to upsert evolution:", upsertErr.message);
    }

    return sendJSON(req, res, 200, {
      canonical,
      layer,
      narrative,
      occurrences,
      generated_at: new Date().toISOString(),
      cached: false
    });
  } catch (error) {
    return sendError(req, res, error);
  }
};
