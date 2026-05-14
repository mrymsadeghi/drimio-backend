const { callOpenAIJSON } = require("./ai");

const ALLOWED_ARCHETYPES = new Set([
  "Shadow",
  "Anima",
  "Animus",
  "Self",
  "Mother",
  "Father",
  "Child",
  "Hero",
  "Trickster",
  "Wise Old Man",
  "Wise Old Woman",
  "Persona",
  "Threshold",
  "Anima Mundi"
]);

const ALLOWED_CHARGES = new Set([
  "threatening",
  "anxious",
  "sad",
  "longing",
  "neutral",
  "curious",
  "awe",
  "calm",
  "joyful"
]);

const ALLOWED_ELEMENT_KINDS = new Set([
  "person",
  "object",
  "place",
  "action",
  "emotion",
  "other"
]);

const ALLOWED_FAMILIARITY = new Set(["known", "unknown", "mixed", "n/a"]);

const SYSTEM_PROMPT = `You are Drimio's dream-tagging service. Your job is to extract a structured, canonical, three-layer tag set from a single dream so we can build a long-term symbol map for this user.

You will receive:
- the dream text,
- Drimio's interpretation of the dream,
- short user context (identity and soul — distilled personal patterns),
- the user's existing canonical vocabulary (symbols, archetypes, themes from past dreams).

You must respond with strictly valid JSON matching this schema:
{
  "emotional_tone": "<one of: threatening|anxious|sad|longing|neutral|curious|awe|calm|joyful>",
  "tags": [
    {
      "layer": "<symbol|archetype|theme>",
      "canonical": "<canonical form>",
      "raw": "<short phrase from the dream as the user said it>",
      "salience": <float 0..1>,
      "emotional_charge": "<one of the nine charges above>",
      "element_kind": "<person|object|place|action|emotion|other>",
      "intensity": <float 0..1>,
      "familiarity": "<known|unknown|mixed|n/a>",
      "personal_association": "<brief user-specific association or empty>",
      "is_shadow": <true|false>,
      "shadow_reason": "<why this is shadow-related or empty>"
    }
  ]
}

Rules:

1. THREE LAYERS — emit tags across all three when present:
   - "symbol" — concrete things in the dream. Use lowercased singular nouns. Compound concepts are allowed when inseparable ("childhood home", "the dead").
   - "archetype" — Jungian archetypes only, capitalized as proper nouns. ONLY these are allowed: Shadow, Anima, Animus, Self, Mother, Father, Child, Hero, Trickster, Wise Old Man, Wise Old Woman, Persona, Threshold, Anima Mundi. Never invent new ones.
   - "theme" — what the dream is about, lowercased. Examples: transition, pursuit, threshold, transformation, loss, return, descent, flight, reconciliation. Be sparing: 1-3 themes per dream.

2. CANONICAL REUSE — if a tag conceptually matches one of the existing_canonicals for this user, reuse that exact canonical string. "snakes" -> "snake". Never create a new canonical when an existing one fits.

3. SALIENCE — 1.0 means the dream is centered on the tag; 0.3 means it appears in passing. Most tags should be 0.4-0.7. Reserve 0.9+ for what the dream is genuinely about.

4. EMOTIONAL CHARGE — pick the single charge that describes how this particular instance felt. The same canonical may carry different charges across different dreams.

5. DREAMGRAPH ATTRIBUTES:
   - element_kind captures the symbol role (person/object/place/action/emotion/other).
   - intensity captures perceived emotional force of that tag in this dream.
   - familiarity captures known vs unknown quality for dreamer.
   - personal_association should be short and optional.
   - is_shadow is true when the tag reflects rejected traits, taboo material, threatening recurring figures, or avoidance dynamics.
   - shadow_reason should be short and optional.

6. EMOTIONAL TONE — one value for the whole dream's dominant tone.

7. LIMITS — at most 8 symbols, 3 archetypes, 3 themes per dream. Quality over quantity. Drop trivial scenery.

8. NEVER include personally identifying real names in canonical. "my mother" -> canonical "mother". A name like "Sarah" stays in raw but canonical uses a generic role ("friend", "lover", "stranger").

9. OUTPUT JSON ONLY — no preamble, no markdown fences, no commentary.`;

function buildUserPrompt({
  dreamContent,
  interpretationBody,
  interpretationKeyThemes,
  userPersonalInfo,
  userSoul,
  existingCanonicals
}) {
  return [
    `- dream_content: ${dreamContent}`,
    `- interpretation: ${interpretationBody || "(none)"}`,
    `- interpretation_key_themes: ${JSON.stringify(interpretationKeyThemes || [])}`,
    `- user_personal_info: ${userPersonalInfo || "(none)"}`,
    `- user_soul: ${userSoul || "(none)"}`,
    `- existing_canonicals: ${JSON.stringify(existingCanonicals || { symbol: [], archetype: [], theme: [] })}`
  ].join("\n");
}

function normalizeCanonical(layer, raw) {
  const s = String(raw || "").trim();
  if (!s) return null;
  if (layer === "archetype") {
    const found = [...ALLOWED_ARCHETYPES].find(
      (a) => a.toLowerCase() === s.toLowerCase()
    );
    return found || null;
  }
  return s.toLowerCase().replace(/\s+/g, " ");
}

function clamp01(value, fallback) {
  let n = Number(value);
  if (!Number.isFinite(n)) n = fallback;
  return Math.max(0, Math.min(1, n));
}

function sanitizeTags(rawTags) {
  if (!Array.isArray(rawTags)) return [];
  const seen = new Set();
  const out = [];

  for (const t of rawTags) {
    if (!t || typeof t !== "object") continue;
    const layer = String(t.layer || "").toLowerCase();
    if (!["symbol", "archetype", "theme"].includes(layer)) continue;
    const canonical = normalizeCanonical(layer, t.canonical);
    if (!canonical) continue;

    const key = `${layer}::${canonical}`;
    if (seen.has(key)) continue;
    seen.add(key);

    const emotionalCharge = ALLOWED_CHARGES.has(
      String(t.emotional_charge || "").toLowerCase()
    )
      ? String(t.emotional_charge).toLowerCase()
      : null;
    const elementKind = ALLOWED_ELEMENT_KINDS.has(
      String(t.element_kind || "").toLowerCase()
    )
      ? String(t.element_kind).toLowerCase()
      : "other";
    const familiarity = ALLOWED_FAMILIARITY.has(
      String(t.familiarity || "").toLowerCase()
    )
      ? String(t.familiarity).toLowerCase()
      : "n/a";

    const personalAssociation =
      typeof t.personal_association === "string"
        ? t.personal_association.trim().slice(0, 250)
        : null;
    const raw = typeof t.raw === "string" ? t.raw.trim().slice(0, 200) : null;
    const shadowReason =
      typeof t.shadow_reason === "string" ? t.shadow_reason.trim().slice(0, 250) : null;

    const tag = {
      layer,
      canonical,
      raw,
      salience: clamp01(t.salience, 0.5),
      emotional_charge: emotionalCharge,
      element_kind: elementKind,
      intensity: clamp01(t.intensity, 0.5),
      familiarity,
      personal_association: personalAssociation || null,
      is_shadow: Boolean(t.is_shadow),
      shadow_reason: shadowReason || null
    };

    if (!tag.is_shadow) {
      tag.shadow_reason = null;
    }
    out.push(tag);
  }

  const limits = { symbol: 8, archetype: 3, theme: 3 };
  const counts = { symbol: 0, archetype: 0, theme: 0 };
  return out.filter((tag) => {
    counts[tag.layer] += 1;
    return counts[tag.layer] <= limits[tag.layer];
  });
}

async function fetchExistingCanonicals(supabase, userId) {
  const { data, error } = await supabase
    .from("user_symbols")
    .select("layer,canonical,count")
    .eq("user_id", userId)
    .order("count", { ascending: false })
    .limit(200);

  if (error) {
    console.warn("Failed to fetch existing canonicals:", error.message);
    return { symbol: [], archetype: [], theme: [] };
  }

  const grouped = { symbol: [], archetype: [], theme: [] };
  for (const row of data || []) {
    if (grouped[row.layer]) grouped[row.layer].push(row.canonical);
  }
  return grouped;
}

async function generateDreamGraphTags({
  supabase,
  userId,
  dreamContent,
  interpretationBody,
  interpretationKeyThemes,
  userPersonalInfo,
  userSoul,
  modelOverride
}) {
  const existingCanonicals = await fetchExistingCanonicals(supabase, userId);
  const model = modelOverride || process.env.OPENAI_MODEL_TAG || "gpt-4.1-mini";
  const result = await callOpenAIJSON({
    model,
    systemPrompt: SYSTEM_PROMPT,
    userPrompt: buildUserPrompt({
      dreamContent,
      interpretationBody,
      interpretationKeyThemes,
      userPersonalInfo,
      userSoul,
      existingCanonicals
    })
  });

  const emotionalTone = ALLOWED_CHARGES.has(
    String(result?.emotional_tone || "").toLowerCase()
  )
    ? String(result.emotional_tone).toLowerCase()
    : null;

  return {
    emotionalTone,
    tags: sanitizeTags(result?.tags)
  };
}

module.exports = {
  ALLOWED_CHARGES,
  generateDreamGraphTags
};
