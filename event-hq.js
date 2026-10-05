const firstName = name => String(name || '').trim().split(/\s+/)[0];
let hqData;
let agendaMode='plan';
const field = (label,id,value="",type="text") => '<div class="field"><label for="'+id+'">'+esc(label)+'</label><input id="'+id+'" type="'+type+'" value="'+esc(value)+'"></div>';
const area = (label,id,value="") => '<div class="field"><label for="'+id+'">'+esc(label)+'</label><textarea id="'+id+'">'+esc(value)+'</textarea></div>';
function memberOptions(selected="") { return hqData.members.filter(m=>m.attendance_status==="coming").map(m=>'<option value="'+m.id+'" '+(m.id===selected?'selected':'')+'>'+esc(firstName(m.name))+'</option>').join(''); }
function roleOptions(selected="") { return '<option value="">None</option>'+hqData.roles.map(r=>'<option value="'+esc(r.role_key)+'" '+(r.role_key===selected?'selected':'')+'>'+esc(r.name)+'</option>').join(''); }
function card(title,body) { return '<section class="card"><h2>'+title+'</h2>'+body+'</section>'; }
function renderHQ(data) {
  hqData=data;
  const a=data.audience;
  const main=document.querySelector('main.wrap');
  main.querySelector('h1').textContent='Ladybug Event HQ';
  const summary=card('People, places and email delivery',
    '<p><strong>'+a.public_records+' people on the guest list · '+a.unique_addresses+' unique delivery addresses</strong></p>'+
    '<p>'+a.public_records+' named guest registrations; '+a.team_people+' participating team members shown separately. Companion names may already appear in the list, so party sizes are not added to the people count. Shared email addresses do not merge people.</p>'+
    '<div class="actions">'+['guests','team','everyone'].map(k=>'<button class="btn small" data-copy="'+k+'">Copy '+({guests:'Guests',team:'Team',everyone:'Everyone'}[k])+' email list ('+a.emails[k].length+')</button>').join('')+'</div>'+
    '<p id="copy-result" role="status"></p><textarea id="email-fallback" aria-label="Email list for manual copying" hidden readonly></textarea>'+
    a.attendance_flags.map(f=>'<div class="hq-warning"><strong>Attendance needs confirmation: '+f.names.map(esc).join(' / ')+'</strong><p>'+f.places+' stored places may represent two people. '+esc(f.message)+'</p></div>').join('')+
    (a.unconfirmed_team.length?'<p>Team RSVP still needs confirmation: '+a.unconfirmed_team.map(m=>esc(firstName(m.name))+' ('+esc(m.status)+')').join(', ')+'.</p>':''));
  main.insertAdjacentHTML('afterbegin',summary);
  main.querySelectorAll('[data-copy]').forEach(b=>b.addEventListener('click',()=>copyAudience(b.dataset.copy)));
  main.querySelectorAll('.actions button[onclick^="resetMember"]').forEach(b=> {
    const match=b.getAttribute('onclick').match(/resetMember\('([^']+)'/);
    if(match){b.textContent='Edit safely';b.removeAttribute('onclick');b.addEventListener('click',()=>editMember(match[1]));}
  });
  const baseSections=[...main.querySelectorAll('section.card')];
  const findSection=prefix=>baseSections.find(section=>section.querySelector('h2')?.textContent.startsWith(prefix));
  function moveInside(sourcePrefix,targetPrefix){const source=findSection(sourcePrefix),target=findSection(targetPrefix);if(source&&target)target.appendChild(source);}
  moveInside('Add a team member','Team members');
  moveInside('Add an attendee','Registered attendees');
  moveInside('Share the attendee list','Registered attendees');
  main.querySelectorAll('section.card').forEach(section=>{const heading=section.querySelector('h2');if(!heading||!(/Registered attendees|Team members|Tally by role|Add a team member|Add an attendee|Share the attendee list/.test(heading.textContent)))return;const details=document.createElement('details'),summary=document.createElement('summary');summary.textContent=heading.textContent;summary.style.cssText='font-weight:800;cursor:pointer;padding:8px 0';heading.remove();details.appendChild(summary);while(section.firstChild)details.appendChild(section.firstChild);section.appendChild(details);});
  main.insertAdjacentHTML('beforeend','<div id="hq-sections">'+
    card('Event details and team arrival','<form id="details-form"><div class="hq-grid">'+
      field('Event name','ev-name',data.event.name)+field('Date','ev-date',data.event.event_date,'date')+
      field('Public event time','ev-time',data.event.time_range)+field('Address','ev-location',data.event.location)+
      field('Venue / community','ev-venue',data.event.hq_details.venue)+field('Team arrival / setup','ev-arrival',data.event.hq_details.team_arrival)+
      '</div><button class="btn small">Save event details</button></form>')+
    card('Tasks and accepted assignments','<div class="actions"><button class="btn small" id="add-task">Create task / role</button></div><div id="task-board"></div>')+
    card('Agenda / run of show','<p>Shared with the team. Internal notes stay in Admin. The public registration agenda is unchanged.</p><form id="agenda-form"><details style="margin:12px 0"><summary>Original agenda — add back a starting item</summary><p>Your edits stay in place. Choose an original item to add, then Save agenda.</p><div id="original-agenda-items" class="actions"></div></details><div id="agenda-rows"></div><div class="actions"><button type="button" class="btn small ghost" id="add-agenda">Add agenda item</button><button class="btn small" id="save-agenda">Save agenda</button><p id="agenda-save-status" role="status" aria-live="polite">✓ Saved agenda loaded.</p></div></form>')+
    card('Team updates and notes','<p>These updates appear on the team page. Saving does not send email.</p><form id="updates-form"><div id="updates-rows"></div><div class="actions"><button type="button" class="btn small ghost" id="add-update">Add update</button><button class="btn small">Save team updates</button></div></form>')+
    card('Recovered event register','<p><a href="https://karikounkel.shop/pos" target="_blank" rel="noreferrer">Open K Co Register</a> · <a href="https://karikounkel.shop/pos/admin" target="_blank" rel="noreferrer">Open register setup and reports</a></p><p>Ladybug event and products configured; 7.38% tax, cash and customer-phone QR checkout. Stripe test-card verification and PDF delivery/files are still pending.</p>')+
    '</div><dialog id="hq-dialog"><div id="dialog-content"></div><button class="btn small ghost" id="close-dialog">Cancel</button></dialog>');
  document.getElementById('close-dialog').onclick=()=>document.getElementById('hq-dialog').close();
  renderTasks();
  const agenda=data.event.hq_details.run_of_show || data.event.agenda || [];
  agenda.slice().sort((a,b)=>(a.start||time24(a.time)||'').localeCompare(b.start||time24(b.time)||'')).forEach(addAgendaRow);
  const planForm=document.getElementById('agenda-form'),oldAgendaSection=planForm.closest('section'),taskSection=document.getElementById('task-board').closest('section');
  taskSection.querySelector('h2').textContent='Event plan and helpers';
  const planHeading=document.createElement('h3');planHeading.textContent='Timed agenda';
  taskSection.insertBefore(planHeading,document.getElementById('task-board'));
  taskSection.insertBefore(planForm,document.getElementById('task-board'));
  const taskHeading=document.createElement('h3');taskHeading.textContent='Ongoing tasks';taskSection.insertBefore(taskHeading,document.getElementById('task-board'));
  oldAgendaSection.remove();
  document.getElementById('original-agenda-items').innerHTML=(data.event.agenda||[]).map((item,i)=>'<button type="button" class="btn small ghost" data-original-agenda="'+i+'">'+esc(item.time)+' · '+esc(item.activity)+'</button>').join('');
  document.querySelectorAll('[data-original-agenda]').forEach(button=>button.onclick=()=>{const item=data.event.agenda[Number(button.dataset.originalAgenda)];const already=[...document.querySelectorAll('.agenda-edit')].some(row=>row.querySelector('[name=title]').value===item.activity);if(already){document.getElementById('agenda-save-status').textContent='That original item is already in your agenda.';return;}addAgendaRow(item);document.getElementById('agenda-save-status').textContent='Original item added. Unsaved changes — tap Save agenda.';});
  (data.event.team_updates || []).forEach(addUpdateRow);
  document.getElementById('add-task').onclick=()=>editTask();
  document.getElementById('add-agenda').onclick=()=>addAgendaRow({});
  document.getElementById('add-update').onclick=()=>addUpdateRow({});
  document.getElementById('details-form').onsubmit=async e=>{e.preventDefault();await saveHQ({action:'save_event_details',name:value('ev-name'),event_date:value('ev-date'),time_range:value('ev-time'),location:value('ev-location'),hq_details:{venue:value('ev-venue'),team_arrival:value('ev-arrival')}});};
  const agendaForm=document.getElementById('agenda-form');
  function agendaDirty(){const status=document.getElementById('agenda-save-status');if(status){status.textContent='Unsaved changes — tap Save agenda.';status.style.color='#9a5700';document.getElementById('agenda-savebar').hidden=false;}}
  agendaForm.addEventListener('input',agendaDirty);agendaForm.addEventListener('change',agendaDirty);
  agendaForm.addEventListener('click',e=>{if(e.target.closest('#add-agenda,[data-up],[data-down],[data-remove]'))agendaDirty();});
  agendaForm.querySelector('.actions').style.cssText='position:sticky;bottom:0;background:#fff8ed;padding:14px;border:1px solid #e4d4bf;border-radius:12px;z-index:5;box-shadow:0 -4px 16px #00000012';
  document.getElementById('agenda-form').onsubmit=async e=> {
    e.preventDefault();
    const agenda=[...document.querySelectorAll('.agenda-edit')].map(row=>({start:row.querySelector('[name=start]').value,end:row.querySelector('[name=end]').value,activity:row.querySelector('[name=title]').value,description:row.querySelector('[name=description]').value,responsible:[...row.querySelector('[name=responsible]').selectedOptions].map(o=>o.value),role_key:row.querySelector('[name=role]').value,internal_notes:row.querySelector('[name=internal]').value}));
    agenda.sort((a,b)=>a.start.localeCompare(b.start));
    const button=document.getElementById('save-agenda'),status=document.getElementById('agenda-save-status');
    button.disabled=true;button.textContent='Saving…';status.textContent='Saving your agenda…';
    const saved=await saveHQ({action:'save_agenda',agenda});
    if(saved){document.getElementById('agenda-rows').innerHTML='';agenda.forEach(addAgendaRow);}
    button.disabled=false;button.textContent='Save agenda';
    status.textContent=saved?'✓ Saved at '+new Date().toLocaleTimeString([], {hour:'numeric',minute:'2-digit'}) :'Not saved. Your edits are still here. Please try again.';
    status.style.color=saved?'#1f7a4d':'#b42318';
    updateAgendaMode();
  };
  setupAdminViews(data);
  document.getElementById('updates-form').onsubmit=async e=> {
    e.preventDefault();
    const updates=[...document.querySelectorAll('.update-edit')].map(row=>({id:row.dataset.id,title:row.querySelector('[name=title]').value,body:row.querySelector('[name=body]').value,updated_at:new Date().toISOString()}));
    await saveHQ({action:'save_updates',updates});
  };
}
function value(id){return document.getElementById(id).value;}
async function saveHQ(body){
  try{await api('POST',{event_slug:hqData.event.slug,...body});if(body.action==='save_agenda'){const confirmed=await api('GET');hqData=confirmed;const persisted=confirmed.event.hq_details?.run_of_show||[];if(persisted.length!==body.agenda.length||persisted.some((item,i)=>['start','end','activity','description','internal_notes','role_key'].some(key=>(item[key]||'')!==(body.agenda[i][key]||''))||JSON.stringify(item.responsible||[])!==JSON.stringify(body.agenda[i].responsible||[])))throw new Error('The saved agenda could not be verified. Your edits are still on screen.');return true;}await boot();return true;}catch(e){alert('Could not save: '+e.message);return false;}
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
  openForm('<h2>Edit '+esc(firstName(m.name))+'</h2><p>Accepted assignments are preserved.</p>'+field('Name','member-name',m.name)+field('Email','member-email',m.email,'email')+field('Phone','member-phone',m.phone)+area('Notes','member-notes',m.notes)+
    '<div class="field"><label for="member-rsvp">RSVP</label><select id="member-rsvp">'+[['','No RSVP'],['coming','Coming'],['unsure','Unsure'],['not_coming','Not coming']].map(([v,l])=>'<option value="'+v+'" '+((m.attendance_status||'')===v?'selected':'')+'>'+l+'</option>').join('')+'</select></div>',
    async e=>{e.preventDefault();await saveHQ({action:'edit_member',member_id:id,name:value('member-name'),email:value('member-email'),phone:value('member-phone'),notes:value('member-notes'),attendance_status:value('member-rsvp')});});
}
function editTask(key){
  const r=hqData.roles.find(r=>r.role_key===key)||{role_key:'task_'+Date.now(),min_needed:1,max_needed:null,sort_order:hqData.roles.length+1};
  openForm('<h2>'+ (key?'Edit task / role':'Create task / role')+'</h2>'+field('Title','task-title',r.name)+area('Instructions','task-description',r.description)+field('Time / shift','task-time',r.time_slot)+field('Minimum helpers','task-min',r.min_needed,'number')+field('Maximum helpers (optional)','task-max',r.max_needed,'number'),
    async e=>{e.preventDefault();await saveHQ({action:'save_role',role_key:r.role_key,name:value('task-title'),description:value('task-description'),time_slot:value('task-time'),min_needed:value('task-min'),max_needed:value('task-max'),sort_order:r.sort_order,icon:r.icon||'✓'});});
}
function taskStartMinutes(role){const text=role.time_slot||'';const match=text.match(/(\d{1,2})(?::(\d{2}))?\s*(AM|PM)?/i);if(!match)return 9999;const suffix=match[3]||text.match(/AM|PM/i)?.[0]||'AM';return (Number(match[1])%12+(suffix.toUpperCase()==='PM'?12:0))*60+Number(match[2]||0);}
function renderTasks(){
  const labels={accepted:'Accepted',in_progress:'In Progress',done:'Done'};
  document.getElementById('task-board').innerHTML=hqData.roles.slice().sort((a,b)=>taskStartMinutes(a)-taskStartMinutes(b)).map(role=>{
    const assigned=hqData.assignments.filter(a=>a.role_key===role.role_key);
    const slots=Math.max(0,role.min_needed-assigned.length);
    return '<div class="task-item"><strong>'+esc(role.name)+'</strong><p>'+esc(role.time_slot)+'</p><p>'+esc(role.description)+'</p><p><strong>Helping:</strong> '+(assigned.length?assigned.map(a=>esc(hqData.members.find(m=>m.id===a.member_id)?.name?.split(/\s+/)[0]||'Unknown')).join(', '):'No helpers yet')+'</p><div class="actions">'+assigned.map(a=>'<button class="btn small ghost" data-assignment="'+a.id+'">'+esc(hqData.members.find(m=>m.id===a.member_id)?.name?.split(/\s+/)[0]||'Unknown')+' · '+(labels[a.status||'accepted']||'Accepted')+'</button>').join('')+'</div>'+(slots?'<p>'+slots+' more helper'+(slots===1?'':'s')+' needed</p>':'')+'<div class="actions"><button class="btn small" data-claim="'+esc(role.role_key)+'">Add helper</button><button class="btn small ghost" data-edit-role="'+esc(role.role_key)+'">Edit task</button></div></div>';
  }).join('');
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
  openForm('<h2>'+esc(firstName(m.name))+' · '+esc(hqData.roles.find(r=>r.role_key===s.role_key).name)+'</h2><div class="field"><label for="assignment-status">Status</label><select id="assignment-status">'+[['accepted','Accepted'],['in_progress','In Progress'],['done','Done']].map(([v,l])=>'<option value="'+v+'" '+(s.status===v?'selected':'')+'>'+l+'</option>').join('')+'</select></div>'+area('Internal assignment notes','assignment-notes',s.internal_notes)+'<p>To reassign, add the new helper first, then explicitly remove this assignment.</p><button type="button" class="btn small ghost" id="add-other">Add another helper</button><button type="button" class="btn small ghost" id="remove-assignment">Remove this assignment</button>',
    async e=>{e.preventDefault();await saveHQ({action:'update_assignment',member_id:s.member_id,role_key:s.role_key,status:value('assignment-status'),internal_notes:value('assignment-notes')});});
  document.getElementById('add-other').onclick=()=>assignTask(s.role_key);
  document.getElementById('remove-assignment').onclick=async()=>{if(confirm('Remove only this assignment for '+m.name+'?'))await saveHQ({action:'remove_assignment',member_id:s.member_id,role_key:s.role_key});};
}
function time24(s){
  const m=String(s||'').match(/(\d{1,2}):(\d{2})\s*(AM|PM)/i);
  return m?String((Number(m[1])%12)+(m[3].toUpperCase()==='PM'?12:0)).padStart(2,'0')+':'+m[2]:'';
}
function addAgendaRow(item){
  const row=document.createElement('details');row.className='agenda-edit task-item';row.open=agendaMode==='edit';
  row.innerHTML='<label>Experience<input name="title" required value="'+esc(item.activity)+'" style="font-weight:800;font-size:1rem"></label><div class="hq-grid"><label>Start<input name="start" type="time" required value="'+esc(item.start||time24(item.time))+'"></label><label>End<input name="end" type="time" value="'+esc(item.end)+'"></label></div>'+
    '<label>Instructions<textarea name="description" rows="2">'+esc(item.description)+'</textarea></label><details><summary style="cursor:pointer;font-weight:800">Helping: <span data-helper-summary>'+esc((item.responsible||[]).map(id=>hqData.members.find(m=>m.id===id)?.name?.split(/\s+/)[0]||'').filter(Boolean).join(', ')||'choose helpers')+'</span></summary><div class="actions" style="margin:8px 0">'+hqData.members.filter(m=>m.attendance_status==='coming').map(m=>'<label style="display:flex;align-items:center;gap:6px;text-transform:none;letter-spacing:0"><input type="checkbox" data-helper="'+m.id+'" '+((item.responsible||[]).includes(m.id)?'checked':'')+' style="width:auto">'+esc(firstName(m.name))+'</label>').join('')+'</div></details>'+
    '<select name="responsible" multiple hidden>'+hqData.members.map(m=>'<option value="'+m.id+'" '+((item.responsible||[]).includes(m.id)?'selected':'')+'>'+esc(firstName(m.name))+'</option>').join('')+'</select>'+
    '<details><summary>Internal notes / related task</summary><label>Related task<select name="role">'+roleOptions(item.role_key)+'</select></label><label>Internal notes<textarea name="internal">'+esc(item.internal_notes)+'</textarea></label></details><div class="actions"><button type="button" class="btn small ghost" data-up>Move up</button><button type="button" class="btn small ghost" data-down>Move down</button><button type="button" class="btn small ghost" data-remove>Remove item</button></div>';
  const planSummary=document.createElement('summary');planSummary.className='plan-row';row.prepend(planSummary);
  row.addEventListener('toggle',()=>{if(row.open&&agendaMode==='plan')document.querySelectorAll('.agenda-edit').forEach(other=>{if(other!==row)other.open=false;});});
  row.addEventListener('input',()=>refreshPlanRow(row));row.addEventListener('change',()=>refreshPlanRow(row));refreshPlanRow(row);
  row.querySelectorAll('[data-helper]').forEach(box=>box.onchange=()=>{row.querySelector('option[value="'+box.dataset.helper+'"]').selected=box.checked;row.querySelector('[data-helper-summary]').textContent=[...row.querySelectorAll('[data-helper]:checked')].map(input=>hqData.members.find(m=>m.id===input.dataset.helper)?.name?.split(/\s+/)[0]||'').filter(Boolean).join(', ')||'choose helpers';});
  row.querySelector('[data-up]').onclick=()=>{if(row.previousElementSibling)row.parentNode.insertBefore(row,row.previousElementSibling);};
  row.querySelector('[data-down]').onclick=()=>{if(row.nextElementSibling)row.parentNode.insertBefore(row.nextElementSibling,row);};
  row.querySelector('[data-remove]').onclick=()=>row.remove();
  document.getElementById('agenda-rows').appendChild(row);
  if(document.getElementById('agenda-savebar'))updateAgendaMode();
}
function addUpdateRow(item){
  const row=document.createElement('div');row.className='update-edit hq-row';row.dataset.id=item.id||crypto.randomUUID();
  row.innerHTML='<label>Title<input name="title" value="'+esc(item.title)+'"></label><label>Update / instructions<textarea name="body">'+esc(item.body)+'</textarea></label><button type="button" class="btn small ghost">Remove update</button>';
  row.querySelector('button').onclick=()=>row.remove();document.getElementById('updates-rows').appendChild(row);
}

function refreshPlanRow(row){
  const title=row.querySelector('[name=title]').value||'New experience';
  const start=row.querySelector('[name=start]').value,end=row.querySelector('[name=end]').value;
  const fmt=t=>{if(!t)return 'Time needed';const [h,m]=t.split(':').map(Number);return (h%12||12)+':'+String(m).padStart(2,'0')+' '+(h>=12?'PM':'AM');};
  const names=[...row.querySelector('[name=responsible]').selectedOptions].map(o=>firstName(o.textContent)).join(', ')||'—';
  row.querySelector('.plan-row').innerHTML='<span>'+esc(fmt(start)+(end?'–'+fmt(end):''))+'</span><strong>'+esc(title)+'</strong><span>'+esc(names)+'</span>';
}
function updateAgendaMode(){
  const root=document.getElementById('agenda-panel');if(!root)return;
  root.dataset.mode=agendaMode;
  document.getElementById('agenda-form').hidden=agendaMode==='team';
  document.getElementById('team-preview').hidden=agendaMode!=='team';
  document.getElementById('add-agenda').hidden=agendaMode!=='edit';
  const dirty=/Unsaved|Not saved|Saving/.test(document.getElementById('agenda-save-status').textContent);
  document.getElementById('agenda-savebar').hidden=!dirty&&agendaMode!=='edit';
  document.querySelectorAll('[data-agenda-mode]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.agendaMode===agendaMode)));
  document.querySelectorAll('.agenda-edit').forEach(row=>{if(agendaMode==='edit')row.open=true;else if(agendaMode==='plan')row.open=false;refreshPlanRow(row);});
}
function setupAdminViews(data){
  const main=document.querySelector('main.wrap');main.querySelector('.sub').textContent='Plan the day. Open one section at a time.';
  const css=document.createElement('style');css.textContent=
    '[hidden]{display:none!important}.admin-tabs,.agenda-modes{display:flex;gap:8px;flex-wrap:wrap;margin:14px 0}.admin-tabs{position:sticky;top:0;background:#fff8ef;padding:12px 0;z-index:20;border-bottom:1px solid #ead5c8}.admin-tabs button[aria-selected=true],.agenda-modes button[aria-pressed=true]{background:#ac1630;color:white}.plan-row{display:grid;grid-template-columns:155px 1fr 150px;gap:16px;padding:14px;cursor:pointer;align-items:center}.plan-row span{font-size:.86rem}.agenda-edit{padding:0!important;margin:0 0 8px!important}.agenda-edit>label,.agenda-edit>div,.agenda-edit>details{margin:14px}.agenda-edit:not([open])>*:not(summary){display:none!important}.agenda-edit[open]{border:2px solid #bf2340}.timeline-header{display:grid;grid-template-columns:155px 1fr 150px;gap:16px;padding:10px 14px;font-size:.75rem;font-weight:800;color:#78645b}.agenda-edit[data-placeholder] summary{color:#82695e}#agenda-savebar{position:sticky;bottom:0;z-index:15;background:#fff8ed;padding:16px;border:2px solid #bf2340;border-radius:12px;box-shadow:0 -5px 18px #0002}#save-agenda{font-size:1rem;padding:14px 25px}#agenda-save-status{font-size:1rem;font-weight:800;padding:10px 0}.overview-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:12px}.overview-stat{background:#fff;border:1px solid #ead5c8;border-radius:12px;padding:16px}.overview-stat strong{display:block;font-size:1.6rem}.team-preview-frame{width:100%;height:75vh;border:1px solid #ead5c8;border-radius:12px}@media(max-width:650px){.plan-row,.timeline-header{grid-template-columns:105px 1fr;gap:10px}.plan-row>span:last-child{grid-column:2}.timeline-header>span:last-child{display:none}.overview-grid{grid-template-columns:1fr 1fr}.admin-tabs{position:static}.btn.small{min-height:40px}}';document.head.appendChild(css);
  const panelNames=['Overview','Agenda','People','Tasks','Communications','Register'];
  const nav=document.createElement('nav');nav.className='admin-tabs';nav.setAttribute('aria-label','Admin sections');
  const panels={};panelNames.forEach(name=>{const panel=document.createElement('div');panel.id=name.toLowerCase()+'-panel';panel.dataset.adminPanel=name.toLowerCase();panel.hidden=true;panels[name]=panel;main.appendChild(panel);const button=document.createElement('button');button.className='btn small ghost';button.type='button';button.textContent=name;button.dataset.adminTab=name.toLowerCase();button.setAttribute('aria-selected','false');button.onclick=()=>showAdminPanel(name.toLowerCase());nav.appendChild(button);});main.querySelector('h1').after(nav);
  const rootCards=[...main.querySelectorAll('section.card')].filter(card=>!card.parentElement.closest('section.card'));
  const title=card=>card.querySelector('h2')?.textContent||card.querySelector('summary')?.textContent||'';
  const peopleSummary=rootCards.find(card=>title(card)==='People, places and email delivery');
  const comm=document.createElement('section');comm.className='card';comm.innerHTML='<h2>Email lists</h2><p>Copy delivery addresses for Guests, Team or Everyone.</p>';
  peopleSummary.querySelectorAll('[data-copy]').forEach(button=>comm.appendChild(button));comm.appendChild(document.getElementById('copy-result'));comm.appendChild(document.getElementById('email-fallback'));panels.Communications.appendChild(comm);
  const form=document.getElementById('agenda-form'),taskSection=document.getElementById('task-board').closest('section');
  taskSection.querySelector('h2').textContent='Tasks and helpers';taskSection.querySelectorAll('h3').forEach(h=>{if(['Timed agenda','Ongoing tasks'].includes(h.textContent))h.remove();});
  const original=document.getElementById('original-agenda-items');if(original)original.closest('details').remove();
  panels.Agenda.innerHTML='<h2>Agenda</h2><div class="agenda-modes"><button type="button" class="btn small" data-agenda-mode="plan">Plan view</button><button type="button" class="btn small ghost" data-agenda-mode="edit">Edit view</button><button type="button" class="btn small ghost" data-agenda-mode="team">Team view / preview</button></div>';
  panels.Agenda.appendChild(form);
  const status=document.getElementById('agenda-save-status'),savebar=document.getElementById('save-agenda').parentElement;savebar.id='agenda-savebar';savebar.removeAttribute('style');form.prepend(status);
  const header=document.createElement('div');header.className='timeline-header';header.innerHTML='<span>TIME</span><span>EXPERIENCE</span><span>RESPONSIBLE</span>';document.getElementById('agenda-rows').before(header);
  const teamMember=data.members.find(m=>m.is_admin&&m.token);const teamURL=teamMember?'/team?t='+encodeURIComponent(teamMember.token):'/team';
  const teamPreview=document.createElement('div');teamPreview.id='team-preview';teamPreview.hidden=true;teamPreview.innerHTML='<p><a class="btn small" target="_blank" rel="noreferrer" href="'+esc(teamURL)+'">Open Team Page ↗</a></p><p>This is the actual shared Team page. It shows the saved agenda; unsaved edits do not appear here.</p><iframe class="team-preview-frame" title="Shared Team page preview"></iframe>';panels.Agenda.appendChild(teamPreview);teamPreview.querySelector('iframe').dataset.src=teamURL+(teamURL.includes('?')?'&':'?')+'preview=1';
  panels.Agenda.querySelectorAll('[data-agenda-mode]').forEach(button=>button.onclick=()=>{agendaMode=button.dataset.agendaMode;if(agendaMode==='team'){const frame=teamPreview.querySelector('iframe');frame.src=frame.dataset.src;}updateAgendaMode();});
  rootCards.forEach(card=>{const heading=title(card);if(heading==='People, places and email delivery'||/Registered attendees|Team members/.test(heading))panels.People.appendChild(card);else if(heading==='Tally by role')card.remove();else if(heading==='Tasks and helpers')panels.Tasks.appendChild(card);else if(heading==='Team updates and notes')panels.Communications.appendChild(card);else if(heading==='Recovered event register')panels.Register.appendChild(card);else if(heading==='Event details and team arrival'){const details=document.createElement('details');details.innerHTML='<summary>Edit event details and arrival</summary>';details.appendChild(card);panels.Overview.appendChild(details);}else if(heading==='Event')panels.Overview.appendChild(card);});
  const confirmed=data.members.filter(m=>m.attendance_status==='coming').length,needs=data.audience.unconfirmed_team.length;
  const openNeeds=data.roles.reduce((n,r)=>n+Math.max(0,r.min_needed-data.assignments.filter(a=>a.role_key===r.role_key).length),0);
  const dash=document.createElement('section');dash.className='card';dash.innerHTML='<h2>Event dashboard</h2><div class="overview-grid"><div class="overview-stat"><strong>'+confirmed+'</strong>Team confirmed</div><div class="overview-stat"><strong>'+needs+'</strong>Need RSVP confirmation</div><div class="overview-stat"><strong>'+openNeeds+'</strong>Open helper needs</div></div><h3 style="margin-top:16px">Next operational issues</h3><p>Bug-Off Boxes: decorating begins during arrival at 9:00. The current schedule needs your review; no agenda times have been changed.</p><p>Register: real Stripe test-card verification and PDF delivery/files remain pending.</p>';panels.Overview.prepend(dash);
  panelNames.forEach(name=>main.appendChild(panels[name]));
  const requestedParams=new URLSearchParams(location.hash.slice(1));const previewRequested=requestedParams.get('mode')==='team';const requested=requestedParams.get('view')||'agenda';showAdminPanel(requested);updateAgendaMode();
  if(previewRequested)panels.Agenda.querySelector('[data-agenda-mode=team]').click();
}
function showAdminPanel(name){if(!document.querySelector('[data-admin-panel="'+name+'"]'))name='agenda';document.querySelectorAll('[data-admin-panel]').forEach(panel=>panel.hidden=panel.dataset.adminPanel!==name);document.querySelectorAll('[data-admin-tab]').forEach(button=>button.setAttribute('aria-selected',String(button.dataset.adminTab===name)));history.replaceState({},'',location.pathname+location.search+'#view='+name);}
