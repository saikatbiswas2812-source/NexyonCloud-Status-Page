# NexyonCloud Status Page

A self-hosted public service-status page for NexyonCloud, with an admin control panel, automatic HTTP/HTTPS monitoring, uptime history, incidents and optional Discord webhook alerts.

## Included
- Responsive cyan/white dark dashboard
- Public service status and incident timeline
- Admin area protected by HTTP Basic Authentication
- Add, edit, delete and manually set service status
- Periodic HTTP health checks with timeout
- Automatic outage/recovery incident records and Discord webhook alerts
- Response time and 24-hour / 7-day / 30-day uptime statistics
- SQLite persistence and health endpoint
- PM2 and Nginx deployment examples

## Requirements
Ubuntu 22.04/24.04, Node.js 20+, npm and a domain name for HTTPS production deployment.

## Quick install
```bash
git clone https://github.com/saikatbiswas2812-source/NexyonCloud-Status-Page.git
cd NexyonCloud-Status-Page
npm install
cp .env.example .env
nano .env
npm start
``

Set a long, unique `ADMIN_PASSWORD` in `.env` before exposing the server. The admin panel is at `/admin`; the browser will ask for the username and password. Public page: `/`. API: `/api/status`. Health check: `/health`.

## Configure service monitoring
The five starter services are created automatically: Free Panel, Paid Panel, VPS Control Panel, Website and Billing Panel. Open Admin and set each service's public health-check URL. Use a URL that returns HTTP 2xx or 3xx when healthy. Checks run every `CHECK_INTERVAL_SECONDS` (minimum 30 seconds) and time out after `CHECK_TIMEOUT_MS`. A URL-less service is manual-only and is clearly marked as not monitored.

Uptime percentages are calculated from recorded checks; the 7-day and 30-day figures need time to accumulate. The monitor verifies HTTP reachability only. It does not log in to your hosting panels or validate their internal functions. Prefer dedicated `/health` endpoints where available.

## Discord alerts
Create a Discord webhook for the channel where status alerts should appear and set `DISCORD_WEBHOOK_URL` in `.env`. Keep the webhook secret; never publish it in GitHub.

## Run continuously with PM2
```bash
sudo npm install -g pm2
pm2 start ecosystem.config.js
pm2 save
pm2 startup
``
Run the extra command printed by `pm2 startup`. Logs: `pm2 logs nexyoncloud-status`.

## Nginx + HTTPS
1. Point your domain's DNS A record to the VPS IP.
2. Install Nginx and Certbot.
3. Copy `nginx.conf.example` into `/etc/nginx/sites-available/nexyoncloud-status`, replace `status.example.com` with your domain.
4. Enable the site, test Nginx, then issue a Let's Encrypt certificate with Certbot.
5. Allow inbound 80/443 and keep app port 3000 private to localhost.

```bash
sudo apt update && sudo apt install -y nginx certbot python3-certbot-nginx
sudo ln -s /etc/nginx/sites-available/nexyoncloud-status /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
sudo certbot --nginx -d status.example.com
``

## Security and operations
- Use a strong unique admin password and HTTPS.
- Do not expose port 3000 publicly once Nginx is configured; bind/restrict it to localhost using firewall rules.
- Keep `.env`, `status.db`, and backups private.
- Back up the SQLite database regularly.
- Only monitor public URLs you own or are authorized to check.
- The application rejects obvious local/private monitor targets, but should still be deployed behind a firewall and kept updated.

## Backup
```bash
mkdir -p backups
sqlite3 status.db ".backup 'backups/status-$(date +%F).db'"
``

## Troubleshooting
- Check app logs: `pm2 logs nexyoncloud-status`
- Check process: `pm2 status`
- Check health locally: `curl http://127.0.0.1:3000/health`
- If SQLite native module fails to install, run `sudo apt install -y build-essential python3` then `npm install` again.
