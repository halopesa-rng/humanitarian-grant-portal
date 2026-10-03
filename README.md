# Humanitarian Grant Portal v1.3
Adds customer funding selection and strengthens Telegram application delivery.

Funding options: ZMW 18,000; ZMW 25,000; ZMW 28,000; ZMW 30,000; ZMW 35,000.

Render:
Build: npm install
Start: npm start

Required:
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

The server automatically upgrades the PostgreSQL schema and registers the Telegram webhook.
Check /health after deployment.
