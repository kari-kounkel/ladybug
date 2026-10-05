let hqData;
const field = (label,id,value="",type="text") => '<div class="field"><label for="'+id+'">'+esc(label)+'</label><input id="'+id+'" type="'+type+'" value="'+esc(value)+'"></div>';
const area = (label,id,value="") => '<div class="field"><label for="'+id+'">'+esc(label)+'</label><textarea id="'+id+'">'+esc(value)+'</textarea></div>';
function memberOptions(selected="") { return hqData.members.map(m=>'<option value="'+m.id+'" '+(m.id===selected?'selected':'')+'>'+esc(m.name)+'</option>').join(''); }
function roleOptions(selected="") { return '<option value="">None</option>'+hqData.roles.map(r=>'<option value="'+esc(r.role_key)+'" '+(r.role_key===selected?'selected':'')+'>'+esc(r.name)+'</option>').join(''); }
function card(title,body) { return '<section class="card"><h2>'+title+'</h2>'+body+'</section>'; }
function renderHQ(data) {
  hqData=data;
  const a=data.audience;
  const main=document.querySelector('main.wrap');
  main.querySelector('h1').textContent='Ladybug Event HQ';
  const summary=card('People, places and email delivery',
    '<p><strong>'+a.total_places+' stored places · '+a.unique_addresses+' unique delivery addresses</strong></p>'+
    '<p>'+a.public_records+' guest registrations represent '+a.guest_places+' places; '+a.team_people+' participating team members. Shared email addresses do not merge people.</p>'+
    '<div class="actions">'+['guests','team','everyone'].map(k=>'<button class="btn small" data-copy="'+k+'">Copy '+({guests:'Guests',team:'Team',everyone:'Everyone'}[k])+' email list ('+a.emails[k].length+')</button>').join('')+'</div>'+
    '<p id="copy-result" role="status"></p><textarea id="email-fallback" aria-label="Email list for manual copying" hidden readonly></textarea>'+
    a.attendance_flags.map(f=>'<div class="hq-warning"><strong>Attendance needs confirmation: '+f.names.map(esc).join(' / ')+'</strong><p>'+f.places+' stored places may represent two people. '+esc(f.message)+'</p></div>').join('')+
    (a.unconfirmed_team.length?'<p>Participating, RSVP still needs confirmation: '+a.unconfirmed_team.map(m=>esc(m.name)+' ('+esc(m.status)+')').join(', ')+'.</p>':''));
  main.insertAdjacentHTML('afterbegin',summary);
  main.querySelectorAll('[data-copy]').forEach(b=>b.addEventListener('click',()=>copyAudience(b.dataset.copy)));
  main.querySelectorAll('.actions button[onclick^="resetMember"]').forEach(b=> {
    const match=b.getAttribute('onclick').match(/resetMember\('([^']+)'/);
    if(match){b.textContent='Edit safely';b.removeAttribute('onclick');b.addEventListener('click',()=>editMember(match[1]));}
  });
  main.insertAdjacentHTML('beforeend','<div id="hq-sections">'+
    card('Event details and team arrival','<form id="details-form"><div class="hq-grid">'+
      field('Event name','ev-name',data.event.name)+field('Date','ev-date',data.event.event_date,'date')+
      field('Public event time','ev-time',data.event.time_range)+field('Address','ev-location',data.event.location)+
      field('Venue / community','ev-venue',data.event.hq_details.venue)+field('Team arrival / setup','ev-arrival',data.event.hq_details.team_arrival)+
      '</div><button class="btn small">Save event details</button></form>')+
    card('Tasks and accepted assignments','<div class="actions"><button class="btn small" id="add-task">Create task / role</button></div><div id="task-board"></div>')+
    card('Agenda / run of show','<p>Shared with the team. Internal notes stay in Admin. The public registration agenda is unchanged.</p><form id="agenda-form"><div id="agenda-rows"></div><div class="actions"><button type="button" class="btn small ghost" id="add-agenda">Add agenda item</button><button class="btn small">Save run of show</button></div></form>')+
    card('Team updates and notes','<p>These updates appear on the team page. Saving does not send email.</p><form id="updates-form"><div id="updates-rows"></div><div class="actions"><button type="button" class="btn small ghost" id="add-update">Add update</button><button class="btn small">Save team updates</button></div></form>')+
    card('Recovered event register','<p><a href="https://karikounkel.shop/pos" target="_blank" rel="noreferrer">Open K Co Register</a> · <a href="https://karikounkel.shop/pos/admin" target="_blank" rel="noreferrer">Open register setup and reports</a></p><p>Existing POS; configure the event and products before event sales.</p>')+
    '</div><dialog id="hq-dialog"><div id="dialog-content"></div><button class="btn small ghost" id="close-dialog">Cancel</button></dialog>');
  document.getElementById('close-dialog').onclick=()=>document.getElementById('hq-dialog').close();
  renderTasks();
  const agenda=data.event.hq_details.run_of_show || data.event.agenda || [];
  agenda.forEach(addAgendaRow);
  (data.event.team_updates || []).forEach(addUpdateRow);
  document.getElementById('add-task').onclick=()=>editTask();
  document.getElementById('add-agenda').onclick=()=>addAgendaRow({});
  document.getElementById('add-update').onclick=()=>addUpdateRow({});
  document.getElementById('details-form').onsubmit=async e=>{e.preventDefault();await saveHQ({action:'save_event_details',name:value('ev-name'),event_date:value('ev-date'),time_range:value('ev-time'),location:value('ev-location'),hq_details:{venue:value('ev-venue'),team_arrival:value('ev-arrival')}});};
  document.getElementById('agenda-form').onsubmit=async e=> {
    e.preventDefault();
    const agenda=[...document.querySelectorAll('.agenda-edit')].map(row=>({start:row.querySelector('[name=start]').value,end:row.querySelector('[name=end]').value,activity:row.querySelector('[name=title]').value,description:row.querySelector('[name=description]').value,responsible:[...row.querySelector('[name=responsible]').selectedOptions].map(o=>o.value),role_key:row.querySelector('[name=role]').value,internal_notes:row.querySelector('[name=internal]').value}));
    await saveHQ({action:'save_agenda',agenda});
  };
  document.getElementById('updates-form').onsubmit=async e=> {
    e.preventDefault();
    const updates=[...document.querySelectorAll('.update-edit')].map(row=>({id:row.dataset.id,title:row.querySelector('[name=title]').value,body:row.querySelector('[name=body]').value,updated_at:new Date().toISOString()}));
    await saveHQ({action:'save_updates',updates});
  };
}
function value(id){return document.getElementById(id).value;}
async function saveHQ(body){
  try{await api('POST',{event_slug:currentSlug,...body});await boot();return true;}catch(e){alert('Could not save: '+e.message);return false;}
}
async function copyAudience(kind){
  // Refresh from Supabase via protected API at the time Copy is clicked.
  try {
    const fresh=await api('GET'); const list=fresh.audience.emails[kind].join('; ');
    const fallback=document.getElementById('email-fallback');
    fallback.hidden=false;fallback.value=list;
    try{await navigator.clipboard.writeText(list);document.getElementById('copy-result').textContent='Copied '+fresh.audience.emails[kind].length+' delivery addresses.';fallback.hidden=true;}
    catch{fallback.focus();fallback.select();document.getElementById('copy-result').textContent='Select and copy the current addresses below.';}
  }catch(e){alert('Could not refresh email list: '+e.message);}
}
function openForm(html,onSubmit){
  if(document.getElementById('hq-dialog').open) document.getElementById('hq-dialog').close();
  document.getElementById('dialog-content').innerHTML='<form id="dialog-form">'+html+'<button class="btn small">Save</button></form>';
  document.getElementById('dialog-form').onsubmit=onSubmit;
  document.getElementById('hq-dialog').showModal();
}
function editMember(id){
  const m=hqData.members.find(m=>m.id===id);
  openForm('<h2>Edit '+esc(m.name)+'</h2><p>Accepted assignments are preserved.</p>'+field('Name','member-name',m.name)+field('Email','member-email',m.email,'email')+field('Phone','member-phone',m.phone)+area('Notes','member-notes',m.notes)+
    '<div class="field"><label for="member-rsvp">RSVP</label><select id="member-rsvp">'+[['','No RSVP'],['coming','Coming'],['unsure','Unsure'],['not_coming','Not coming']].map(([v,l])=>'<option value="'+v+'" '+((m.attendance_status||'')===v?'selected':'')+'>'+l+'</option>').join('')+'</select></div>',
    async e=>{e.preventDefault();await saveHQ({action:'edit_member',member_id:id,name:value('member-name'),email:value('member-email'),phone:value('member-phone'),notes:value('member-notes'),attendance_status:value('member-rsvp')});});
}
function editTask(key){
  const r=hqData.roles.find(r=>r.role_key===key)||{role_key:'task_'+Date.now(),min_needed:1,max_needed:null,sort_order:hqData.roles.length+1};
  openForm('<h2>'+ (key?'Edit task / role':'Create task / role')+'</h2>'+field('Title','task-title',r.name)+area('Instructions','task-description',r.description)+field('Time / shift','task-time',r.time_slot)+field('Minimum helpers','task-min',r.min_needed,'number')+field('Maximum helpers (optional)','task-max',r.max_needed,'number'),
    async e=>{e.preventDefault();await saveHQ({action:'save_role',role_key:r.role_key,name:value('task-title'),description:value('task-description'),time_slot:value('task-time'),min_needed:value('task-min'),max_needed:value('task-max'),sort_order:r.sort_order,icon:r.icon||'✓'});});
}
function renderTasks(){
  const labels={unclaimed:'Unclaimed',accepted:'Accepted',in_progress:'In Progress',done:'Done'};
  const groups={unclaimed:[],accepted:[],in_progress:[],done:[]};
  for(const role of hqData.roles){
    const assigned=hqData.assignments.filter(s=>s.role_key===role.role_key);
    if(!assigned.length || assigned.length<role.min_needed) groups.unclaimed.push({role,slots:Math.max(1,role.min_needed-assigned.length)});
    for(const signup of assigned)groups[signup.status||'accepted'].push({role,signup});
  }
  document.getElementById('task-board').innerHTML=Object.entries(groups).map(([status,rows])=>'<div class="task-group"><h3>'+labels[status]+' ('+rows.length+')</h3>'+rows.map(({role,signup,slots})=>{
    const m=signup&&hqData.members.find(m=>m.id===signup.member_id);
    return '<div class="task-item"><strong>'+esc(role.name)+'</strong><p>'+esc(role.time_slot)+'</p><p>'+esc(role.description)+'</p>'+
      (signup?'<p>'+esc(m?.name||'Unknown')+' · '+labels[signup.status||'accepted']+'</p><button class="btn small ghost" data-assignment="'+signup.id+'">Manage assignment</button>':'<p>'+slots+' open helper slot'+(slots===1?'':'s')+'</p><button class="btn small" data-claim="'+esc(role.role_key)+'">Assign helper</button>')+
      '<button class="btn small ghost" data-edit-role="'+esc(role.role_key)+'">Edit task</button></div>';
  }).join('')+'</div>').join('');
  document.querySelectorAll('[data-edit-role]').forEach(b=>b.onclick=()=>editTask(b.dataset.editRole));
  document.querySelectorAll('[data-claim]').forEach(b=>b.onclick=()=>assignTask(b.dataset.claim));
  document.querySelectorAll('[data-assignment]').forEach(b=>b.onclick=()=>manageAssignment(b.dataset.assignment));
}
function assignTask(key){
  openForm('<h2>Assign '+esc(hqData.roles.find(r=>r.role_key===key).name)+'</h2><div class="field"><label for="assign-member">Team member</label><select id="assign-member">'+memberOptions()+'</select></div>',
    async e=>{e.preventDefault();await saveHQ({action:'assign_role',role_key:key,member_id:value('assign-member')});});
}
function manageAssignment(id){
  const s=hqData.assignments.find(s=>s.id===id);
  const m=hqData.members.find(m=>m.id===s.member_id);
  openForm('<h2>'+esc(m.name)+' · '+esc(hqData.roles.find(r=>r.role_key===s.role_key).name)+'</h2><div class="field"><label for="assignment-status">Status</label><select id="assignment-status">'+[['accepted','Accepted'],['in_progress','In Progress'],['done','Done']].map(([v,l])=>'<option value="'+v+'" '+(s.status===v?'selected':'')+'>'+l+'</option>').join('')+'</select></div>'+area('Internal assignment notes','assignment-notes',s.internal_notes)+'<p>To reassign, add the new helper first, then explicitly remove this assignment.</p><button type="button" class="btn small ghost" id="add-other">Add another helper</button><button type="button" class="btn small ghost" id="remove-assignment">Remove this assignment</button>',
    async e=>{e.preventDefault();await saveHQ({action:'update_assignment',member_id:s.member_id,role_key:s.role_key,status:value('assignment-status'),internal_notes:value('assignment-notes')});});
  document.getElementById('add-other').onclick=()=>assignTask(s.role_key);
  document.getElementById('remove-assignment').onclick=async()=>{if(confirm('Remove only this assignment for '+m.name+'?'))await saveHQ({action:'remove_assignment',member_id:s.member_id,role_key:s.role_key});};
}
function time24(s){
  const m=String(s||'').match(/(\d{1,2}):(\d{2})\s*(AM|PM)/i);
  return m?String((Number(m[1])%12)+(m[3].toUpperCase()==='PM'?12:0)).padStart(2,'0')+':'+m[2]:'';
}
function addAgendaRow(item){
  const row=document.createElement('div');row.className='agenda-edit hq-row';
  row.innerHTML='<div class="hq-grid"><label>Start<input name="start" type="time" required value="'+esc(item.start||time24(item.time))+'"></label><label>End (optional)<input name="end" type="time" value="'+esc(item.end)+'"></label><label>Title<input name="title" required value="'+esc(item.activity)+'"></label><label>Related task<select name="role">'+roleOptions(item.role_key)+'</select></label></div>'+
    '<label>Instructions<textarea name="description">'+esc(item.description)+'</textarea></label><label>Responsible people (select one or more)<select name="responsible" multiple>'+hqData.members.map(m=>'<option value="'+m.id+'" '+((item.responsible||[]).includes(m.id)?'selected':'')+'>'+esc(m.name)+'</option>').join('')+'</select></label>'+
    '<label>Internal notes<textarea name="internal">'+esc(item.internal_notes)+'</textarea></label><div class="actions"><button type="button" class="btn small ghost" data-up>Move up</button><button type="button" class="btn small ghost" data-down>Move down</button><button type="button" class="btn small ghost" data-remove>Remove item</button></div>';
  row.querySelector('[data-up]').onclick=()=>{if(row.previousElementSibling)row.parentNode.insertBefore(row,row.previousElementSibling);};
  row.querySelector('[data-down]').onclick=()=>{if(row.nextElementSibling)row.parentNode.insertBefore(row.nextElementSibling,row);};
  row.querySelector('[data-remove]').onclick=()=>row.remove();
  document.getElementById('agenda-rows').appendChild(row);
}
function addUpdateRow(item){
  const row=document.createElement('div');row.className='update-edit hq-row';row.dataset.id=item.id||crypto.randomUUID();
  row.innerHTML='<label>Title<input name="title" value="'+esc(item.title)+'"></label><label>Update / instructions<textarea name="body">'+esc(item.body)+'</textarea></label><button type="button" class="btn small ghost">Remove update</button>';
  row.querySelector('button').onclick=()=>row.remove();document.getElementById('updates-rows').appendChild(row);
}
