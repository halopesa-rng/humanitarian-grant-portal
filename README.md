# Humanitarian Grant Portal — Admin Portal Upgrade

## Customer flow
The existing customer application, funding selection, payment statement submission, Telegram notifications, and status lookup are preserved.

## Super admin + multiple admin portal
The Telegram bot now has a **Super Admin** layer.

### Super admin environment variables
Add:
- `SUPER_ADMIN_TELEGRAM_ID` — your personal Telegram numeric user ID.
- `SUPER_ADMIN_NAME` — optional, defaults to `Super Admin`.
- `ADMIN_PORTAL_URL` — optional, e.g. `https://your-domain.onrender.com/admin`.

The existing variables remain:
- `DATABASE_URL`
- `TELEGRAM_BOT_TOKEN`
- `TELEGRAM_ADMIN_CHAT_ID`
- `TELEGRAM_WEBHOOK_URL=https://YOUR-RENDER-DOMAIN/telegram/webhook`
- `TELEGRAM_WEBHOOK_SECRET`

### Super admin Telegram commands
- `/myid` — show your Telegram ID.
- `/adminlink John Doe` — create a new admin and receive a private portal link.
- `/admins` — list all admins and access status.
- `/revoke 2` — revoke admin ID 2.
- `/portal` — show the admin portal address.
- `/help` — show commands.

Only `SUPER_ADMIN_TELEGRAM_ID` can run these management commands and use Telegram approval buttons.

### Admin portal
A new admin receives a private link like:
`https://your-domain.onrender.com/admin?token=...`

Opening the link creates a secure browser session and removes the token from the visible URL. The admin can then:
- view applications;
- view payment statements;
- approve/reject applications;
- verify/reject payments;
- assign an active contact number;
- refresh the dashboard.

The same database workflow is used by Telegram and the portal. If one admin already approves/rejects an item, another admin cannot overwrite the completed decision.

The Super Admin can create and revoke multiple portal admins. Portal actions are also reported to the Telegram admin chat for audit visibility.

## Render
Build command: `npm install`
Start command: `npm start`

After deployment, open `/health` and confirm database is CONNECTED.
