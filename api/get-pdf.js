// Vercel serverless function — verifies a paid Stripe Checkout Session,
// then mints a fresh 7-day signed Supabase Storage URL for the book PDF.
//
// Called from /pdf-thanks.html with ?session_id=cs_live_...
// Stripe drops in the real session ID when it redirects the buyer after
// payment.
//
// Required Vercel env vars:
//   STRIPE_SECRET_KEY            — sk_live_... from Stripe dashboard
//   SUPABASE_SERVICE_ROLE_KEY    — service_role JWT from Supabase project
// Optional override:
//   SUPABASE_URL                 — defaults to the kkstore project URL

import Stripe from "stripe";
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL =
  process.env.SUPABASE_URL || "https://lheytkgixafdhluuvrbg.supabase.co";
const BUCKET = "ladybug-pdf";
const FILE = "ladybug.pdf";
const SIGNED_URL_TTL_SECONDS = 60 * 60 * 24 * 7; // 7 days

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");

  const sessionId = (req.query && req.query.session_id) || "";

  if (!sessionId || !/^cs_(live|test)_[A-Za-z0-9]+$/.test(sessionId)) {
    return res
      .status(400)
      .json({ error: "missing_or_invalid_session_id" });
  }

  if (!process.env.STRIPE_SECRET_KEY) {
    return res
      .status(500)
      .json({ error: "server_misconfigured", detail: "STRIPE_SECRET_KEY not set" });
  }
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return res
      .status(500)
      .json({ error: "server_misconfigured", detail: "SUPABASE_SERVICE_ROLE_KEY not set" });
  }

  try {
    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
    const session = await stripe.checkout.sessions.retrieve(sessionId);

    if (!session) {
      return res.status(404).json({ error: "session_not_found" });
    }
    if (session.payment_status !== "paid") {
      return res
        .status(403)
        .json({ error: "not_paid", payment_status: session.payment_status });
    }

    const supabase = createClient(
      SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY,
      { auth: { persistSession: false } }
    );

    const { data, error } = await supabase.storage
      .from(BUCKET)
      .createSignedUrl(FILE, SIGNED_URL_TTL_SECONDS);

    if (error || !data || !data.signedUrl) {
      console.error("createSignedUrl failed:", error);
      return res
        .status(500)
        .json({ error: "signed_url_failed", detail: error?.message });
    }

    const expiresAt = new Date(Date.now() + SIGNED_URL_TTL_SECONDS * 1000).toISOString();

    return res.status(200).json({
      url: data.signedUrl,
      expires_at: expiresAt,
      buyer_email: session.customer_details?.email || null,
      amount_total: session.amount_total,
      currency: session.currency,
    });
  } catch (err) {
    console.error("get-pdf error:", err);
    return res
      .status(500)
      .json({ error: "verification_failed", detail: err?.message || String(err) });
  }
}
