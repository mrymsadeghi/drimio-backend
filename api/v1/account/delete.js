const { authenticate } = require("../../_lib/auth");
const { getSupabaseAdmin } = require("../../_lib/supabase-admin");
const {
  handleOptions,
  requireMethod,
  sendError,
  sendJSON,
} = require("../../_lib/utils");

async function deleteTableRows(supabase, table, column, value) {
  const { error } = await supabase.from(table).delete().eq(column, value);
  if (error) {
    throw new Error(`Failed to delete ${table}: ${error.message}`);
  }
}

module.exports = async function handler(req, res) {
  try {
    if (handleOptions(req, res)) return;
    requireMethod(req, "POST");

    const authUser = await authenticate(req);
    if (!authUser?.id) {
      throw new Error("Unauthorized: missing authenticated user");
    }

    const supabaseAdmin = getSupabaseAdmin();
    const userId = authUser.id;

    await deleteTableRows(supabaseAdmin, "analyzer_chats", "user_id", userId);
    await deleteTableRows(supabaseAdmin, "dreams", "user_id", userId);
    await deleteTableRows(supabaseAdmin, "user_distilled_info", "user_id", userId);
    await deleteTableRows(supabaseAdmin, "user_info", "user_id", userId);
    await deleteTableRows(supabaseAdmin, "profiles", "id", userId);

    const { error: deleteAuthError } = await supabaseAdmin.auth.admin.deleteUser(
      userId
    );
    if (deleteAuthError) {
      throw new Error(`Failed to delete auth user: ${deleteAuthError.message}`);
    }

    return sendJSON(req, res, 200, { success: true });
  } catch (error) {
    return sendError(req, res, error);
  }
};
