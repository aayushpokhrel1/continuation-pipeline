import type { Decision } from "./approvals.ts";

export type StreamEvent =
  | { kind: "assistant"; text: string }
  | { kind: "tool"; name: string; input: unknown }
  | { kind: "result" };

export type CanUseToolFn = (name: string, input: unknown) => Promise<Decision>;

export interface SendParams {
  repoPath: string;
  resumeId?: string;
  text: string;
  canUseTool: CanUseToolFn;
  onEvent: (e: StreamEvent) => void;
}

export interface SessionSource {
  send(p: SendParams): Promise<{ sessionId: string }>;
}
