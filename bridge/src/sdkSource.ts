import { query as sdkQuery, listSessions as sdkListSessions, getSessionMessages as sdkGetSessionMessages } from "@anthropic-ai/claude-agent-sdk";
import type { SessionSource, SendParams, SessionInfo, TranscriptEvent } from "./source.ts";
import type { Decision } from "./approvals.ts";

type QueryFn = typeof sdkQuery;

// Map our decision onto the SDK PermissionResult. This is the one place that
// depends on the SDK permission shape.
function toPermissionResult(decision: Decision, input: Record<string, unknown>) {
  return decision === "allow"
    ? { behavior: "allow" as const, updatedInput: input }
    : { behavior: "deny" as const, message: "Denied from phone" };
}

export class SdkSessionSource implements SessionSource {
  constructor(
    private queryFn: QueryFn = sdkQuery,
    private listFn: typeof sdkListSessions = sdkListSessions,
    private historyFn: typeof sdkGetSessionMessages = sdkGetSessionMessages,
  ) {}

  async send(p: SendParams): Promise<{ sessionId: string }> {
    let sessionId = "";
    const options: Record<string, unknown> = {
      cwd: p.repoPath,
      resume: p.resumeId,
    };
    if (p.mode === "yolo") {
      options.permissionMode = "bypassPermissions";
    } else {
      options.permissionMode = "default";
      options.canUseTool = async (toolName: string, input: Record<string, unknown>) => {
        const decision = await p.canUseTool(toolName, input);
        return toPermissionResult(decision, input);
      };
      if (p.mode === "auto-safe") options.allowedTools = ["Read", "Glob", "Grep"];
    }
    const iterator = this.queryFn({
      prompt: p.text,
      options,
    } as any);

    for await (const msg of iterator as any) {
      if (msg.session_id && !sessionId) { sessionId = msg.session_id; p.onEvent({ kind: "session", sessionId }); }
      if (msg.type === "assistant" && msg.message?.content) {
        for (const block of msg.message.content) {
          if (block.type === "text") p.onEvent({ kind: "assistant", text: block.text });
          else if (block.type === "tool_use") p.onEvent({ kind: "tool", name: block.name, input: block.input });
        }
      } else if (msg.type === "result") {
        p.onEvent({ kind: "result" });
      }
    }
    return { sessionId };
  }

  async listSessions(repoPath: string): Promise<SessionInfo[]> {
    const infos = await this.listFn({ dir: repoPath } as any);
    return (infos as any[])
      .map((i) => ({
        sessionId: i.sessionId,
        title: i.customTitle ?? i.summary ?? i.firstPrompt ?? i.sessionId,
        lastModified: i.lastModified ?? 0,
      }))
      .sort((a, b) => b.lastModified - a.lastModified);
  }

  async getHistory(sessionId: string, repoPath: string): Promise<TranscriptEvent[]> {
    const msgs = await this.historyFn(sessionId, { dir: repoPath } as any);
    const out: TranscriptEvent[] = [];
    const textOf = (content: unknown): string =>
      typeof content === "string"
        ? content
        : Array.isArray(content)
          ? content.filter((b: any) => b?.type === "text").map((b: any) => b.text).join("")
          : "";
    for (const msg of msgs as any[]) {
      const content = msg.message?.content;
      if (msg.type === "user") {
        const text = textOf(content);
        if (text) out.push({ role: "user", text });
      } else if (msg.type === "assistant" && Array.isArray(content)) {
        for (const b of content) {
          if (b?.type === "text") out.push({ role: "assistant", text: b.text });
          else if (b?.type === "tool_use") out.push({ role: "assistant", tool: b.name });
        }
      }
    }
    return out;
  }
}
