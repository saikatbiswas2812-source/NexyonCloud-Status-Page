import fs from "node:fs/promises";
import dns from "node:dns/promises";
import net from "node:net";

// Monitor revision: 2026-11-22 — run a fresh check after service configuration corrections.

const config = JSON.parse(await fs.readFile("config/services.json", "utf8"));
const outputFile = "data/status.json";
let previous = { services: [], incidents: [], history: {} };
try { previous = JSON.parse(await fs.readFile(outputFile, "utf8")); } catch {}

const now = new Date();
const oldById = new Map((previous.services || []).map(service => [service.id, service]));
const history = previous.history || {};
const incidents = [...(previous.incidents || [])];
const services = [];

function isPrivateIPv4(ip) {
  const parts = ip.split(".").map(Number);
  return parts.length !== 4 ||
    parts.some(n => !Number.isInteger(n) || n < 0 || n > 255) ||
    parts[0] === 0 || parts[0] === 10 || parts[0] === 127 || parts[0] >= 224 ||
    (parts[0] === 169 && parts[1] === 254) ||
    (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) ||
    (parts[0] === 192 && parts[1] === 168) ||
    (parts[0] === 100 && parts[1] >= 64 && parts[1] <= 127);
}

function isPrivateIPv6(ip) {
  const value = ip.toLowerCase().split("%")[0];
  return value === "::" || value === "::1" ||
    value.startsWith("fc") || value.startsWith("fd") ||
    value.startsWith("fe8") || value.startsWith("fe9") ||
    value.startsWith("fea") || value.startsWith("feb") ||
    value.startsWith("::ffff:127.") || value.startsWith("::ffff:10.") ||
    value.startsWith("::ffff:192.168.");
}

async function validatePublicUrl(raw) {
  const url = new URL(raw);
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) {
    throw new Error("Invalid HTTP(S) URL");
  }

  const host = url.hostname.toLowerCase();
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local")) {
    throw new Error("Local hostnames are blocked");
  }

  if (net.isIP(host)) {
    const privateAddress = net.isIP(host) === 4 ? isPrivateIPv4(host) : isPrivateIPv6(host);
    if (privateAddress) throw new Error("Private IP addresses are blocked");
  } else {
    const records = await dns.lookup(host, { all: true, verbatim: true });
    if (!records.length || records.some(record =>
      net.isIP(record.address) === 4
        ? isPrivateIPv4(record.address)
        : isPrivateIPv6(record.address)
    )) {
      throw new Error("Hostname resolves to a private or invalid IP");
    }
  }

  return url;
}

async function notifyDiscord(message) {
  const webhook = process.env.DISCORD_WEBHOOK_URL;
  if (!webhook) return;
  try {
    await fetch(webhook, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ content: message })
    });
  } catch (error) {
    console.error("Discord alert failed:", error.message);
  }
}

async function checkUrl(raw) {
  await validatePublicUrl(raw);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12000);
  const started = Date.now();

  try {
    const response = await fetch(raw, {
      method: "GET",
      redirect: "follow",
      signal: controller.signal,
      headers: {
        "user-agent": "Mozilla/5.0 (compatible; NexyonCloud-Status-Monitor/3.0; +https://nexyoncloud.fun)",
        "accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"
      }
    });

    const responseMs = Date.now() - started;

    // Only a real successful HTTP response is green. 401/403, blocked URLs,
    // rate limits, server errors and all other non-2xx/3xx responses are outages.
    if (response.status >= 200 && response.status < 400) {
      return { status: "operational", responseMs, httpStatus: response.status };
    }

    return {
      status: "outage",
      responseMs,
      httpStatus: response.status,
      detail: "HTTP " + response.status
    };
  } finally {
    clearTimeout(timer);
  }
}

for (const service of config.services || []) {
  const old = oldById.get(service.id) || {};
  const url = String(service.url || "").trim();
  const enabled = service.enabled !== false && Boolean(url);

  let status = "unknown";
  let responseMs = null;
  let httpStatus = null;
  let detail = "No health URL configured";

  if (enabled) {
    let lastError = null;
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        const result = await checkUrl(url);
        status = result.status;
        responseMs = result.responseMs;
        httpStatus = result.httpStatus;
        detail = result.detail || ("HTTP " + result.httpStatus);
        lastError = null;
        break;
      } catch (error) {
        lastError = error;
        if (attempt < 2) await new Promise(resolve => setTimeout(resolve, 1500));
      }
    }
    if (lastError) {
      status = "outage";
      detail = lastError.name === "AbortError" ? "Health check timed out" : lastError.message;
      console.error(service.name + ":", detail);
    }

    const samples = history[service.id] || [];
    samples.push({
      at: now.toISOString(),
      ok: status === "operational" ? 1 : 0,
      ms: responseMs
    });
    while (samples.length && Date.now() - Date.parse(samples[0].at) > 30 * 86400000) {
      samples.shift();
    }
    history[service.id] = samples;
  } else {
    // URL removed or monitoring disabled: do not carry forward a previous
    // green state or uptime percentages from an endpoint we no longer check.
    delete history[service.id];
  }

  const samples = enabled ? (history[service.id] || []) : [];
  const uptime = hours => {
    const selected = samples.filter(sample =>
      Date.now() - Date.parse(sample.at) <= hours * 3600000
    );
    return selected.length
      ? Number((100 * selected.reduce((sum, sample) => sum + sample.ok, 0) / selected.length).toFixed(2))
      : null;
  };

  services.push({
    id: service.id,
    name: service.name,
    description: service.description || "",
    status,
    monitored: enabled,
    responseMs,
    httpStatus,
    detail: enabled ? detail : null,
    lastCheckAt: enabled ? now.toISOString() : null,
    uptime24h: enabled ? uptime(24) : null,
    uptime7d: enabled ? uptime(168) : null,
    uptime30d: enabled ? uptime(720) : null
  });

  if (enabled && old.status && old.status !== status && old.status !== "unknown") {
    const recovered = status === "operational";
    incidents.unshift({
      title: service.name + (recovered ? " recovered" : " is down"),
      message: recovered
        ? "Automated health check succeeded in " + responseMs + " ms."
        : "Automated health check failed: " + detail + ".",
      serviceName: service.name,
      status: recovered ? "resolved" : "investigating",
      time: now.toISOString()
    });

    await notifyDiscord(
      (recovered ? "🟢 " : "🔴 ") + service.name +
      (recovered ? " has recovered." : " is DOWN.") + " NexyonCloud Status"
    );
  }
}

const result = {
  updatedAt: now.toISOString(),
  checkIntervalMinutes: 5,
  services,
  incidents: incidents.slice(0, 100),
  history
};

await fs.writeFile(outputFile, JSON.stringify(result, null, 2) + "\n");
console.log(
  "Published status for " + services.length + " services (" +
  services.filter(service => service.monitored).length + " monitored)."
);
