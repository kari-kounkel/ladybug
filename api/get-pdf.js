// Vercel serverless function — verifies a paid Stripe Checkout Session,
// then mints a fresh 7-day signed Supabase Storage URL for the book PDF.
//
// Uses raw fetch() instead of the Stripe / Supabase SDKs to keep this
// thing as simple as possible (the SDKs were throwing
// StripeConnectionError on Vercel for reasons that weren't worth
// debugging when the actual API calls are 5-line fetches).
//
// Called from /pdf-thanks.html with ?session_id=cs_live_...
//
// Required Vercel env vars:
//   STRIPE_SECRET_KEY            sk_live_... or rk_live_... (restricted is fine if it has Checkout sessions: Read)
//   SUPABASE_SERVICE_ROLE_KEY    service_role JWT from kkstore project

const SUPABASE_URL = "https://lheytkgixafdhluuvrbg.supabase.co";
const BUCKET = "ladybug-pdf";
const FILE = "ladybug.pdf";
const SIGNED_URL_TTL_SECONDS = 60 * 60 * 24 * 7; // 7 days

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");

  const sessionId = (req.query && req.query.session_id) || "";

  if (!sessionId || !/^cs_(live|test)_[A-Za-z0-9]+$/.test(sessionId)) {
    return res.status(400).json({ error: "missing_or_invalid_session_id" });
  }

  // Strip leading BOM / whitespace — happens when env vars are piped in
  // from a PowerShell stdin, which prepends ﻿.
  const clean = (s) => (s || "").replace(/^[﻿\s]+|\s+$/g, "");
  const stripeKey = clean(process.env.STRIPE_SECRET_KEY);
  const supabaseKey = clean(process.env.SUPABASE_SERVICE_ROLE_KEY);

  if (!stripeKey) {
    return res.status(500).json({ error: "server_misconfigured", detail: "STRIPE_SECRET_KEY not set" });
  }
  if (!supabaseKey) {
    return res.status(500).json({ error: "server_misconfigured", detail: "SUPABASE_SERVICE_ROLE_KEY not set" });
  }

  // --- 1. Verify the Stripe session ---
  let session;
  try {
    const stripeRes = await fetch(
      `https://api.stripe.com/v1/checkout/sessions/${encodeURIComponent(sessionId)}`,
      {
        headers: {
          Authorization: `Bearer ${stripeKey}`,
          "Stripe-Version": "2024-06-20",
        },
      }
    );
    const text = await stripeRes.text();
    let body;
    try { body = JSON.parse(text); } catch { body = { raw: text }; }

    if (stripeRes.status === 404 || body?.error?.code === "resource_missing") {
      return res.status(404).json({ error: "session_not_found" });
    }
    if (!stripeRes.ok) {
      console.error("Stripe verify failed:", stripeRes.status, body);
      return res.status(502).json({
        error: "stripe_request_failed",
        status: stripeRes.status,
        detail: body?.error?.message || body?.raw || "unknown stripe error",
      });
    }
    session = body;
  } catch (err) {
    console.error("Stripe fetch threw:", err);
    return res.status(500).json({ error: "stripe_fetch_failed", detail: err?.message || String(err) });
  }

  if (session.payment_status !== "paid") {
    return res.status(403).json({ error: "not_paid", payment_status: session.payment_status });
  }

  // --- 2. Mint a signed URL from Supabase Storage ---
  let signedUrl;
  try {
    const supaRes = await fetch(
      `${SUPABASE_URL}/storage/v1/object/sign/${encodeURIComponent(BUCKET)}/${encodeURIComponent(FILE)}`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${supabaseKey}`,
          apikey: supabaseKey,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ expiresIn: SIGNED_URL_TTL_SECONDS }),
      }
    );
    const text = await supaRes.text();
    let body;
    try { body = JSON.parse(text); } catch { body = { raw: text }; }

    if (!supaRes.ok || !body?.signedURL) {
      console.error("Supabase sign failed:", supaRes.status, body);
      return res.status(500).json({
        error: "signed_url_failed",
        status: supaRes.status,
        detail: body?.message || body?.error || body?.raw || "unknown supabase error",
      });
    }
    // signedURL is a relative path like "/object/sign/ladybug-pdf/ladybug.pdf?token=..."
    signedUrl = body.signedURL.startsWith("http")
      ? body.signedURL
      : `${SUPABASE_URL}/storage/v1${body.signedURL}`;
  } catch (err) {
    console.error("Supabase fetch threw:", err);
    return res.status(500).json({ error: "supabase_fetch_failed", detail: err?.message || String(err) });
  }

  const expiresAt = new Date(Date.now() + SIGNED_URL_TTL_SECONDS * 1000).toISOString();

  return res.status(200).json({
    url: signedUrl,
    expires_at: expiresAt,
    buyer_email: session.customer_details?.email || null,
    amount_total: session.amount_total,
    currency: session.currency,
  });
}
