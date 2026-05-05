const Stripe = require("stripe");
const { createClient } = require("@supabase/supabase-js");

const ACTIVE_SUBSCRIPTION_STATUSES = new Set(["active", "trialing", "past_due"]);

let stripeClient = null;
let supabaseAdmin = null;

function getStripeClient() {
  if (stripeClient) return stripeClient;

  const stripeSecretKey = process.env.STRIPE_SECRET_KEY;
  if (!stripeSecretKey) {
    throw new Error("Missing STRIPE_SECRET_KEY");
  }

  stripeClient = new Stripe(stripeSecretKey);
  return stripeClient;
}

function getSupabaseAdmin() {
  if (supabaseAdmin) return supabaseAdmin;

  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  }

  supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false }
  });

  return supabaseAdmin;
}

function resolvePriceId(plan) {
  if (plan === "monthly") return process.env.STRIPE_PRICE_ID_MONTHLY;
  if (plan === "yearly") return process.env.STRIPE_PRICE_ID_YEARLY;
  throw new Error("Invalid plan. Expected 'monthly' or 'yearly'.");
}

function getAppBaseUrl() {
  return process.env.APP_BASE_URL || process.env.ALLOWED_ORIGIN || "http://localhost:5173";
}

function getBillingSuccessUrl() {
  return process.env.STRIPE_SUCCESS_URL || `${getAppBaseUrl().replace(/\/$/, "")}/profile/subscription?checkout=success`;
}

function getBillingCancelUrl() {
  return process.env.STRIPE_CANCEL_URL || `${getAppBaseUrl().replace(/\/$/, "")}/profile/subscription?checkout=cancelled`;
}

function getPortalReturnUrl() {
  return process.env.STRIPE_PORTAL_RETURN_URL || `${getAppBaseUrl().replace(/\/$/, "")}/profile/subscription`;
}

function stripeSearchValue(value) {
  return String(value).replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

async function findCustomerBySupabaseUserId(userId) {
  const stripe = getStripeClient();
  const result = await stripe.customers.search({
    query: `metadata['supabase_user_id']:'${stripeSearchValue(userId)}'`,
    limit: 1
  });
  return result.data[0] || null;
}

async function findOrCreateCustomer({ userId, email }) {
  const stripe = getStripeClient();
  const existingCustomer = await findCustomerBySupabaseUserId(userId);

  if (existingCustomer) {
    return existingCustomer;
  }

  return stripe.customers.create({
    email: email || undefined,
    metadata: { supabase_user_id: userId }
  });
}

async function createCheckoutSessionForUser({ userId, email, plan }) {
  const stripe = getStripeClient();
  const priceId = resolvePriceId(plan);

  if (!priceId) {
    throw new Error(`Missing Stripe price ID for ${plan} plan`);
  }

  const customer = await findOrCreateCustomer({ userId, email });
  const session = await stripe.checkout.sessions.create({
    mode: "subscription",
    customer: customer.id,
    line_items: [{ price: priceId, quantity: 1 }],
    client_reference_id: userId,
    success_url: getBillingSuccessUrl(),
    cancel_url: getBillingCancelUrl(),
    allow_promotion_codes: true,
    subscription_data: { metadata: { supabase_user_id: userId } }
  });

  if (!session.url) {
    throw new Error("Stripe checkout session did not return a redirect URL");
  }

  return session.url;
}

async function createPortalSessionForUser({ userId }) {
  const stripe = getStripeClient();
  const customer = await findCustomerBySupabaseUserId(userId);

  if (!customer) {
    throw new Error("No Stripe customer found for this user");
  }

  const session = await stripe.billingPortal.sessions.create({
    customer: customer.id,
    return_url: getPortalReturnUrl()
  });

  if (!session.url) {
    throw new Error("Stripe portal session did not return a redirect URL");
  }

  return session.url;
}

async function updateMembershipForUser(userId, membershipType) {
  const supabase = getSupabaseAdmin();
  const { error } = await supabase
    .from("profiles")
    .update({ membership_type: membershipType })
    .eq("id", userId);

  if (error) {
    throw new Error(`Failed to update membership_type: ${error.message}`);
  }
}

function isActiveSubscription(status) {
  return ACTIVE_SUBSCRIPTION_STATUSES.has(String(status || "").toLowerCase());
}

async function extractUserIdFromEventObject(eventObject) {
  if (eventObject?.metadata?.supabase_user_id) {
    return String(eventObject.metadata.supabase_user_id);
  }

  if (eventObject?.client_reference_id) {
    return String(eventObject.client_reference_id);
  }

  const customerId = eventObject?.customer;
  if (!customerId) {
    return null;
  }

  const stripe = getStripeClient();
  const customer = await stripe.customers.retrieve(customerId);
  if (customer && !customer.deleted && customer.metadata?.supabase_user_id) {
    return String(customer.metadata.supabase_user_id);
  }

  return null;
}

async function handleStripeWebhook(rawBody, signature) {
  const stripe = getStripeClient();
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  let event;

  if (webhookSecret) {
    if (!signature) {
      throw new Error("Missing Stripe signature");
    }
    event = stripe.webhooks.constructEvent(rawBody, signature, webhookSecret);
  } else {
    event = JSON.parse(Buffer.isBuffer(rawBody) ? rawBody.toString("utf8") : String(rawBody));
  }

  const object = event?.data?.object;
  if (!object) {
    return { received: true };
  }

  if (event.type === "checkout.session.completed") {
    const userId = await extractUserIdFromEventObject(object);
    if (userId) {
      await updateMembershipForUser(userId, "plus");
    }
    return { received: true };
  }

  if (
    event.type === "customer.subscription.created" ||
    event.type === "customer.subscription.updated" ||
    event.type === "customer.subscription.deleted"
  ) {
    const userId = await extractUserIdFromEventObject(object);
    if (userId) {
      const membershipType = isActiveSubscription(object.status) ? "plus" : "basic";
      await updateMembershipForUser(userId, membershipType);
    }
    return { received: true };
  }

  return { received: true };
}

module.exports = {
  createCheckoutSessionForUser,
  createPortalSessionForUser,
  handleStripeWebhook
};
