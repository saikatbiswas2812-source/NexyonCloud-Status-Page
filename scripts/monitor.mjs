import fs from "node:fs/promises";
import dns from "node:dns/promises";
import net from "node:net";

const config = JSON.parse(await fs.readFile("config/services.json", "utf8"));
const outputFile = "data/status.json";
let previous = { services: [], incidents: [], history: {} };
try { previous = JSON.parse(await fs.readFile(outputFile, "utf8")); } catch {}
const now = new Date();
const oldById = new Map((previous.services || []).map(s => [s.id, s]));
const history = previous.history || {};
const incidents = [...(previous.incidents || [])];
const services = [];

function isPrivateIPv4(ip) {
  const p = ip.split(".").map(Number);
  return p.length !== 4 || p.some(n => !Number.isInteger(n) || n < 0 || n > 255) ||
    p[0] === 0 || p[0] === 10 || p[0] === 127 || p[0] >= 224 ||
    (p[0] === 169 && p[1] === 254) || (p[0] === 172 && p[1] >= 16 && p[1] <= 31) ||
    (p[0] === 192 && p[1] === 168) || (p[0] === 100 && p[1] >= 64 && p[1] <= 127);
}
function isPrivateIPv6(ip) {
  const x = ip.toLowerCase().split("%")[0];
  return x === "::" || x === "::1" || x.startsWith("fc") || x.startsWith("fd") ||
    x.startsWith("fe8") || x.startsWith("fe9") || x.startsWith("fea") || x.startsWith("feb") ||
    x.startsWith("::ffff:127.") || x.startsWith("::ffff:10.") || x.startsWith("::ffff:192.168.");
}
async function validatePublicUrl(raw) {
  const u = new URL(raw);
  if (!["http:", "https:"].includes(u.protocol) || u.username || u.password) throw new Error("Invalid HTTP(S) URL");
  const host = u.hostname.toLowerCase();
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local")) throw new Error("Local hostnames are blocked");
  if (net.isIP(host)) {
    if (net.isIP(host) === 4 ? isPrivateIPv4(host) : isPrivateIPv6(host)) throw new Error("Private IP addresses are blocked");
  } else {
    const records = await dns.lookup(host, { all: true, verbatim: true });
    if (!records.length || records.some(x => net.isIP(x.address) === 4 ? isPrivateIPv4(x.address) : isPrivateIPv6(x.address))) {
      throw new Error("Hostname resolves to a private or invalid IP");
    }
  }
  return u;
}
async function notifyDiscord(message) {
  const hook = process.env.DISCORD_WEBHOOK_URL;
  if (!hook) return;
  try {
    await fetch(hook, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ content: message }) });
  } catch (e) { console.error("Discord alert failed:", e.message); }
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
      headers: { "user-agent": "NexyonCloud-Status-Monitor/2.0", "cache-control": "no-cache" }
    });
    const ms = Date.now() - started;
    if (response.status >= 200 && response.status < 400) return { status: "operational", ms, httpStatus: response.status };
    if (response.status >= 500 || response.status === 408 || response.status === 429) return { status: "outage", ms, httpStatus: response.status };
    return { status: "degraded", ms, httpStatus: response.status };
  } finally { clearTimeout(timer); }
}

for (const service of config.services || []) {
  const old = oldById.get(service.id) || {};
  const enabled = service.enabled !== false && Boolean((service.url || "").trim());
  let status = "unknown", responseMs = null, httpStatus = null, detail = "No health URL configured";
  if (enabled) {
    try {
      const result = await checkUrl(service.url.trim());
      status = result.status;
      responseMs = result.ms;
      httpStatus = result.httpStatus;
      detail = "HTTP " + result.httpStatus;
    } catch (error) {
      status = "outage";
      detail = error.name === "AbortError" ? "Health check timed out" : error.message;
      console.error(service.name + ":", detail);
    }
  }
  const samples = history[service.id] || [];
  if (enabled) {
    samples.push({ at: now.toISOString(), ok: status === "operational" ? 1 : 0, ms: responseMs });
    while (samples.length && Date.now() - Date.parse(samples[0].at) > 30 * 86400000) samples.shift();
    history[service.id] = samples;
  }
  const uptime = hours => {
    const selected = samples.filter(x => Date.now() - Date.parse(x.at) <= hours * 3600000);
    return selected.length ? Number((100 * selected.reduce((sum, x) => sum + x.ok, 0) / selected.length).toFixed(2)) : null;
  };
  const item = {
    id: service.id, name: service.name, description: service.description || "",
    status, monitored: enabled, responseMs, httpStatus,
    lastCheckAt: enabled ? now.toISOString() : null,
    uptime24h: uptime(24), uptime7d: uptime(168), uptime30d: uptime(720)
  };
  services.push(item);
  if (enabled && old.status && old.status !== status && old.status !== "unknown") {
    const recovered = status === "operational";
    incidents.unshift({
      title: service.name + (recovered ? " recovered" : status === "degraded" ? " is degraded" : " is down"),
      message: recovered ? "Automated health check succeeded in " + responseMs + " ms." : "Automated health check result: " + detail + ".",
      serviceName: service.name, status: recovered ? "resolved" : "investigating", time: now.toISOString()
    });
    await notifyDiscord((recovered ? "🟢 " : status === "degraded" ? "🟡 " : "🔴 ") + service.name +
      (recovered ? " has recovered." : status === "degraded" ? " is degraded." : " is DOWN.") + " NexyonCloud Status");
  }
}
const result = {
  updatedAt: now.toISOString(), checkIntervalMinutes: 5, services,
  incidents: incidents.slice(0, 100), history
};
await fs.writeFile(outputFile, JSON.stringify(result, null, 2) + "\n");
console.log("Published status for " + services.length + " services (" + services.filter(s => s.monitored).length + " monitored).");
