# Humanitarian Grant Portal v1.4

## New interface
The application is now a four-step landing-page flow:
1. Applicant details
2. Requested funding selection
3. MTN/Airtel payment-method selection
4. Submission/waiting page with reference and status lookup

## Preserved
- PostgreSQL database
- Automatic database-column upgrades
- Telegram notifications
- Telegram webhook registration
- Approve / Reject application buttons
- Payment information notification and verification buttons
- Application status lookup
- Administrator contact number field/API

## Render
Build command: `npm install`
Start command: `npm start`

Required environment:
DATABASE_URL
TELEGRAM_BOT_TOKEN
TELEGRAM_ADMIN_CHAT_ID
TELEGRAM_WEBHOOK_URL=https://YOUR-RENDER-DOMAIN/telegram/webhook
TELEGRAM_WEBHOOK_SECRET
ADMIN_KEY

Optional:
CUSTOMER_CONTACT_NUMBER
MTN_PAYMENT_NUMBER
AIRTEL_PAYMENT_NUMBER

After deployment, open `/health` and confirm database is CONNECTED.

The portal treats funding as subject to eligibility and official review. Do not represent a payment as a guarantee of receiving humanitarian funding.
