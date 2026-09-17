import { ApprovalRegistry, type Decision } from "./approvals.ts";
import type { SessionSource } from "./source.ts";
import type { ServerMessage } from "./protocol.ts";

export class Session {
  private approvals = new ApprovalRegistry();
  private sessionId?: string;

  constructor(
    private source: SessionSource,
    private repoPath: string,
    private emit: (m: ServerMessage) => void,
  ) {}

  approve(id: string, decision: Decision): void {
    this.approvals.resolve(id, decision);
  }

  async handleUser(text: string): Promise<void> {
    try {
      const { sessionId } = await this.source.send({
        repoPath: this.repoPath,
        resumeId: this.sessionId,
        text,
        onEvent: (e) => {
          if (e.kind === "assistant") this.emit({ type: "assistant", text: e.text });
          else if (e.kind === "tool") this.emit({ type: "tool", name: e.name, input: e.input });
        },
        canUseTool: (name, input) => {
          const { id, promise } = this.approvals.create();
          this.emit({ type: "approval", id, name, input });
          return promise;
        },
      });
      this.sessionId = sessionId;
      this.emit({ type: "ready", sessionId });
      this.emit({ type: "turn_done" });
    } catch (err) {
      this.emit({ type: "error", message: err instanceof Error ? err.message : String(err) });
    }
  }
}
