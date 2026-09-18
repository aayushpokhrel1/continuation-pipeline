import { Session, type PushNotify } from "./session.ts";
import type { ApprovalMode, SessionSource, SessionInfo, TranscriptEvent } from "./source.ts";

// Registry of live sessions that outlive individual WebSocket connections.
// ponytail: never evicted (process-lifetime); add idle eviction if memory ever matters.
export class SessionManager {
  private sessions = new Map<string, Session>();

  constructor(private source: SessionSource, private pushNotify: PushNotify) {}

  create(repoPath: string, mode: ApprovalMode): Session {
    return new Session(this.source, repoPath, mode, (s) => this.register(s), this.pushNotify);
  }

  register(s: Session): void {
    if (s.sdkSessionId) this.sessions.set(s.sdkSessionId, s);
  }

  get(sessionId: string): Session | undefined { return this.sessions.get(sessionId); }

  getOrCreate(sessionId: string, repoPath: string, mode: ApprovalMode): Session {
    let s = this.sessions.get(sessionId);
    if (!s) {
      s = this.create(repoPath, mode);
      s.sdkSessionId = sessionId;
      this.sessions.set(sessionId, s);
    }
    return s;
  }

  async listSessions(repoPath: string): Promise<SessionInfo[]> {
    return this.source.listSessions ? this.source.listSessions(repoPath) : [];
  }

  async getHistory(sessionId: string, repoPath: string): Promise<TranscriptEvent[]> {
    return this.source.getHistory ? this.source.getHistory(sessionId, repoPath) : [];
  }
}
