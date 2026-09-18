import { query as sdkQuery } from "@anthropic-ai/claude-agent-sdk";
import type { SessionSource, SendParams } from "./source.ts";
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
  constructor(private queryFn: QueryFn = sdkQuery) {}

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
      if (msg.session_id && !sessionId) sessionId = msg.session_id;
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
}
