import { existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import type { Config, RepoRef } from "./config.ts";

// Configured repos, plus every immediate subdirectory of config.projectsDir that contains a
// .git entry. Deduped by path (configured repos win). ponytail: naive sync scan on each call;
// fine for a handful of dirs and infrequent (user-action) calls.
export function discoverRepos(config: Config): RepoRef[] {
  const out: RepoRef[] = [...config.repos];
  const seen = new Set(out.map((r) => r.path));
  if (config.projectsDir && existsSync(config.projectsDir)) {
    for (const name of readdirSync(config.projectsDir)) {
      const path = join(config.projectsDir, name);
      try {
        if (!statSync(path).isDirectory()) continue;
        if (!existsSync(join(path, ".git"))) continue;
        if (seen.has(path)) continue;
        seen.add(path);
        out.push({ name, path });
      } catch { /* unreadable entry, skip */ }
    }
  }
  return out;
}
