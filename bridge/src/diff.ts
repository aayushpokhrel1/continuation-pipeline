export interface DiffLine { sign: "+" | "-"; text: string; }
export interface DiffModel { path: string; lines: DiffLine[]; truncated: number; }

const MAX_LINES = 40;

function str(input: unknown, key: string): string | null {
  if (typeof input !== "object" || input === null) return null;
  const v = (input as Record<string, unknown>)[key];
  return typeof v === "string" ? v : null;
}

function splitLines(s: string): string[] {
  const lines = s.split("\n");
  if (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
  return lines;
}

export function buildDiff(toolName: string, input: unknown): DiffModel | null {
  let path: string;
  let lines: DiffLine[];

  if (toolName === "Edit") {
    const filePath = str(input, "file_path");
    const oldString = str(input, "old_string");
    const newString = str(input, "new_string");
    if (filePath === null || oldString === null || newString === null) return null;
    path = filePath;
    lines = [
      ...splitLines(oldString).map((text): DiffLine => ({ sign: "-", text })),
      ...splitLines(newString).map((text): DiffLine => ({ sign: "+", text })),
    ];
  } else if (toolName === "MultiEdit") {
    const filePath = str(input, "file_path");
    const edits = typeof input === "object" && input !== null
      ? (input as Record<string, unknown>).edits
      : undefined;
    if (filePath === null || !Array.isArray(edits)) return null;
    path = filePath;
    lines = [];
    for (const edit of edits) {
      const oldString = str(edit, "old_string");
      const newString = str(edit, "new_string");
      if (oldString === null || newString === null) return null;
      lines.push(...splitLines(oldString).map((text): DiffLine => ({ sign: "-", text })));
      lines.push(...splitLines(newString).map((text): DiffLine => ({ sign: "+", text })));
    }
  } else if (toolName === "Write") {
    const filePath = str(input, "file_path");
    const content = str(input, "content");
    if (filePath === null || content === null) return null;
    path = filePath;
    lines = splitLines(content).map((text): DiffLine => ({ sign: "+", text }));
  } else {
    return null;
  }

  const truncated = lines.length > MAX_LINES ? lines.length - MAX_LINES : 0;
  if (truncated > 0) lines = lines.slice(0, MAX_LINES);
  return { path, lines, truncated };
}
