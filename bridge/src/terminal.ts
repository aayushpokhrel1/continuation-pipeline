import { spawn as nodeSpawn } from "node:child_process";

export interface TermHandle {
  write(data: string): void;
  resize(cols: number, rows: number): void;
  kill(): void;
}

const NAME_RE = /^[A-Za-z0-9_.-]+$/;
const ALT_SCREEN_RE = /\x1b\[\?1049[hl]/g;
const SCROLLBACK_LINES = 2000;

export function attachTerminal(
  name: string,
  onData: (data: string) => void,
  onExit: () => void,
  spawnFn: typeof nodeSpawn = nodeSpawn,
): TermHandle {
  if (!NAME_RE.test(name)) throw new Error("invalid terminal name");
  // Dump the pane's scrollback (everything above the viewport) before attaching, in the
  // same PTY so the ordering is free; tmux attach then paints the current screen under it.
  // Stripping the alt-screen switch keeps both in one xterm buffer, so the phone can
  // scroll back through what happened before it connected.
  // ponytail: 2000 lines of scrollback, raise if a long session gets cut off.
  const command = `tmux capture-pane -p -t ${name} -S -${SCROLLBACK_LINES} -E -1; tmux attach -t ${name}`;
  const child = spawnFn("script", ["-qfc", command, "/dev/null"], {
    env: { ...process.env, TERM: "xterm-256color" },
  });
  const send = (b: Buffer) => onData(b.toString("utf8").replace(ALT_SCREEN_RE, ""));
  child.stdout?.on("data", send);
  child.stderr?.on("data", send);
  child.on("exit", () => onExit());
  return {
    write: (data) => { child.stdin?.write(data); },
    resize: (cols, rows) => {
      nodeSpawn("tmux", ["resize-window", "-t", name, "-x", String(cols), "-y", String(rows)]);
    },
    kill: () => { child.kill(); },
  };
}

export function listTerminals(spawnFn: typeof nodeSpawn = nodeSpawn): Promise<string[]> {
  return new Promise((resolve) => {
    const child = spawnFn("tmux", ["list-sessions", "-F", "#{session_name}"]);
    let out = "";
    child.stdout?.on("data", (b) => { out += b.toString("utf8"); });
    child.on("exit", (code) => {
      if (code === 0) resolve(out.split("\n").map((s) => s.trim()).filter((s) => s.length > 0));
      else resolve([]);
    });
    child.on("error", () => resolve([]));
  });
}
