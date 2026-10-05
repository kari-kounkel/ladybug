export const participates = m => m.attendance_status !== "not_coming" && (m.attendance_status === "coming" || (m.signups || []).length > 0);
export const delivery = rows => [...new Set(rows.map(r => String(r.email || "").trim().toLowerCase()).filter(e => /^[^\s@;]+@[^\s@;]+\.[^\s@;]+$/.test(e)))].sort();
export function audience(attendees, members) {
  const guests = attendees.filter(a => a.status === "registered"), team = members.filter(participates);
  const places = guests.reduce((n,a) => n + a.party_size, 0);
  const emails = {guests: delivery(guests), team: delivery(team), everyone: delivery([...guests,...team])};
  const flags = [];
  const norm = s => String(s || "").toLowerCase().replace(/[^a-z ]/g,"").replace(/\s+/g," ").trim();
  const matches = (name, text) => { const words = norm(name).split(" "); const target = norm(text); return words.filter(w => w.length > 1).every(w => target.includes(w)); };
  for (let i=0;i<guests.length;i++) for(let j=i+1;j<guests.length;j++) {
    const a=guests[i], b=guests[j];
    if (a.party_size>1 && b.party_size>1 && matches(a.name,b.attending_with) && matches(b.name,a.attending_with)) flags.push({ids:[a.id,b.id],names:[a.name,b.name],places:a.party_size+b.party_size,message:"Possible reciprocal guest registrations — confirm people represented; neither record changed."});
  }
  return {public_records:guests.length,guest_places:places,team_people:team.length,total_places:places+team.length,unique_addresses:emails.everyone.length,emails,attendance_flags:flags,unconfirmed_team:team.filter(m => m.attendance_status !== "coming").map(m => ({id:m.id,name:m.name,status:m.attendance_status || "no RSVP"}))};
}
export function sharedEvent(event) {
  if (!event) return event;
  const {hosts_token, ...safe} = event;
  safe.hq_details = {venue:event.hq_details?.venue || "",team_arrival:event.hq_details?.team_arrival || ""};
  safe.agenda = (event.hq_details?.run_of_show || event.agenda || []).map(({internal_notes, ...item}) => item);
  return safe;
}
export function text(value, max=2000) { return typeof value === "string" ? value.trim().slice(0,max) : ""; }
