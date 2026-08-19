// Read-only view for church hosts / co-organizers.
// GET /api/hosts?t=HOSTS_TOKEN → { event, attendees, total_people }
// No writes. No team-member data leaks. Only attendee-facing info.

import { createClient } from "@supabase/supabase-js";

const clean = (s) => (s || "").replace(/^[﻿\s]+|\s+$/g, "");
const SUPABASE_URL =
  process.env.SUPABASE_URL || "https://lheytkgixafdhluuvrbg.supabase.co";

function client() {
  const key = clean(process.env.SUPABASE_SERVICE_ROLE_KEY);
  if (!key) throw new Error("SUPABASE_SERVICE_ROLE_KEY not set");
  return createClient(SUPABASE_URL, key, { auth: { persistSession: false } });
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  const token = clean(req.query?.t || "");
  if (!/^[a-f0-9]{16,64}$/.test(token)) {
    return res.status(400).json({ error: "invalid_token" });
  }

  let supabase;
  try { supabase = client(); }
  catch (e) { return res.status(500).json({ error: "server_misconfigured", detail: e.message }); }

  try {
    const { data: event } = await supabase
      .from("ladybug_team_events")
      .select("id, name, event_date, time_range, location, agenda")
      .eq("hosts_token", token)
      .maybeSingle();
    if (!event) return res.status(404).json({ error: "not_found" });

    const { data: attendees } = await supabase
      .from("ladybug_attendees")
      .select("name, email, phone, party_size, attending_with, home_church, city_state, dietary, notes, created_at")
      .eq("event_id", event.id)
      .order("created_at", { ascending: false });

    const total_people = (attendees || []).reduce((s, a) => s + (a.party_size || 1), 0);
    return res.status(200).json({ event, attendees: attendees || [], total_people });
  } catch (err) {
    return res.status(500).json({ error: "server_error", detail: err.message });
  }
}
