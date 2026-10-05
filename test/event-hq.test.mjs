import fs from 'node:fs';
import vm from 'node:vm';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {JSDOM} from 'jsdom';
import * as hq from '../lib/event-hq.js';
const fixture=JSON.parse(fs.readFileSync('test/fixture.json','utf8'));
const adminCredential='a'.repeat(48);
function seed(){
 const event={...fixture.event,hq_details:{venue:'Silver Creek'},team_updates:[]};
 const members=fixture.members.map(m=>({...m,admin_access_hash:m.is_admin?crypto.createHash('sha256').update(adminCredential).digest('hex'):null,name:m.name==='Laurie Geosse'?'Laurie Geisse':m.name}));
 const signups=members.flatMap(m=>m.signups.map((role_key,i)=>({id:m.id+'_'+i,member_id:m.id,role_key,status:'accepted',internal_notes:'',created_at:'2026-08-18'})));
 return {ladybug_team_events:[event],ladybug_team_members:members,ladybug_team_roles:structuredClone(fixture.roles),ladybug_team_signups:signups,ladybug_attendees:structuredClone(fixture.attendees)};
}
let tables=seed(),failure=null;
class Query{
 constructor(table){this.table=table;this.filters=[];this.fields='*';this.mode='select';}
 select(fields='*'){this.fields=fields;return this;}
 eq(key,v){this.filters.push(r=>r[key]===v);return this;}
 in(key,values){this.filters.push(r=>values.includes(r[key]));return this;}
 order(){return this;} limit(){return this;}
 single(){this.one=true;return this;} maybeSingle(){this.one=true;return this;}
 update(p){this.mode='update';this.patch=p;return this;}
 delete(){this.mode='delete';return this;}
 insert(p){this.mode='insert';this.patch=p;return this;}
 upsert(p,options){this.mode='upsert';this.patch=p;this.options=options;return this;}
 then(resolve,reject){try{return Promise.resolve(this.run()).then(resolve,reject);}catch(e){return Promise.reject(e).then(resolve,reject);}}
 run(){
  if(failure&&this.table==='ladybug_team_signups'&&this.mode!=='select')return {data:null,error:new Error(failure)};
  let rows=tables[this.table].filter(r=>this.filters.every(f=>f(r)));
  if(this.mode==='update')rows.forEach(r=>Object.assign(r,this.patch));
  if(this.mode==='delete')tables[this.table]=tables[this.table].filter(r=>!rows.includes(r));
  if(['insert','upsert'].includes(this.mode)){
   rows=[];
   for(const patch of Array.isArray(this.patch)?this.patch:[this.patch]){
    const keys=(this.options?.onConflict||'id').split(',');
    let row=this.mode==='upsert'&&tables[this.table].find(r=>keys.every(k=>r[k]===patch[k]));
    if(row){if(!this.options?.ignoreDuplicates)Object.assign(row,patch);}
    else{row={id:crypto.randomUUID(),status:'accepted',internal_notes:'',...patch};tables[this.table].push(row);}
    rows.push(row);
   }
  }
  rows=rows.map(r=>this.fields==='*'?structuredClone(r):Object.fromEntries(this.fields.split(',').map(k=>k.trim()).map(k=>[k,r[k]])));
  return {data:this.one?(rows[0]||null):rows,error:null};
 }
}
const db={from:t=>new Query(t),storage:{from:()=>({createSignedUrl:async()=>({data:{signedUrl:'https://example.test/packet'}})})}};
const context=vm.createContext({console,process:{env:{SUPABASE_SERVICE_ROLE_KEY:'test-only'}},Buffer,Date,Set,Map,crypto});
async function moduleFor(file,source){
 const mod=new vm.SourceTextModule(source||fs.readFileSync(file,'utf8'),{context,identifier:file});
 await mod.link(async name=>{
  let exports;
  if(name==='@supabase/supabase-js')exports={createClient:()=>db};
  else if(name==='node:crypto')exports={default:crypto};
  else if(name.endsWith('event-hq.js'))exports=hq;
  else throw new Error(name);
  return new vm.SyntheticModule(Object.keys(exports),function(){for(const [k,v] of Object.entries(exports))this.setExport(k,v);},{context});
 });
 await mod.evaluate();return mod.namespace.default;
}
const team=await moduleFor('api/team.js'),admin=await moduleFor('api/team-admin.js');
async function call(handler,method='GET',body,token,query={}){
 const req={method,body,headers:token?{'x-team-token':token}:{},query};
 let status=200,data;
 const res={setHeader(){},status(s){status=s;return this;},json(d){data=JSON.parse(JSON.stringify(d));return this;}};
 await handler(req,res);return {status,data};
}
const before=JSON.stringify(tables.ladybug_team_signups), attendance=tables.ladybug_team_members.map(m=>m.attendance_status);
let result=await call(team);
assert.equal(result.status,200);
assert(!result.data.members.some(m=>m.token===fixture.members.find(m=>m.is_admin).token));
assert.equal((await call(admin,'GET',null,fixture.members.find(m=>m.is_admin).token)).status,401,'team token must not authorize admin');
result=await call(admin,'GET',null,adminCredential);
assert.equal(result.status,200);assert.equal(result.data.audience.total_places,41);assert.equal(result.data.audience.unique_addresses,37);
assert.equal(result.data.audience.attendance_flags.length,1);assert.equal(result.data.assignments.length,21);
assert(!JSON.stringify(result.data.members).includes('admin_access_hash'));
const member=tables.ladybug_team_members.find(m=>m.name==='Laurie Geisse');
result=await call(team,'POST',{attendance_status:member.attendance_status},null,{t:member.token});
assert.equal(result.status,200);assert(result.data.event&&result.data.roles);assert.equal(result.data.member.name,'Laurie Geisse');
assert.equal(JSON.stringify(tables.ladybug_team_signups),before);assert.deepEqual(tables.ladybug_team_members.map(m=>m.attendance_status),attendance);
failure='forced signup failure';
assert.equal((await call(team,'POST',{add_role:'art'},null,{t:member.token})).status,500);
failure=null;
// Browser regression: use an isolated fixture, never mutate production.
async function memberDOM(source,patched){
 const local=seed();tables=local;
 const selected=local.ladybug_team_members.find(m=>m.is_admin);
 const dom=new JSDOM(source,{url:'http://localhost/team?t='+selected.token,runScripts:'outside-only'});
 dom.window.fetch=async(url,opts={})=>{
  const params=new URL(url,'http://localhost').searchParams;
  let out=await call(team,opts.method||'GET',opts.body?JSON.parse(opts.body):undefined,null,{t:params.get('t')});
  if(!patched&&opts.method==='POST'){delete out.data.event;delete out.data.roles;}
  return {ok:out.status===200,status:out.status,json:async()=>out.data};
 };
 for(const script of dom.window.document.querySelectorAll('script:not([src])'))dom.window.eval(script.textContent);
 await new Promise(r=>setTimeout(r,30));
 const radio=dom.window.document.querySelector('input[name=attend][value=coming]');
 radio.dispatchEvent(new dom.window.Event('change',{bubbles:true}));
 await new Promise(r=>setTimeout(r,30));
 return dom;
}
let dom=await memberDOM(execFileSync('git',['show','origin/main:team.html'],{encoding:'utf8'}),false);
assert.match(dom.window.document.getElementById('save-pill').textContent,/Save failed/);dom.window.close();
dom=await memberDOM(fs.readFileSync('team.html','utf8'),true);
assert.match(dom.window.document.getElementById('save-pill').textContent,/RSVP saved/);dom.window.close();
tables=seed();
const agenda=[{start:'08:00',end:'08:30',activity:'Setup',description:'Team instructions',responsible:[member.id],role_key:'book',internal_notes:'Private test note'}];
result=await call(admin,'POST',{action:'save_agenda',event_slug:fixture.event.slug,agenda},adminCredential);assert.equal(result.status,200);
const shared=(await call(team,'GET',null,null,{t:member.token})).data;
assert.equal(shared.event.agenda[0].activity,'Setup');
assert(!JSON.stringify(shared).includes('Private test note'));assert(!JSON.stringify(shared).includes('hosts_token'));
assert.deepEqual(tables.ladybug_team_events[0].agenda,fixture.event.agenda,'public registration agenda preserved');
await call(admin,'POST',{action:'edit_member',event_slug:fixture.event.slug,member_id:member.id,name:'Laurie Geisse',notes:'Corrected note'},adminCredential);
assert.equal(JSON.stringify(tables.ladybug_team_signups),before,'member edit preserves assignments');
assert.equal((await call(admin,'POST',{action:'edit_member',event_slug:fixture.event.slug,member_id:'other-event',name:'Wrong'},adminCredential)).status,500);
await call(admin,'POST',{action:'save_updates',event_slug:fixture.event.slug,updates:[{title:'Arrival',body:'Bring supplies'}]},adminCredential);
assert.equal((await call(team,'GET',null,null,{t:member.token})).data.event.team_updates[0].title,'Arrival');
await call(admin,'POST',{action:'save_role',event_slug:fixture.event.slug,role_key:'test_setup',name:'Setup',min_needed:1,max_needed:2},adminCredential);
await call(admin,'POST',{action:'assign_role',event_slug:fixture.event.slug,role_key:'test_setup',member_id:member.id},adminCredential);
await call(admin,'POST',{action:'update_assignment',event_slug:fixture.event.slug,role_key:'test_setup',member_id:member.id,status:'done',internal_notes:'Finished'},adminCredential);
assert.equal(tables.ladybug_team_signups.find(s=>s.role_key==='test_setup').status,'done');
tables=seed();
const adminDom=new JSDOM(fs.readFileSync('team-admin.html','utf8'),{url:'http://localhost/team-admin?t='+adminCredential,runScripts:'outside-only'});
let clipboard='';
Object.defineProperty(adminDom.window.navigator,'clipboard',{value:{writeText:async text=>{clipboard=text;}}});
adminDom.window.alert=message=>{throw new Error(message);};
adminDom.window.fetch=async(url,opts={})=>{
 const out=await call(admin,opts.method||'GET',opts.body?JSON.parse(opts.body):undefined,opts.headers?.['x-team-token']);
 return {ok:out.status===200,status:out.status,json:async()=>out.data};
};
for(const script of adminDom.window.document.querySelectorAll('script:not([src])'))adminDom.window.eval(script.textContent);
adminDom.window.eval(fs.readFileSync('event-hq.js','utf8'));
await new Promise(r=>setTimeout(r,40));
assert.match(adminDom.window.document.body.textContent,/41 stored places/);
assert.match(adminDom.window.document.body.textContent,/Laurie Geisse/);
assert.match(adminDom.window.document.body.textContent,/Attendance needs confirmation/);
adminDom.window.document.querySelector('[data-copy=everyone]').click();
await new Promise(r=>setTimeout(r,30));assert.equal(clipboard.split('; ').length,37);
adminDom.window.document.querySelector('#add-agenda').click();assert.equal(adminDom.window.document.querySelectorAll('.agenda-edit').length,fixture.event.agenda.length+1);
adminDom.window.close();
assert.equal(JSON.stringify(tables.ladybug_team_signups),before);
console.log('PASS: admin credential separation, no admin token in picker, counts/email/reciprocal flag, RSVP regression, role errors, member edits preserve assignments, task lifecycle, agenda privacy/public preservation, team updates, Admin DOM/copy controls.');
