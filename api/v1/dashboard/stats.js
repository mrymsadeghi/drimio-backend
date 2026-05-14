const { getSupabaseAdmin } = require("../../_lib/supabase-admin");
const {
  handleOptions,
  requireMethod,
  sendError,
  sendJSON
} = require("../../_lib/utils");

async function countProfiles(admin, applyFilter) {
  let query = admin.from("profiles").select("*", { count: "exact", head: true });
  if (typeof applyFilter === "function") {
    query = applyFilter(query);
  }

  const { count, error } = await query;
  if (error) {
    throw new Error(`Failed to count profiles: ${error.message}`);
  }

  return count ?? 0;
}

async function getAppStoreReviewsCount() {
  const appStoreAppId = process.env.APP_STORE_APP_ID || process.env.APPLE_APP_ID;
  if (!appStoreAppId) {
    return null;
  }

  const response = await fetch(
    `https://itunes.apple.com/lookup?id=${encodeURIComponent(appStoreAppId)}`
  );
  if (!response.ok) {
    throw new Error(`Failed to fetch App Store reviews (${response.status})`);
  }

  const payload = await response.json();
  const firstResult = Array.isArray(payload?.results) ? payload.results[0] : null;
  const reviewCount = Number(
    firstResult?.userRatingCount ?? firstResult?.userRatingCountForCurrentVersion ?? 0
  );

  return Number.isFinite(reviewCount) ? reviewCount : 0;
}

module.exports = async function handler(req, res) {
  try {
    if (handleOptions(req, res)) return;
    requireMethod(req, "GET");

    const admin = getSupabaseAdmin();
    const [webSignups, iosSignups, paidSubscriptions, appStoreReviews] =
      await Promise.all([
        countProfiles(admin, (query) =>
          query.or("signup_platform.eq.web,signup_platform.is.null")
        ),
        countProfiles(admin, (query) => query.eq("signup_platform", "ios")),
        countProfiles(admin, (query) => query.ilike("membership_type", "plus")),
        getAppStoreReviewsCount(),
      ]);

    return sendJSON(req, res, 200, {
      webSignups,
      iosSignups,
      paidSubscriptions,
      appStoreReviews,
      generatedAt: new Date().toISOString(),
    });
  } catch (error) {
    return sendError(req, res, error);
  }
};
