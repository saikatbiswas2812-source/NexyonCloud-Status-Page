# NexyonCloud Status Page

A public, responsive service-status dashboard with an admin area, incident history, SQLite storage, and optional Discord webhook notifications.

## Requirements
- Node.js 20+
- npm

## Setup
1. Clone this repository.
2. Run `npm install`.
3. Copy `.env.example` to `.env`.
4. Set a strong `ADMIN_PASSWORD` and optional `DISCORD_WEBHOOK_URL`.
5. Run `npm start`.
6. Open `http://localhost:3000`.

## Admin
Open `/admin`. The browser will request HTTP Basic Authentication. Use the values in `.env` (`ADMIN_USER` and `ADMIN_PASSWORD`). Change the default password before exposing the app publicly.

## Status values
- `operational`
- `degraded`
- `outage`
- `maintenance`

## Notes
The public dashboard refreshes every 30 seconds. Service status is managed manually in the admin area; this version does not probe external panel URLs automatically. Incident updates and status changes are sent to the configured Discord webhook.
