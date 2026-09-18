import { readFileSync, writeFileSync, existsSync } from "node:fs";

// Set of archived session ids, optionally persisted to a JSON file. In-memory when no path.
export class ArchiveStore {
  private ids = new Set<string>();
  constructor(private storePath?: string) {
    if (storePath && existsSync(storePath)) {
      try { this.ids = new Set(JSON.parse(readFileSync(storePath, "utf8")) as string[]); } catch { this.ids = new Set(); }
    }
  }
  has(id: string): boolean { return this.ids.has(id); }
  archive(id: string): void { this.ids.add(id); this.persist(); }
  unarchive(id: string): void { this.ids.delete(id); this.persist(); }
  private persist(): void {
    if (!this.storePath) return;
    try { writeFileSync(this.storePath, JSON.stringify([...this.ids])); } catch { /* best effort */ }
  }
}
