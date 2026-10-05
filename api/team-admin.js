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
import { audience, text } from "../lib/event-hq.js";

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
  const hash = crypto.createHash("sha256").update(token).digest("hex");
  const { data: admin, error } = await supabase.from("ladybug_team_members").select("id").eq("is_admin",true).eq("admin_access_hash",hash).maybeSingle();
  if(error) throw error;
  return !!admin;
}

function newToken() {
  return crypto.randomBytes(12).toString("base64url"); // 16 chars url-safe
}

async function loadEvent(supabase, slug) {
  const { data: events, error: evErr } = await supabase
    .from("ladybug_team_events")
    .select("id, slug, name, event_date, time_range, location, active, hosts_token, agenda, hq_details, team_updates")
    .order("event_date", { ascending: false });
  if (evErr) throw evErr;
  const event = slug ? events.find((e) => e.slug === slug) : events[0];
  if (!event) return { events, event: null };

  const results = await Promise.all([
    supabase
      .from("ladybug_team_roles")
      .select("*")
      .eq("event_id", event.id)
      .order("sort_order"),
    supabase
      .from("ladybug_team_members")
      .select("id,event_id,name,email,phone,notes,attendance_status,first_signup_at,is_admin,is_host,token,packet_filename")
      .eq("event_id", event.id)
      .order("name"),
    supabase
      .from("ladybug_team_signups")
      .select("id, member_id, role_key, created_at, status, internal_notes")
      .in(
        "member_id",
        (
          await supabase
            .from("ladybug_team_members")
            .select("id")
            .eq("event_id", event.id)
        ).data.map((m) => m.id).concat("00000000-0000-0000-0000-000000000000")
      ),
    supabase
      .from("ladybug_attendees")
      .select("*")
      .eq("event_id", event.id)
      .order("created_at", { ascending: false }),
  ]);

  for (const result of results) if (result.error) throw result.error;
  const [{data:roles},{data:members},{data:signups},{data:attendees}]=results;
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
  for (const k of Object.keys(tallies)) tallies[k].names.sort();

  return { events, event, roles, members: enrichedMembers, tallies, attendees: attendees || [], assignments: signups, audience: audience(attendees || [], enrichedMembers) };
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");

  let supabase;
  try {
    supabase = client();
  } catch (e) {
    return res.status(500).json({ error: "server_misconfigured", detail: e.message });
  }

  // Auth: shared admin key or independent hashed admin credential; never a team token.
  let okKey, okTok;
  try {
  okKey = authedByKey(req);
  okTok = okKey ? true : await authedByToken(req, supabase);
  } catch { return res.status(500).json({error:"auth_unavailable"}); }
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

      // Existing roles/signups remain the source of tasks and assignments.
      if (["edit_member","save_role","assign_role","remove_assignment","update_assignment","save_agenda","save_updates","save_event_details"].includes(action)) {
        const {data:event,error:eventError} = await supabase.from("ladybug_team_events").select("*").eq("slug",slug).single();
        if(eventError || !event) return res.status(400).json({error:"event_not_found"});
        async function memberInEvent(id) {
          const {data,error}=await supabase.from("ladybug_team_members").select("id").eq("id",id).eq("event_id",event.id).maybeSingle();
          if(error) throw error;
          if(!data) throw new Error("member_not_in_event");
          return data;
        }
        if(action==="edit_member") {
          await memberInEvent(body.member_id);
          const patch={};
          for(const field of ["name","phone","email","notes"]) if(typeof body[field]==="string") patch[field]=text(body[field],field==="notes"?4000:200) || null;
          if("name" in patch && !patch.name) return res.status(400).json({error:"name_required"});
          if(patch.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(patch.email)) return res.status(400).json({error:"invalid_email"});
          if("attendance_status" in body) {
            if(!["coming","not_coming","unsure",null,""].includes(body.attendance_status)) return res.status(400).json({error:"invalid_rsvp"});
            patch.attendance_status=body.attendance_status || null;
          }
          if(!Object.keys(patch).length) return res.status(400).json({error:"empty_patch"});
          const {error}=await supabase.from("ladybug_team_members").update({...patch,updated_at:new Date().toISOString()}).eq("id",body.member_id).eq("event_id",event.id); if(error) throw error;
        }
        if(action==="save_role") {
          const roleKey=text(body.role_key,80);
          if(!/^[a-z0-9_-]+$/.test(roleKey) || !text(body.name,200)) return res.status(400).json({error:"role_key_and_name_required"});
          const min=Number(body.min_needed),max=body.max_needed===""||body.max_needed==null?null:Number(body.max_needed);
          if(!Number.isInteger(min)||min<0||(max!==null&&(!Number.isInteger(max)||max<min))) return res.status(400).json({error:"invalid_staffing"});
          const {error}=await supabase.from("ladybug_team_roles").upsert({event_id:event.id,role_key:roleKey,name:text(body.name,200),description:text(body.description,4000),time_slot:text(body.time_slot,200),min_needed:min,max_needed:max,sort_order:Number(body.sort_order)||0,icon:text(body.icon,16)},{onConflict:"event_id,role_key"}); if(error) throw error;
        }
        if(["assign_role","remove_assignment","update_assignment"].includes(action)) {
          await memberInEvent(body.member_id);
          const {data:role,error:rError}=await supabase.from("ladybug_team_roles").select("role_key").eq("event_id",event.id).eq("role_key",body.role_key).maybeSingle();
          if(rError) throw rError; if(!role) return res.status(400).json({error:"role_not_in_event"});
          if(action==="assign_role") {
            const {error}=await supabase.from("ladybug_team_signups").upsert({member_id:body.member_id,role_key:role.role_key},{onConflict:"member_id,role_key",ignoreDuplicates:true}); if(error) throw error;
          } else if(action==="remove_assignment") {
            const {error}=await supabase.from("ladybug_team_signups").delete().eq("member_id",body.member_id).eq("role_key",role.role_key); if(error) throw error;
          } else {
            if(!["accepted","in_progress","done"].includes(body.status)) return res.status(400).json({error:"invalid_status"});
            const {error}=await supabase.from("ladybug_team_signups").update({status:body.status,internal_notes:text(body.internal_notes,4000)}).eq("member_id",body.member_id).eq("role_key",role.role_key); if(error) throw error;
          }
        }
        if(action==="save_agenda") {
          if(!Array.isArray(body.agenda)||body.agenda.length>100) return res.status(400).json({error:"invalid_agenda"});
          const {data:roster,error:rosterError}=await supabase.from("ladybug_team_members").select("id").eq("event_id",event.id); if(rosterError) throw rosterError;
          const ids=new Set(roster.map(m=>m.id));
          const {data:roles,error:rolesError}=await supabase.from("ladybug_team_roles").select("role_key").eq("event_id",event.id); if(rolesError) throw rolesError;
          const roleKeys=new Set(roles.map(r=>r.role_key));
          const agenda=body.agenda.map((i,index)=> {
            const start=text(i.start,5),end=text(i.end,5);
            if(!/^([01]\d|2[0-3]):[0-5]\d$/.test(start) || (end && (!/^([01]\d|2[0-3]):[0-5]\d$/.test(end)||end<start)) || !text(i.activity,200)) throw new Error("agenda_requires_valid_time_and_title");
            const people=Array.isArray(i.responsible)?i.responsible:[];
            if(people.some(id=>!ids.has(id))) throw new Error("agenda_member_not_in_event");
            if(i.role_key && !roleKeys.has(i.role_key)) throw new Error("agenda_role_not_in_event");
            const [h,m]=start.split(":").map(Number);
            return {start,end,time:(h%12||12)+":"+String(m).padStart(2,"0")+" "+(h>=12?"PM":"AM"),activity:text(i.activity,200),description:text(i.description,4000),responsible:people,role_key:text(i.role_key,80),internal_notes:text(i.internal_notes,4000),sort_order:index};
          });
          const {error}=await supabase.from("ladybug_team_events").update({hq_details:{...event.hq_details,run_of_show:agenda}}).eq("id",event.id); if(error) throw error;
        }
        if(action==="save_updates") {
          if(!Array.isArray(body.updates)||body.updates.length>100) return res.status(400).json({error:"invalid_updates"});
          const updates=body.updates.map(i=>({id:text(i.id,100)||crypto.randomUUID(),title:text(i.title,200),body:text(i.body,8000),updated_at:i.updated_at||new Date().toISOString()})).filter(i=>i.title||i.body);
          const {error}=await supabase.from("ladybug_team_events").update({team_updates:updates}).eq("id",event.id); if(error) throw error;
        }
        if(action==="save_event_details") {
          const details=body.hq_details||{};
          const {error}=await supabase.from("ladybug_team_events").update({name:text(body.name,200),event_date:body.event_date,time_range:text(body.time_range,200),location:text(body.location,400),hq_details:{...event.hq_details,venue:text(details.venue,200),team_arrival:text(details.team_arrival,200)}}).eq("id",event.id); if(error) throw error;
        }
        return res.status(200).json({ok:true});
      }

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

      if (["remove_member","reset_member","remove_attendee"].includes(action)) {
        const {data:selectedEvent,error:selectedError}=await supabase.from("ladybug_team_events").select("id").eq("slug",slug).single();
        if(selectedError||!selectedEvent)return res.status(400).json({error:"event_not_found"});
        const table=action==="remove_attendee"?"ladybug_attendees":"ladybug_team_members";
        const id=action==="remove_attendee"?body.attendee_id:body.member_id;
        const {data:target,error:targetError}=await supabase.from(table).select("id").eq("id",id).eq("event_id",selectedEvent.id).maybeSingle();
        if(targetError)throw targetError;if(!target)return res.status(400).json({error:"record_not_in_event"});
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

      if (action === "add_attendee") {
        const { data: event } = await supabase
          .from("ladybug_team_events")
          .select("id")
          .eq("slug", slug)
          .single();
        if (!event) return res.status(400).json({ error: "event_not_found" });
        const name = clean(body.name || "");
        const email = clean(body.email || "");
        if (!name || !email) return res.status(400).json({ error: "name_and_email_required" });
        const { data: attendee, error } = await supabase
          .from("ladybug_attendees")
          .insert({
            event_id: event.id,
            name,
            email,
            phone: clean(body.phone || "") || null,
            party_size: parseInt(body.party_size, 10) || 1,
            attending_with: clean(body.attending_with || "") || null,
            home_church: clean(body.home_church || "") || null,
            city_state: clean(body.city_state || "") || null,
            dietary: clean(body.dietary || "") || null,
            notes: clean(body.notes || "") || null,
          })
          .select("*")
          .single();
        if (error) throw error;
        return res.status(200).json({ ok: true, attendee });
      }

      if (action === "remove_attendee") {
        const attendeeId = clean(body.attendee_id || "");
        if (!attendeeId) return res.status(400).json({ error: "attendee_id_required" });
        const { error } = await supabase.from("ladybug_attendees").delete().eq("id", attendeeId);
        if (error) throw error;
        return res.status(200).json({ ok: true });
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
