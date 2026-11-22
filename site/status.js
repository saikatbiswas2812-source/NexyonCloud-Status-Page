const DATA = "https://raw.githubusercontent.com/saikatbiswas2812-source/NexyonCloud-Status-Page/main/data/status.json";
const labels = {
  operational: "Operational",
  degraded: "Degraded",
  outage: "Major outage",
  maintenance: "Maintenance",
  unknown: "Not monitored"
};
const escapeHtml = value => String(value ?? "").replace(/[&<>"']/g, char => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
})[char]);
const percent = value => value == null ? "—" : Number(value).toFixed(2) + "%";

async function loadStatus() {
  try {
    const response = await fetch(DATA + "?t=" + Date.now(), { cache: "no-store" });
    if (!response.ok) throw new Error("Status file not found");

    const data = await response.json();
    const services = data.services || [];
    const incidents = data.incidents || [];
    const monitored = services.filter(service => service.monitored);
    const updatedAt = data.updatedAt ? new Date(data.updatedAt) : null;
    const stale = !updatedAt || Date.now() - updatedAt.getTime() > 12 * 60 * 1000;

    const down = services.some(service => service.monitored && service.status === "outage");
    const pending = services.some(service => service.monitored && service.status === "unknown");
    const warning = services.some(service =>
      service.monitored && ["degraded", "maintenance", "unknown"].includes(service.status)
    );

    const overall = document.querySelector("#overall");
    overall.className = "overall " + (down ? "outage" : (warning || stale ? "degraded" : ""));
    overall.innerHTML = "<i></i>" + (
      stale ? "Monitoring checks are delayed" :
      down ? "Service disruption detected" :
      pending ? "Waiting for the first health check" :
      warning ? "Some services need attention" :
      monitored.length ? "All monitored services operational" :
      "Monitoring setup in progress"
    );

    document.querySelector("#meta").textContent =
      monitored.length + " of " + services.length + " services monitored · " +
      (services.length - monitored.length) + " not configured · Checks every " +
      (data.checkIntervalMinutes || 5) + " minutes" +
      (stale ? " · Last monitoring update is older than 12 minutes" : "");

    document.querySelector("#services").innerHTML = services.map(service => {
      const displayStatus = stale && service.monitored ? "unknown" : service.status;
      const displayLabel = stale && service.monitored
        ? "Check delayed"
        : service.monitored && displayStatus === "unknown"
          ? "Awaiting first check"
          : (labels[displayStatus] || displayStatus);

      return '<article class="service">' +
        '<div class="service-icon">◈</div>' +
        '<div class="info">' +
          '<h3>' + escapeHtml(service.name) + '</h3>' +
          '<p>' + escapeHtml(service.description) + '</p>' +
          '<div class="stats">' +
            '<span>24h <b>' + percent(service.uptime24h) + '</b></span>' +
            '<span>7d <b>' + percent(service.uptime7d) + '</b></span>' +
            '<span>30d <b>' + percent(service.uptime30d) + '</b></span>' +
            (service.responseMs != null
              ? '<span>Ping <b>' + escapeHtml(service.responseMs) + ' ms</b></span>'
              : '') +
          '</div>' +
        '</div>' +
        '<span class="status ' + escapeHtml(displayStatus) + '">' +
          escapeHtml(displayLabel) +
        '</span>' +
      '</article>';
    }).join("") || '<p class="empty">No services configured.</p>';

    document.querySelector("#incidents").innerHTML = incidents.length
      ? incidents.slice(0, 30).map(incident =>
          '<article class="incident"><div>' +
            '<b>' + escapeHtml(incident.title) + '</b>' +
            '<p>' + escapeHtml(incident.message) + '</p>' +
            '<small>' + escapeHtml(incident.serviceName || "General") + " · " +
              escapeHtml(incident.status || "investigating") + " · " +
              escapeHtml(incident.time || "") +
            '</small>' +
          '</div></article>'
        ).join("")
      : '<p class="empty">No incidents recorded.</p>';

    document.querySelector("#updated").textContent =
      "Updated " + (updatedAt ? updatedAt.toLocaleString() : "—");
  } catch (error) {
    document.querySelector("#overall").className = "overall outage";
    document.querySelector("#overall").textContent = "Status monitoring data unavailable";
    document.querySelector("#services").innerHTML =
      '<p class="empty">The latest monitoring data could not be loaded.</p>';
  }
}

document.querySelector("#year").textContent = new Date().getFullYear();
loadStatus();
setInterval(loadStatus, 60000);
