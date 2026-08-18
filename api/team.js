// Vercel serverless — team member self-signup.
//
//   GET  /api/team?t=TOKEN
//     → { event, roles, member, signups, tallies }
//   POST /api/team?t=TOKEN
//     Body: { name?, phone?, email?, notes?, add_role?, remove_role? }
//     → { ok, member, signups, tallies }
//
// Auth: token alone. No login/password. RLS is off for anon on the team
// tables — this function is the only public entry point, so validation
// lives here.

import { createClient } from "@supabase/supabase-js";

const clean = (s) => (s || "").replace(/^[﻿\s]+|\s+$/g, "");
const SUPABASE_URL =
  process.env.SUPABASE_URL || "https://lheytkgixafdhluuvrbg.supabase.co";

function client() {
  const key = clean(process.env.SUPABASE_SERVICE_ROLE_KEY);
  if (!key) throw new Error("SUPABASE_SERVICE_ROLE_KEY not set");
  return createClient(SUPABASE_URL, key, { auth: { persistSession: false } });
}

async function loadMemberContext(supabase, token) {
  const { data: member, error: mErr } = await supabase
    .from("ladybug_team_members")
    .select("*")
    .eq("token", token)
    .maybeSingle();
  if (mErr) throw mErr;
  if (!member) return { notFound: true };

  const { data: event, error: eErr } = await supabase
    .from("ladybug_team_events")
    .select("*")
    .eq("id", member.event_id)
    .single();
  if (eErr) throw eErr;

  const { data: roles, error: rErr } = await supabase
    .from("ladybug_team_roles")
    .select("*")
    .eq("event_id", member.event_id)
    .order("sort_order");
  if (rErr) throw rErr;

  // All signups for this event (join to members for display)
  const { data: allMembers, error: amErr } = await supabase
    .from("ladybug_team_members")
    .select("id, name")
    .eq("event_id", member.event_id);
  if (amErr) throw amErr;
  const memberById = Object.fromEntries(allMembers.map((m) => [m.id, m.name]));

  const memberIds = allMembers.map((m) => m.id);
  const { data: allSignups, error: asErr } = await supabase
    .from("ladybug_team_signups")
    .select("member_id, role_key, created_at")
    .in("member_id", memberIds.length ? memberIds : ["00000000-0000-0000-0000-000000000000"]);
  if (asErr) throw asErr;

  const tallies = {};
  for (const r of roles) tallies[r.role_key] = { count: 0, names: [] };
  for (const s of allSignups) {
    if (!tallies[s.role_key]) tallies[s.role_key] = { count: 0, names: [] };
    tallies[s.role_key].count += 1;
    const nm = memberById[s.member_id] || "?";
    if (!tallies[s.role_key].names.includes(nm)) tallies[s.role_key].names.push(nm);
  }

  const mySignups = allSignups
    .filter((s) => s.member_id === member.id)
    .map((s) => s.role_key);

  return { event, roles, member, mySignups, tallies };
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  const token = clean(req.query?.t || "");
  if (!/^[A-Za-z0-9_-]{8,64}$/.test(token)) {
    return res.status(400).json({ error: "invalid_token" });
  }

  let supabase;
  try {
    supabase = client();
  } catch (e) {
    return res.status(500).json({ error: "server_misconfigured", detail: e.message });
  }

  try {
    if (req.method === "GET") {
      const ctx = await loadMemberContext(supabase, token);
      if (ctx.notFound) return res.status(404).json({ error: "token_not_found" });
      return res.status(200).json({
        event: ctx.event,
        roles: ctx.roles,
        member: {
          name: ctx.member.name,
          phone: ctx.member.phone,
          email: ctx.member.email,
          notes: ctx.member.notes,
        },
        my_signups: ctx.mySignups,
        tallies: ctx.tallies,
      });
    }

    if (req.method === "POST") {
      const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body || {};
      const initial = await loadMemberContext(supabase, token);
      if (initial.notFound) return res.status(404).json({ error: "token_not_found" });
      const memberId = initial.member.id;

      // Update contact fields (only fields the client sent)
      const patch = {};
      for (const f of ["name", "phone", "email", "notes"]) {
        if (typeof body[f] === "string") patch[f] = body[f].trim() || null;
      }
      if (Object.keys(patch).length) {
        patch.updated_at = new Date().toISOString();
        const { error } = await supabase
          .from("ladybug_team_members")
          .update(patch)
          .eq("id", memberId);
        if (error) throw error;
      }

      // Add/remove roles
      if (body.add_role && typeof body.add_role === "string") {
        const roleKey = body.add_role.trim();
        const validRole = initial.roles.some((r) => r.role_key === roleKey);
        if (validRole) {
          await supabase
            .from("ladybug_team_signups")
            .upsert({ member_id: memberId, role_key: roleKey }, { onConflict: "member_id,role_key" });
        }
      }
      if (body.remove_role && typeof body.remove_role === "string") {
        await supabase
          .from("ladybug_team_signups")
          .delete()
          .eq("member_id", memberId)
          .eq("role_key", body.remove_role.trim());
      }

      const ctx = await loadMemberContext(supabase, token);
      return res.status(200).json({
        ok: true,
        member: {
          name: ctx.member.name,
          phone: ctx.member.phone,
          email: ctx.member.email,
          notes: ctx.member.notes,
        },
        my_signups: ctx.mySignups,
        tallies: ctx.tallies,
      });
    }

    return res.status(405).json({ error: "method_not_allowed" });
  } catch (err) {
    console.error("team api error:", err);
    return res.status(500).json({ error: "server_error", detail: err.message || String(err) });
  }
}
