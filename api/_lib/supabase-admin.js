const { createClient } = require("@supabase/supabase-js");
const WebSocket = require("ws");

let supabaseAdmin = null;

function resolveSupabaseAdminConfig() {
  const supabaseUrl =
    process.env.SUPABASE_URL ||
    process.env.NEXT_PUBLIC_SUPABASE_URL ||
    process.env.VITE_SUPABASE_URL;
  const serviceRoleKey =
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.SUPABASE_SERVICE_ROLE;

  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error(
      "Missing Supabase admin env vars. Set SUPABASE_URL (or NEXT_PUBLIC_SUPABASE_URL / VITE_SUPABASE_URL) and SUPABASE_SERVICE_ROLE_KEY."
    );
  }

  return { supabaseUrl, serviceRoleKey };
}

function getSupabaseAdmin() {
  if (supabaseAdmin) return supabaseAdmin;
  const { supabaseUrl, serviceRoleKey } = resolveSupabaseAdminConfig();

  supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false },
    realtime: { transport: WebSocket },
  });

  return supabaseAdmin;
}

module.exports = {
  getSupabaseAdmin,
};
