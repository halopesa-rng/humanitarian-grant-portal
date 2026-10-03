require("dotenv").config();

const express = require("express");
const cors = require("cors");
const path = require("path");
const crypto = require("crypto");
const { Pool } = require("pg");

const app = express();
const PORT = process.env.PORT || 10000;

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is not configured.");
  process.exit(1);
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL.includes("localhost")
    ? false
    : { rejectUnauthorized: false }
});

app.use(cors());
app.use(express.json({ limit: "200kb" }));
app.use(express.urlencoded({ extended: true, limit: "200kb" }));
app.use(express.static(path.join(__dirname, "public")));

async function initDatabase() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS applications (
      id SERIAL PRIMARY KEY,
      reference VARCHAR(32) UNIQUE NOT NULL,
      full_name VARCHAR(160) NOT NULL,
      age INTEGER NOT NULL CHECK (age >= 18 AND age <= 120),
      phone VARCHAR(40) NOT NULL,
      country VARCHAR(100) NOT NULL,
      location VARCHAR(160) NOT NULL,
      occupation VARCHAR(120) NOT NULL,
      zone VARCHAR(120),
      purpose VARCHAR(80) NOT NULL,
      participated_before BOOLEAN NOT NULL DEFAULT FALSE,
      status VARCHAR(30) NOT NULL DEFAULT 'PENDING',
      admin_contact_number VARCHAR(40),
      admin_message TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      reviewed_at TIMESTAMPTZ
    );

    CREATE TABLE IF NOT EXISTS payments (
      id SERIAL PRIMARY KEY,
      application_id INTEGER REFERENCES applications(id) ON DELETE CASCADE,
      method VARCHAR(20) NOT NULL,
      transaction_reference VARCHAR(120),
      payment_statement TEXT,
      amount NUMERIC(12,2),
      status VARCHAR(30) NOT NULL DEFAULT 'PENDING',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      verified_at TIMESTAMPTZ
    );

    ALTER TABLE applications ADD COLUMN IF NOT EXISTS admin_contact_number VARCHAR(40);
    ALTER TABLE applications ADD COLUMN IF NOT EXISTS admin_message TEXT;
    ALTER TABLE payments ADD COLUMN IF NOT EXISTS payment_statement TEXT;
    ALTER TABLE payments ADD COLUMN IF NOT EXISTS verified_at TIMESTAMPTZ;

    CREATE INDEX IF NOT EXISTS idx_applications_reference ON applications(reference);
    CREATE INDEX IF NOT EXISTS idx_applications_status ON applications(status);
    CREATE INDEX IF NOT EXISTS idx_payments_application ON payments(application_id);
  `);

  console.log("Database tables ready.");
}

function makeReference() {
  return `WHF-${new Date().getFullYear()}-${crypto
    .randomBytes(3)
    .toString("hex")
    .toUpperCase()}`;
}

function constantTimeEqual(a, b) {
  if (!a || !b) return false;
  const aa = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  return aa.length === bb.length && crypto.timingSafeEqual(aa, bb);
}

async function telegram(method, payload) {
  if (!process.env.TELEGRAM_BOT_TOKEN) return null;

  const response = await fetch(
    `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/${method}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    }
  );

  if (!response.ok) {
    console.error("Telegram API error:", await response.text());
  }

  return response;
}

async function setTelegramWebhook() {
  if (!process.env.TELEGRAM_BOT_TOKEN || !process.env.TELEGRAM_WEBHOOK_URL) {
    console.log("Telegram webhook not configured.");
    return;
  }

  const payload = {
    url: process.env.TELEGRAM_WEBHOOK_URL
  };

  if (process.env.TELEGRAM_WEBHOOK_SECRET) {
    payload.secret_token = process.env.TELEGRAM_WEBHOOK_SECRET;
  }

  try {
    const response = await telegram("setWebhook", payload);
    if (response && response.ok) {
      console.log("Telegram webhook configured.");
    }
  } catch (error) {
    console.error("Telegram webhook setup failed:", error.message);
  }
}

function requireAdmin(req, res, next) {
  if (!constantTimeEqual(req.get("x-admin-key"), process.env.ADMIN_KEY)) {
    return res.status(401).json({ error: "Unauthorized." });
  }
  next();
}

app.get("/health", async (_req, res) => {
  try {
    await pool.query("SELECT 1");
    res.json({ status: "OK", database: "CONNECTED" });
  } catch {
    res.status(500).json({ status: "ERROR", database: "NOT CONNECTED" });
  }
});

app.get("/api/config", (_req, res) => {
  res.json({
    paymentMethods: ["MTN", "AIRTEL"],
    mtnNumber: process.env.MTN_PAYMENT_NUMBER || "",
    airtelNumber: process.env.AIRTEL_PAYMENT_NUMBER || ""
  });
});

app.post("/api/applications", async (req, res) => {
  try {
    const {
      full_name, age, phone, country, location,
      occupation, zone, purpose, participated_before
    } = req.body;

    if (!full_name || !age || !phone || !country ||
        !location || !occupation || !purpose) {
      return res.status(400).json({
        error: "Please complete all required fields."
      });
    }

    const reference = makeReference();

    const result = await pool.query(
      `INSERT INTO applications
      (reference,full_name,age,phone,country,location,occupation,zone,purpose,participated_before)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
      RETURNING *`,
      [
        reference,
        String(full_name).trim(),
        Number(age),
        String(phone).trim(),
        String(country).trim(),
        String(location).trim(),
        String(occupation).trim(),
        zone ? String(zone).trim() : null,
        String(purpose).trim(),
        participated_before === true || participated_before === "true"
      ]
    );

    const a = result.rows[0];

    await telegram("sendMessage", {
      chat_id: process.env.TELEGRAM_ADMIN_CHAT_ID,
      text:
`🆕 <b>NEW APPLICATION</b>

Reference: <b>${a.reference}</b>
Name: ${a.full_name}
Age: ${a.age}
Phone: ${a.phone}
Country: ${a.country}
Location: ${a.location}
Occupation: ${a.occupation}
Purpose: ${a.purpose}

Status: PENDING`,
      parse_mode: "HTML",
      reply_markup: {
        inline_keyboard: [[
          { text: "✅ APPROVE", callback_data: `approve:${a.id}` },
          { text: "❌ REJECT", callback_data: `reject:${a.id}` }
        ]]
      }
    });

    res.json({
      success: true,
      reference: a.reference,
      status: a.status
    });
  } catch (error) {
    console.error("APPLICATION ERROR:", error);
    res.status(500).json({
      error: "Unable to submit application."
    });
  }
});

app.get("/api/applications/:reference", async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT reference,status,created_at,admin_contact_number,admin_message
       FROM applications WHERE reference=$1`,
      [req.params.reference.trim()]
    );

    if (!result.rows.length) {
      return res.status(404).json({
        error: "Application not found."
      });
    }

    res.json(result.rows[0]);
  } catch (error) {
    console.error("STATUS ERROR:", error);
    res.status(500).json({
      error: "Unable to check application status."
    });
  }
});

/*
  Customer payment statement.
  This is for a legitimate, disclosed payment process only.
  Automatic provider verification should be connected to the official
  MTN/Airtel API for the operating country.
*/
app.post("/api/payments", async (req, res) => {
  try {
    const {
      reference,
      method,
      transaction_reference,
      payment_statement,
      amount
    } = req.body;

    if (!reference || !method || !payment_statement) {
      return res.status(400).json({
        error: "Reference, payment method and payment statement are required."
      });
    }

    if (!["MTN", "AIRTEL"].includes(method)) {
      return res.status(400).json({
        error: "Unsupported payment method."
      });
    }

    const application = await pool.query(
      `SELECT id FROM applications WHERE reference=$1`,
      [String(reference).trim()]
    );

    if (!application.rows.length) {
      return res.status(404).json({
        error: "Application not found."
      });
    }

    await pool.query(
      `INSERT INTO payments
      (application_id,method,transaction_reference,payment_statement,amount)
      VALUES($1,$2,$3,$4,$5)`,
      [
        application.rows[0].id,
        method,
        transaction_reference ? String(transaction_reference).trim() : null,
        String(payment_statement).trim(),
        amount || null
      ]
    );

    res.json({
      success: true,
      status: "PENDING",
      message: "Payment statement submitted for administrator verification."
    });
  } catch (error) {
    console.error("PAYMENT ERROR:", error);
    res.status(500).json({
      error: "Unable to submit payment statement."
    });
  }
});

/* Admin: applications */
app.get("/api/admin/applications", requireAdmin, async (_req, res) => {
  const result = await pool.query(
    `SELECT id,reference,full_name,age,phone,country,location,
            occupation,purpose,status,admin_contact_number,admin_message,created_at
     FROM applications
     ORDER BY created_at DESC LIMIT 300`
  );
  res.json(result.rows);
});

/* Admin: payments awaiting verification */
app.get("/api/admin/payments", requireAdmin, async (_req, res) => {
  const result = await pool.query(
    `SELECT p.id,p.method,p.transaction_reference,p.payment_statement,
            p.amount,p.status,p.created_at,
            a.reference,a.full_name,a.phone
     FROM payments p
     JOIN applications a ON a.id=p.application_id
     ORDER BY p.created_at DESC LIMIT 300`
  );
  res.json(result.rows);
});

/* Admin: update application status/contact number/message */
app.post("/api/admin/applications/:id/update", requireAdmin, async (req, res) => {
  try {
    const { status, contact_number, message } = req.body;
    const allowed = ["PENDING", "APPROVED", "REJECTED", "NEEDS_REVIEW"];

    if (!allowed.includes(status)) {
      return res.status(400).json({ error: "Invalid status." });
    }

    const result = await pool.query(
      `UPDATE applications
       SET status=$1,
           admin_contact_number=$2,
           admin_message=$3,
           reviewed_at=CASE WHEN $1 IN ('APPROVED','REJECTED') THEN NOW() ELSE reviewed_at END
       WHERE id=$4
       RETURNING reference,status,admin_contact_number,admin_message`,
      [
        status,
        contact_number ? String(contact_number).trim() : null,
        message ? String(message).trim() : null,
        req.params.id
      ]
    );

    if (!result.rows.length) {
      return res.status(404).json({ error: "Application not found." });
    }

    res.json(result.rows[0]);
  } catch (error) {
    console.error("ADMIN UPDATE ERROR:", error);
    res.status(500).json({ error: "Unable to update application." });
  }
});

/* Admin: verify/reject a submitted payment statement */
app.post("/api/admin/payments/:id/status", requireAdmin, async (req, res) => {
  const allowed = ["PENDING", "VERIFIED", "REJECTED"];
  const { status } = req.body;

  if (!allowed.includes(status)) {
    return res.status(400).json({ error: "Invalid payment status." });
  }

  const result = await pool.query(
    `UPDATE payments
     SET status=$1,
         verified_at=CASE WHEN $1 IN ('VERIFIED','REJECTED') THEN NOW() ELSE verified_at END
     WHERE id=$2
     RETURNING id,status`,
    [status, req.params.id]
  );

  if (!result.rows.length) {
    return res.status(404).json({ error: "Payment not found." });
  }

  res.json(result.rows[0]);
});

/*
  Telegram webhook.
  Render automatically registers this webhook at startup when
  TELEGRAM_WEBHOOK_URL and TELEGRAM_BOT_TOKEN are configured.
*/
app.post("/telegram/webhook", async (req, res) => {
  try {
    if (process.env.TELEGRAM_WEBHOOK_SECRET) {
      const incoming = req.get("x-telegram-bot-api-secret-token");
      if (!constantTimeEqual(incoming, process.env.TELEGRAM_WEBHOOK_SECRET)) {
        return res.sendStatus(403);
      }
    }

    const callback = req.body.callback_query;

    if (!callback) {
      return res.sendStatus(200);
    }

    const [action, id] = String(callback.data || "").split(":");

    if (!["approve", "reject"].includes(action) || !id) {
      return res.sendStatus(200);
    }

    const status = action === "approve" ? "APPROVED" : "REJECTED";

    const result = await pool.query(
      `UPDATE applications
       SET status=$1, reviewed_at=NOW()
       WHERE id=$2
       RETURNING reference,status`,
      [status, id]
    );

    await telegram("answerCallbackQuery", {
      callback_query_id: callback.id,
      text: `Application ${status.toLowerCase()}.`
    });

    if (result.rows.length && callback.message) {
      await telegram("editMessageText", {
        chat_id: callback.message.chat.id,
        message_id: callback.message.message_id,
        text: `${callback.message.text || ""}\n\n<b>REVIEWED: ${status}</b>`,
        parse_mode: "HTML"
      });
    }

    res.sendStatus(200);
  } catch (error) {
    console.error("TELEGRAM WEBHOOK ERROR:", error);
    res.sendStatus(500);
  }
});

app.get("/admin", (_req, res) => {
  res.sendFile(path.join(__dirname, "public", "admin.html"));
});

app.get("*", (_req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

async function start() {
  try {
    await initDatabase();
    app.listen(PORT, async () => {
      console.log(`Server running on port ${PORT}`);
      await setTelegramWebhook();
    });
  } catch (error) {
    console.error("STARTUP DATABASE ERROR:", error);
    process.exit(1);
  }
}

start();
