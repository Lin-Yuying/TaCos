/**
 * Updates panel rendered diffs (docs/plans/team-2.3.md item 11): inline word changes and tables as tables.
 *   node --import tsx scripts/check-doc-updates-diff.ts
 */
function assert(ok: unknown, message: string) {
  if (!ok) {
    console.error(`FAIL ${message}`);
    process.exit(1);
  }
}

async function main() {
  const { docDiffItems, summarizeDocDiff, visibleInlineDiff } = await import("../src/lib/doc-diff-render");
  const { parseBlock } = await import("../src/lib/markdown");

  const inline = visibleInlineDiff("Hello world", "Hello brave world");
  assert(inline.some((part) => part.kind === "add" && part.text.includes("brave")), "inline diff marks added words");
  assert(inline.some((part) => part.kind === "same" && part.text.includes("Hello")), "inline diff keeps unchanged words");

  const textItems = docDiffItems("Intro\n\nOld **bold** line", "Intro\n\nNew **bold** line");
  assert(
    textItems.some((item) => item.kind === "inline" && item.segments.some((s) => s.kind === "del" && s.text.includes("Old"))),
    "paragraph edits become inline diff items"
  );

  const tableBefore = "| Name | Qty |\n| --- | --- |\n| Apple | 2 |\n| Pear | 1 |";
  const tableAfter = "| Name | Qty |\n| --- | --- |\n| Apple | 3 |\n| Pear | 1 |";
  const tableItems = docDiffItems(tableBefore, tableAfter);
  assert(tableItems.length === 1 && tableItems[0].kind === "table", "table edits stay one table item");
  const table = tableItems[0];
  assert(table?.kind === "table", "table item shape");
  if (table.kind !== "table") return;
  const qtyCell = table.rows[0]?.[1];
  assert(
    qtyCell?.kind === "inline" && qtyCell.segments.some((s) => s.kind === "add" && s.text.includes("3")),
    "table cell uses inline diff"
  );
  assert(parseBlock(tableBefore).kind === "table", "fixture parses as table");

  const addedTable = docDiffItems("Before", `Before\n\n${tableAfter}`);
  assert(
    addedTable.some((item) => item.kind === "add" && item.block.kind === "table"),
    "new table blocks render as table adds"
  );

  const summary = summarizeDocDiff(tableBefore, tableAfter);
  assert(summary.tables === 1 && summary.tableCells >= 4, "summary counts table cells");

  console.log("check-doc-updates-diff: ok");
}

void main();
