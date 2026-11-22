# NexyonCloud Status Page

Public cyan/white service-status dashboard with private admin controls, automatic HTTP uptime checks, incident history, response times and optional Discord webhook alerts.

## Requirements
- Ubuntu 22.04/24.04 or another Linux server
- Node.js 20+
- npm
- A public domain with HTTPS recommended for production

## Install
```bash
git clone https://github.com/saikatbiswas2812-source/NexyonCloud-Status-Page.git
cd NexyonCloud-Status-Page
npm install
cp .env.example .env
nano .env
npm start
``

Set a unique long `ADMIN_PASSWORD` before starting. Configure `PORT`, `ADMIN_USER`, `ADMIN_PASSWORD`, `DISCORD_WEBHOOK_URL`, `CHECK_INTERVAL_SECONDS` (minimum 30), and `CHECK_TIMEOUT_MS` as needed.

## Admin and monitoring
- Public dashboard: `http://SERVER_IP:3000/`
- Admin: `http://SERVER_IP:3000/admin` (HTTP Basic Auth; browser prompts for credentials)
- Health endpoint: `/health`
- API: `/api/status`

In Admin, add each service's public HTTP/HTTPS health URL. The monitor performs GET requests on the configured interval. HTTP 2xx and 3xx count as healthy; errors, timeouts and other status codes count as outages. When a monitored service changes from healthy to down or recovers, an incident is recorded and an optional Discord webhook is notified. A service without a URL is not automatically monitored; it can be set manually.

Uptime percentages are calculated from checks stored in SQLite for the last 24 hours, 7 days and 30 days. They become meaningful as checks accumulate. Keep the `status.db` file persistent and backed up.

## Run in background with PM2
```bash
sudo npm install -g pm2
pm2 start app.js --name nexyoncloud-status
pm2 save
pm2 startup
``
Run the command printed by `pm2 startup` to enable boot startup. View logs with `pm2 logs nexyoncloud-status`.

## Production notes
Put the app behind Nginx/Caddy and enable HTTPS before exposing the admin panel. Use a strong unique admin password, restrict admin access by firewall/IP allowlist where possible, keep Node.js updated, and back up `status.db`. Do not use private network URLs as monitor targets. This app checks HTTP endpoints; it does not log into provider dashboards or verify application-specific functionality beyond the configured URL response.

## Default services
Free Panel, Paid Panel, VPS Control Panel, Website and Billing Panel are pre-created. Add the correct public health URL for each from the admin page to activate automatic monitoring.
