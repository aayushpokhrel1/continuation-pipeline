import { randomUUID } from "node:crypto";

export type Decision = "allow" | "deny";

export class ApprovalRegistry {
  private pending = new Map<string, (d: Decision) => void>();

  create(): { id: string; promise: Promise<Decision> } {
    const id = randomUUID();
    const promise = new Promise<Decision>((resolve) => {
      this.pending.set(id, resolve);
    });
    return { id, promise };
  }

  resolve(id: string, decision: Decision): boolean {
    const fn = this.pending.get(id);
    if (!fn) return false;
    this.pending.delete(id);
    fn(decision);
    return true;
  }
}
