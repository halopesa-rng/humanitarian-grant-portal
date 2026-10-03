require("dotenv").config();
const express = require("express");
const cors = require("cors");
const path = require("path");
const { Pool } = require("pg");

const app = express();
const port = process.env.PORT || 3000;
const pool = process.env.DATABASE_URL ? new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL.includes("localhost") ? false : { rejectUnauthorized: false }
}) : null;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

function reference() {
  return "WHF-" + new Date().getFullYear() + "-" +
    Math.random().toString(36).slice(2, 8).toUpperCase();
}

async function telegram(text, buttons) {
  if (!process.env.TELEGRAM_BOT_TOKEN || !process.env.TELEGRAM_ADMIN_CHAT_ID) return;
  const body = {
    chat_id: process.env.TELEGRAM_ADMIN_CHAT_ID,
    text,
    parse_mode: "HTML",
    ...(buttons ? {reply_markup: {inline_keyboard: buttons}} : {})
  };
  await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: "POST", headers: {"Content-Type": "application/json"}, body: JSON.stringify(body)
  });
}

app.post("/api/applications", async (req, res) => {
  if (!pool) return res.status(503).json({error:"DATABASE_URL is not configured."});
  const {full_name, age, phone, country, location, occupation, zone, purpose, participated_before} = req.body;
  if (!full_name || !age || !phone || !country || !location || !occupation || !purpose)
    return res.status(400).json({error:"Please complete all required fields."});

  const ref = reference();
  const result = await pool.query(
    `INSERT INTO applications
    (reference,full_name,age,phone,country,location,occupation,zone,purpose,participated_before)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
    [ref, full_name, age, phone, country, location, occupation, zone || null, purpose, !!participated_before]
  );
  const a = result.rows[0];

  await telegram(
    `🆕 <b>NEW HUMANITARIAN APPLICATION</b>\n\nReference: <b>${a.reference}</b>\nName: ${a.full_name}\nAge: ${a.age}\nPhone: ${a.phone}\nCountry: ${a.country}\nLocation: ${a.location}\nOccupation: ${a.occupation}\nPurpose: ${a.purpose}`,
    [[
      {text:"✅ APPROVE", callback_data:`approve:${a.id}`},
      {text:"❌ REJECT", callback_data:`reject:${a.id}`}
    ]]
  );

  res.json({reference: a.reference, status: a.status});
});

app.get("/api/applications/:reference", async (req,res) => {
  if (!pool) return res.status(503).json({error:"DATABASE_URL is not configured."});
  const r = await pool.query("SELECT reference,status,created_at FROM applications WHERE reference=$1", [req.params.reference]);
  if (!r.rows.length) return res.status(404).json({error:"Application not found."});
  res.json(r.rows[0]);
});

app.post("/api/payments", async (req,res) => {
  if (!pool) return res.status(503).json({error:"DATABASE_URL is not configured."});
  const {reference, method, transaction_reference, amount} = req.body;
  const a = await pool.query("SELECT id FROM applications WHERE reference=$1", [reference]);
  if (!a.rows.length) return res.status(404).json({error:"Application not found."});
  if (!["MTN","AIRTEL"].includes(method)) return res.status(400).json({error:"Unsupported payment method."});
  await pool.query(
    `INSERT INTO payments(application_id,method,transaction_reference,amount)
     VALUES($1,$2,$3,$4)`,
    [a.rows[0].id, method, transaction_reference, amount || null]
  );
  res.json({message:"Payment reference submitted for verification."});
});

/* Telegram webhook.
   Set TELEGRAM_WEBHOOK_URL to https://YOUR-DOMAIN/telegram/webhook.
   This endpoint intentionally does not verify payments or grant eligibility automatically. */
app.post("/telegram/webhook", async (req,res) => {
  const q = req.body.callback_query;
  if (!q || !pool) return res.sendStatus(200);
  const [action,id] = (q.data || "").split(":");
  if (!["approve","reject"].includes(action)) return res.sendStatus(200);
  const status = action === "approve" ? "APPROVED" : "REJECTED";
  await pool.query("UPDATE applications SET status=$1, reviewed_at=NOW() WHERE id=$2", [status,id]);
  await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/answerCallbackQuery`, {
    method:"POST", headers:{"Content-Type":"application/json"},
    body:JSON.stringify({callback_query_id:q.id,text:`Application ${status.toLowerCase()}.`})
  });
  res.sendStatus(200);
});

app.get("*", (_,res) => res.sendFile(path.join(__dirname,"public","index.html")));
app.listen(port, () => console.log(`Server running on port ${port}`));
