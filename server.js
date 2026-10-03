require("dotenv").config();
const express=require("express"),cors=require("cors"),path=require("path"),crypto=require("crypto"),{Pool}=require("pg");
const app=express(),PORT=process.env.PORT||10000;
if(!process.env.DATABASE_URL){console.error("DATABASE_URL is not configured.");process.exit(1)}
const pool=new Pool({connectionString:process.env.DATABASE_URL,ssl:process.env.DATABASE_URL.includes("localhost")?false:{rejectUnauthorized:false}});
app.use(cors());app.use(express.json({limit:"100kb"}));app.use(express.static(path.join(__dirname,"public")));

async function initDatabase(){
 await pool.query(`CREATE TABLE IF NOT EXISTS applications(
 id SERIAL PRIMARY KEY,reference VARCHAR(32) UNIQUE NOT NULL,full_name VARCHAR(160) NOT NULL,
 age INTEGER NOT NULL CHECK(age>=18 AND age<=120),phone VARCHAR(40) NOT NULL,country VARCHAR(100) NOT NULL,
 location VARCHAR(160) NOT NULL,occupation VARCHAR(120) NOT NULL,zone VARCHAR(120),
 purpose VARCHAR(80) NOT NULL,participated_before BOOLEAN NOT NULL DEFAULT FALSE,
 status VARCHAR(30) NOT NULL DEFAULT 'PENDING',created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),reviewed_at TIMESTAMPTZ);
 CREATE TABLE IF NOT EXISTS payments(id SERIAL PRIMARY KEY,application_id INTEGER REFERENCES applications(id) ON DELETE CASCADE,
 method VARCHAR(20) NOT NULL,transaction_reference VARCHAR(120) NOT NULL,amount NUMERIC(12,2),
 status VARCHAR(30) NOT NULL DEFAULT 'PENDING',created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
 CREATE INDEX IF NOT EXISTS idx_app_ref ON applications(reference);
 CREATE INDEX IF NOT EXISTS idx_app_status ON applications(status);`);
 console.log("Database tables ready.");
}
const ref=()=>`WHF-${new Date().getFullYear()}-${crypto.randomBytes(3).toString("hex").toUpperCase()}`;
async function tg(method,payload){
 if(!process.env.TELEGRAM_BOT_TOKEN)return;
 const r=await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/${method}`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(payload)});
 if(!r.ok)console.error("Telegram API:",await r.text());
}
function admin(req,res,next){
 const a=req.get("x-admin-key"),b=process.env.ADMIN_KEY||"";
 if(!a||!b||a!==b)return res.status(401).json({error:"Unauthorized."});next();
}
app.get("/health",async(req,res)=>{try{await pool.query("SELECT 1");res.json({status:"OK",database:"CONNECTED"})}catch(e){res.status(500).json({status:"ERROR",database:"NOT CONNECTED"})}});
app.get("/api/config",(req,res)=>res.json({paymentMethods:["MTN","AIRTEL"],mtnNumber:process.env.MTN_PAYMENT_NUMBER||"",airtelNumber:process.env.AIRTEL_PAYMENT_NUMBER||""}));

app.post("/api/applications",async(req,res)=>{
 try{
  const {full_name,age,phone,country,location,occupation,zone,purpose,participated_before}=req.body;
  if(!full_name||!age||!phone||!country||!location||!occupation||!purpose)return res.status(400).json({error:"Please complete all required fields."});
  const reference=ref(),r=await pool.query(`INSERT INTO applications(reference,full_name,age,phone,country,location,occupation,zone,purpose,participated_before) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
   [reference,String(full_name).trim(),Number(age),String(phone).trim(),String(country).trim(),String(location).trim(),String(occupation).trim(),zone?String(zone).trim():null,String(purpose).trim(),participated_before===true||participated_before==="true"]);
  const a=r.rows[0];
  await tg("sendMessage",{chat_id:process.env.TELEGRAM_ADMIN_CHAT_ID,text:`🆕 <b>NEW APPLICATION</b>\n\nReference: <b>${a.reference}</b>\nName: ${a.full_name}\nAge: ${a.age}\nPhone: ${a.phone}\nCountry: ${a.country}\nLocation: ${a.location}\nOccupation: ${a.occupation}\nPurpose: ${a.purpose}\n\nStatus: PENDING`,parse_mode:"HTML",reply_markup:{inline_keyboard:[[{text:"✅ APPROVE",callback_data:`approve:${a.id}`},{text:"❌ REJECT",callback_data:`reject:${a.id}`}]]}});
  res.json({success:true,reference:a.reference,status:a.status});
 }catch(e){console.error("APPLICATION ERROR:",e);res.status(500).json({error:"Unable to submit application."})}
});
app.get("/api/applications/:reference",async(req,res)=>{try{const r=await pool.query("SELECT reference,status,created_at FROM applications WHERE reference=$1",[req.params.reference.trim()]);if(!r.rows.length)return res.status(404).json({error:"Application not found."});res.json(r.rows[0])}catch(e){res.status(500).json({error:"Unable to check application status."})}});
app.post("/api/payments",async(req,res)=>{try{const{reference,method,transaction_reference,amount}=req.body;if(!reference||!method||!transaction_reference)return res.status(400).json({error:"Reference, method and transaction reference are required."});if(!["MTN","AIRTEL"].includes(method))return res.status(400).json({error:"Unsupported payment method."});const a=await pool.query("SELECT id FROM applications WHERE reference=$1",[reference.trim()]);if(!a.rows.length)return res.status(404).json({error:"Application not found."});await pool.query("INSERT INTO payments(application_id,method,transaction_reference,amount) VALUES($1,$2,$3,$4)",[a.rows[0].id,method,String(transaction_reference).trim(),amount||null]);res.json({success:true,status:"PENDING",message:"Payment reference submitted for verification."})}catch(e){console.error("PAYMENT ERROR:",e);res.status(500).json({error:"Unable to submit payment reference."})}});
app.get("/api/admin/applications",admin,async(req,res)=>{const r=await pool.query("SELECT id,reference,full_name,age,phone,country,location,occupation,purpose,status,created_at FROM applications ORDER BY created_at DESC LIMIT 200");res.json(r.rows)});
app.post("/api/admin/applications/:id/status",admin,async(req,res)=>{const allowed=["PENDING","APPROVED","REJECTED","NEEDS_REVIEW"],{status}=req.body;if(!allowed.includes(status))return res.status(400).json({error:"Invalid status."});const r=await pool.query("UPDATE applications SET status=$1,reviewed_at=NOW() WHERE id=$2 RETURNING reference,status",[status,req.params.id]);if(!r.rows.length)return res.status(404).json({error:"Application not found."});res.json(r.rows[0])});
app.post("/telegram/webhook",async(req,res)=>{try{const q=req.body.callback_query;if(!q)return res.sendStatus(200);const[action,id]=String(q.data||"").split(":");if(!["approve","reject"].includes(action))return res.sendStatus(200);const status=action==="approve"?"APPROVED":"REJECTED";const r=await pool.query("UPDATE applications SET status=$1,reviewed_at=NOW() WHERE id=$2 RETURNING reference,status",[status,id]);await tg("answerCallbackQuery",{callback_query_id:q.id,text:`Application ${status.toLowerCase()}.`});if(r.rows.length)await tg("editMessageReplyMarkup",{chat_id:q.message.chat.id,message_id:q.message.message_id,reply_markup:{inline_keyboard:[]}});res.sendStatus(200)}catch(e){console.error("WEBHOOK ERROR:",e);res.sendStatus(500)}});
app.get("*",(req,res)=>res.sendFile(path.join(__dirname,"public","index.html")));
(async()=>{try{await initDatabase();app.listen(PORT,()=>console.log(`Server running on port ${PORT}`))}catch(e){console.error("STARTUP DATABASE ERROR:",e);process.exit(1)}})();
