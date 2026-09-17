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

async function loadRepos(origin, token) {
  const res = await fetch(origin + "/repos", { headers: { Authorization: "Bearer " + token } });
  if (!res.ok) throw new Error("auth failed");
  const { repos } = await res.json();
  $("repo").innerHTML = repos.map((r) => `<option>${r}</option>`).join("");
}

function connect(origin, token, repo) {
  const wsUrl = origin.replace(/^http/, "ws") + "/ws";
  ws = new WebSocket(wsUrl, ["bridge", token]);
  ws.onopen = () => { $("status").textContent = "connected"; ws.send(JSON.stringify({ type: "start", repo })); };
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

window.addEventListener("load", async () => {
  const origin = localStorage.getItem("origin") || location.origin;
  const token = localStorage.getItem("token") || "";
  $("origin").value = origin;
  $("token").value = token;
  const dlg = $("setup");
  if (token) { try { await loadRepos(origin, token); } catch {} }
  dlg.showModal();
  $("connect").addEventListener("click", async (e) => {
    e.preventDefault();
    const o = $("origin").value.trim(), t = $("token").value.trim();
    localStorage.setItem("origin", o); localStorage.setItem("token", t);
    try { await loadRepos(o, t); } catch { line("error", "could not load repos"); return; }
    connect(o, t, $("repo").value);
    dlg.close();
  });
  if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});
});
