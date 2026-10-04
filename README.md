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

## v1.5 UI
Modern branded 5-step flow: details → funding → MTN/Airtel → payment statement → submitted. Payment statement is a separate page after provider selection. Existing Telegram webhook/database endpoints are retained.

## v1.6 payment submission fix
Fixed optional Amount handling. An empty Amount field is now stored as SQL NULL instead of an empty string, preventing PostgreSQL numeric conversion errors. Transaction/reference is also normalized safely.

## v1.7 payment instructions
Only the customer-facing payment instructions were updated. Existing application, database, payment submission, Telegram and backend logic are unchanged from v1.6. The payment page now clearly shows +254 705 300 161 and instructs customers to paste the complete confirmation message.
