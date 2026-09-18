import type { Config } from "./config.ts";
import type { SessionInfo } from "./source.ts";
import { discoverRepos } from "./repos.ts";

export interface OverviewSession extends SessionInfo { repo: string; repoPath: string; }
export interface OverviewRepo { name: string; path: string; lastModified: number; live: boolean; }
export interface Overview { items: OverviewSession[]; repos: OverviewRepo[]; }

// Minimal surface buildOverview needs; SessionManager satisfies it structurally.
export interface OverviewManager {
  listSessions(repoPath: string, archived?: boolean): Promise<SessionInfo[]>;
  liveRepoPaths(): Set<string>;
}

// Cross-repo view: every repo's sessions merged into one recency-sorted list, plus per-repo
// summaries. A repo that fails to list is treated as empty rather than failing the whole call.
export async function buildOverview(config: Config, manager: OverviewManager): Promise<Overview> {
  const live = manager.liveRepoPaths();
  const items: OverviewSession[] = [];
  const repos: OverviewRepo[] = [];

  for (const repo of discoverRepos(config)) {
    let sessions: SessionInfo[];
    try {
      sessions = await manager.listSessions(repo.path, false);
    } catch {
      sessions = [];
    }
    items.push(...sessions.map((s) => ({ ...s, repo: repo.name, repoPath: repo.path })));
    repos.push({
      name: repo.name,
      path: repo.path,
      lastModified: sessions.reduce((max, s) => Math.max(max, s.lastModified), 0),
      live: live.has(repo.path),
    });
  }

  items.sort((a, b) => b.lastModified - a.lastModified);
  repos.sort((a, b) => (Number(b.live) - Number(a.live)) || (b.lastModified - a.lastModified));
  return { items, repos };
}
