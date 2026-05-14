const { authenticate } = require("../../_lib/auth");
const { getSupabaseAdmin } = require("../../_lib/supabase-admin");
const {
  handleOptions,
  requireMethod,
  sendError,
  sendJSON
} = require("../../_lib/utils");

// Pair-key helper so (a,b) and (b,a) hash the same. We use a separator
// (the pipe character) that canonicals never contain — they are
// lowercased nouns or capitalized archetype names.
const PAIR_SEP = "||";

function pairKey(a, b) {
  return a < b ? `${a}${PAIR_SEP}${b}` : `${b}${PAIR_SEP}${a}`;
}

function unpackPairKey(k) {
  const i = k.indexOf(PAIR_SEP);
  return [k.slice(0, i), k.slice(i + PAIR_SEP.length)];
}

function buildGraphSummary(nodes, edges) {
  const adjacency = new Map();
  for (const n of nodes) adjacency.set(n.canonical, new Set());
  for (const edge of edges) {
    if (!adjacency.has(edge.a) || !adjacency.has(edge.b)) continue;
    adjacency.get(edge.a).add(edge.b);
    adjacency.get(edge.b).add(edge.a);
  }

  const visited = new Set();
  const components = [];
  for (const node of nodes) {
    const start = node.canonical;
    if (visited.has(start)) continue;
    const queue = [start];
    const members = [];
    visited.add(start);
    while (queue.length > 0) {
      const current = queue.shift();
      members.push(current);
      for (const next of adjacency.get(current) || []) {
        if (!visited.has(next)) {
          visited.add(next);
          queue.push(next);
        }
      }
    }
    components.push(members);
  }

  const shadowNodeSet = new Set(
    nodes.filter((n) => (n.shadow_count || 0) > 0).map((n) => n.canonical)
  );
  const shadowClusterCount = components.filter((members) =>
    members.some((m) => shadowNodeSet.has(m))
  ).length;

  return {
    node_count: nodes.length,
    edge_count: edges.length,
    cluster_count: components.length,
    shadow_cluster_count: shadowClusterCount,
    largest_cluster_size: components.reduce(
      (max, members) => Math.max(max, members.length),
      0
    )
  };
}

module.exports = async function handler(req, res) {
  try {
    if (handleOptions(req, res)) return;
    requireMethod(req, "GET");
    const user = await authenticate(req);
    if (!user?.id) throw new Error("Unauthorized");

    const supabase = getSupabaseAdmin();

    // 1. Stats
    const [{ count: dreamCount }, firstDreamRes] = await Promise.all([
      supabase
        .from("dreams")
        .select("id", { count: "exact", head: true })
        .eq("user_id", user.id),
      supabase
        .from("dreams")
        .select("created_at")
        .eq("user_id", user.id)
        .order("created_at", { ascending: true })
        .limit(1)
    ]);

    // 2. Nodes — top symbols by count
    const { data: nodes, error: nodesErr } = await supabase
      .from("user_symbols")
      .select(
        "layer,canonical,count,mean_salience,current_charge,first_seen_at,last_seen_at,shadow_count,mean_intensity,last_familiarity"
      )
      .eq("user_id", user.id)
      .order("count", { ascending: false })
      .limit(40);

    if (nodesErr) throw new Error(`Failed to load nodes: ${nodesErr.message}`);

    const recurringCount = (nodes || []).filter((n) => n.count >= 2).length;

    // 3. Edges — pull recent dream_symbols and compute co-occurrence in JS.
    //    For typical user sizes (<2k rows) this is faster and simpler than
    //    issuing a SQL self-join via PostgREST.
    const { data: tagRows, error: tagErr } = await supabase
      .from("dream_symbols")
      .select("dream_id,canonical,layer,element_kind,is_shadow")
      .eq("user_id", user.id);

    if (tagErr) throw new Error(`Failed to load tag rows: ${tagErr.message}`);

    const byDream = new Map();
    const nodeHints = new Map();
    for (const row of tagRows || []) {
      if (!byDream.has(row.dream_id)) byDream.set(row.dream_id, []);
      byDream.get(row.dream_id).push(row.canonical);

      const current = nodeHints.get(row.canonical) || {
        shadow_hits: 0,
        element_kind_counts: {}
      };
      if (row.is_shadow) current.shadow_hits += 1;
      if (row.element_kind) {
        current.element_kind_counts[row.element_kind] =
          (current.element_kind_counts[row.element_kind] || 0) + 1;
      }
      nodeHints.set(row.canonical, current);
    }

    const edgeCounts = new Map();
    for (const symbols of byDream.values()) {
      const unique = [...new Set(symbols)];
      for (let i = 0; i < unique.length; i++) {
        for (let j = i + 1; j < unique.length; j++) {
          const k = pairKey(unique[i], unique[j]);
          edgeCounts.set(k, (edgeCounts.get(k) || 0) + 1);
        }
      }
    }

    const edges = [...edgeCounts.entries()]
      .filter(([, c]) => c >= 2) // hide one-off coincidences
      .map(([k, co_count]) => {
        const [a, b] = unpackPairKey(k);
        return { a, b, co_count };
      })
      .sort((x, y) => y.co_count - x.co_count)
      .slice(0, 80);

    const maxEdgeCount = edges.reduce((acc, e) => Math.max(acc, e.co_count), 0);
    const edgesWithStrength = edges.map((edge) => ({
      ...edge,
      strength: maxEdgeCount > 0 ? Number((edge.co_count / maxEdgeCount).toFixed(4)) : 0
    }));

    // 4. Featured: most active symbol in the last 7 days.
    const sevenDaysAgo = new Date(
      Date.now() - 7 * 24 * 60 * 60 * 1000
    ).toISOString();
    const { data: recentRows } = await supabase
      .from("dream_symbols")
      .select("layer,canonical")
      .eq("user_id", user.id)
      .gte("created_at", sevenDaysAgo);

    let featured = null;
    if (recentRows && recentRows.length > 0) {
      const recentCounts = new Map();
      for (const r of recentRows) {
        const key = `${r.layer}::${r.canonical}`;
        recentCounts.set(key, (recentCounts.get(key) || 0) + 1);
      }
      const sorted = [...recentCounts.entries()].sort((a, b) => b[1] - a[1]);
      const [topKey, topCount] = sorted[0];
      const sepIdx = topKey.indexOf("::");
      const layer = topKey.slice(0, sepIdx);
      const canonical = topKey.slice(sepIdx + 2);

      // Try to pull a cached narrative if it exists.
      const { data: evo } = await supabase
        .from("symbol_evolutions")
        .select("narrative,generated_at,occurrences")
        .eq("user_id", user.id)
        .eq("layer", layer)
        .eq("canonical", canonical)
        .maybeSingle();

      featured = {
        layer,
        canonical,
        count_last_7d: topCount,
        narrative: evo?.narrative || null,
        narrative_generated_at: evo?.generated_at || null
      };
    }

    // last_updated_at: the most recent moment any tag entered the sky.
    let lastUpdatedAt = null;
    for (const n of nodes || []) {
      if (!lastUpdatedAt || (n.last_seen_at && n.last_seen_at > lastUpdatedAt)) {
        lastUpdatedAt = n.last_seen_at;
      }
    }

    const nodesWithGraph = (nodes || []).map((node) => {
      const hint = nodeHints.get(node.canonical);
      let dominantElementKind = "other";
      if (hint?.element_kind_counts) {
        const sortedKinds = Object.entries(hint.element_kind_counts).sort(
          (a, b) => b[1] - a[1]
        );
        if (sortedKinds[0]?.[0]) dominantElementKind = sortedKinds[0][0];
      }
      return {
        ...node,
        element_kind: dominantElementKind,
        is_shadow: (node.shadow_count || 0) > 0,
        shadow_hits: hint?.shadow_hits || node.shadow_count || 0,
        familiarity: node.last_familiarity || null,
        intensity: node.mean_intensity ?? null
      };
    });

    const graph = buildGraphSummary(nodesWithGraph, edgesWithStrength);

    return sendJSON(req, res, 200, {
      stats: {
        dream_count: dreamCount || 0,
        recurring_symbols: recurringCount,
        first_dream_at: firstDreamRes?.data?.[0]?.created_at || null,
        last_updated_at: lastUpdatedAt
      },
      nodes: nodesWithGraph,
      edges: edgesWithStrength,
      graph,
      featured
    });
  } catch (error) {
    return sendError(req, res, error);
  }
};
