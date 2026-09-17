import type { Decision } from "./approvals.ts";

export type ClientMessage =
  | { type: "start"; repo: string }
  | { type: "user"; text: string }
  | { type: "approve"; id: string; decision: Decision };

export type ServerMessage =
  | { type: "ready"; sessionId: string }
  | { type: "assistant"; text: string }
  | { type: "tool"; name: string; input: unknown }
  | { type: "approval"; id: string; name: string; input: unknown }
  | { type: "turn_done" }
  | { type: "error"; message: string };
