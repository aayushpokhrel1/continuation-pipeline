import { readFileSync } from "node:fs";

export interface RepoRef { name: string; path: string; }
export interface Config { port: number; token: string; repos: RepoRef[]; }

export function loadConfig(path: string): Config {
  const raw = readFileSync(path, "utf8");
  const data = JSON.parse(raw) as Partial<Config>;
  if (typeof data.token !== "string" || data.token.length === 0) {
    throw new Error("config: token must be a non-empty string");
  }
  if (!Array.isArray(data.repos) || data.repos.length === 0) {
    throw new Error("config: repos must be a non-empty array");
  }
  const port = typeof data.port === "number" ? data.port : 8790;
  return { port, token: data.token, repos: data.repos };
}
