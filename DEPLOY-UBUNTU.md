# Ubuntu VPS deployment

These steps assume a fresh Ubuntu 22.04/24.04 VPS and a domain pointed to its public IPv4 address.

## 1. Install runtime
```bash
sudo apt update
sudo apt install -y curl git build-essential python3 nginx
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs
node -v
npm -v
``

## 2. Download and install
```bash
sudo mkdir -p /opt/nexyoncloud-status
sudo chown "$USER":"$USER" /opt/nexyoncloud-status
git clone https://github.com/saikatbiswas2812-source/NexyonCloud-Status-Page.git /opt/nexyoncloud-status
cd /opt/nexyoncloud-status
npm install
cp .env.example .env
nano .env
``

Set a unique long admin password. Set the Discord webhook if desired. Keep secrets out of GitHub.

## 3. Start with PM2
```bash
sudo npm install -g pm2
pm2 start ecosystem.config.js
pm2 save
pm2 startup
``
Copy and run the additional command printed by PM2. Verify with `pm2 status` and `curl http://127.0.0.1:3000/health`.

## 4. Configure Nginx
Replace the example hostname below with your real domain:
```bash
sudo cp nginx.conf.example /etc/nginx/sites-available/nexyoncloud-status
sudo nano /etc/nginx/sites-available/nexyoncloud-status
sudo ln -s /etc/nginx/sites-available/nexyoncloud-status /etc/nginx/sites-enabled/nexyoncloud-status
sudo nginx -t
sudo systemctl reload nginx
``

## 5. Enable HTTPS
```bash
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d status.YOURDOMAIN.com
``
Use the exact hostname configured in Nginx. Confirm DNS has propagated before running Certbot.

## 6. Firewall
Allow SSH and web traffic. Do not open port 3000 to the public internet when Nginx is proxying to localhost.
```bash
sudo ufw allow OpenSSH
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw enable
sudo ufw status
``

## 7. Finish setup
Open `https://status.YOURDOMAIN.com/admin`, authenticate with the credentials from `.env`, and add each service's public health-check URL. Set a Discord webhook in `.env` and restart with `pm2 restart nexyoncloud-status --update-env`.

## Maintenance
```bash
cd /opt/nexyoncloud-status
pm2 logs nexyoncloud-status
pm2 restart nexyoncloud-status
bash scripts/backup.sh
git pull
npm install
pm2 restart nexyoncloud-status
``

Keep `.env` and `status.db` backed up privately. Do not upload either file to GitHub.
