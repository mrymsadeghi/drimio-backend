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

const SYSTEM_PROMPT = `You are Drimio's sky reader. Given a snapshot of a user's dream symbol map, you write a short, personal reflection on what their current sky reveals — the patterns running through their dream life right now.

You will receive:
- the user's identity and soul context (distilled personal patterns),
- the top nodes in their sky: symbols, archetypes, themes, each with frequency and current emotional charge,
- the strongest co-occurrence edges (which canonicals keep arriving together in the same dream),
- a comparison of recent activity (last 7 days) versus the prior 7 days.

Write a 3-5 sentence reflection that:

1. NAMES THE DOMINANT PATTERN. If there is a clear cluster of symbols, archetypes, or themes that recur together, name it concretely and say what is at its center. Use the actual canonicals from the data.
2. NAMES THE EMOTIONAL WEATHER. If the recent charges skew toward one tone (anxious, longing, calm, etc.), note that. If they are mixed, say so.
3. NAMES WHAT HAS SHIFTED. If recent activity differs from prior weeks — a symbol gone quiet, a new archetype emerging, an old pattern resurfacing — call it out. If nothing has shifted, say the pattern is steady.
4. ENDS WITH A FRAMING. One sentence that gives the user a way of holding the pattern, never instructive. Examples: "Something is loosening." "The work right now seems to be one of return." "These dreams are circling, not yet resolving."

Rules of voice:
- Speak in second person, warmly, but never therapeutically. Never diagnose. Never use phrases like "your inner child" or "your higher self" or other pop-psychology shorthand.
- Never instruct ("you should...", "try to..."). Reflect, don't advise.
- Stay strictly rooted in the data. If the sky is thin (few recurring symbols), say so plainly — do not invent patterns.
- Never use generic dream-dictionary meanings ("water often symbolizes..."). The reading is about THIS user's symbols, not symbols in general.
- Keep it specific. Name actual canonicals from the data, not abstract categories.

OUTPUT: strictly valid JSON: { "reading": "..." }. No preamble, no markdown.`;

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
      temperature: 0.75,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt }
      ],
      response_format: { type: "json_object" }
    })
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`OpenAI error ${response.status}: ${text}`);
  }
  const data = await response.json();
  const content = data?.choices?.[0]?.message?.content || "";
  return JSON.parse(content);
}

async function loadSnapshot(supabase, userId) {
  // Top nodes
  const { data: nodes } = await supabase
    .from("user_symbols")
    .select("layer,canonical,count,current_charge")
    .eq("user_id", userId)
    .order("count", { ascending: false })
    .limit(20);

  // Edges (last 90 days only, to stay relevant)
  const { data: tagRows } = await supabase
    .from("dream_symbols")
    .select("dream_id,canonical")
    .eq("user_id", userId);

  const byDream = new Map();
  for (const row of tagRows || []) {
    if (!byDream.has(row.dream_id)) byDream.set(row.dream_id, []);
    byDream.get(row.dream_id).push(row.canonical);
  }
  const pairCounts = new Map();
  for (const list of byDream.values()) {
    const unique = [...new Set(list)];
    for (let i = 0; i < unique.length; i++) {
      for (let j = i + 1; j < unique.length; j++) {
        const a = unique[i];
        const b = unique[j];
        const key = a < b ? `${a}||${b}` : `${b}||${a}`;
        pairCounts.set(key, (pairCounts.get(key) || 0) + 1);
      }
    }
  }
  const edges = [...pairCounts.entries()]
    .filter(([, c]) => c >= 2)
    .map(([key, count]) => {
      const i = key.indexOf("||");
      return { a: key.slice(0, i), b: key.slice(i + 2), co_count: count };
    })
    .sort((x, y) => y.co_count - x.co_count)
    .slice(0, 12);

  // Recent vs prior week activity
  const now = Date.now();
  const w1 = new Date(now - 7 * 24 * 60 * 60 * 1000).toISOString();
  const w2 = new Date(now - 14 * 24 * 60 * 60 * 1000).toISOString();

  const { data: recent } = await supabase
    .from("dream_symbols")
    .select("layer,canonical,emotional_charge,created_at")
    .eq("user_id", userId)
    .gte("created_at", w1);

  const { data: prior } = await supabase
    .from("dream_symbols")
    .select("layer,canonical,emotional_charge")
    .eq("user_id", userId)
    .gte("created_at", w2)
    .lt("created_at", w1);

  const countByCanonical = (rows) => {
    const m = new Map();
    for (const r of rows || []) {
      const k = `${r.layer}::${r.canonical}`;
      m.set(k, (m.get(k) || 0) + 1);
    }
    return m;
  };
  const recentMap = countByCanonical(recent);
  const priorMap = countByCanonical(prior);
  const chargeCount = new Map();
  for (const r of recent || []) {
    if (r.emotional_charge)
      chargeCount.set(
        r.emotional_charge,
        (chargeCount.get(r.emotional_charge) || 0) + 1
      );
  }

  // Diffs: surfaced (in recent, missing in prior), faded (in prior, missing
  // in recent), or growing.
  const surfaced = [];
  const faded = [];
  const growing = [];
  for (const [k, c] of recentMap) {
    const p = priorMap.get(k) || 0;
    if (p === 0) surfaced.push({ key: k, count: c });
    else if (c > p) growing.push({ key: k, prior: p, recent: c });
  }
  for (const [k, c] of priorMap) {
    if (!recentMap.has(k)) faded.push({ key: k, count: c });
  }

  return {
    nodes: nodes || [],
    edges,
    recent_window: {
      total_tags: recent?.length || 0,
      dominant_charges: [...chargeCount.entries()]
        .map(([charge, count]) => ({ charge, count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 3),
      surfaced: surfaced.slice(0, 5),
      faded: faded.slice(0, 5),
      growing: growing.slice(0, 5)
    },
    prior_window: { total_tags: prior?.length || 0 }
  };
}

async function getProfileContext(supabase, userId) {
  const { data } = await supabase
    .from("profiles")
    .select("identity,soul")
    .eq("id", userId)
    .maybeSingle();
  return {
    identity: data?.identity || "",
    soul: data?.soul || ""
  };
}

async function getDreamCount(supabase, userId) {
  const { count } = await supabase
    .from("dreams")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId);
  return count || 0;
}

module.exports = async function handler(req, res) {
  try {
    if (handleOptions(req, res)) return;
    requireMethod(req, "POST");
    const user = await authenticate(req);
    if (!user?.id) throw new Error("Unauthorized");

    const body = await readBody(req).catch(() => ({}));
    const force = body?.force === true;

    const supabase = getSupabaseAdmin();

    const dreamCount = await getDreamCount(supabase, user.id);

    if (dreamCount < 3) {
      return sendJSON(req, res, 200, {
        reading: null,
        dream_count: dreamCount,
        generated_at: null,
        cached: false,
        reason: "not_enough_dreams"
      });
    }

    // Cache lookup
    const { data: cached } = await supabase
      .from("sky_readings")
      .select("reading,dream_count,generated_at")
      .eq("user_id", user.id)
      .maybeSingle();

    const sevenDays = 7 * 24 * 60 * 60 * 1000;
    const stale =
      !cached ||
      Date.now() - new Date(cached.generated_at).getTime() > sevenDays ||
      dreamCount - (cached.dream_count || 0) >= 3;

    if (!force && cached && !stale) {
      return sendJSON(req, res, 200, {
        reading: cached.reading,
        dream_count: cached.dream_count,
        generated_at: cached.generated_at,
        cached: true
      });
    }

    const [snapshot, profile] = await Promise.all([
      loadSnapshot(supabase, user.id),
      getProfileContext(supabase, user.id)
    ]);

    if (!snapshot.nodes.length) {
      return sendJSON(req, res, 200, {
        reading: null,
        dream_count: dreamCount,
        generated_at: null,
        cached: false,
        reason: "no_symbols_yet"
      });
    }

    const userPrompt = [
      `- identity: ${profile.identity || "(none)"}`,
      `- soul: ${profile.soul || "(none)"}`,
      `- total_dreams_logged: ${dreamCount}`,
      `- top_nodes: ${JSON.stringify(snapshot.nodes, null, 2)}`,
      `- strongest_edges: ${JSON.stringify(snapshot.edges, null, 2)}`,
      `- recent_window_last_7_days: ${JSON.stringify(snapshot.recent_window, null, 2)}`,
      `- prior_window_days_7_to_14: ${JSON.stringify(snapshot.prior_window, null, 2)}`
    ].join("\n");

    const result = await callOpenAITextJSON({
      systemPrompt: SYSTEM_PROMPT,
      userPrompt,
      model: process.env.OPENAI_MODEL_SKY_READING || "gpt-4.1"
    });

    const reading = requireString(result?.reading, "reading");
    const generated_at = new Date().toISOString();

    const { error: upsertErr } = await supabase
      .from("sky_readings")
      .upsert({
        user_id: user.id,
        reading,
        dream_count: dreamCount,
        generated_at
      });

    if (upsertErr) console.warn("Failed to cache sky reading:", upsertErr.message);

    return sendJSON(req, res, 200, {
      reading,
      dream_count: dreamCount,
      generated_at,
      cached: false
    });
  } catch (error) {
    return sendError(req, res, error);
  }
};
