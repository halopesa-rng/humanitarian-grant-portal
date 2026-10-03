# Humanitarian Grant Application Portal

## Run locally
1. Install Node.js 20+.
2. Copy `.env.example` to `.env` and fill in `DATABASE_URL`.
3. Create a PostgreSQL database and run `schema.sql`.
4. Run `npm install`.
5. Run `npm start`.
6. Open http://localhost:3000

## Telegram
Create a bot with BotFather, set `TELEGRAM_BOT_TOKEN` and `TELEGRAM_ADMIN_CHAT_ID`.
Set Telegram's webhook to:
`https://YOUR-DOMAIN/telegram/webhook`

The included webhook supports application approval/rejection. It does not automatically promise or release funds.

## Payments
MTN/Airtel transaction references are stored as PENDING. Production API verification must be connected to the official provider API for the country where the organization operates. Do not publish payment numbers until they have been verified as belonging to the legitimate organization.
