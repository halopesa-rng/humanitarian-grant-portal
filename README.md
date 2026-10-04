# World Humanitarian Foundation Portal

This build includes:
- Working Telegram webhook commands and approval/rejection callback buttons.
- Super Admin controls in Telegram: /myid, /adminlink NAME, /customerlink ID, /admins, /revoke ID.
- Separate admin portal links and customer application links.
- Customer isolation: each admin sees only applications submitted through their customer link.
- Application and payment approve/reject/verify controls in the admin portal.
- Customer status page with an approval celebration page and a rejection page.
- Existing payment statement workflow preserved.

Required Render environment variables:
DATABASE_URL
TELEGRAM_BOT_TOKEN
TELEGRAM_ADMIN_CHAT_ID
TELEGRAM_WEBHOOK_URL=https://YOUR-DOMAIN/telegram/webhook
TELEGRAM_WEBHOOK_SECRET=your-private-webhook-secret
SUPER_ADMIN_TELEGRAM_ID=your-numeric-telegram-user-id
ADMIN_PORTAL_URL=https://YOUR-DOMAIN/admin

Existing payment variables should be retained if already configured:
MTN_PAYMENT_NUMBER
AIRTEL_PAYMENT_NUMBER
CUSTOMER_CONTACT_NUMBER

After deployment:
1. Send /myid to the bot.
2. Put that numeric ID in SUPER_ADMIN_TELEGRAM_ID and redeploy.
3. Send /start to the bot.
4. Send /adminlink Admin Name.
5. Give the generated Admin Portal link to that admin.
6. Give the generated Customer Application link to that admin's customers.

Do not share admin portal links publicly.
