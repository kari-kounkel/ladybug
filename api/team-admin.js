// Vercel serverless — admin ops for team signup.
//
// Auth: header `x-admin-key` (or ?k=... in GET) must match env var
// TEAM_ADMIN_KEY. Bookmark the admin page with ?k=... and it stays
// in localStorage after first use.
//
//   GET  /api/team-admin?k=KEY[&event=slug]
//     → { events, event, roles, members, tallies }
//   POST /api/team-admin?k=KEY
//     Body: { event_slug, action, ...args }
//     Actions:
//       add_member    { name, phone?, email? }              → { member, url }
//       remove_member { member_id }                         → { ok }
//       reset_member  { member_id }                         → wipes their signups
//       add_event     { slug, name, event_date, time_range, location } → { event }
//       clone_event   { from_slug, new_slug, name, event_date } → { event }

import { createClient } from "@supabase/supabase-js";
import crypto from "node:crypto";

const clean = (s) => (s || "").replace(/^[﻿\s]+|\s+$/g, "");
const SUPABASE_URL =
  process.env.SUPABASE_URL || "https://lheytkgixafdhluuvrbg.supabase.co";

function client() {
  const key = clean(process.env.SUPABASE_SERVICE_ROLE_KEY);
  if (!key) throw new Error("SUPABASE_SERVICE_ROLE_KEY not set");
  return createClient(SUPABASE_URL, key, { auth: { persistSession: false } });
}

// SHA256 of the admin key. Rotating = compute new hash, replace this string.
const ADMIN_KEY_HASH = "fe65181077840d89f0c6437cb4cda92cc187a4e61952ad29a40b76e23f85c67a";

function authedByKey(req) {
  const provided =
    clean(req.headers["x-admin-key"]) ||
    clean((req.query && req.query.k) || "");
  if (!provided) return false;
  const hash = crypto.createHash("sha256").update(provided).digest("hex");
  if (hash.length !== ADMIN_KEY_HASH.length) return false;
  return crypto.timingSafeEqual(Buffer.from(hash), Buffer.from(ADMIN_KEY_HASH));
}

// Also allow entry via an admin team member's own token — that way Kari can
// bounce from her /team page into admin with no key to remember.
async function authedByToken(req, supabase) {
  const token =
    clean(req.headers["x-team-token"]) ||
    clean((req.query && req.query.t) || "");
  if (!/^[A-Za-z0-9_-]{8,64}$/.test(token)) return false;
  const { data } = await supabase
    .from("ladybug_team_members")
    .select("is_admin")
    .eq("token", token)
    .maybeSingle();
  return !!(data && data.is_admin);
}

function newToken() {
  return crypto.randomBytes(12).toString("base64url"); // 16 chars url-safe
}

async function loadEvent(supabase, slug) {
  const { data: events, error: evErr } = await supabase
    .from("ladybug_team_events")
    .select("*")
    .order("event_date", { ascending: false });
  if (evErr) throw evErr;
  const event = slug ? events.find((e) => e.slug === slug) : events[0];
  if (!event) return { events, event: null };

  const [{ data: roles }, { data: members }, { data: signups }] = await Promise.all([
    supabase
      .from("ladybug_team_roles")
      .select("*")
      .eq("event_id", event.id)
      .order("sort_order"),
    supabase
      .from("ladybug_team_members")
      .select("*")
      .eq("event_id", event.id)
      .order("created_at"),
    supabase
      .from("ladybug_team_signups")
      .select("member_id, role_key, created_at")
      .in(
        "member_id",
        (
          await supabase
            .from("ladybug_team_members")
            .select("id")
            .eq("event_id", event.id)
        ).data.map((m) => m.id).concat("00000000-0000-0000-0000-000000000000")
      ),
  ]);

  const signupsByMember = {};
  for (const s of signups) {
    (signupsByMember[s.member_id] ||= []).push(s.role_key);
  }
  const enrichedMembers = members.map((m) => ({
    ...m,
    signups: signupsByMember[m.id] || [],
  }));

  // Enrich tallies with the names of who signed up for each role
  const memberById = Object.fromEntries(members.map((m) => [m.id, m.name]));
  const tallies = {};
  for (const r of roles) tallies[r.role_key] = { count: 0, names: [] };
  for (const s of signups) {
    if (!tallies[s.role_key]) tallies[s.role_key] = { count: 0, names: [] };
    tallies[s.role_key].count += 1;
    const nm = memberById[s.member_id];
    if (nm && !tallies[s.role_key].names.includes(nm)) tallies[s.role_key].names.push(nm);
  }

  return { events, event, roles, members: enrichedMembers, tallies };
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");

  let supabase;
  try {
    supabase = client();
  } catch (e) {
    return res.status(500).json({ error: "server_misconfigured", detail: e.message });
  }

  // Auth: either the shared admin key OR an admin member's own team token.
  const okKey = authedByKey(req);
  const okTok = okKey ? true : await authedByToken(req, supabase);
  if (!okKey && !okTok) return res.status(401).json({ error: "unauthorized" });

  try {
    if (req.method === "GET") {
      const slug = clean((req.query && req.query.event) || "");
      const data = await loadEvent(supabase, slug);
      return res.status(200).json(data);
    }

    if (req.method === "POST") {
      const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body || {};
      const action = clean(body.action || "");
      const slug = clean(body.event_slug || "");

      if (action === "add_member") {
        const { data: event } = await supabase
          .from("ladybug_team_events")
          .select("*")
          .eq("slug", slug)
          .single();
        if (!event) return res.status(400).json({ error: "event_not_found" });
        const name = clean(body.name || "");
        if (!name) return res.status(400).json({ error: "name_required" });
        const token = newToken();
        const { data: member, error } = await supabase
          .from("ladybug_team_members")
          .insert({
            event_id: event.id,
            token,
            name,
            phone: clean(body.phone || "") || null,
            email: clean(body.email || "") || null,
          })
          .select("*")
          .single();
        if (error) throw error;
        return res.status(200).json({
          ok: true,
          member,
          url: `https://ladybug.karikounkel.com/team?t=${token}`,
        });
      }

      if (action === "remove_member") {
        const memberId = clean(body.member_id || "");
        if (!memberId) return res.status(400).json({ error: "member_id_required" });
        const { error } = await supabase.from("ladybug_team_members").delete().eq("id", memberId);
        if (error) throw error;
        return res.status(200).json({ ok: true });
      }

      if (action === "reset_member") {
        const memberId = clean(body.member_id || "");
        if (!memberId) return res.status(400).json({ error: "member_id_required" });
        await supabase.from("ladybug_team_signups").delete().eq("member_id", memberId);
        await supabase
          .from("ladybug_team_members")
          .update({ first_signup_at: null, updated_at: new Date().toISOString() })
          .eq("id", memberId);
        return res.status(200).json({ ok: true });
      }

      if (action === "add_event") {
        const evSlug = clean(body.slug || "");
        const evName = clean(body.name || "");
        if (!evSlug || !evName) return res.status(400).json({ error: "slug_and_name_required" });
        const { data: event, error } = await supabase
          .from("ladybug_team_events")
          .insert({
            slug: evSlug,
            name: evName,
            event_date: body.event_date || null,
            time_range: body.time_range || null,
            location: body.location || null,
          })
          .select("*")
          .single();
        if (error) throw error;
        return res.status(200).json({ ok: true, event });
      }

      if (action === "clone_event") {
        const fromSlug = clean(body.from_slug || "");
        const newSlug = clean(body.new_slug || "");
        const newName = clean(body.name || "");
        if (!fromSlug || !newSlug || !newName)
          return res.status(400).json({ error: "from_slug_new_slug_name_required" });
        const { data: fromEvent } = await supabase
          .from("ladybug_team_events")
          .select("*")
          .eq("slug", fromSlug)
          .single();
        if (!fromEvent) return res.status(400).json({ error: "from_event_not_found" });
        const { data: newEvent, error: neErr } = await supabase
          .from("ladybug_team_events")
          .insert({
            slug: newSlug,
            name: newName,
            event_date: body.event_date || null,
            time_range: body.time_range || fromEvent.time_range,
            location: body.location || fromEvent.location,
          })
          .select("*")
          .single();
        if (neErr) throw neErr;
        const { data: fromRoles } = await supabase
          .from("ladybug_team_roles")
          .select("role_key,name,description,min_needed,max_needed,icon,sort_order")
          .eq("event_id", fromEvent.id);
        if (fromRoles && fromRoles.length) {
          await supabase
            .from("ladybug_team_roles")
            .insert(fromRoles.map((r) => ({ ...r, event_id: newEvent.id })));
        }
        return res.status(200).json({ ok: true, event: newEvent });
      }

      return res.status(400).json({ error: "unknown_action" });
    }

    return res.status(405).json({ error: "method_not_allowed" });
  } catch (err) {
    console.error("team-admin api error:", err);
    return res.status(500).json({ error: "server_error", detail: err.message || String(err) });
  }
}
