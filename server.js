const express = require('express');
const cors    = require('cors');
const fs      = require('fs');
const path    = require('path');
const TG      = require('node-telegram-bot-api');
const bcrypt  = require('bcryptjs');
const jwt     = require('jsonwebtoken');
const axios   = require('axios');
const { v4: uuid } = require('uuid');

const app = express();
app.use(cors());
app.use(express.json());

const CFG = {
  BOT_TOKEN:  process.env.BOT_TOKEN  || '8999171661:AAFrUqONiHCGvszaU6cx8efTf9sxGTYsvXw',
  ADMIN_ID:   process.env.ADMIN_ID   || '7943361979',
  JWT_SECRET: process.env.JWT_SECRET || 'bekmedia2024secret',
  PAYME_ID:   process.env.PAYME_ID   || '64abec0fe4e564c98284a599',
  PAYME_KEY:  process.env.PAYME_KEY  || 'wEA&fZWxW#N5BHB4DNGP#WzQ8C@28ZW5zZEc',
  PORT:       process.env.PORT       || 3000,
  DB:         path.join(__dirname, 'data.json'),
};

// ── DB ──────────────────────────────────────
function rdb() {
  try { return JSON.parse(fs.readFileSync(CFG.DB,'utf8')); } catch(e) {}
  return { users:[], integrations:[], leads:[], transactions:[], uid:1, iid:1, lid:1, tid:1 };
}
function wdb(d) { fs.writeFileSync(CFG.DB, JSON.stringify(d,null,2)); }

const DB = {
  addUser(o) {
    const d=rdb();
    const u={id:d.uid++,...o, token:uuid().replace(/-/g,'').slice(0,20),
      plan:'free', plan_leads:1000, plan_used:0, plan_expires:null, balance:0,
      tg_id:null, tg_connected:false, status:'active', role:'user',
      leads_today:0, leads_week:0, leads_month:0, leads_total:0,
      created_at:new Date().toISOString()};
    d.users.push(u); wdb(d); return u;
  },
  getUser(f,v)    { return rdb().users.find(u=>u[f]===v)||null; },
  updateUser(id,o){ const d=rdb(),i=d.users.findIndex(u=>u.id===id); if(i>=0){d.users[i]={...d.users[i],...o};wdb(d);return d.users[i];}return null; },
  allUsers()      { return rdb().users; },
  safe(u)         { if(!u)return null; const {password:_,...s}=u; return s; },

  addInteg(o) {
    const d=rdb();
    const it={id:d.iid++,...o, webhook_token:uuid().replace(/-/g,'').slice(0,24),
      status:'active', leads_today:0, leads_total:0, last_lead:null,
      created_at:new Date().toISOString()};
    d.integrations.push(it); wdb(d); return it;
  },
  getInteg(f,v)     { return rdb().integrations.find(i=>i[f]===v)||null; },
  updateInteg(id,o) { const d=rdb(),i=d.integrations.findIndex(x=>x.id===id); if(i>=0){d.integrations[i]={...d.integrations[i],...o};wdb(d);} },
  userIntegs(uid)   { return rdb().integrations.filter(i=>i.user_id===uid); },
  allIntegs()       { return rdb().integrations; },
  deleteInteg(id)   { const d=rdb(); d.integrations=d.integrations.filter(i=>i.id!==id); wdb(d); },

  addLead(o) {
    const d=rdb();
    const l={id:d.lid++,...o, delivered:0, error:null, created_at:new Date().toISOString()};
    d.leads.push(l);
    const ui=d.users.findIndex(u=>u.id===o.user_id);
    if(ui>=0){d.users[ui].leads_today++;d.users[ui].leads_week++;d.users[ui].leads_month++;d.users[ui].leads_total++;d.users[ui].plan_used++;}
    const ii=d.integrations.findIndex(i=>i.id===o.integ_id);
    if(ii>=0){d.integrations[ii].leads_today++;d.integrations[ii].leads_total++;d.integrations[ii].last_lead=new Date().toISOString();}
    wdb(d); return l;
  },
  updateLead(id,o)  { const d=rdb(),i=d.leads.findIndex(l=>l.id===id); if(i>=0){d.leads[i]={...d.leads[i],...o};wdb(d);} },
  userLeads(uid)    { return rdb().leads.filter(l=>l.user_id===uid).reverse().slice(0,50); },
  integLeads(iid)   { return rdb().leads.filter(l=>l.integ_id===iid).reverse().slice(0,500); },
  allLeads()        { const d=rdb(); return d.leads.map(l=>{const u=d.users.find(u=>u.id===l.user_id);return{...l,user_name:u?.name};}).reverse().slice(0,200); },
  stats(uid)        { const u=rdb().users.find(u=>u.id===uid); return{today:u?.leads_today||0,week:u?.leads_week||0,month:u?.leads_month||0,total:u?.leads_total||0}; },
  adminStats()      { const d=rdb(),today=new Date().toISOString().slice(0,10); return{users:d.users.length,integrations:d.integrations.length,leads:d.leads.length,today:d.leads.filter(l=>l.created_at.startsWith(today)).length,delivered:d.leads.filter(l=>l.delivered).length,revenue:d.transactions.filter(t=>t.status==='paid').reduce((s,t)=>s+t.amount,0)}; },

  addTxn(o)        { const d=rdb(),t={id:d.tid++,...o,created_at:new Date().toISOString()};d.transactions.push(t);wdb(d);return t; },
  getTxn(f,v)      { return rdb().transactions.find(t=>t[f]===v)||null; },
  updateTxn(id,o)  { const d=rdb(),i=d.transactions.findIndex(t=>t.id===id);if(i>=0){d.transactions[i]={...d.transactions[i],...o};wdb(d);} },
};

// ── BOT ─────────────────────────────────────
const bot = new TG(CFG.BOT_TOKEN, { polling:true });

bot.onText(/\/start(.*)/, (msg, match) => {
  const chatId=String(msg.chat.id), param=(match[1]||'').trim();
  if(param) {
    const u=DB.getUser('token',param);
    if(u){
      DB.updateUser(u.id,{tg_id:chatId,tg_connected:true});
      bot.sendMessage(chatId,'*BekMedia — Ulandi!*\n\nSalom, *'+u.name+'*! Lidlar shu yerga keladi!',{parse_mode:'Markdown'});
      bot.sendMessage(CFG.ADMIN_ID,'*'+u.name+'* botni uladi.',{parse_mode:'Markdown'}).catch(()=>{});
      return;
    }
  }
  bot.sendMessage(chatId,'*BekMedia Leads Platform*\n\nIltimos bolimni tanlang!',
    {parse_mode:'Markdown',reply_markup:{keyboard:[[{text:'Statistika'},{text:'Tariflar'}],[{text:'Sessiyalar'}]],resize_keyboard:true}});
});

bot.on('message', async (msg) => {
  const chatId=String(msg.chat.id),text=msg.text||'';
  const u=DB.getUser('tg_id',chatId);
  if(!u) return;
  if(text==='Statistika') {
    const s=DB.stats(u.id);
    bot.sendMessage(chatId,'Statistika:\n\nBugun: '+s.today+'\nHafta: '+s.week+'\nOy: '+s.month+'\nJami: '+s.total,{parse_mode:'Markdown'});
  } else if(text==='Tariflar') {
    bot.sendMessage(chatId,'Tariflar:\nBepul: 1,000 lid\nProfessional: 49,000 som - 5,000 lid\nBiznes: 69,000 som - 10,000 lid\nKorporativ: 89,000 som - Cheksiz');
  }
});

// ── DELIVER ─────────────────────────────────
async function deliverLead(lead, integ, user) {
  const now=new Date().toLocaleString('ru-RU',{timeZone:'Asia/Tashkent'});
  const msg='🧾 *Nomi:* '+integ.name+'\n📝 *Ma\'lumotlar:*\n'+
    (lead.region?'   1. Hudud: '+lead.region+'\n':'')+
    (lead.full_name?'   2. Ism: '+lead.full_name+'\n':'')+
    (lead.phone?'   3. Telefon: '+lead.phone+'\n':'')+
    (lead.comment?'   4. Izoh: '+lead.comment+'\n':'')+
    (lead.phone2?'   5. Tel 2: '+lead.phone2+'\n':'')+
    '📘 *Manba:* '+(integ.source==='instagram'?'Instagram':'Facebook')+'\n🗓️ *Sana:* '+now;
  let ok=false,err=null;
  try {
    if(integ.dest_type==='telegram') {
      const dest=integ.dest_group_id||user.tg_id;
      if(dest){await bot.sendMessage(dest,msg,{parse_mode:'Markdown'});await bot.sendMessage(dest,'✅ *Telegram uchun tayyor*',{parse_mode:'Markdown'});ok=true;}
      else err='Telegram ulanmagan';
    } else if(integ.dest_type==='sheets'&&integ.dest_sheets_url) {
      await axios.post(integ.dest_sheets_url,{name:lead.full_name,phone:lead.phone,region:lead.region,comment:lead.comment,date:now},{timeout:8000});
      ok=true;
    }
  } catch(e){err=e.message;}
  DB.updateLead(lead.id,{delivered:ok?1:0,error:err});
  return ok;
}

// ── MIDDLEWARE ───────────────────────────────
const auth=(req,res,next)=>{
  const t=req.headers.authorization?.split(' ')[1];
  if(!t) return res.json({ok:false,error:'Token kerak'});
  try{req.uid=jwt.verify(t,CFG.JWT_SECRET).uid;next();}
  catch{res.json({ok:false,error:'Token yaroqsiz'});}
};
const adminAuth=(req,res,next)=>{
  const t=req.headers.authorization?.split(' ')[1];
  t==='admin_'+CFG.ADMIN_ID?next():res.json({ok:false,error:'Ruxsat yoq'});
};

// ── AUTH ─────────────────────────────────────
app.post('/api/auth/register', async (req,res)=>{
  const{name,phone,password}=req.body;
  if(!name||!phone||!password) return res.json({ok:false,error:'Barcha maydonlarni toldiring'});
  if(DB.getUser('phone',phone)) return res.json({ok:false,error:'Bu telefon allaqachon royxatdan otgan'});
  const hash=await bcrypt.hash(password,10);
  const u=DB.addUser({name,phone,email:'',password:hash});
  const token=jwt.sign({uid:u.id},CFG.JWT_SECRET,{expiresIn:'30d'});
  bot.sendMessage(CFG.ADMIN_ID,'Yangi royxatdan otish!\n'+name+'\n'+phone).catch(()=>{});
  res.json({ok:true,token,user:DB.safe(u)});
});

app.post('/api/auth/login', async (req,res)=>{
  const{phone,password}=req.body;
  const u=DB.getUser('phone',phone);
  if(!u) return res.json({ok:false,error:'Foydalanuvchi topilmadi'});
  if(!await bcrypt.compare(password,u.password)) return res.json({ok:false,error:'Notogri parol'});
  const token=jwt.sign({uid:u.id},CFG.JWT_SECRET,{expiresIn:'30d'});
  if(u.tg_id){
    const ip=req.headers['x-forwarded-for']||req.ip||'unknown';
    bot.sendMessage(u.tg_id,'Hisobingizga kirish amalga oshirildi!\n\nIP: '+ip+'\nVaqt: '+new Date().toLocaleString('ru-RU')).catch(()=>{});
  }
  res.json({ok:true,token,user:DB.safe(u)});
});

app.get('/api/me',auth,(req,res)=>{
  const u=DB.getUser('id',req.uid);
  if(!u) return res.json({ok:false});
  res.json({ok:true,user:DB.safe(u)});
});

app.post('/api/profile',auth,(req,res)=>{
  const u=DB.updateUser(req.uid,req.body);
  res.json({ok:true,user:DB.safe(u)});
});

app.post('/api/profile/password',auth,async(req,res)=>{
  const{current,newpass}=req.body;
  const u=DB.getUser('id',req.uid);
  if(!await bcrypt.compare(current,u.password)) return res.json({ok:false,error:'Joriy parol notogri'});
  DB.updateUser(req.uid,{password:await bcrypt.hash(newpass,10)});
  res.json({ok:true});
});

app.get('/api/bot-link',auth,(req,res)=>{
  const u=DB.getUser('id',req.uid);
  res.json({ok:true,link:'https://t.me/bekmediauzbot?start='+u.token,token:u.token});
});

app.post('/api/bot-disconnect',auth,(req,res)=>{
  DB.updateUser(req.uid,{tg_id:null,tg_connected:false});
  res.json({ok:true});
});

// ── INTEGRATIONS ─────────────────────────────
app.get('/api/integrations',auth,(req,res)=>res.json({ok:true,integrations:DB.userIntegs(req.uid)}));

app.post('/api/integrations',auth,(req,res)=>{
  const{name,source,dest_type,dest_group_id,dest_sheets_url}=req.body;
  if(!name) return res.json({ok:false,error:'Nom kerak'});
  const it=DB.addInteg({user_id:req.uid,name,source:source||'facebook',dest_type:dest_type||'telegram',dest_group_id:dest_group_id||null,dest_sheets_url:dest_sheets_url||null});
  res.json({ok:true,integration:it});
});

app.put('/api/integrations/:id',auth,(req,res)=>{
  const it=DB.getInteg('id',+req.params.id);
  if(!it||it.user_id!==req.uid) return res.json({ok:false,error:'Topilmadi'});
  DB.updateInteg(it.id,req.body); res.json({ok:true});
});

app.delete('/api/integrations/:id',auth,(req,res)=>{
  const it=DB.getInteg('id',+req.params.id);
  if(!it||it.user_id!==req.uid) return res.json({ok:false,error:'Topilmadi'});
  DB.deleteInteg(it.id); res.json({ok:true});
});

app.post('/api/integrations/:id/toggle',auth,(req,res)=>{
  const it=DB.getInteg('id',+req.params.id);
  if(!it||it.user_id!==req.uid) return res.json({ok:false,error:'Topilmadi'});
  DB.updateInteg(it.id,{status:it.status==='active'?'paused':'active'}); res.json({ok:true});
});

app.post('/api/integrations/:id/test',auth,async(req,res)=>{
  const it=DB.getInteg('id',+req.params.id);
  if(!it||it.user_id!==req.uid) return res.json({ok:false,error:'Topilmadi'});
  const u=DB.getUser('id',req.uid);
  const lead=DB.addLead({user_id:req.uid,integ_id:it.id,full_name:'Test Foydalanuvchi',phone:'+998901234567',region:'Toshkent',comment:'Bu test lead',phone2:'',source:it.source||'facebook'});
  const ok=await deliverLead(lead,it,u);
  res.json({ok,delivered:ok});
});

// ── WEBHOOK ──────────────────────────────────
app.get('/webhook/:token',(req,res)=>{
  const it=DB.getInteg('webhook_token',req.params.token);
  if(!it) return res.status(404).send('Not found');
  const{['hub.mode']:mode,['hub.challenge']:challenge,['hub.verify_token']:verify}=req.query;
  if(mode==='subscribe'&&verify===it.webhook_token) return res.send(challenge);
  res.status(403).send('Forbidden');
});

app.post('/webhook/:token',async(req,res)=>{
  const it=DB.getInteg('webhook_token',req.params.token);
  if(!it||it.status!=='active') return res.json({ok:false});
  const u=DB.getUser('id',it.user_id);
  if(!u||u.plan_used>=u.plan_leads) return res.json({ok:false,error:'Limit'});
  let full_name='',phone='',phone2='',region='',comment='';
  const body=req.body;
  if(body.entry){
    const fd=body.entry[0]?.changes?.[0]?.value?.field_data||[];
    fd.forEach(f=>{const v=(f.values||[])[0]||'',fn=f.name.toLowerCase();
      if(fn.includes('name')) full_name=v;
      else if(fn.includes('phone')){if(!phone)phone=v;else phone2=v;}
      else if(fn.includes('region')) region=v;
      else if(fn.includes('comment')) comment=v;
    });
  } else {full_name=body.name||body.full_name||'';phone=body.phone||'';phone2=body.phone2||'';region=body.region||'';comment=body.comment||'';}
  const lead=DB.addLead({user_id:u.id,integ_id:it.id,full_name,phone,phone2,region,comment,source:it.source||'facebook'});
  await deliverLead(lead,it,u);
  res.json({ok:true});
});

app.post('/api/lead',async(req,res)=>{
  const{webhook_token,...data}=req.body;
  const it=DB.getInteg('webhook_token',webhook_token);
  if(!it) return res.json({ok:false,error:'Token topilmadi'});
  const u=DB.getUser('id',it.user_id);
  const lead=DB.addLead({user_id:u.id,integ_id:it.id,...data,source:it.source||'facebook'});
  const ok=await deliverLead(lead,it,u);
  res.json({ok,leadId:lead.id});
});

// ── REPORTS ──────────────────────────────────
app.get('/api/reports',auth,(req,res)=>{
  const integs=DB.userIntegs(req.uid);
  const report=integs.map(it=>{
    const leads=DB.integLeads(it.id);
    return{id:it.id,name:it.name,total:it.leads_total,today:it.leads_today,delivered:leads.filter(l=>l.delivered).length,dest_type:it.dest_type,status:it.status};
  });
  res.json({ok:true,stats:DB.stats(req.uid),integrations:report});
});

app.get('/api/leads',auth,(req,res)=>res.json({ok:true,leads:DB.userLeads(req.uid)}));

// ── PAYME ────────────────────────────────────
const PLANS={free:{name:'Bepul',price:0,leads:1000},pro:{name:'Professional',price:49000,leads:5000},business:{name:'Biznes',price:69000,leads:10000},corporate:{name:'Korporativ',price:89000,leads:999999}};

app.post('/api/payment/create',auth,(req,res)=>{
  const{plan}=req.body;
  const p=PLANS[plan];
  if(!p||p.price===0) return res.json({ok:false,error:'Notogri tarif'});
  const txn=DB.addTxn({user_id:req.uid,plan,amount:p.price*100,status:'pending',payme_id:null,create_time:null});
  const params=Buffer.from(JSON.stringify({m:CFG.PAYME_ID,ac:{order_id:txn.id},a:p.price*100,l:'uz'})).toString('base64');
  res.json({ok:true,url:'https://checkout.paycom.uz/'+params,txnId:txn.id});
});

app.post('/api/payme',(req,res)=>{
  const expected='Basic '+Buffer.from('Paycom:'+CFG.PAYME_KEY).toString('base64');
  if(req.headers.authorization!==expected) return res.json({error:{code:-32504,message:{ru:'Nedostatochno prav',uz:'Ruxsat yoq',en:'Permission denied'}}});
  const{method,params,id}=req.body;
  const ok=(r)=>res.json({jsonrpc:'2.0',id,result:r});
  const err=(c,m)=>res.json({jsonrpc:'2.0',id,error:{code:c,message:{ru:m,uz:m,en:m}}});
  if(method==='CheckPerformTransaction'){
    const txn=DB.getTxn('id',+params.account?.order_id);
    if(!txn) return err(-31050,'Buyurtma topilmadi');
    if(txn.amount!==params.amount) return err(-31001,'Summa mos kelmaydi');
    ok({allow:true});
  } else if(method==='CreateTransaction'){
    let txn=DB.getTxn('payme_id',params.id)||DB.getTxn('id',+params.account?.order_id);
    if(!txn) return err(-31050,'Buyurtma topilmadi');
    DB.updateTxn(txn.id,{payme_id:params.id,status:'created',create_time:params.time});
    txn=DB.getTxn('id',txn.id);
    ok({create_time:txn.create_time,transaction:String(txn.id),state:1});
  } else if(method==='PerformTransaction'){
    const txn=DB.getTxn('payme_id',params.id);
    if(!txn) return err(-31003,'Tranzaksiya topilmadi');
    DB.updateTxn(txn.id,{status:'paid',perform_time:Date.now()});
    const p=PLANS[txn.plan];
    if(p){const exp=new Date();exp.setMonth(exp.getMonth()+1);DB.updateUser(txn.user_id,{plan:txn.plan,plan_leads:p.leads,plan_used:0,plan_expires:exp.toISOString()});
    const u=DB.getUser('id',txn.user_id);if(u?.tg_id)bot.sendMessage(u.tg_id,'Tolov qabul qilindi! Tarif: '+p.name).catch(()=>{});}
    ok({transaction:String(txn.id),perform_time:Date.now(),state:2});
  } else if(method==='CancelTransaction'){
    const txn=DB.getTxn('payme_id',params.id);
    if(!txn) return err(-31003,'Topilmadi');
    DB.updateTxn(txn.id,{status:'cancelled',cancel_time:Date.now(),reason:params.reason});
    ok({transaction:String(txn.id),cancel_time:Date.now(),state:txn.status==='paid'?-2:-1});
  } else if(method==='CheckTransaction'){
    const txn=DB.getTxn('payme_id',params.id);
    if(!txn) return err(-31003,'Topilmadi');
    ok({create_time:txn.create_time||0,perform_time:txn.perform_time||0,cancel_time:txn.cancel_time||0,transaction:String(txn.id),state:txn.status==='paid'?2:txn.status==='cancelled'?-1:1,reason:txn.reason||null});
  } else if(method==='GetStatement'){
    const txns=rdb().transactions.filter(t=>t.payme_id&&t.create_time>=params.from&&t.create_time<=params.to);
    ok({transactions:txns.map(t=>({id:t.payme_id,time:t.create_time,amount:t.amount,account:{order_id:t.id},create_time:t.create_time,perform_time:t.perform_time||0,cancel_time:t.cancel_time||0,transaction:String(t.id),state:t.status==='paid'?2:-1,reason:t.reason||null}))});
  } else err(-32601,'Metod topilmadi');
});

// ── ADMIN ────────────────────────────────────
app.get('/api/admin/stats',adminAuth,(req,res)=>res.json({ok:true,...DB.adminStats()}));
app.get('/api/admin/users',adminAuth,(req,res)=>res.json({ok:true,users:DB.allUsers().map(DB.safe)}));
app.get('/api/admin/leads',adminAuth,(req,res)=>res.json({ok:true,leads:DB.allLeads()}));
app.get('/api/admin/integrations',adminAuth,(req,res)=>res.json({ok:true,integrations:DB.allIntegs()}));
app.post('/api/admin/user/:id/plan',adminAuth,(req,res)=>{
  const{plan,leads}=req.body;
  DB.updateUser(+req.params.id,{plan,plan_leads:leads||1000,plan_used:0});
  res.json({ok:true});
});
app.post('/api/admin/broadcast',adminAuth,async(req,res)=>{
  const{message}=req.body;
  const users=DB.allUsers().filter(u=>u.tg_id&&u.status==='active');
  let sent=0;
  for(const u of users){try{await bot.sendMessage(u.tg_id,message,{parse_mode:'Markdown'});sent++;}catch(e){}}
  res.json({ok:true,sent});
});

// ── FRONTEND ─────────────────────────────────
const _HTML="<!DOCTYPE html>\n<html lang=\"uz\">\n<head>\n<meta charset=\"UTF-8\">\n<meta name=\"viewport\" content=\"width=device-width, initial-scale=1.0\">\n<title>BekMedia Platform</title>\n<link href=\"https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800&display=swap\" rel=\"stylesheet\">\n<style>\n*{margin:0;padding:0;box-sizing:border-box}\n:root{--blue:#2563eb;--dark:#0f172a;--gray:#64748b;--light:#f1f5f9;--border:#e2e8f0;--green:#16a34a}\nbody{font-family:'Inter',sans-serif;background:var(--light);color:var(--dark)}\n.hidden{display:none!important}\n\n/* \u2500\u2500\u2500 AUTH PAGES \u2500\u2500\u2500 */\n.auth-wrap{min-height:100vh;display:flex;align-items:center;justify-content:center;background:linear-gradient(135deg,#eff6ff,#fff,#f0fdf4);padding:20px}\n.auth-box{background:#fff;border:1px solid var(--border);border-radius:20px;padding:40px;width:100%;max-width:420px;box-shadow:0 8px 40px rgba(0,0,0,.06)}\n.auth-logo{font-size:22px;font-weight:800;margin-bottom:6px}\n.auth-logo span{color:var(--blue)}\n.auth-sub{color:var(--gray);font-size:14px;margin-bottom:28px}\n.fg{margin-bottom:14px}\n.fg label{display:block;font-size:12px;font-weight:600;color:#374151;margin-bottom:6px;text-transform:uppercase;letter-spacing:.4px}\n.fg input,.fg select{width:100%;background:#f8fafc;border:1.5px solid var(--border);border-radius:9px;padding:11px 13px;font-size:14px;color:var(--dark);font-family:'Inter',sans-serif;outline:none;transition:border-color .2s}\n.fg input:focus,.fg select:focus{border-color:var(--blue);background:#fff}\n.btn{width:100%;background:var(--blue);color:#fff;border:none;padding:13px;border-radius:9px;font-size:15px;font-weight:600;cursor:pointer;font-family:'Inter',sans-serif;transition:all .2s;margin-top:4px}\n.btn:hover{background:#1d4ed8;transform:translateY(-1px)}\n.btn-outline{background:#fff;color:var(--dark);border:1.5px solid var(--border)}\n.btn-outline:hover{background:var(--light)}\n.btn-green{background:var(--green)}\n.btn-green:hover{background:#15803d}\n.auth-switch{text-align:center;margin-top:18px;font-size:14px;color:var(--gray)}\n.auth-switch a{color:var(--blue);font-weight:600;cursor:pointer;text-decoration:none}\n.err{background:#fee2e2;color:#dc2626;border-radius:8px;padding:10px 13px;font-size:13px;margin-bottom:14px;display:none}\n.err.show{display:block}\n.suc{background:#dcfce7;color:var(--green);border-radius:8px;padding:10px 13px;font-size:13px;margin-bottom:14px;display:none}\n.suc.show{display:block}\n\n/* \u2500\u2500\u2500 APP LAYOUT \u2500\u2500\u2500 */\n.app{display:flex;min-height:100vh}\n.sidebar{width:230px;background:var(--dark);position:fixed;top:0;left:0;height:100vh;display:flex;flex-direction:column;z-index:50}\n.sb-logo{padding:18px 16px 14px;border-bottom:1px solid rgba(255,255,255,.07)}\n.sb-logo-t{font-size:17px;font-weight:800;color:#fff}\n.sb-logo-t span{color:var(--blue)}\n.sb-badge{display:inline-block;background:#1d4ed8;color:#93c5fd;font-size:9px;font-weight:700;padding:2px 6px;border-radius:3px;margin-top:3px}\n.sb-nav{flex:1;padding:10px 8px;overflow-y:auto}\n.sb-sec{font-size:9px;font-weight:700;color:#475569;text-transform:uppercase;letter-spacing:.8px;padding:14px 10px 5px}\n.sb-item{display:flex;align-items:center;gap:9px;padding:9px 10px;border-radius:7px;cursor:pointer;color:#94a3b8;font-size:13px;font-weight:500;transition:all .15s;margin-bottom:1px}\n.sb-item:hover{background:rgba(255,255,255,.06);color:#e2e8f0}\n.sb-item.on{background:#1e40af;color:#fff}\n.sb-item .ic{font-size:15px;width:20px;text-align:center}\n.sb-item .dot{margin-left:auto;background:#ef4444;color:#fff;font-size:9px;font-weight:700;padding:1px 6px;border-radius:100px}\n.sb-foot{padding:12px;border-top:1px solid rgba(255,255,255,.07)}\n.sb-user{display:flex;align-items:center;gap:9px}\n.sb-av{width:32px;height:32px;border-radius:50%;background:linear-gradient(135deg,var(--blue),#60a5fa);display:flex;align-items:center;justify-content:center;color:#fff;font-weight:700;font-size:13px;flex-shrink:0}\n.sb-name{font-size:12px;font-weight:600;color:#e2e8f0}\n.sb-role{font-size:10px;color:#64748b}\n.logout-btn{margin-top:8px;width:100%;background:rgba(239,68,68,.1);color:#f87171;border:none;padding:7px;border-radius:7px;font-size:12px;font-weight:600;cursor:pointer;font-family:'Inter',sans-serif;transition:all .2s}\n.logout-btn:hover{background:rgba(239,68,68,.2)}\n\n.main{margin-left:230px;flex:1;display:flex;flex-direction:column}\n.topbar{background:#fff;border-bottom:1px solid var(--border);padding:0 24px;height:56px;display:flex;align-items:center;justify-content:space-between;position:sticky;top:0;z-index:40}\n.tb-title{font-size:16px;font-weight:700}\n.tb-right{display:flex;align-items:center;gap:10px}\n.notif{width:34px;height:34px;background:var(--light);border:1px solid var(--border);border-radius:8px;display:flex;align-items:center;justify-content:center;cursor:pointer;font-size:15px;position:relative}\n.notif::after{content:'';position:absolute;top:7px;right:8px;width:6px;height:6px;background:#ef4444;border-radius:50%;border:2px solid #fff}\n.content{padding:20px 24px;flex:1}\n\n/* \u2500\u2500\u2500 STATS \u2500\u2500\u2500 */\n.stats{display:grid;grid-template-columns:repeat(4,1fr);gap:14px;margin-bottom:20px}\n.sc{background:#fff;border:1px solid var(--border);border-radius:12px;padding:18px}\n.sc-top{display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:10px}\n.sc-lbl{font-size:12px;color:var(--gray);font-weight:500}\n.sc-ico{width:36px;height:36px;border-radius:9px;display:flex;align-items:center;justify-content:center;font-size:17px}\n.sc-n{font-size:26px;font-weight:800;line-height:1}\n.sc-ch{font-size:11px;margin-top:3px;color:var(--green)}\n\n/* \u2500\u2500\u2500 CARD \u2500\u2500\u2500 */\n.card{background:#fff;border:1px solid var(--border);border-radius:12px;margin-bottom:16px;overflow:hidden}\n.card-h{padding:14px 18px;border-bottom:1px solid var(--light);display:flex;align-items:center;justify-content:space-between}\n.card-h h3{font-size:14px;font-weight:700}\n.card-h-r{display:flex;gap:8px}\n.btn-sm{padding:6px 12px;border-radius:7px;font-size:11px;font-weight:600;cursor:pointer;border:none;font-family:'Inter',sans-serif;transition:all .15s}\n.bs-blue{background:var(--blue);color:#fff}\n.bs-out{background:#fff;color:#374151;border:1px solid var(--border)}\n\n/* \u2500\u2500\u2500 TABLE \u2500\u2500\u2500 */\ntable{width:100%;border-collapse:collapse}\nth{font-size:10px;font-weight:700;color:#94a3b8;text-transform:uppercase;letter-spacing:.5px;padding:9px 14px;text-align:left;background:#f8fafc;border-bottom:1px solid var(--light)}\ntd{padding:11px 14px;font-size:12px;color:#374151;border-bottom:1px solid #f8fafc}\ntr:last-child td{border-bottom:none}\ntr:hover td{background:#fafbff}\n.badge{display:inline-flex;align-items:center;gap:3px;padding:2px 8px;border-radius:100px;font-size:10px;font-weight:600}\n.b-green{background:#dcfce7;color:#16a34a}\n.b-blue{background:#dbeafe;color:#1d4ed8}\n.b-yellow{background:#fef9c3;color:#854d0e}\n.b-gray{background:var(--light);color:var(--gray)}\n.b-red{background:#fee2e2;color:#dc2626}\n\n/* \u2500\u2500\u2500 DEST OPTIONS \u2500\u2500\u2500 */\n.dest-opts{display:flex;flex-direction:column;gap:8px;margin:16px 0}\n.dest-opt{display:flex;align-items:center;gap:12px;padding:12px 14px;border-radius:9px;border:1.5px solid var(--border);cursor:pointer;transition:all .2s}\n.dest-opt:hover{border-color:#93c5fd}\n.dest-opt.sel{border-color:var(--blue);background:#eff6ff}\n.do-icon{font-size:22px;width:36px;text-align:center}\n.do-title{font-size:13px;font-weight:600}\n.do-sub{font-size:11px;color:var(--gray)}\n.do-check{margin-left:auto;width:18px;height:18px;border-radius:50%;border:1.5px solid var(--border);display:flex;align-items:center;justify-content:center;font-size:10px;transition:all .2s}\n.dest-opt.sel .do-check{background:var(--blue);border-color:var(--blue);color:#fff}\n\n/* \u2500\u2500\u2500 BOT CONNECT \u2500\u2500\u2500 */\n.bot-box{background:#0f172a;border-radius:12px;padding:20px;display:flex;gap:20px;align-items:center;flex-wrap:wrap}\n.bot-box ol{font-size:13px;color:#94a3b8;line-height:2;padding-left:16px;flex:1}\n.bot-box ol strong{color:#60a5fa}\n.bot-qr{background:#1e293b;border-radius:10px;padding:16px;text-align:center;min-width:120px}\n.bot-qr-icon{font-size:48px}\n.bot-qr-name{font-size:11px;color:#60a5fa;font-weight:600;margin-top:4px}\n.bot-link-btn{display:inline-flex;align-items:center;gap:6px;background:#1d4ed8;color:#fff;padding:9px 18px;border-radius:8px;font-size:13px;font-weight:600;text-decoration:none;border:none;cursor:pointer;font-family:'Inter',sans-serif;margin-top:12px;transition:all .2s}\n.bot-link-btn:hover{background:#1e40af}\n\n/* \u2500\u2500\u2500 LEADS FEED \u2500\u2500\u2500 */\n.leads-feed{display:flex;flex-direction:column;gap:8px}\n.lead-item{background:var(--light);border:1px solid var(--border);border-radius:9px;padding:12px;display:flex;gap:12px;align-items:flex-start}\n.lead-av{width:36px;height:36px;border-radius:8px;background:linear-gradient(135deg,#dbeafe,#bfdbfe);display:flex;align-items:center;justify-content:center;font-size:16px;flex-shrink:0}\n.lead-info{flex:1}\n.lead-name{font-size:13px;font-weight:600;margin-bottom:2px}\n.lead-meta{display:flex;gap:10px;flex-wrap:wrap}\n.lead-meta span{font-size:11px;color:var(--gray);display:flex;align-items:center;gap:3px}\n.lead-r{text-align:right;flex-shrink:0}\n.lead-time{font-size:10px;color:#94a3b8;margin-bottom:4px}\n\n/* \u2500\u2500\u2500 SETTINGS GRID \u2500\u2500\u2500 */\n.sg{display:grid;grid-template-columns:1fr 1fr;gap:16px}\n.scard{background:#fff;border:1px solid var(--border);border-radius:12px;padding:20px}\n.scard-t{font-size:14px;font-weight:700;margin-bottom:4px}\n.scard-s{font-size:12px;color:var(--gray);margin-bottom:16px}\n\n/* \u2500\u2500\u2500 TOAST \u2500\u2500\u2500 */\n.toast{position:fixed;bottom:20px;right:20px;z-index:9999;background:var(--dark);color:#fff;padding:11px 18px;border-radius:9px;font-size:13px;font-weight:500;display:none;align-items:center;gap:7px;box-shadow:0 8px 24px rgba(0,0,0,.2)}\n.toast.on{display:flex;animation:tIn .3s ease}\n@keyframes tIn{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:translateY(0)}}\n\n@media(max-width:800px){\n  .sidebar{transform:translateX(-230px)}\n  .main{margin-left:0}\n  .stats{grid-template-columns:1fr 1fr}\n  .sg{grid-template-columns:1fr}\n}\n</style>\n</head>\n<body>\n\n<!-- \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550 LOGIN PAGE \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550 -->\n<div id=\"pg-login\" class=\"auth-wrap\">\n  <div class=\"auth-box\">\n    <div class=\"auth-logo\">Bek<span>Media</span></div>\n    <div class=\"auth-sub\">Kabinetingizga kiring</div>\n    <div class=\"err\" id=\"login-err\"></div>\n    <div class=\"fg\"><label>Telefon raqam</label><input id=\"l-phone\" placeholder=\"+998 90 000 00 00\" type=\"tel\"></div>\n    <div class=\"fg\"><label>Parol</label><input id=\"l-pass\" placeholder=\"\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\" type=\"password\"></div>\n    <button class=\"btn\" onclick=\"doLogin()\">Kirish \u2192</button>\n    <div class=\"auth-switch\">Akkaunt yo'qmi? <a onclick=\"showPg('pg-register')\">Ro'yxatdan o'ting</a></div>\n    <div style=\"margin-top:10px;text-align:center\"><a onclick=\"showPg('pg-admin-login')\" style=\"font-size:12px;color:var(--gray);cursor:pointer\">Admin kirish</a></div>\n  </div>\n</div>\n\n<!-- \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550 REGISTER PAGE \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550 -->\n<div id=\"pg-register\" class=\"auth-wrap hidden\">\n  <div class=\"auth-box\">\n    <div class=\"auth-logo\">Bek<span>Media</span></div>\n    <div class=\"auth-sub\">Bepul ro'yxatdan o'ting \u2014 7 kun sinov</div>\n    <div class=\"err\" id=\"reg-err\"></div>\n    <div class=\"suc\" id=\"reg-ok\"></div>\n    <div class=\"fg\"><label>Ism Familiya</label><input id=\"r-name\" placeholder=\"Sardor Toshmatov\"></div>\n    <div class=\"fg\"><label>Telefon</label><input id=\"r-phone\" placeholder=\"+998 90 000 00 00\" type=\"tel\"></div>\n    <div class=\"fg\"><label>Biznes turi</label>\n      <select id=\"r-biz\">\n        <option value=\"\">Tanlang...</option>\n        <option>Beauty salon / Klinika</option>\n        <option>Ta'lim markazi</option>\n        <option>Fitnes / Sport</option>\n        <option>Qurilish / Uy-joy</option>\n        <option>Onlayn savdo</option>\n        <option>Restoran / Cafe</option>\n        <option>Boshqa</option>\n      </select>\n    </div>\n    <div class=\"fg\"><label>Parol</label><input id=\"r-pass\" placeholder=\"Parol o'rnating\" type=\"password\"></div>\n    <button class=\"btn btn-green\" onclick=\"doRegister()\">Ro'yxatdan o'tish \u2192</button>\n    <div class=\"auth-switch\">Akkaunt bormi? <a onclick=\"showPg('pg-login')\">Kirish</a></div>\n  </div>\n</div>\n\n<!-- \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550 ADMIN LOGIN \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550 -->\n<div id=\"pg-admin-login\" class=\"auth-wrap hidden\">\n  <div class=\"auth-box\">\n    <div class=\"auth-logo\">Bek<span>Media</span> <span style=\"font-size:12px;color:var(--gray)\">Admin</span></div>\n    <div class=\"auth-sub\">Admin paneliga kirish</div>\n    <div class=\"err\" id=\"admin-err\"></div>\n    <div class=\"fg\"><label>Admin parol</label><input id=\"a-pass\" placeholder=\"\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\" type=\"password\"></div>\n    <button class=\"btn\" onclick=\"doAdminLogin()\">Kirish \u2192</button>\n    <div class=\"auth-switch\"><a onclick=\"showPg('pg-login')\" style=\"cursor:pointer\">\u2190 Orqaga</a></div>\n  </div>\n</div>\n\n<!-- \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550 MAIN APP \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550 -->\n<div id=\"pg-app\" class=\"app hidden\">\n  <!-- Sidebar -->\n  <div class=\"sidebar\">\n    <div class=\"sb-logo\">\n      <div class=\"sb-logo-t\">Bek<span>Media</span></div>\n      <div class=\"sb-badge\" id=\"sb-badge\">KABINET</div>\n    </div>\n    <div class=\"sb-nav\" id=\"sb-nav\">\n      <!-- filled by JS -->\n    </div>\n    <div class=\"sb-foot\">\n      <div class=\"sb-user\">\n        <div class=\"sb-av\" id=\"sb-av\">U</div>\n        <div>\n          <div class=\"sb-name\" id=\"sb-uname\">\u2014</div>\n          <div class=\"sb-role\" id=\"sb-urole\">Foydalanuvchi</div>\n        </div>\n      </div>\n      <button class=\"logout-btn\" onclick=\"logout()\">Chiqish</button>\n    </div>\n  </div>\n\n  <!-- Main -->\n  <div class=\"main\">\n    <div class=\"topbar\">\n      <div class=\"tb-title\" id=\"pg-title\">Dashboard</div>\n      <div class=\"tb-right\">\n        <div class=\"notif\">\ud83d\udd14</div>\n      </div>\n    </div>\n    <div class=\"content\" id=\"app-content\">\n      <!-- filled by JS -->\n    </div>\n  </div>\n</div>\n\n<div class=\"toast\" id=\"toast\"></div>\n\n<script>\nconst API = ''; // same origin\nlet currentUser = null;\nlet isAdmin = false;\nlet currentView = '';\n\n// \u2500\u2500\u2500 UTILS \u2500\u2500\u2500\nconst $ = id => document.getElementById(id);\nconst toast = (msg, c='') => {\n  const t = $('toast');\n  t.textContent = (c==='ok'?'\u2705 ':'\u274c ') + msg;\n  t.classList.add('on');\n  setTimeout(()=>t.classList.remove('on'), 2800);\n};\nconst showPg = id => {\n  document.querySelectorAll('[id^=pg-]').forEach(p=>p.classList.add('hidden'));\n  $(id).classList.remove('hidden');\n};\n\n// \u2500\u2500\u2500 AUTH \u2500\u2500\u2500\nasync function doRegister() {\n  const name=$('r-name').value.trim(), phone=$('r-phone').value.trim(),\n        biz=$('r-biz').value, pass=$('r-pass').value.trim();\n  if(!name||!phone){$('reg-err').textContent='Ism va telefon kerak';$('reg-err').classList.add('show');return;}\n  const r = await fetch('/api/register',{method:'POST',headers:{'Content-Type':'application/json'},\n    body:JSON.stringify({name,phone,business:biz,password:pass})});\n  const d = await r.json();\n  if(d.ok){\n    $('reg-err').classList.remove('show');\n    $('reg-ok').textContent='\u2705 Muvaffaqiyatli! Endi kiring.';\n    $('reg-ok').classList.add('show');\n    setTimeout(()=>showPg('pg-login'),1500);\n  } else {\n    $('reg-err').textContent=d.error; $('reg-err').classList.add('show');\n  }\n}\n\nasync function doLogin() {\n  const phone=$('l-phone').value.trim(), pass=$('l-pass').value.trim();\n  const r = await fetch('/api/login',{method:'POST',headers:{'Content-Type':'application/json'},\n    body:JSON.stringify({phone,password:pass})});\n  const d = await r.json();\n  if(d.ok){\n    localStorage.setItem('bm_token', d.token);\n    localStorage.setItem('bm_admin','0');\n    currentUser = d.user; isAdmin = false;\n    initApp();\n  } else {\n    $('login-err').textContent=d.error; $('login-err').classList.add('show');\n  }\n}\n\nfunction doAdminLogin(){\n  const pass=$('a-pass').value.trim();\n  // Simple: admin_CHATID\n  if(pass==='bekmedia2024'||pass==='admin'){\n    localStorage.setItem('bm_token','admin_7943361979');\n    localStorage.setItem('bm_admin','1');\n    isAdmin=true;\n    initApp();\n  } else {\n    $('admin-err').textContent='Noto\\'g\\'ri parol';$('admin-err').classList.add('show');\n  }\n}\n\nfunction logout(){localStorage.removeItem('bm_token');localStorage.removeItem('bm_admin');location.reload();}\n\n// \u2500\u2500\u2500 INIT \u2500\u2500\u2500\nasync function boot(){\n  const token=localStorage.getItem('bm_token');\n  const admin=localStorage.getItem('bm_admin')==='1';\n  if(!token){showPg('pg-login');return;}\n  if(admin&&token.startsWith('admin_')){isAdmin=true;initApp();return;}\n  const r=await fetch('/api/me',{headers:{Authorization:'Bearer '+token}});\n  const d=await r.json();\n  if(d.ok){currentUser=d.user;isAdmin=false;initApp();}\n  else{localStorage.removeItem('bm_token');showPg('pg-login');}\n}\n\nfunction initApp(){\n  showPg('pg-app');\n  if(isAdmin){\n    $('sb-badge').textContent='ADMIN';\n    $('sb-uname').textContent='Izzatbek';\n    $('sb-urole').textContent='Super Admin';\n    $('sb-av').textContent='I';\n    renderAdminNav();\n    loadView('a-dashboard');\n  } else {\n    $('sb-badge').textContent='KABINET';\n    $('sb-uname').textContent=currentUser.name;\n    $('sb-urole').textContent=currentUser.business||'Foydalanuvchi';\n    $('sb-av').textContent=currentUser.name[0].toUpperCase();\n    renderClientNav();\n    loadView('c-dashboard');\n  }\n}\n\n// \u2500\u2500\u2500 ADMIN NAV \u2500\u2500\u2500\nfunction renderAdminNav(){\n  $('sb-nav').innerHTML = `\n    <div class=\"sb-sec\">Asosiy</div>\n    <div class=\"sb-item on\" onclick=\"loadView('a-dashboard',this)\"><div class=\"ic\">\ud83d\udcca</div> Dashboard</div>\n    <div class=\"sb-item\" onclick=\"loadView('a-leads',this)\"><div class=\"ic\">\ud83d\udd25</div> Barcha lidlar <div class=\"dot\">!</div></div>\n    <div class=\"sb-item\" onclick=\"loadView('a-users',this)\"><div class=\"ic\">\ud83d\udc65</div> Foydalanuvchilar</div>\n    <div class=\"sb-sec\">Boshqaruv</div>\n    <div class=\"sb-item\" onclick=\"loadView('a-broadcast',this)\"><div class=\"ic\">\ud83d\udce2</div> Xabar yuborish</div>\n    <div class=\"sb-item\" onclick=\"loadView('a-settings',this)\"><div class=\"ic\">\u2699\ufe0f</div> Sozlamalar</div>\n  `;\n}\n\n// \u2500\u2500\u2500 CLIENT NAV \u2500\u2500\u2500\nfunction renderClientNav(){\n  $('sb-nav').innerHTML = `\n    <div class=\"sb-sec\">Mening hisobim</div>\n    <div class=\"sb-item on\" onclick=\"loadView('c-dashboard',this)\"><div class=\"ic\">\ud83d\udcca</div> Dashboard</div>\n    <div class=\"sb-item\" onclick=\"loadView('c-leads',this)\"><div class=\"ic\">\ud83d\udd25</div> Mening lidlarim</div>\n    <div class=\"sb-sec\">Sozlamalar</div>\n    <div class=\"sb-item\" onclick=\"loadView('c-dest',this)\"><div class=\"ic\">\ud83d\udcf2</div> Yetkazish joyi</div>\n    <div class=\"sb-item\" onclick=\"loadView('c-bot',this)\"><div class=\"ic\">\ud83e\udd16</div> Botni ulash</div>\n  `;\n}\n\n// \u2500\u2500\u2500 VIEWS \u2500\u2500\u2500\nfunction loadView(name, el){\n  currentView = name;\n  if(el){\n    document.querySelectorAll('.sb-item').forEach(i=>i.classList.remove('on'));\n    el.classList.add('on');\n  }\n  const titles={\n    'a-dashboard':'Dashboard','a-leads':'Barcha Lidlar','a-users':'Foydalanuvchilar',\n    'a-broadcast':'Xabar Yuborish','a-settings':'Sozlamalar',\n    'c-dashboard':'Dashboard','c-leads':'Mening Lidlarim',\n    'c-dest':'Yetkazish Joyi','c-bot':'Botni Ulash'\n  };\n  $('pg-title').textContent=titles[name]||name;\n\n  if(name==='a-dashboard') renderAdminDashboard();\n  else if(name==='a-leads') renderAdminLeads();\n  else if(name==='a-users') renderAdminUsers();\n  else if(name==='a-broadcast') renderBroadcast();\n  else if(name==='a-settings') renderAdminSettings();\n  else if(name==='c-dashboard') renderClientDashboard();\n  else if(name==='c-leads') renderClientLeads();\n  else if(name==='c-dest') renderDestSettings();\n  else if(name==='c-bot') renderBotConnect();\n}\n\n// \u2500\u2500\u2500 ADMIN VIEWS \u2500\u2500\u2500\nasync function renderAdminDashboard(){\n  $('app-content').innerHTML = `<div style=\"display:grid;grid-template-columns:repeat(4,1fr);gap:14px;margin-bottom:20px\" id=\"a-stats\">Yuklanmoqda...</div>\n  <div style=\"display:grid;grid-template-columns:2fr 1fr;gap:16px\">\n    <div class=\"card\"><div class=\"card-h\"><h3>\ud83d\udd25 So'nggi lidlar</h3></div><div style=\"padding:14px\" id=\"a-recent-leads\">Yuklanmoqda...</div></div>\n    <div class=\"card\"><div class=\"card-h\"><h3>\ud83d\udcf2 Kanallar</h3></div><div style=\"padding:14px\" id=\"a-channels\"></div></div>\n  </div>`;\n  \n  const r = await api('/api/admin/stats');\n  if(r.ok){\n    $('a-stats').innerHTML = [\n      {l:'Bugungi lidlar',n:r.todayLeads,i:'\ud83d\udd25',c:'#dbeafe'},\n      {l:'Jami foydalanuvchi',n:r.totalUsers,i:'\ud83d\udc65',c:'#dcfce7'},\n      {l:'Jami lidlar',n:r.totalLeads,i:'\ud83d\udcca',c:'#fef9c3'},\n      {l:'Yetkazildi',n:r.delivered,i:'\u2705',c:'#fce7f3'},\n    ].map(s=>`\n      <div class=\"sc\"><div class=\"sc-top\"><div class=\"sc-lbl\">${s.l}</div><div class=\"sc-ico\" style=\"background:${s.c}\">${s.i}</div></div>\n      <div class=\"sc-n\">${s.n}</div><div class=\"sc-ch\">\u2191 Faol</div></div>\n    `).join('');\n  }\n\n  const lr = await api('/api/admin/leads');\n  if(lr.ok){\n    $('a-recent-leads').innerHTML = `<div class=\"leads-feed\">` +\n      lr.leads.slice(0,6).map(l=>`\n        <div class=\"lead-item\">\n          <div class=\"lead-av\">\ud83d\udc64</div>\n          <div class=\"lead-info\">\n            <div class=\"lead-name\">${l.full_name||'\u2014'}</div>\n            <div class=\"lead-meta\"><span>\ud83d\udcde ${l.phone}</span><span>\ud83c\udfe2 ${l.user_name||'\u2014'}</span><span>${l.source==='Instagram'?'\ud83d\udcf8':'\ud83d\udcd8'} ${l.source}</span></div>\n          </div>\n          <div class=\"lead-r\"><div class=\"lead-time\">${l.created_at?.slice(11,16)||''}</div>\n          <span class=\"badge ${l.delivered?'b-green':'b-red'}\">${l.delivered?'\u2713 Yetkazildi':'\u2717 Xato'}</span></div>\n        </div>\n      `).join('') + `</div>`;\n\n    // channels\n    const tg = lr.leads.filter(l=>l.dest_type==='telegram').length;\n    const gr = lr.leads.filter(l=>l.dest_type==='group').length;\n    const sh = lr.leads.filter(l=>l.dest_type==='sheets').length;\n    const tot = lr.leads.length||1;\n    $('a-channels').innerHTML = [\n      {l:'\u2708\ufe0f Shaxsiy',v:tg,c:'#2563eb'},\n      {l:'\ud83d\udc65 Guruh',v:gr,c:'#16a34a'},\n      {l:'\ud83d\udcca Google Sheets',v:sh,c:'#d97706'},\n    ].map(c=>`\n      <div style=\"margin-bottom:12px\">\n        <div style=\"display:flex;justify-content:space-between;font-size:12px;margin-bottom:4px\"><span>${c.l}</span><strong>${Math.round(c.v/tot*100)}%</strong></div>\n        <div style=\"height:6px;background:var(--light);border-radius:3px\"><div style=\"height:100%;width:${Math.round(c.v/tot*100)}%;background:${c.c};border-radius:3px\"></div></div>\n      </div>`).join('');\n  }\n}\n\nasync function renderAdminLeads(){\n  const r = await api('/api/admin/leads');\n  $('app-content').innerHTML = `\n    <div class=\"card\">\n      <div class=\"card-h\"><h3>\ud83d\udd25 Barcha Lidlar (${r.leads?.length||0})</h3>\n        <button class=\"btn-sm bs-blue\" onclick=\"exportLeads()\">\ud83d\udce5 Export CSV</button>\n      </div>\n      <table><thead><tr>\n        <th>Ism</th><th>Telefon</th><th>Mijoz</th><th>Manba</th><th>Kanal</th><th>Sana</th><th>Holat</th>\n      </tr></thead><tbody>\n      ${r.leads?.map(l=>`<tr>\n        <td><strong>${l.full_name||'\u2014'}</strong></td>\n        <td style=\"color:var(--blue)\">${l.phone||'\u2014'}</td>\n        <td>${l.user_name||'\u2014'}</td>\n        <td><span class=\"badge ${l.source==='Instagram'?'b-blue':'b-gray'}\">${l.source}</span></td>\n        <td><span class=\"badge b-blue\">${l.dest_type==='telegram'?'\u2708\ufe0f Shaxsiy':l.dest_type==='group'?'\ud83d\udc65 Guruh':'\ud83d\udcca Sheets'}</span></td>\n        <td style=\"color:#94a3b8;font-size:11px\">${l.created_at?.slice(0,16)||''}</td>\n        <td><span class=\"badge ${l.delivered?'b-green':'b-red'}\">${l.delivered?'\u2713':'\u2717'}</span></td>\n      </tr>`).join('')}\n      </tbody></table>\n    </div>`;\n}\n\nasync function renderAdminUsers(){\n  const r = await api('/api/admin/users');\n  $('app-content').innerHTML = `\n    <div class=\"card\">\n      <div class=\"card-h\"><h3>\ud83d\udc65 Foydalanuvchilar (${r.users?.length||0})</h3></div>\n      <table><thead><tr>\n        <th>Ism</th><th>Telefon</th><th>Biznes</th><th>Kanal</th><th>Lidlar</th><th>Tarif</th><th>Holat</th>\n      </tr></thead><tbody>\n      ${r.users?.map(u=>`<tr>\n        <td><strong>${u.name}</strong></td>\n        <td>${u.phone}</td>\n        <td>${u.business||'\u2014'}</td>\n        <td><span class=\"badge b-blue\">${u.dest_type==='telegram'?'\u2708\ufe0f':u.dest_type==='group'?'\ud83d\udc65':'\ud83d\udcca'} ${u.dest_type}</span></td>\n        <td><strong>${u.leads_count}</strong></td>\n        <td><span class=\"badge b-gray\">${u.plan}</span></td>\n        <td><span class=\"badge ${u.status==='active'?'b-green':'b-yellow'}\">\u25cf ${u.status}</span></td>\n      </tr>`).join('')}\n      </tbody></table>\n    </div>`;\n}\n\nfunction renderBroadcast(){\n  $('app-content').innerHTML = `\n    <div class=\"scard\" style=\"max-width:500px\">\n      <div class=\"scard-t\">\ud83d\udce2 Barcha mijozlarga xabar yuborish</div>\n      <div class=\"scard-s\">Xabar barcha faol foydalanuvchilarning Telegramiga boradi</div>\n      <div class=\"fg\"><label>Kimga</label>\n        <select id=\"bc-to\">\n          <option value=\"all\">Barcha faol mijozlar</option>\n          <option value=\"trial\">Sinov tarifidagilar</option>\n        </select>\n      </div>\n      <div class=\"fg\"><label>Xabar matni</label>\n        <textarea id=\"bc-msg\" style=\"width:100%;background:#f8fafc;border:1.5px solid var(--border);border-radius:9px;padding:11px 13px;font-size:13px;font-family:'Inter',sans-serif;outline:none;resize:vertical;min-height:100px\" placeholder=\"Xabar kiriting...\"></textarea>\n      </div>\n      <button class=\"btn btn-green\" onclick=\"sendBroadcast()\">\ud83d\udce2 Yuborish</button>\n    </div>`;\n}\n\nasync function sendBroadcast(){\n  const msg=$('bc-msg').value.trim();\n  if(!msg){toast('Xabar bo\\'sh!','err');return;}\n  const r=await api('/api/admin/broadcast',{method:'POST',body:{message:msg}});\n  if(r.ok) toast(`${r.sent} ta foydalanuvchiga yuborildi!`,'ok');\n  else toast('Xato!','err');\n}\n\nfunction renderAdminSettings(){\n  $('app-content').innerHTML = `\n    <div class=\"sg\">\n      <div class=\"scard\">\n        <div class=\"scard-t\">\ud83e\udd16 Bot sozlamalari</div>\n        <div class=\"scard-s\">Telegram bot token va admin ID</div>\n        <div class=\"fg\"><label>Bot Token</label><input value=\"${localStorage.getItem('bm_token')?.startsWith('admin')?'8972409490:AAHM...':'\u2014'}\" type=\"password\"></div>\n        <div class=\"fg\"><label>Admin Chat ID</label><input value=\"7943361979\"></div>\n        <button class=\"btn\" onclick=\"toast('Saqlandi','ok')\">Saqlash</button>\n      </div>\n      <div class=\"scard\">\n        <div class=\"scard-t\">\ud83d\udcca Lead yuborish test</div>\n        <div class=\"scard-s\">Istalgan foydalanuvchiga test lid yuboring</div>\n        <div class=\"fg\"><label>Foydalanuvchi tokeni</label><input id=\"test-token\" placeholder=\"abc123...\"></div>\n        <button class=\"btn bs-blue btn-sm\" style=\"width:100%;padding:11px;font-size:14px\" onclick=\"sendTestLead()\">\ud83d\udd25 Test lid yuborish</button>\n      </div>\n    </div>`;\n}\n\nasync function sendTestLead(){\n  const token=$('test-token').value.trim();\n  if(!token){toast('Token kiriting','err');return;}\n  const r=await fetch('/api/lead',{method:'POST',headers:{'Content-Type':'application/json'},\n    body:JSON.stringify({user_token:token,full_name:'Test Foydalanuvchi',phone:'+998901234567',region:'Toshkent',comment:'Bu test lid',source:'Facebook'})});\n  const d=await r.json();\n  if(d.ok) toast(`Test lid yuborildi! ${d.delivered?'\u2705 Yetkazildi':'\u26a0\ufe0f Yetkazilmadi'}`,'ok');\n  else toast(d.error,'err');\n}\n\n// \u2500\u2500\u2500 CLIENT VIEWS \u2500\u2500\u2500\nasync function renderClientDashboard(){\n  const r = await api('/api/leads');\n  const leads = r.leads||[];\n  $('app-content').innerHTML = `\n    <div class=\"stats\">\n      <div class=\"sc\"><div class=\"sc-top\"><div class=\"sc-lbl\">Jami lidlar</div><div class=\"sc-ico\" style=\"background:#dbeafe\">\ud83d\udd25</div></div><div class=\"sc-n\">${currentUser.leads_count||leads.length}</div></div>\n      <div class=\"sc\"><div class=\"sc-top\"><div class=\"sc-lbl\">Bu oy</div><div class=\"sc-ico\" style=\"background:#dcfce7\">\ud83d\udcca</div></div><div class=\"sc-n\">${currentUser.leads_month||0}</div></div>\n      <div class=\"sc\"><div class=\"sc-top\"><div class=\"sc-lbl\">Yetkazish</div><div class=\"sc-ico\" style=\"background:#fef9c3\">\ud83d\udcf2</div></div><div class=\"sc-n\">${currentUser.dest_type==='telegram'?'\u2708\ufe0f TG':currentUser.dest_type==='group'?'\ud83d\udc65 Guruh':'\ud83d\udcca Sheets'}</div></div>\n      <div class=\"sc\"><div class=\"sc-top\"><div class=\"sc-lbl\">Tarif</div><div class=\"sc-ico\" style=\"background:#fce7f3\">\ud83d\udc8e</div></div><div class=\"sc-n\" style=\"font-size:16px;padding-top:4px\">${currentUser.plan}</div></div>\n    </div>\n    <div class=\"card\">\n      <div class=\"card-h\"><h3>\ud83d\udd25 So'nggi lidlar</h3><button class=\"btn-sm bs-out\" onclick=\"loadView('c-leads')\">Barchasini \u2192</button></div>\n      <div style=\"padding:14px\">\n        <div class=\"leads-feed\">\n        ${leads.slice(0,5).map(l=>`\n          <div class=\"lead-item\">\n            <div class=\"lead-av\">\ud83d\udc64</div>\n            <div class=\"lead-info\"><div class=\"lead-name\">${l.full_name||'\u2014'}</div>\n              <div class=\"lead-meta\"><span>\ud83d\udcde ${l.phone}</span><span>${l.source==='Instagram'?'\ud83d\udcf8':'\ud83d\udcd8'} ${l.source}</span></div>\n            </div>\n            <div class=\"lead-r\"><div class=\"lead-time\">${l.created_at?.slice(11,16)||''}</div>\n              <span class=\"badge ${l.delivered?'b-green':'b-red'}\">${l.delivered?'\u2713':'\u2717'}</span>\n            </div>\n          </div>`).join('') || '<div style=\"text-align:center;color:var(--gray);padding:20px;font-size:13px\">Hali lid yo\\'q. Botni ulab reklamani boshlang!</div>'}\n        </div>\n      </div>\n    </div>\n    ${!currentUser.dest_chat_id && !currentUser.dest_group_id?`\n    <div style=\"background:#fffbeb;border:1px solid #fde68a;border-radius:10px;padding:14px;display:flex;align-items:center;gap:12px;font-size:13px\">\n      \u26a0\ufe0f <strong>Bot ulanmagan!</strong> &nbsp;Lidlar kelishi uchun <a onclick=\"loadView('c-bot')\" style=\"color:var(--blue);cursor:pointer;font-weight:600\">botni ulang \u2192</a>\n    </div>`:''}`;\n}\n\nasync function renderClientLeads(){\n  const r = await api('/api/leads');\n  $('app-content').innerHTML = `\n    <div class=\"card\">\n      <div class=\"card-h\"><h3>\ud83d\udd25 Mening lidlarim (${r.leads?.length||0})</h3>\n        <button class=\"btn-sm bs-blue\" onclick=\"exportMyLeads()\">\ud83d\udce5 CSV</button>\n      </div>\n      <table><thead><tr>\n        <th>Ism</th><th>Telefon</th><th>Hudud</th><th>Izoh</th><th>Manba</th><th>Sana</th><th>Holat</th>\n      </tr></thead><tbody>\n      ${r.leads?.map(l=>`<tr>\n        <td><strong>${l.full_name||'\u2014'}</strong></td>\n        <td style=\"color:var(--blue)\">${l.phone||'\u2014'}</td>\n        <td>${l.region||'\u2014'}</td>\n        <td style=\"max-width:120px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap\">${l.comment||'\u2014'}</td>\n        <td><span class=\"badge b-gray\">${l.source}</span></td>\n        <td style=\"color:#94a3b8;font-size:11px\">${l.created_at?.slice(0,16)||''}</td>\n        <td><span class=\"badge ${l.delivered?'b-green':'b-red'}\">${l.delivered?'\u2713 Yetkazildi':'\u2717'}</span></td>\n      </tr>`).join('') || '<tr><td colspan=\"7\" style=\"text-align:center;color:var(--gray);padding:20px\">Hali lid yo\\'q</td></tr>'}\n      </tbody></table>\n    </div>`;\n}\n\nasync function renderDestSettings(){\n  const u = currentUser;\n  $('app-content').innerHTML = `\n    <div class=\"sg\">\n      <div class=\"scard\">\n        <div class=\"scard-t\">\ud83d\udcf2 Lidlar qaerga tushsin?</div>\n        <div class=\"scard-s\">Har bir yangi lid qayerga yuborilishini tanlang</div>\n        <div class=\"dest-opts\">\n          <div class=\"dest-opt ${(!u.dest_type||u.dest_type==='telegram')?'sel':''}\" onclick=\"selDest(this,'telegram')\" id=\"do-tg\">\n            <div class=\"do-icon\">\u2708\ufe0f</div><div><div class=\"do-title\">Telegram \u2014 Shaxsiy</div><div class=\"do-sub\">Lidlar to'g'ridan shaxsiy chatga tushadi</div></div>\n            <div class=\"do-check\">${(!u.dest_type||u.dest_type==='telegram')?'\u2713':''}</div>\n          </div>\n          <div class=\"dest-opt ${u.dest_type==='group'?'sel':''}\" onclick=\"selDest(this,'group')\" id=\"do-gr\">\n            <div class=\"do-icon\">\ud83d\udc65</div><div><div class=\"do-title\">Telegram \u2014 Guruh</div><div class=\"do-sub\">Lidlar guruh chatga tushadi (jamoaviy)</div></div>\n            <div class=\"do-check\">${u.dest_type==='group'?'\u2713':''}</div>\n          </div>\n          <div class=\"dest-opt ${u.dest_type==='sheets'?'sel':''}\" onclick=\"selDest(this,'sheets')\" id=\"do-sh\">\n            <div class=\"do-icon\">\ud83d\udcca</div><div><div class=\"do-title\">Google Sheets</div><div class=\"do-sub\">Lidlar avtomatik jadvalga yoziladi</div></div>\n            <div class=\"do-check\">${u.dest_type==='sheets'?'\u2713':''}</div>\n          </div>\n        </div>\n        <div id=\"dest-field\"></div>\n        <button class=\"btn\" onclick=\"saveDest()\">Saqlash</button>\n      </div>\n      <div class=\"scard\">\n        <div class=\"scard-t\">\u2139\ufe0f Qanday ulash kerak?</div>\n        <div class=\"scard-s\">Har bir kanal uchun yo'riqnoma</div>\n        <div style=\"font-size:13px;color:#374151;line-height:1.8\">\n          <p><strong>\u2708\ufe0f Shaxsiy Telegram:</strong><br>Botni ulab, chat ID avtomatik aniqlanadi.</p><br>\n          <p><strong>\ud83d\udc65 Guruh:</strong><br>Botni guruhga qo'shing \u2192 Guruh chat ID sini kiriting. (Masalan: -1001234567890)</p><br>\n          <p><strong>\ud83d\udcca Google Sheets:</strong><br>Google Apps Script webhook URL sini kiriting.</p>\n        </div>\n      </div>\n    </div>`;\n  selDest(document.querySelector('.dest-opt.sel'), u.dest_type||'telegram', true);\n}\n\nlet selectedDest = 'telegram';\nfunction selDest(opt, type, init=false){\n  selectedDest = type;\n  if(!init){\n    document.querySelectorAll('.dest-opt').forEach(o=>{o.classList.remove('sel');o.querySelector('.do-check').textContent='';});\n    opt.classList.add('sel'); opt.querySelector('.do-check').textContent='\u2713';\n  }\n  const labels={telegram:'Telegram Chat ID',group:'Guruh Chat ID',sheets:'Google Sheets Webhook URL'};\n  const placeholders={telegram:'Masalan: 7943361979',group:'Masalan: -1001234567890',sheets:'https://script.google.com/...'};\n  const vals={telegram:currentUser.dest_chat_id,group:currentUser.dest_group_id,sheets:currentUser.dest_sheets_url};\n  $('dest-field').innerHTML=`<div class=\"fg\"><label>${labels[type]}</label><input id=\"dest-val\" placeholder=\"${placeholders[type]}\" value=\"${vals[type]||''}\"></div>`;\n}\n\nasync function saveDest(){\n  const val=$('dest-val')?.value.trim();\n  const body={dest_type:selectedDest};\n  if(selectedDest==='telegram') body.dest_chat_id=val;\n  else if(selectedDest==='group') body.dest_group_id=val;\n  else body.dest_sheets_url=val;\n  const r=await api('/api/settings/dest',{method:'POST',body});\n  if(r.ok){toast('Saqlandi!','ok');currentUser={...currentUser,...body};}\n  else toast('Xato!','err');\n}\n\nasync function renderBotConnect(){\n  const r=await api('/api/bot-link');\n  $('app-content').innerHTML=`\n    <div class=\"card\">\n      <div class=\"card-h\"><h3>\ud83e\udd16 Telegram Botni Ulash</h3></div>\n      <div style=\"padding:20px\">\n        <div class=\"bot-box\">\n          <div style=\"flex:1\">\n            <div style=\"font-size:14px;color:#e2e8f0;margin-bottom:14px\">Botni Telegramingiz bilan ulang \u2014 lidlar avtomatik keladi:</div>\n            <ol>\n              <li>Quyidagi tugmani bosing</li>\n              <li>Telegram <strong>@Bekmedia_smmbot</strong> ochiladi</li>\n              <li><strong>/start</strong> tugmasini bosing</li>\n              <li>Kabinetingiz avtomatik ulanadi \u2705</li>\n            </ol>\n            <br>\n            <a href=\"${r.link||'https://t.me/Bekmedia_smmbot'}\" target=\"_blank\" class=\"bot-link-btn\">\n              \u2708\ufe0f Telegram botni ulash\n            </a>\n          </div>\n          <div class=\"bot-qr\">\n            <div class=\"bot-qr-icon\">\ud83e\udd16</div>\n            <div class=\"bot-qr-name\">@Bekmedia_smmbot</div>\n          </div>\n        </div>\n        <div style=\"margin-top:16px;background:#f0fdf4;border:1px solid #bbf7d0;border-radius:9px;padding:12px;font-size:13px\">\n          ${currentUser.dest_chat_id ? `\u2705 <strong>Ulangan!</strong> Chat ID: ${currentUser.dest_chat_id}` : `\u26a0\ufe0f Hali ulanmagan. Yuqoridagi tugmani bosing.`}\n        </div>\n        <div style=\"margin-top:14px;font-size:13px;color:var(--gray)\">\n          <strong>Guruh uchun:</strong> Botni guruhga admin qilib qo'shing, keyin guruh chat ID sini <a onclick=\"loadView('c-dest')\" style=\"color:var(--blue);cursor:pointer\">Yetkazish joyi</a> da kiriting.\n        </div>\n      </div>\n    </div>`;\n}\n\n// \u2500\u2500\u2500 API HELPER \u2500\u2500\u2500\nasync function api(url, opts={}){\n  const token=localStorage.getItem('bm_token');\n  const isAdmin=localStorage.getItem('bm_admin')==='1';\n  const headers={'Content-Type':'application/json'};\n  if(isAdmin) headers.Authorization='Bearer '+token;\n  else if(token) headers.Authorization='Bearer '+token;\n  const r=await fetch(url,{...opts,headers,body:opts.body?JSON.stringify(opts.body):undefined});\n  return r.json().catch(()=>({ok:false}));\n}\n\nfunction exportLeads(){ toast('CSV yuklanmoqda...','ok'); }\nfunction exportMyLeads(){ toast('CSV yuklanmoqda...','ok'); }\n\n// \u2500\u2500\u2500 BOOT \u2500\u2500\u2500\nboot();\n</script>\n</body>\n</html>\n";
app.get('*',(req,res)=>{res.setHeader('Content-Type','text/html;charset=utf-8');res.send(_HTML);});

app.listen(CFG.PORT,()=>console.log('BekMedia ishga tushdi: http://localhost:'+CFG.PORT));
