import { diffLines } from "diff";

export type DiffRow =
  | { kind: "same" | "add" | "del"; text: string }
  | { kind: "gap"; count: number };

// Lines kept around a change; a long unchanged run collapses into one row.
const CONTEXT = 2;

export function docDiffRows(before: string, after: string): DiffRow[] {
  const rows: DiffRow[] = [];
  const parts = diffLines(before, after);
  parts.forEach((part, index) => {
    const lines = part.value.replace(/\n$/, "").split("\n");
    if (part.added || part.removed) {
      for (const text of lines) rows.push({ kind: part.added ? "add" : "del", text });
      return;
    }
    const head = index === 0 ? 0 : CONTEXT;
    const tail = index === parts.length - 1 ? 0 : CONTEXT;
    if (lines.length <= head + tail + 1) {
      for (const text of lines) rows.push({ kind: "same", text });
      return;
    }
    for (const text of lines.slice(0, head)) rows.push({ kind: "same", text });
    rows.push({ kind: "gap", count: lines.length - head - tail });
    for (const text of lines.slice(lines.length - tail)) rows.push({ kind: "same", text });
  });
  return rows;
}
