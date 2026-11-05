"use client";

import { useMemo } from "react";
import { useT } from "@/components/i18n-context";
import { docDiffItems, type DiffSegment, type DocDiffCell, type DocDiffItem } from "@/lib/doc-diff-render";
import { parseInline, type Block, type Inline, type TableAlign } from "@/lib/markdown";

const segmentClass = (kind: DiffSegment["kind"]) =>
  kind === "add"
    ? "bg-code-string/10 text-text"
    : kind === "del"
      ? "bg-danger/10 text-muted line-through"
      : "text-text";

function DiffSegments({ segments }: { segments: DiffSegment[] }) {
  if (segments.length === 0) return null;
  return (
    <span data-doc-diff-inline className="whitespace-pre-wrap break-words text-body leading-relaxed">
      {segments.map((segment, i) => (
        <span key={i} data-diff={segment.kind} className={segmentClass(segment.kind)}>
          {segment.text}
        </span>
      ))}
    </span>
  );
}

function DiffInlines({ nodes }: { nodes: Inline[] }) {
  return (
    <>
      {nodes.map((node, i) => {
        switch (node.type) {
          case "bold":
            return (
              <strong key={i} className="font-semibold">
                {node.text}
              </strong>
            );
          case "italic":
            return <em key={i}>{node.text}</em>;
          case "bolditalic":
            return (
              <strong key={i} className="font-semibold">
                <em>{node.text}</em>
              </strong>
            );
          case "strike":
            return <s key={i}>{node.text}</s>;
          case "code":
            return (
              <code key={i} className="rounded bg-elevated px-1 py-0.5 font-mono text-small">
                {node.text}
              </code>
            );
          case "link":
            return (
              <a key={i} href={node.href} className="text-accent underline underline-offset-2">
                {node.text}
              </a>
            );
          default:
            return <span key={i}>{node.text}</span>;
        }
      })}
    </>
  );
}

function DiffBlock({ block, tone }: { block: Block; tone: "same" | "add" | "del" }) {
  const frame =
    tone === "add"
      ? "rounded bg-code-string/10 px-1 py-0.5"
      : tone === "del"
        ? "rounded bg-danger/10 px-1 py-0.5 text-muted line-through"
        : "text-muted";
  switch (block.kind) {
    case "heading": {
      const level = Math.min(6, Math.max(1, block.level));
      const sizes = ["text-title", "text-lead", "text-body", "text-body", "text-small", "text-small"];
      return (
        <div className={`my-1 ${frame}`} data-diff={tone}>
          <div className={`font-semibold ${sizes[level - 1]}`}>
            <DiffInlines nodes={block.text} />
          </div>
        </div>
      );
    }
    case "paragraph":
      return (
        <p className={`my-1 whitespace-pre-wrap text-body leading-relaxed ${frame}`} data-diff={tone}>
          {block.lines.map((line, i) => (
            <span key={i}>
              <DiffInlines nodes={line} />
              {i < block.lines.length - 1 ? "\n" : ""}
            </span>
          ))}
        </p>
      );
    case "quote":
      return (
        <blockquote
          className={`my-1 border-l-2 border-border pl-3 text-body leading-relaxed ${frame}`}
          data-diff={tone}
        >
          {block.lines.map((line, i) => (
            <span key={i}>
              <DiffInlines nodes={line} />
              {i < block.lines.length - 1 ? "\n" : ""}
            </span>
          ))}
        </blockquote>
      );
    case "code":
      return (
        <pre
          className={`my-1 overflow-x-auto rounded border border-border bg-elevated px-2 py-1 font-mono text-small ${frame}`}
          data-diff={tone}
        >
          {block.body}
        </pre>
      );
    case "divider":
      return <hr className="my-2 border-border" data-diff={tone} />;
    case "table": {
      const cellKind = tone === "same" ? ("same" as const) : tone;
      return (
        <DiffTable
          align={block.align}
          header={block.header.map((text) => ({ kind: cellKind, text }))}
          rows={block.rows.map((row) => row.map((text) => ({ kind: cellKind, text })))}
        />
      );
    }
    default:
      return null;
  }
}

function DiffTableCell({ cell }: { cell: DocDiffCell }) {
  switch (cell.kind) {
    case "same":
      return (
        <span className="text-body">
          <DiffInlines nodes={parseInline(cell.text)} />
        </span>
      );
    case "add":
      return (
        <span data-diff="add" className="rounded bg-code-string/10 px-0.5">
          <DiffInlines nodes={parseInline(cell.text)} />
        </span>
      );
    case "del":
      return (
        <span data-diff="del" className="rounded bg-danger/10 px-0.5 text-muted line-through">
          <DiffInlines nodes={parseInline(cell.text)} />
        </span>
      );
    case "inline":
      return <DiffSegments segments={cell.segments} />;
    default:
      return null;
  }
}

function DiffTable({
  align,
  header,
  rows,
}: {
  align: (TableAlign | null)[];
  header: DocDiffCell[];
  rows: DocDiffCell[][];
}) {
  const alignOf = (a: TableAlign | null) => (a ? { textAlign: a } : undefined);
  return (
    <div className="my-2 overflow-x-auto">
      <table data-doc-diff-table className="w-full border-collapse text-body">
        <thead>
          <tr>
            {header.map((cell, i) => (
              <th
                key={i}
                className="border border-border bg-elevated/60 px-2 py-1 text-left font-medium"
                style={alignOf(align[i] ?? null)}
              >
                <DiffTableCell cell={cell} />
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, ri) => (
            <tr key={ri}>
              {row.map((cell, ci) => (
                <td key={ci} className="border border-border px-2 py-1 align-top" style={alignOf(align[ci] ?? null)}>
                  <DiffTableCell cell={cell} />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function DiffItem({ item }: { item: DocDiffItem }) {
  const t = useT();
  switch (item.kind) {
    case "gap":
      return (
        <div className="px-1 py-0.5 text-small text-faint" data-doc-diff-gap>
          {t("{count} unchanged blocks", { count: item.count })}
        </div>
      );
    case "same":
      return <DiffBlock block={item.block} tone="same" />;
    case "add":
      return <DiffBlock block={item.block} tone="add" />;
    case "del":
      return <DiffBlock block={item.block} tone="del" />;
    case "inline":
      return (
        <div className="my-1 rounded px-1 py-0.5 text-body leading-relaxed" data-doc-diff-inline-block>
          <DiffSegments segments={item.segments} />
        </div>
      );
    case "table":
      return <DiffTable align={item.align} header={item.header} rows={item.rows} />;
    default:
      return null;
  }
}

export function DocDiffRendered({ before, after }: { before: string; after: string }) {
  const t = useT();
  const items = useMemo(() => docDiffItems(before, after), [before, after]);
  if (before === after) return <p className="text-small text-faint">{t("No text changed.")}</p>;
  return (
    <div data-doc-diff className="space-y-0.5 text-small">
      {items.map((item, index) => (
        <DiffItem key={index} item={item} />
      ))}
    </div>
  );
}
