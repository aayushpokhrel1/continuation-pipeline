import webpush from "web-push";
import { readFileSync, writeFileSync, existsSync } from "node:fs";

export interface Vapid { subject: string; publicKey: string; privateKey: string; }
export type PushPayload = { title: string; body: string };
type Sub = webpush.PushSubscription;
export type SendFn = (sub: Sub, payload: string) => Promise<unknown>;

// The subset server.ts needs, so tests can pass a fake.
export interface PushLike {
  readonly publicKey: string;
  add(sub: Sub): void;
  notify(payload: PushPayload): Promise<void>;
}

export class PushService implements PushLike {
  private subs: Sub[] = [];
  private send: SendFn;
  constructor(private vapid: Vapid, private storePath: string, send?: SendFn) {
    // Do NOT call webpush.setVapidDetails here (it validates key format and would break
    // tests that inject a fake sender with dummy keys). Instead the real sender passes
    // vapidDetails per call.
    this.send = send ?? ((sub, payload) =>
      webpush.sendNotification(sub, payload, {
        vapidDetails: {
          subject: this.vapid.subject,
          publicKey: this.vapid.publicKey,
          privateKey: this.vapid.privateKey,
        },
      }));
    if (existsSync(storePath)) {
      try { this.subs = JSON.parse(readFileSync(storePath, "utf8")) as Sub[]; } catch { this.subs = []; }
    }
  }
  get publicKey(): string { return this.vapid.publicKey; }
  add(sub: Sub): void {
    if (!this.subs.some((s) => s.endpoint === sub.endpoint)) {
      this.subs.push(sub);
      this.persist();
    }
  }
  async notify(payload: PushPayload): Promise<void> {
    const json = JSON.stringify(payload);
    const gone: string[] = [];
    await Promise.all(this.subs.map(async (s) => {
      try { await this.send(s, json); }
      catch (err) {
        const code = (err as { statusCode?: number })?.statusCode;
        if (code === 404 || code === 410) gone.push(s.endpoint);  // subscription expired
      }
    }));
    if (gone.length) {
      this.subs = this.subs.filter((s) => !gone.includes(s.endpoint));
      this.persist();
    }
  }
  private persist(): void {
    try { writeFileSync(this.storePath, JSON.stringify(this.subs)); } catch { /* best effort */ }
  }
}
