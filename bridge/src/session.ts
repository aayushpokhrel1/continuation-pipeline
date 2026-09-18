import { ApprovalRegistry, type Decision } from "./approvals.ts";
import type { ApprovalMode, SessionSource } from "./source.ts";
import type { ServerMessage } from "./protocol.ts";

export type PushNotify = (sessionId: string, payload: { title: string; body: string }) => void;

export class Session {
  private approvals = new ApprovalRegistry();
  private pending = new Map<string, { name: string; input: unknown }>();
  sdkSessionId?: string;
  private emitFn: (m: ServerMessage) => void = () => {};

  constructor(
    private source: SessionSource,
    readonly repoPath: string,
    private mode: ApprovalMode,
    private onRegister: (s: Session) => void,
    private pushNotify: PushNotify,
  ) {}

  setMode(mode: ApprovalMode): void { this.mode = mode; }
  attach(emit: (m: ServerMessage) => void): void { this.emitFn = emit; }
  detach(): void { this.emitFn = () => {}; }

  private emit(m: ServerMessage): void {
    this.emitFn(m);
    const id = this.sdkSessionId ?? "";
    if (m.type === "approval") this.pushNotify(id, { title: "Approval needed", body: m.name });
    else if (m.type === "turn_done") this.pushNotify(id, { title: "Turn finished", body: "The agent is done." });
  }

  approve(id: string, decision: Decision): void {
    this.pending.delete(id);
    this.approvals.resolve(id, decision);
  }

  // Re-send unresolved approvals to the currently attached socket (on re-attach).
  replayPending(): void {
    for (const [id, { name, input }] of this.pending) this.emitFn({ type: "approval", id, name, input });
  }

  async handleUser(text: string): Promise<void> {
    try {
      await this.source.send({
        repoPath: this.repoPath,
        resumeId: this.sdkSessionId,
        text,
        mode: this.mode,
        onEvent: (e) => {
          if (e.kind === "session") {
            this.sdkSessionId = e.sessionId;
            this.onRegister(this);
            this.emit({ type: "ready", sessionId: e.sessionId });
          } else if (e.kind === "assistant") this.emit({ type: "assistant", text: e.text });
          else if (e.kind === "tool") this.emit({ type: "tool", name: e.name, input: e.input });
        },
        canUseTool: (name, input) => {
          const { id, promise } = this.approvals.create();
          this.pending.set(id, { name, input });
          this.emit({ type: "approval", id, name, input });
          return promise;
        },
      });
      this.emit({ type: "turn_done" });
    } catch (err) {
      this.emit({ type: "error", message: err instanceof Error ? err.message : String(err) });
    }
  }
}
