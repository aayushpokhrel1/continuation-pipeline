const $ = (id) => document.getElementById(id);
const log = $("log");
let ws;
let inSession = false; // true once we've attached/started a session this run
let showArchived = false; // which view the session list is showing
let allMode = true; // sessions dialog shows the cross-repo overview vs a single repo
let lastRepos = []; // repo summaries from the most recent overview, for the repo bar
let term = null, fit = null; // xterm.js terminal + fit addon, lazily created
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

// A diff model ({ path, lines: [{sign, text}], truncated }) as a <pre> of colored lines.
function diffElement(model) {
  const pre = document.createElement("pre");
  pre.className = "diff";
  for (const l of model.lines) {
    const span = document.createElement("span");
    span.className = l.sign === "+" ? "add" : "del";
    span.textContent = l.sign + " " + l.text;
    pre.appendChild(span);
  }
  if (model.truncated > 0) {
    const more = document.createElement("span");
    more.className = "more";
    more.textContent = `… +${model.truncated} more line${model.truncated === 1 ? "" : "s"}`;
    pre.appendChild(more);
  }
  return pre;
}

// A tool call rendered as its own diff card (name + path header, then the diff).
function diffCard(name, model) {
  const el = document.createElement("div");
  el.className = "line diff";
  const head = document.createElement("div");
  head.className = "diffhead";
  head.textContent = `${name} · ${model.path}`;
  el.append(head, diffElement(model));
  log.appendChild(el);
  log.scrollTop = log.scrollHeight;
  return el;
}

function approvalCard(id, name, input, diff) {
  const el = document.createElement("div");
  el.className = "line approval";
  const title = document.createElement("b");
  title.textContent = `Approve ${name}?`;
  el.appendChild(title);
  if (diff) {
    el.appendChild(diffElement(diff));
  } else {
    const pre = document.createElement("pre");
    pre.textContent = JSON.stringify(input, null, 2);
    el.appendChild(pre);
  }
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
    else if (m.tool) { if (m.diff) diffCard(m.tool, m.diff); else line("tool", "tool: " + m.tool); }
    else if (m.text) line("assistant", m.text);
  }
}

function requestSessions() {
  if (allMode) send({ type: "listAll" });
  else send({ type: "list", repo: state.repo, archived: showArchived });
}

// The repo switcher: an "All repos" chip plus one chip per repo (live-dot, recency-sorted
// as the server returned them). Selecting one re-lists over the open socket, no reconnect.
function renderRepoBar() {
  const bar = $("repobar");
  bar.innerHTML = "";
  const chip = (label, active, live, onClick) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "repochip" + (active ? " active" : "") + (live ? " live" : "");
    b.textContent = label;
    b.onclick = onClick;
    return b;
  };
  bar.appendChild(chip("All repos", allMode, false, () => { allMode = true; requestSessions(); }));
  for (const r of lastRepos) {
    bar.appendChild(chip(r.name, !allMode && state.repo === r.name, r.live, () => {
      allMode = false; showArchived = false; state.repo = r.name;
      localStorage.setItem("repo", r.name);
      requestSessions();
    }));
  }
}

// Cross-repo overview: every repo's active sessions in one list, each tagged with its repo.
function showOverview(items, repos) {
  allMode = true;
  lastRepos = repos;
  $("sesstitle").textContent = "All sessions";
  $("togglearchived").style.display = "none";
  renderRepoBar();
  const list = $("sesslist");
  list.innerHTML = items.length ? "" : "<p>No sessions yet. Pick a repo and start one.</p>";
  for (const s of items) {
    const row = document.createElement("div");
    row.className = "sessrow";
    const open = document.createElement("button");
    open.className = "sessitem";
    open.type = "button";
    open.innerHTML = `<b>${escapeHtml(s.title)}</b><span><span class="repochip">${escapeHtml(s.repo)}</span> ${new Date(s.lastModified).toLocaleString()}</span>`;
    open.onclick = () => { state.repo = s.repo; localStorage.setItem("repo", s.repo); attachSession(s.sessionId); };
    row.append(open);
    list.appendChild(row);
  }
  if (!$("sessions").open) $("sessions").showModal();
}

function showSessions(items, archived) {
  allMode = false;
  showArchived = !!archived;
  const list = $("sesslist");
  list.innerHTML = "";
  $("sesstitle").textContent = `${showArchived ? "Archived in" : "Sessions in"} ${state.repo}`;
  $("togglearchived").style.display = "";
  $("togglearchived").textContent = showArchived ? "Show active" : "Show archived";
  renderRepoBar();
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
  if (!state.repo) { $("sesstitle").textContent = "Pick a repo first"; return; }
  state.sessionId = null;
  inSession = true;
  localStorage.removeItem("sessionId");
  log.innerHTML = "";
  send({ type: "start", repo: state.repo, mode: state.mode });
  closeDialogs();
}

// --- Terminal continuation: a live xterm bound to a tmux session over the socket. ---
function fitTerminal() {
  if (!term || $("termview").hidden) return;
  try { fit.fit(); } catch {}
  send({ type: "termResize", cols: term.cols, rows: term.rows });
}

function openTerminalView(name) {
  $("termname").textContent = name;
  $("log").hidden = true;
  $("composer").hidden = true;
  $("termview").hidden = false;
  if (!term) {
    term = new Terminal({ fontSize: 13, cursorBlink: true, convertEol: false, scrollback: 3000 });
    fit = new FitAddon.FitAddon();
    term.loadAddon(fit);
    term.open($("term"));
    term.onData((d) => send({ type: "termInput", data: d }));
    term.onResize(({ cols, rows }) => send({ type: "termResize", cols, rows }));
  } else {
    term.reset();
  }
  fitTerminal();
  term.focus();
}

// Tear down the terminal UI without telling the server (used when the server said it exited).
function hideTerminalView() {
  $("termview").hidden = true;
  $("log").hidden = false;
  $("composer").hidden = false;
  if (term) { term.dispose(); term = null; fit = null; }
}

function onTerms(names) {
  const name = names.includes("continuation") ? "continuation" : names[0];
  if (!name) { line("error", "No terminal running. Run `cc` on the workstation first."); return; }
  openTerminalView(name);
  send({ type: "termAttach", name });
}

function handleServer(m) {
  if (m.type === "sessions") showSessions(m.items, m.archived);
  else if (m.type === "sessionsAll") showOverview(m.items, m.repos);
  else if (m.type === "terms") onTerms(m.names);
  else if (m.type === "termOut") { if (term) term.write(m.data); }
  else if (m.type === "termExit") { hideTerminalView(); line("meta", "terminal detached"); }
  else if (m.type === "history") renderHistory(m.messages);
  else if (m.type === "ready") { state.sessionId = m.sessionId; localStorage.setItem("sessionId", m.sessionId); }
  else if (m.type === "assistant") line("assistant", m.text);
  else if (m.type === "tool") { if (m.diff) diffCard(m.name, m.diff); else line("tool", "tool: " + m.name); }
  else if (m.type === "approval") approvalCard(m.id, m.name, m.input, m.diff);
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
// (push deep-link); otherwise show the cross-repo overview.
function connect(attachTo) {
  openWs(() => {
    if (attachTo) attachSession(attachTo);
    else { allMode = true; send({ type: "listAll" }); }
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
  if (!state.token) return;
  if (ws && ws.readyState === ws.OPEN) return;
  openWs(() => {
    if (inSession && state.sessionId) send({ type: "attach", sessionId: state.sessionId, repo: state.repo, mode: state.mode });
    else { allMode = true; send({ type: "listAll" }); }
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
  $("serverbtn").addEventListener("click", () => { $("sessions").close(); dlg.showModal(); });
  $("terminalbtn").addEventListener("click", () => {
    $("sessions").close();
    if (ws && ws.readyState === ws.OPEN) send({ type: "termList" });
    else openWs(() => send({ type: "termList" }));
  });
  $("termback").addEventListener("click", () => { send({ type: "termDetach" }); hideTerminalView(); });
  window.addEventListener("resize", fitTerminal);
  $("togglearchived").addEventListener("click", () => { showArchived = !showArchived; requestSessions(); });
  // Reopen the sessions dialog mid-session to switch repo/session without reconnecting.
  $("sessionsbtn").addEventListener("click", () => {
    if (!state.token) { dlg.showModal(); return; }
    allMode = true; showArchived = false;
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
