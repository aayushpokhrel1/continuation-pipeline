import { readFileSync } from "node:fs";

export interface RepoRef { name: string; path: string; }
export interface Config {
  port: number;
  token: string;
  repos: RepoRef[];
  vapid?: { subject: string; publicKey: string; privateKey: string };
}

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
  const base: Config = { port, token: data.token, repos: data.repos };
  if (data.vapid) {
    for (const field of ["subject", "publicKey", "privateKey"] as const) {
      const value = data.vapid[field];
      if (typeof value !== "string" || value.length === 0) {
        throw new Error(`config: vapid.${field} must be a non-empty string`);
      }
    }
    base.vapid = data.vapid;
  }
  return base;
}
