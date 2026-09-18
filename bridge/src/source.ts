import type { Decision } from "./approvals.ts";

export type StreamEvent =
  | { kind: "assistant"; text: string }
  | { kind: "tool"; name: string; input: unknown }
  | { kind: "result" }
  | { kind: "session"; sessionId: string };

export interface SessionInfo { sessionId: string; title: string; lastModified: number; }
export interface TranscriptEvent { role: "user" | "assistant"; text?: string; tool?: string; }

export type CanUseToolFn = (name: string, input: unknown) => Promise<Decision>;

export type ApprovalMode = "ask" | "auto-safe" | "yolo";

export interface SendParams {
  repoPath: string;
  resumeId?: string;
  text: string;
  mode: ApprovalMode;
  canUseTool: CanUseToolFn;
  onEvent: (e: StreamEvent) => void;
}

export interface SessionSource {
  send(p: SendParams): Promise<{ sessionId: string }>;
  listSessions?(repoPath: string): Promise<SessionInfo[]>;
  getHistory?(sessionId: string, repoPath: string): Promise<TranscriptEvent[]>;
}
