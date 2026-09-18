import type { Decision } from "./approvals.ts";
import type { DiffModel } from "./diff.ts";
import type { ApprovalMode, SessionInfo, TranscriptEvent } from "./source.ts";
import type { OverviewSession, OverviewRepo } from "./overview.ts";

export type ClientMessage =
  | { type: "list"; repo: string; archived?: boolean }
  | { type: "listAll" }
  | { type: "start"; repo: string; mode?: ApprovalMode }
  | { type: "attach"; sessionId: string; repo: string; mode?: ApprovalMode }
  | { type: "user"; text: string }
  | { type: "approve"; id: string; decision: Decision }
  | { type: "archive"; sessionId: string }
  | { type: "unarchive"; sessionId: string };

export type ServerMessage =
  | { type: "ready"; sessionId: string }
  | { type: "sessions"; items: SessionInfo[]; archived: boolean }
  | { type: "sessionsAll"; items: OverviewSession[]; repos: OverviewRepo[] }
  | { type: "history"; messages: TranscriptEvent[] }
  | { type: "assistant"; text: string }
  | { type: "tool"; name: string; input: unknown; diff?: DiffModel }
  | { type: "approval"; id: string; name: string; input: unknown; diff?: DiffModel }
  | { type: "turn_done" }
  | { type: "error"; message: string };
