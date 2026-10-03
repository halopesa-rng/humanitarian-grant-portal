# Humanitarian Grant Portal

## Render
Build command: `npm install`
Start command: `npm start`

Set these Environment Variables in Render:
- `PORT=10000`
- `DATABASE_URL=<Render PostgreSQL Internal Database URL>`
- `TELEGRAM_BOT_TOKEN=<Telegram bot token>`
- `TELEGRAM_ADMIN_CHAT_ID=<admin chat ID>`
- `ADMIN_KEY=<strong random secret>`
- `MTN_PAYMENT_NUMBER=<verified organization number if applicable>`
- `AIRTEL_PAYMENT_NUMBER=<verified organization number if applicable>`

The server automatically creates the PostgreSQL tables on startup, fixing the
`relation "applications" does not exist` error.

Test:
`https://YOUR-RENDER-DOMAIN/health`

Expected:
`{"status":"OK","database":"CONNECTED"}`

Telegram webhook:
`https://YOUR-RENDER-DOMAIN/telegram/webhook`

Never commit `.env`, database passwords, or Telegram tokens to GitHub.

Payment transaction references are stored as PENDING. Automatic MTN/Airtel
verification requires the official provider API for the operating country.
