const $ = (id) => document.getElementById(id);
const log = $("log");
let ws;
let inSession = false; // true once we've attached/started a session this run
let showArchived = false; // which view the session list is showing
const state = { origin: "", token: "", repo: "", mode: "ask", sessionId: null };

function line(cls, text) {
  const el = document.createElement("div");
  el.className = "line " + cls;
  el.textContent = text;
  log.appendChild(el);
  log.scrollTop = log.scrollHeight;
  return el;
}

function escapeHtml(s) {
  const d = document.createElement("div");
  d.textContent = s ?? "";
  return d.innerHTML;
}

function approvalCard(id, name, input) {
  const el = document.createElement("div");
  el.className = "line approval";
  el.innerHTML = `<b>Approve ${escapeHtml(name)}?</b><pre>${escapeHtml(JSON.stringify(input, null, 2))}</pre>`;
  const allow = document.createElement("button");
  allow.textContent = "Allow";
  const deny = document.createElement("button");
  deny.textContent = "Deny";
  allow.onclick = () => { send({ type: "approve", id, decision: "allow" }); el.remove(); };
  deny.onclick = () => { send({ type: "approve", id, decision: "deny" }); el.remove(); };
  el.append(allow, deny);
  log.appendChild(el);
  log.scrollTop = log.scrollHeight;
}

function urlB64ToUint8Array(b64) {
  const pad = "=".repeat((4 - (b64.length % 4)) % 4);
  const raw = atob((b64 + pad).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
}

// Best-effort Web Push subscribe; any failure is ignored so chat still works.
async function subscribePush(origin, token) {
  try {
    if (!("serviceWorker" in navigator) || !("PushManager" in window)) return;
    const auth = { Authorization: "Bearer " + token };
    const res = await fetch(origin + "/vapid", { headers: auth });
    if (!res.ok) return;
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
    .map((r) => `<option${r === selected ? " selected" : ""}>${escapeHtml(r)}</option>`)
    .join("");
}

function send(msg) {
  if (ws && ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
}

function closeDialogs() {
  for (const id of ["setup", "sessions"]) { const d = $(id); if (d.open) d.close(); }
}

function renderHistory(messages) {
  log.innerHTML = "";
  for (const m of messages) {
    if (m.role === "user") line("user", m.text);
    else if (m.tool) line("tool", "tool: " + m.tool);
    else if (m.text) line("assistant", m.text);
  }
}

function requestSessions() {
  send({ type: "list", repo: state.repo, archived: showArchived });
}

function showSessions(items, archived) {
  showArchived = !!archived;
  const list = $("sesslist");
  list.innerHTML = "";
  $("sesstitle").textContent = `${showArchived ? "Archived in" : "Sessions in"} ${state.repo}`;
  $("togglearchived").textContent = showArchived ? "Show active" : "Show archived";
  if (!items.length) {
    list.innerHTML = `<p>${showArchived ? "No archived sessions." : "No sessions. Start a new one."}</p>`;
  }
  for (const s of items) {
    const row = document.createElement("div");
    row.className = "sessrow";
    const open = document.createElement("button");
    open.className = "sessitem";
    open.type = "button";
    open.innerHTML = `<b>${escapeHtml(s.title)}</b><span>${new Date(s.lastModified).toLocaleString()}</span>`;
    open.onclick = () => attachSession(s.sessionId);
    const arch = document.createElement("button");
    arch.className = "archbtn";
    arch.type = "button";
    arch.textContent = showArchived ? "Unarchive" : "Archive";
    arch.onclick = () => {
      send({ type: showArchived ? "unarchive" : "archive", sessionId: s.sessionId });
      requestSessions(); // refresh the current view
    };
    row.append(open, arch);
    list.appendChild(row);
  }
  if (!$("sessions").open) $("sessions").showModal();
}

function attachSession(sessionId) {
  state.sessionId = sessionId;
  inSession = true;
  localStorage.setItem("sessionId", sessionId);
  log.innerHTML = "";
  send({ type: "attach", sessionId, repo: state.repo, mode: state.mode });
  closeDialogs();
}

function newSession() {
  state.sessionId = null;
  inSession = true;
  localStorage.removeItem("sessionId");
  log.innerHTML = "";
  send({ type: "start", repo: state.repo, mode: state.mode });
  closeDialogs();
}

function handleServer(m) {
  if (m.type === "sessions") showSessions(m.items, m.archived);
  else if (m.type === "history") renderHistory(m.messages);
  else if (m.type === "ready") { state.sessionId = m.sessionId; localStorage.setItem("sessionId", m.sessionId); }
  else if (m.type === "assistant") line("assistant", m.text);
  else if (m.type === "tool") line("tool", "tool: " + m.name);
  else if (m.type === "approval") approvalCard(m.id, m.name, m.input);
  else if (m.type === "turn_done") line("meta", "done");
  else if (m.type === "error") line("error", m.message);
}

// Open the socket. onOpen decides what to do once connected (list, or attach).
function openWs(onOpen) {
  if (ws) { try { ws.close(); } catch {} }
  const wsUrl = state.origin.replace(/^http/, "ws") + "/ws";
  ws = new WebSocket(wsUrl, ["bridge", state.token]);
  ws.onopen = () => { $("status").textContent = "connected"; onOpen && onOpen(); };
  ws.onclose = () => { $("status").textContent = "disconnected"; };
  ws.onmessage = (ev) => handleServer(JSON.parse(ev.data));
}

// Connect from the setup dialog. attachTo != null => go straight into that session
// (push deep-link); otherwise show the session list for the repo.
function connect(attachTo) {
  openWs(() => {
    if (attachTo) attachSession(attachTo);
    else send({ type: "list", repo: state.repo });
  });
  void subscribePush(state.origin, state.token);
}

$("composer").addEventListener("submit", (e) => {
  e.preventDefault();
  const text = $("text").value.trim();
  if (!text || !ws || ws.readyState !== ws.OPEN) return;
  line("user", text);
  send({ type: "user", text });
  $("text").value = "";
});

// Reconnect when the app is foregrounded (iOS suspends the socket in the background).
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState !== "visible") return;
  if (!state.token || !state.repo) return;
  if (ws && ws.readyState === ws.OPEN) return;
  openWs(() => {
    if (inSession && state.sessionId) send({ type: "attach", sessionId: state.sessionId, repo: state.repo, mode: state.mode });
    else send({ type: "list", repo: state.repo });
  });
});

window.addEventListener("load", async () => {
  if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});

  const urlSession = new URLSearchParams(location.search).get("session");
  state.origin = localStorage.getItem("origin") || location.origin;
  state.token = localStorage.getItem("token") || "";
  state.repo = localStorage.getItem("repo") || "";
  state.mode = localStorage.getItem("mode") || "ask";
  state.sessionId = localStorage.getItem("sessionId") || null;

  $("origin").value = state.origin;
  $("token").value = state.token;
  $("mode").value = state.mode;

  const dlg = $("setup");
  let reposLoaded = false;
  if (state.token) { try { await loadRepos(state.origin, state.token, state.repo); reposLoaded = true; } catch {} }

  $("token").addEventListener("change", async () => {
    const o = $("origin").value.trim(), t = $("token").value.trim();
    if (!t) return;
    try { await loadRepos(o, t, $("repo").value); reposLoaded = true; }
    catch { $("repo").innerHTML = ""; reposLoaded = false; }
  });

  $("status").addEventListener("click", () => { if (!dlg.open && !$("sessions").open) dlg.showModal(); });
  $("newsession").addEventListener("click", newSession);
  $("changerepo").addEventListener("click", () => { $("sessions").close(); dlg.showModal(); });
  $("togglearchived").addEventListener("click", () => { showArchived = !showArchived; requestSessions(); });
  // Reopen the session list mid-session to switch sessions without reconnecting.
  $("sessionsbtn").addEventListener("click", () => {
    if (!state.repo) { dlg.showModal(); return; }
    showArchived = false;
    if (ws && ws.readyState === ws.OPEN) requestSessions();
    else openWs(() => requestSessions());
  });

  $("connect").addEventListener("click", async (e) => {
    e.preventDefault();
    const o = $("origin").value.trim(), t = $("token").value.trim();
    if (!reposLoaded) {
      try { await loadRepos(o, t, state.repo); reposLoaded = true; }
      catch { line("error", "could not load repos, check the token"); return; }
    }
    state.origin = o; state.token = t; state.repo = $("repo").value; state.mode = $("mode").value;
    localStorage.setItem("origin", o); localStorage.setItem("token", t);
    localStorage.setItem("repo", state.repo); localStorage.setItem("mode", state.mode);
    dlg.close();
    connect(null);
  });

  // Deep-link from a push (?session=id): jump straight into that session, using the last repo.
  if (urlSession && state.token && state.repo) { connect(urlSession); }
  // Returning visit with token + repo: connect and show the session list.
  else if (state.token && state.repo) { connect(null); }
  else { dlg.showModal(); }
});
