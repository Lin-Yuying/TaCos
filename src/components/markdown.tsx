import type { ReactNode } from "react";
import { parseBlocks, type Block, type Inline } from "@/lib/markdown";

function renderInline(nodes: Inline[], keyPrefix: string): ReactNode[] {
  return nodes.map((node, i) => {
    const key = `${keyPrefix}-${i}`;
    switch (node.type) {
      case "bold":
        return (
          <strong key={key} className="font-semibold">
            {node.text}
          </strong>
        );
      case "italic":
        return (
          <em key={key}>{node.text}</em>
        );
      case "strike":
        return (
          <s key={key}>{node.text}</s>
        );
      case "code":
        return (
          <code
            key={key}
            className="rounded bg-elevated px-1 py-0.5 font-mono text-[12px] text-text"
          >
            {node.text}
          </code>
        );
      case "link":
        return (
          <a
            key={key}
            href={node.href}
            target="_blank"
            rel="noopener noreferrer"
            className="text-accent underline decoration-accent/40 underline-offset-2 hover:decoration-accent"
          >
            {node.text}
          </a>
        );
      default:
        return node.text;
    }
  });
}

export function MarkdownBlock({
  block,
  onToggleTodo,
}: {
  block: Block;
  onToggleTodo?: (itemIndex: number, checked: boolean) => void;
}) {
  switch (block.kind) {
    case "heading": {
      const size = ["text-[20px]", "text-[17px]", "text-[15px]", "text-[14px]", "text-[13px]", "text-[13px]"][
        block.level - 1
      ];
      const Tag = (`h${block.level}` as unknown) as "h1";
      return (
        <Tag
          className={`${size} mt-5 mb-1.5 font-semibold tracking-tight first:mt-0`}
          style={{ marginLeft: block.depth * 20 }}
        >
          {renderInline(block.text, "h")}
        </Tag>
      );
    }
    case "quote":
      return (
        <blockquote
          className="my-2 border-l-2 border-border-strong pl-3 text-muted"
          style={{ marginLeft: block.depth * 20 }}
        >
          {block.lines.map((line, i) => (
            <p key={i} className="text-[13.5px] leading-relaxed">
              {renderInline(line, `q${i}`)}
            </p>
          ))}
        </blockquote>
      );
    case "list":
      return block.ordered ? (
        <ol className="my-1.5 list-decimal space-y-1 text-[13.5px] leading-relaxed marker:text-faint">
          {block.items.map((item, i) => (
            <li key={i} style={{ marginLeft: item.depth * 20 }} className="pl-6">
              {renderInline(item.text, `l${i}`)}
            </li>
          ))}
        </ol>
      ) : (
        <ul className="my-1.5 list-disc space-y-1 text-[13.5px] leading-relaxed marker:text-faint">
          {block.items.map((item, i) => (
            <li key={i} style={{ marginLeft: item.depth * 20 }} className="pl-6">
              {renderInline(item.text, `l${i}`)}
            </li>
          ))}
        </ul>
      );
    case "todo":
      return (
        <div className="my-1.5 space-y-1">
          {block.items.map((item, i) => (
            <div
              key={i}
              className="flex items-start gap-2 text-[13.5px] leading-relaxed"
              style={{ marginLeft: item.depth * 20 }}
            >
              <button
                type="button"
                role="checkbox"
                aria-checked={item.checked}
                aria-label={item.checked ? "Mark as not done" : "Mark as done"}
                // Without a handler the box is just how the block looks while you edit it.
                disabled={!onToggleTodo}
                onClick={(event) => {
                  // Ticking the box is not a request to edit the line.
                  event.stopPropagation();
                  onToggleTodo?.(i, !item.checked);
                }}
                className={`mt-[3px] flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded border text-[9px] ${
                  item.checked ? "border-accent bg-accent text-white" : "border-border-strong bg-bg"
                } ${onToggleTodo ? "cursor-pointer transition-colors hover:border-accent" : ""}`}
              >
                {item.checked ? "✓" : ""}
              </button>
              <span className={item.checked ? "text-faint line-through" : undefined}>
                {renderInline(item.text, `t${i}`)}
              </span>
            </div>
          ))}
        </div>
      );
    case "code":
      return (
        <pre className="my-2 overflow-x-auto rounded-lg border border-border bg-surface p-3 font-mono text-[12.5px] leading-relaxed text-text">
          <code>{block.body}</code>
        </pre>
      );
    case "divider":
      return <hr className="my-4 border-border" />;
    default:
      return (
        <p
          className="my-1.5 whitespace-pre-wrap text-[13.5px] leading-relaxed"
          style={{ marginLeft: block.depth * 20 }}
        >
          {block.lines.map((line, i) => (
            <span key={i}>
              {renderInline(line, `p${i}`)}
              {i < block.lines.length - 1 ? "\n" : ""}
            </span>
          ))}
        </p>
      );
  }
}

export function Markdown({ source }: { source: string }) {
  const blocks = parseBlocks(source);
  if (blocks.length === 0) return null;
  return (
    <div>
      {blocks.map((block, i) => (
        <MarkdownBlock key={i} block={block} />
      ))}
    </div>
  );
}
