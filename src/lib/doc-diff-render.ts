import { diffArrays, diffWordsWithSpace } from "diff";
import { splitBlocks, parseBlock, visiblePassage, type Block, type TableAlign } from "@/lib/markdown";

export type DiffSegment = { kind: "same" | "add" | "del"; text: string };

export type DocDiffCell =
  | { kind: "same"; text: string }
  | { kind: "add"; text: string }
  | { kind: "del"; text: string }
  | { kind: "inline"; before: string; after: string; segments: DiffSegment[] };

export type DocDiffItem =
  | { kind: "gap"; count: number }
  | { kind: "same"; raw: string; block: Block }
  | { kind: "add"; raw: string; block: Block }
  | { kind: "del"; raw: string; block: Block }
  | { kind: "inline"; before: string; after: string; segments: DiffSegment[]; blockBefore: Block; blockAfter: Block }
  | {
      kind: "table";
      align: (TableAlign | null)[];
      header: DocDiffCell[];
      rows: DocDiffCell[][];
    };

const CONTEXT = 2;

export function visibleInlineDiff(before: string, after: string): DiffSegment[] {
  const parts = diffWordsWithSpace(visiblePassage(before), visiblePassage(after));
  return parts
    .filter((part) => part.value.length > 0)
    .map((part) => ({
      kind: part.added ? ("add" as const) : part.removed ? ("del" as const) : ("same" as const),
      text: part.value,
    }));
}

function diffCell(before: string | undefined, after: string | undefined): DocDiffCell {
  const left = before ?? "";
  const right = after ?? "";
  if (left === right) return { kind: "same", text: right };
  if (!left) return { kind: "add", text: right };
  if (!right) return { kind: "del", text: left };
  return { kind: "inline", before: left, after: right, segments: visibleInlineDiff(left, right) };
}

function tableDiff(before: Block, after: Block): DocDiffItem | null {
  if (before.kind !== "table" || after.kind !== "table") return null;
  const cols = Math.max(before.header.length, after.header.length);
  const rows = Math.max(before.rows.length, after.rows.length);
  const align = before.align.length >= after.align.length ? before.align : after.align;
  const header: DocDiffCell[] = [];
  for (let c = 0; c < cols; c += 1) {
    header.push(diffCell(before.header[c], after.header[c]));
  }
  const body: DocDiffCell[][] = [];
  for (let r = 0; r < rows; r += 1) {
    const row: DocDiffCell[] = [];
    for (let c = 0; c < cols; c += 1) {
      row.push(diffCell(before.rows[r]?.[c], after.rows[r]?.[c]));
    }
    body.push(row);
  }
  return { kind: "table", align: align.slice(0, cols), header, rows: body };
}

function pairKind(before: Block, after: Block): "table" | "inline" | null {
  if (before.kind === "table" && after.kind === "table") return "table";
  const inlineKinds = new Set(["paragraph", "heading", "quote"]);
  if (inlineKinds.has(before.kind) && inlineKinds.has(after.kind)) return "inline";
  return null;
}

type RawPart = { added?: boolean; removed?: boolean; value: string[] };

function itemsFromSameRun(blocks: string[]): DocDiffItem[] {
  if (blocks.length === 0) return [];
  if (blocks.length <= CONTEXT * 2 + 1) {
    return blocks.map((raw) => ({ kind: "same" as const, raw, block: parseBlock(raw) }));
  }
  const items: DocDiffItem[] = [];
  for (const raw of blocks.slice(0, CONTEXT)) items.push({ kind: "same", raw, block: parseBlock(raw) });
  items.push({ kind: "gap", count: blocks.length - CONTEXT * 2 });
  for (const raw of blocks.slice(blocks.length - CONTEXT)) items.push({ kind: "same", raw, block: parseBlock(raw) });
  return items;
}

/** Rendered diff tree for the Updates panel and conflict preview. */
export function docDiffItems(before: string, after: string): DocDiffItem[] {
  if (before === after) return [];
  const left = splitBlocks(before);
  const right = splitBlocks(after);
  const parts = diffArrays(left, right) as RawPart[];
  const items: DocDiffItem[] = [];

  for (let i = 0; i < parts.length; i += 1) {
    const part = parts[i];
    if (!part.added && !part.removed) {
      items.push(...itemsFromSameRun(part.value));
      continue;
    }
    if (part.removed) {
      const next = parts[i + 1];
      if (next?.added && part.value.length === 1 && next.value.length === 1) {
        const rawBefore = part.value[0];
        const rawAfter = next.value[0];
        const blockBefore = parseBlock(rawBefore);
        const blockAfter = parseBlock(rawAfter);
        const mode = pairKind(blockBefore, blockAfter);
        if (mode === "table") {
          const table = tableDiff(blockBefore, blockAfter);
          if (table) items.push(table);
        } else if (mode === "inline") {
          items.push({
            kind: "inline",
            before: rawBefore,
            after: rawAfter,
            segments: visibleInlineDiff(rawBefore, rawAfter),
            blockBefore,
            blockAfter,
          });
        } else {
          items.push({ kind: "del", raw: rawBefore, block: blockBefore });
          items.push({ kind: "add", raw: rawAfter, block: blockAfter });
        }
        i += 1;
        continue;
      }
      for (const raw of part.value) items.push({ kind: "del", raw, block: parseBlock(raw) });
      continue;
    }
    for (const raw of part.value) items.push({ kind: "add", raw, block: parseBlock(raw) });
  }
  return items;
}

/** Flattened markers for cheap check scripts (no React). */
export function summarizeDocDiff(before: string, after: string) {
  const items = docDiffItems(before, after);
  const segments: DiffSegment[] = [];
  let tables = 0;
  let tableCells = 0;
  for (const item of items) {
    if (item.kind === "inline") segments.push(...item.segments);
    if (item.kind === "table") {
      tables += 1;
      for (const cell of [...item.header, ...item.rows.flat()]) {
        tableCells += 1;
        if (cell.kind === "inline") segments.push(...cell.segments);
      }
    }
  }
  return { items, segments, tables, tableCells };
}
