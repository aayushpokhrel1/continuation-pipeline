import { spawn as nodeSpawn } from "node:child_process";

export interface TermHandle {
  write(data: string): void;
  resize(cols: number, rows: number): void;
  kill(): void;
}

const NAME_RE = /^[A-Za-z0-9_.-]+$/;

export function attachTerminal(
  name: string,
  onData: (data: string) => void,
  onExit: () => void,
  spawnFn: typeof nodeSpawn = nodeSpawn,
): TermHandle {
  if (!NAME_RE.test(name)) throw new Error("invalid terminal name");
  const child = spawnFn("script", ["-qfc", `tmux attach -t ${name}`, "/dev/null"], {
    env: { ...process.env, TERM: "xterm-256color" },
  });
  child.stdout?.on("data", (b) => onData(b.toString("utf8")));
  child.stderr?.on("data", (b) => onData(b.toString("utf8")));
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
