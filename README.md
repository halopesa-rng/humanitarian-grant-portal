# Humanitarian Grant Portal v1.2

## What was fixed
- Telegram approval/rejection buttons now use a production webhook.
- Render automatically registers the Telegram webhook at startup when configured.
- Optional Telegram webhook secret validation is supported.
- Customer payment section now includes a large space to paste a payment statement/SMS confirmation.
- Admin dashboard shows submitted payment statements and allows VERIFIED/REJECTED.
- Admin can enter the number the customer should contact plus a message.
- Customer status page displays the administrator contact number/message.
- Database migrations automatically add the new columns on startup.

## Render
Build command:
`npm install`

Start command:
`npm start`

## Environment variables
Set these in Render:
- `PORT=10000`
- `DATABASE_URL=<Render PostgreSQL Internal Database URL>`
- `TELEGRAM_BOT_TOKEN=<Telegram bot token>`
- `TELEGRAM_ADMIN_CHAT_ID=<Telegram admin chat ID>`
- `TELEGRAM_WEBHOOK_URL=https://YOUR-RENDER-DOMAIN/telegram/webhook`
- `TELEGRAM_WEBHOOK_SECRET=<random secret>`
- `ADMIN_KEY=<strong random admin secret>`
- `MTN_PAYMENT_NUMBER=<verified organization payment number if applicable>`
- `AIRTEL_PAYMENT_NUMBER=<verified organization payment number if applicable>`

## Telegram approval buttons
After deployment, the server calls Telegram `setWebhook` automatically.
Check Render logs for:
`Telegram webhook configured.`

Test:
1. Submit an application.
2. Open the Telegram admin chat.
3. Tap APPROVE or REJECT.
4. The button should respond and the application status should change.
5. The Telegram message will be marked as REVIEWED.

If the button still does not respond, open:
`https://YOUR-RENDER-DOMAIN/health`
and check Render logs for Telegram webhook errors.

## Admin dashboard
Open:
`https://YOUR-RENDER-DOMAIN/admin`

Enter the `ADMIN_KEY`.

Admin can:
- approve/reject applications
- set a customer contact number
- write a customer message
- view payment statements
- verify/reject payment submissions

## Payment statement
Customers can paste the payment confirmation/SMS into the payment statement box. It is stored in PostgreSQL and displayed to the administrator.

Automatic MTN/Airtel verification requires the official provider API for the country where the organization operates. Do not invent or publish payment numbers.

## Security
Never commit `.env`, database passwords, Telegram bot tokens, or ADMIN_KEY to GitHub.
