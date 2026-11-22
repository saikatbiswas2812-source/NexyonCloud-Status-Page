const OWNER = "saikatbiswas2812-source";
const REPO = "NexyonCloud-Status-Page";
const BRANCH = "main";
let token = "";
let services = [];
let servicesSha = null;
const $ = id => document.getElementById(id);

async function api(path, options = {}) {
  let response;
  try {
    response = await fetch("https://api.github.com" + path, {
      ...options,
      cache: "no-store",
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: "Bearer " + token,
        "X-GitHub-Api-Version": "2022-11-28",
        ...(options.body ? { "Content-Type": "application/json" } : {}),
        ...(options.headers || {})
      }
    });
  } catch (cause) {
    const error = new Error(
      "Browser cannot reach api.github.com. This is a network/CORS/browser-extension block, not a GitHub token permission error. " +
      "Try an Incognito window with extensions disabled, or allow api.github.com in your firewall/ad blocker."
    );
    error.cause = cause;
    throw error;
  }
  const body = await response.text();
  if (!response.ok) {
    let message = body;
    try { message = JSON.parse(body).message || body; } catch {}
    const error = new Error("GitHub API " + response.status + ": " + String(message).slice(0, 300));
    error.status = response.status;
    throw error;
  }
  return body ? JSON.parse(body) : {};
}

function b64(value) {
  return btoa(unescape(encodeURIComponent(value)));
}

async function readFile(path) {
  const result = await api(
    "/repos/" + OWNER + "/" + REPO + "/contents/" + path +
    "?ref=" + encodeURIComponent(BRANCH) + "&_=" + Date.now()
  );
  return {
    ...result,
    text: decodeURIComponent(escape(atob(result.content.replace(/\n/g, ""))))
  };
}

// Always fetch the newest blob SHA immediately before each write.
// If another admin tab or GitHub Action wins the race, fetch again and retry.
async function writeFile(path, text, message, expectedSha = null) {
  let lastError;
  for (let attempt = 0; attempt < 8; attempt++) {
    try {
      const latest = await readFile(path);
      if (expectedSha && latest.sha !== expectedSha) {
        const error = new Error("These settings changed in GitHub after this page was loaded. Reconnect to load the latest settings before saving; this prevents an old tab from overwriting newer configuration.");
        error.status = 412;
        throw error;
      }
      return await api("/repos/" + OWNER + "/" + REPO + "/contents/" + path, {
        method: "PUT",
        body: JSON.stringify({
          message,
          content: b64(text),
          sha: latest.sha,
          branch: BRANCH
        })
      });
    } catch (error) {
      lastError = error;
      if (error.status !== 409 || attempt === 7) throw error;
      await new Promise(resolve => setTimeout(resolve, 400 * (attempt + 1)));
    }
  }
  throw lastError;
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, char => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  })[char]);
}

function draw() {
  $("editor").innerHTML = services.map((service, index) =>
    '<div class="editor-row">' +
      '<input data-i="' + index + '" data-k="name" value="' + escapeHtml(service.name) + '" aria-label="Name">' +
      '<input data-i="' + index + '" data-k="description" value="' + escapeHtml(service.description || "") + '" aria-label="Description">' +
      '<input data-i="' + index + '" data-k="url" value="' + escapeHtml(service.url || "") + '" placeholder="https://health URL" aria-label="Health URL">' +
      '<small>Automatic monitoring: <input style="width:auto" type="checkbox" data-i="' + index + '" data-k="enabled" ' +
        (service.enabled !== false && service.url ? "checked" : "") +
      '> Enabled · Status is detected automatically from the health URL</small>' +
    '</div>'
  ).join("");

  document.querySelectorAll("#editor [data-k]").forEach(element => {
    element.addEventListener("change", () => {
      const service = services[Number(element.dataset.i)];
      const key = element.dataset.k;
      service[key] = element.type === "checkbox" ? element.checked : element.value;
    });
  });

  $("incidentService").innerHTML =
    '<option value="">General update</option>' +
    services.map((service, index) =>
      '<option value="' + index + '">' + escapeHtml(service.name) + '</option>'
    ).join("");
}

$("connect").onclick = async () => {
  token = $("token").value.trim();
  if (!token) {
    $("connectMsg").textContent = "Enter a token.";
    return;
  }

  try {
    await api("/repos/" + OWNER + "/" + REPO);
    const file = await readFile("config/services.json");
    services = JSON.parse(file.text).services || [];
    servicesSha = file.sha;
    draw();
    $("save").disabled = false;
    $("publish").disabled = false;
    try { sessionStorage.setItem("nexyoncloud_admin_token", token); } catch {}
    $("connectMsg").textContent = "Connected. Settings are loaded from the latest GitHub version.";
  } catch (error) {
    token = "";
    try { sessionStorage.removeItem("nexyoncloud_admin_token"); } catch {}
    $("connectMsg").textContent = error.message;
  }
};

async function restoreAdminSession() {
  try {
    const savedToken = sessionStorage.getItem("nexyoncloud_admin_token");
    if (savedToken && !token) {
      $("token").value = savedToken;
      await $("connect").onclick();
    }
  } catch {}
}
window.addEventListener("pageshow", restoreAdminSession);
restoreAdminSession();

$("save").onclick = async () => {
  const button = $("save");
  button.disabled = true;
  $("saveMsg").textContent = "Saving settings to GitHub…";

  try {
    document.querySelectorAll("#editor [data-k]").forEach(element => {
      const service = services[Number(element.dataset.i)];
      const key = element.dataset.k;
      service[key] = element.type === "checkbox" ? element.checked : element.value.trim();
    });

    for (const service of services) {
      service.name = String(service.name || "").trim();
      service.description = String(service.description || "").trim();
      service.url = String(service.url || "").trim();

      if (!service.name) throw new Error("Service names are required.");
      if (service.url && !/^https?:\/\//i.test(service.url)) {
        throw new Error("Health URLs must start with http:// or https://");
      }

      // An empty URL can never remain enabled or retain an old green status.
      if (!service.url) service.enabled = false;
      service.enabled = Boolean(service.url && service.enabled);
    }

    const config = JSON.stringify({ services }, null, 2) + "\n";
    const result = await writeFile("config/services.json", config, "Update status page service configuration", servicesSha);
    const saved = await readFile("config/services.json");
    services = JSON.parse(saved.text).services || [];
    servicesSha = saved.sha;
    draw();
    $("saveMsg").textContent =
      "Saved successfully. Automatic monitoring has been triggered by the GitHub push. " +
      "Wait for the Monitor workflow to finish, then refresh the public status page.";
  } catch (error) {
    $("saveMsg").textContent = error.message;
  } finally {
    button.disabled = false;
  }
};

$("publish").onclick = async () => {
  try {
    const title = $("incidentTitle").value.trim();
    const message = $("incidentMessage").value.trim();
    if (!title || !message) throw new Error("Enter an incident title and message.");

    const file = await readFile("data/status.json");
    const data = JSON.parse(file.text);
    const index = $("incidentService").value;
    data.incidents = data.incidents || [];
    data.incidents.unshift({
      title,
      message,
      serviceName: index === "" ? "General" : services[Number(index)].name,
      status: "investigating",
      time: new Date().toISOString()
    });
    data.updatedAt = new Date().toISOString();

    await writeFile(
      "data/status.json",
      JSON.stringify(data, null, 2) + "\n",
      "Publish status incident"
    );
    alert("Incident published.");
  } catch (error) {
    alert(error.message);
  }
};
