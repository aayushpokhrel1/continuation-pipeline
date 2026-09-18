import { createServer as createHttp, type IncomingMessage, type ServerResponse } from "node:http";
import { readFile } from "node:fs/promises";
import { join, normalize, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocketServer } from "ws";
import type { Config } from "./config.ts";
import { checkToken } from "./auth.ts";
import { Session } from "./session.ts";
import type { SessionSource } from "./source.ts";
import type { ClientMessage, ServerMessage } from "./protocol.ts";

const PUBLIC_DIR = fileURLToPath(new URL("../public/", import.meta.url));
const MIME: Record<string, string> = {
  ".html": "text/html", ".js": "text/javascript", ".css": "text/css",
  ".webmanifest": "application/manifest+json", ".json": "application/json",
};

export function createServer(config: Config, source: SessionSource) {
  const http = createHttp(async (req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    if (url.pathname === "/health") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: true }));
      return;
    }
    if (url.pathname === "/repos") {
      const bearer = (req.headers.authorization ?? "").replace(/^Bearer /, "");
      if (!checkToken(config.token, bearer)) { res.writeHead(401); res.end(); return; }
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ repos: config.repos.map((r) => r.name) }));
      return;
    }
    // static files
    const rel = url.pathname === "/" ? "index.html" : url.pathname.slice(1);
    const path = normalize(join(PUBLIC_DIR, rel));
    if (!path.startsWith(PUBLIC_DIR)) { res.writeHead(403); res.end(); return; }
    try {
      const body = await readFile(path);
      res.writeHead(200, { "content-type": MIME[extname(path)] ?? "application/octet-stream" });
      res.end(body);
    } catch {
      res.writeHead(404); res.end();
    }
  });

  const wss = new WebSocketServer({ server: http, path: "/ws" });
  wss.on("connection", (ws, req) => {
    const token = (req.headers["sec-websocket-protocol"] ?? "").split(",").map((s) => s.trim())[1];
    if (!checkToken(config.token, token)) { ws.close(1008, "unauthorized"); return; }

    let session: Session | undefined;
    const emit = (m: ServerMessage) => ws.readyState === ws.OPEN && ws.send(JSON.stringify(m));

    ws.on("message", (data) => {
      let msg: ClientMessage;
      try { msg = JSON.parse(data.toString()) as ClientMessage; }
      catch { emit({ type: "error", message: "bad json" }); return; }

      if (msg.type === "start") {
        const repo = config.repos.find((r) => r.name === msg.repo);
        if (!repo) { emit({ type: "error", message: "unknown repo" }); return; }
        session = new Session(source, repo.path, emit, msg.mode ?? "ask");
      } else if (msg.type === "user") {
        if (!session) { emit({ type: "error", message: "start a session first" }); return; }
        void session.handleUser(msg.text);
      } else if (msg.type === "approve") {
        session?.approve(msg.id, msg.decision);
      }
    });
  });

  return http;
}
