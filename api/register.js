// Public registration for a Ladybug event.
//   GET  /api/register            → event info + registered count
//   POST /api/register            → { name, email, phone?, party_size?,
//                                     attending_with?, home_church?, city_state?,
//                                     dietary?, notes? }
// Uses the active event automatically.

import { createClient } from "@supabase/supabase-js";

const clean = (s) => (s || "").replace(/^[﻿\s]+|\s+$/g, "");
const SUPABASE_URL =
  process.env.SUPABASE_URL || "https://lheytkgixafdhluuvrbg.supabase.co";

function client() {
  const key = clean(process.env.SUPABASE_SERVICE_ROLE_KEY);
  if (!key) throw new Error("SUPABASE_SERVICE_ROLE_KEY not set");
  return createClient(SUPABASE_URL, key, { auth: { persistSession: false } });
}

async function getActiveEvent(supabase) {
  const { data } = await supabase
    .from("ladybug_team_events")
    .select("id, slug, name, event_date, time_range, location, agenda")
    .eq("active", true)
    .order("event_date", { ascending: false })
    .limit(1)
    .maybeSingle();
  return data;
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");

  let supabase;
  try {
    supabase = client();
  } catch (e) {
    return res.status(500).json({ error: "server_misconfigured", detail: e.message });
  }

  try {
    const event = await getActiveEvent(supabase);
    if (!event) return res.status(404).json({ error: "no_active_event" });

    if (req.method === "GET") {
      const { count } = await supabase
        .from("ladybug_attendees")
        .select("id", { count: "exact", head: true })
        .eq("event_id", event.id)
        .eq("status", "registered");
      // Sum party sizes for a truer "N people coming" number
      const { data: parties } = await supabase
        .from("ladybug_attendees")
        .select("party_size")
        .eq("event_id", event.id)
        .eq("status", "registered");
      const total = (parties || []).reduce((s, r) => s + (r.party_size || 1), 0);
      return res.status(200).json({
        event,
        registrations: count || 0,
        total_people: total || 0,
      });
    }

    if (req.method === "POST") {
      const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body || {};
      const name = clean(body.name || "");
      const email = clean(body.email || "");
      if (!name || name.length > 200) return res.status(400).json({ error: "name_required" });
      if (!email || !email.includes("@") || email.length > 200)
        return res.status(400).json({ error: "email_required" });
      const partySize = Math.max(1, Math.min(20, parseInt(body.party_size, 10) || 1));

      const row = {
        event_id: event.id,
        name,
        email,
        phone: clean(body.phone || "") || null,
        party_size: partySize,
        attending_with: clean(body.attending_with || "") || null,
        home_church: clean(body.home_church || "") || null,
        city_state: clean(body.city_state || "") || null,
        dietary: clean(body.dietary || "") || null,
        notes: clean(body.notes || "") || null,
        user_agent: (req.headers["user-agent"] || "").slice(0, 400),
      };

      const { data, error } = await supabase
        .from("ladybug_attendees")
        .insert(row)
        .select("id, created_at")
        .single();
      if (error) throw error;

      return res.status(200).json({ ok: true, id: data.id });
    }

    return res.status(405).json({ error: "method_not_allowed" });
  } catch (err) {
    console.error("register api error:", err);
    return res.status(500).json({ error: "server_error", detail: err.message || String(err) });
  }
}
