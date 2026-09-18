const $ = (id) => document.getElementById(id);
const log = $("log");
let ws;

function line(cls, text) {
  const el = document.createElement("div");
  el.className = "line " + cls;
  el.textContent = text;
  log.appendChild(el);
  log.scrollTop = log.scrollHeight;
  return el;
}

function approvalCard(id, name, input) {
  const el = document.createElement("div");
  el.className = "line approval";
  el.innerHTML = `<b>Approve ${name}?</b><pre>${JSON.stringify(input, null, 2)}</pre>`;
  const allow = document.createElement("button");
  allow.textContent = "Allow";
  const deny = document.createElement("button");
  deny.textContent = "Deny";
  allow.onclick = () => { ws.send(JSON.stringify({ type: "approve", id, decision: "allow" })); el.remove(); };
  deny.onclick = () => { ws.send(JSON.stringify({ type: "approve", id, decision: "deny" })); el.remove(); };
  el.append(allow, deny);
  log.appendChild(el);
  log.scrollTop = log.scrollHeight;
}

function urlB64ToUint8Array(b64) {
  const pad = "=".repeat((4 - (b64.length % 4)) % 4);
  const raw = atob((b64 + pad).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
}

// Subscribe this device to Web Push. Best-effort: any failure (push not configured,
// permission denied, unsupported browser) is logged and ignored so chat still works.
// Must run from a user gesture (the Connect click) for the iOS permission prompt.
async function subscribePush(origin, token) {
  try {
    if (!("serviceWorker" in navigator) || !("PushManager" in window)) return;
    const auth = { Authorization: "Bearer " + token };
    const res = await fetch(origin + "/vapid", { headers: auth });
    if (!res.ok) return; // 404 = push not configured on the server
    const { publicKey } = await res.json();
    if ((await Notification.requestPermission()) !== "granted") return;
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlB64ToUint8Array(publicKey),
    });
    await fetch(origin + "/subscribe", {
      method: "POST",
      headers: { ...auth, "content-type": "application/json" },
      body: JSON.stringify(sub),
    });
  } catch (err) {
    console.warn("push subscribe failed", err);
  }
}

async function loadRepos(origin, token, selected) {
  const res = await fetch(origin + "/repos", { headers: { Authorization: "Bearer " + token } });
  if (!res.ok) throw new Error("auth failed");
  const { repos } = await res.json();
  $("repo").innerHTML = repos
    .map((r) => `<option${r === selected ? " selected" : ""}>${r}</option>`)
    .join("");
}

function connect(origin, token, repo, mode) {
  if (ws) { try { ws.close(); } catch {} }
  const wsUrl = origin.replace(/^http/, "ws") + "/ws";
  ws = new WebSocket(wsUrl, ["bridge", token]);
  ws.onopen = () => { $("status").textContent = "connected"; ws.send(JSON.stringify({ type: "start", repo, mode })); };
  ws.onclose = () => ($("status").textContent = "disconnected");
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.type === "assistant") line("assistant", m.text);
    else if (m.type === "tool") line("tool", "tool: " + m.name);
    else if (m.type === "approval") approvalCard(m.id, m.name, m.input);
    else if (m.type === "turn_done") line("meta", "done");
    else if (m.type === "error") line("error", m.message);
  };
}

$("composer").addEventListener("submit", (e) => {
  e.preventDefault();
  const text = $("text").value.trim();
  if (!text || !ws || ws.readyState !== ws.OPEN) return;
  line("user", text);
  ws.send(JSON.stringify({ type: "user", text }));
  $("text").value = "";
});

function startSession(o, t, repo, mode) {
  connect(o, t, repo, mode);
  void subscribePush(o, t);
}

window.addEventListener("load", async () => {
  const dlg = $("setup");
  const origin = localStorage.getItem("origin") || location.origin;
  const token = localStorage.getItem("token") || "";
  const savedRepo = localStorage.getItem("repo") || "";
  const savedMode = localStorage.getItem("mode") || "ask";
  $("origin").value = origin;
  $("token").value = token;
  $("mode").value = savedMode;

  // Fill the repo dropdown up front so it is pickable before connecting.
  let reposLoaded = false;
  if (token) {
    try { await loadRepos(origin, token, savedRepo); reposLoaded = true; } catch {}
  }

  // Reload repos whenever the token changes, so the list fills without connecting.
  $("token").addEventListener("change", async () => {
    const o = $("origin").value.trim(), t = $("token").value.trim();
    if (!t) return;
    try { await loadRepos(o, t, $("repo").value); reposLoaded = true; }
    catch { $("repo").innerHTML = ""; reposLoaded = false; }
  });

  // Tap the header to reopen settings later (switch repo/mode, re-enter token).
  $("status").addEventListener("click", () => { if (!dlg.open) dlg.showModal(); });

  $("connect").addEventListener("click", async (e) => {
    e.preventDefault();
    const o = $("origin").value.trim(), t = $("token").value.trim();
    if (!reposLoaded) {
      try { await loadRepos(o, t, savedRepo); reposLoaded = true; }
      catch { line("error", "could not load repos, check the token"); return; }
    }
    const repo = $("repo").value, mode = $("mode").value;
    localStorage.setItem("origin", o); localStorage.setItem("token", t);
    localStorage.setItem("repo", repo); localStorage.setItem("mode", mode);
    dlg.close();
    startSession(o, t, repo, mode);
  });

  if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});

  // Returning visit with everything saved: connect straight away, skip the dialog.
  if (token && reposLoaded && savedRepo) startSession(origin, token, savedRepo, savedMode);
  else dlg.showModal();
});
