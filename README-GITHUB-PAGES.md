# NexyonCloud Status Page — GitHub-hosted mode

This edition runs the public website on GitHub Pages and scheduled checks with GitHub Actions. No VPS is needed.

## Enable GitHub Pages
1. Open repository Settings → Pages.
2. Under Build and deployment, choose **GitHub Actions** as the source.
3. Open Settings → Actions → General → Workflow permissions and enable read/write permissions for workflows (the monitor workflow also declares contents: write).
4. Ensure the default branch is `main`.
5. Open Actions and run **Deploy status page** once, or push a change to the page files.
6. The public URL appears in Settings → Pages and in the Pages workflow deployment.

## Enable monitoring
- Add each service's public health-check URL in Admin → Service settings.
- Use URLs returning HTTP 2xx/3xx on healthy state. Checks run on a five-minute schedule; GitHub may delay scheduled workflows during high load.
- A blank URL means not monitored; status remains unknown/manual.
- GitHub Actions writes uptime samples and incident changes to `data/status.json`.
- Add repository secret `DISCORD_WEBHOOK_URL` under Settings → Secrets and variables → Actions for outage/recovery alerts.

## Admin console
Open `/admin.html` on the Pages website. Create a GitHub fine-grained personal access token restricted to this repository with:
- Contents: Read and write
- Actions: Read and write
- Metadata: Read-only

Paste it into the admin console. The token is held only in page memory and is not saved to local storage. Do not paste it into any public file or share it. Revoke it when finished. The console updates `config/services.json`, can dispatch the monitor workflow, and can publish incidents.

## Limitations
- GitHub Pages is static hosting; it does not run the Express/SQLite server.
- GitHub scheduled workflows are not guaranteed exact-time monitoring and are usually no more frequent than every five minutes.
- Status history is committed to the repository; do not store secrets or private URLs in the public JSON configuration.
- This GitHub Pages version and the Express/VPS version are separate deployment modes. The VPS can be added later for more frequent checks, private configuration, and persistent database storage.
