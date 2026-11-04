// Stored documents stay Markdown, so the editor must give back what it was given.
// Every sample goes Markdown -> editor document -> Markdown. The two sides are compared
// by the block parser the reader renders with: a byte difference that renders the same
// (such as `*` for `-`) passes; anything that renders differently fails.
import { readFileSync } from "node:fs";
import { documentMarkdown, markdownToDocument } from "../src/lib/editor/document-markdown";
import { parseBlocks } from "../src/lib/markdown";

const SYNTAX = `# Heading one

## Heading two

### Heading three

A paragraph with **bold**, *italic*, ***both***, ~~struck~~, \`code\` and a [link](https://example.com/a?b=1).
Second line of the same paragraph.

- bullet one
- bullet two
  - nested bullet
    - deeper bullet
- bullet three

1. first
2. second
   1. nested ordered

- [ ] open todo
- [x] done todo
  - [ ] nested todo

> quoted line
> second quoted line

\`\`\`ts
const a = "**not bold**";
\`\`\`

---

| Name | Count | Note |
|:---|---:|:---:|
| one | 1 | **bold** |
| two | 2 | a \\| b |

![A picture](https://example.com/p.png)

See [[Design notes|page-1]] and [[Bare title]] and [TAC-12](issue:abc-123) inline.

![[Embedded doc|page-2]]

![[Bare embed]]

中文段落，带 **加粗** 和 [链接](https://example.com)。

Literal \\*stars\\* stay literal, R&D uses a < b and a > c.

| Cell | With break |
|---|---|
| a | line one<br>line two |

Paragraph above two empty lines.



Paragraph below them.

  Indented paragraph.
`;

const SAMPLES: [string, string][] = [["syntax", SYNTAX]];
for (const file of ["README.md", "AGENTS.md", "docs/harness-contracts.md", "docs/windows-signing.md", "docs/plans/team-2.2.md"]) {
  SAMPLES.push([file, readFileSync(file, "utf8")]);
}

// Differences the editor makes on purpose. A wrapped list item becomes one line, and spaces
// at the end of a line go away; neither changes what a reader sees.
function explained(source: string): string {
  const out: string[] = [];
  for (const line of source.replace(/[ \t]+$/gm, "").split("\n")) {
    const previous = out[out.length - 1] ?? "";
    const inItem = /^\s*([-*+]|\d+[.)])\s+/.test(previous);
    const marker = /^\s*([-*+]|\d+[.)]|>|#|\|)(\s|$)/.test(line);
    if (inItem && /^\s+\S/.test(line) && !marker) out[out.length - 1] = `${previous} ${line.trim()}`;
    else out.push(line);
  }
  return out.join("\n");
}

const manager = documentMarkdown();
const failures: string[] = [];
for (const [name, source] of SAMPLES) {
  const back = manager.serialize(markdownToDocument(manager, source));
  const before = parseBlocks(explained(source));
  const after = parseBlocks(back.replace(/[ \t]+$/gm, ""));
  const count = Math.max(before.length, after.length);
  for (let i = 0; i < count; i += 1) {
    const a = JSON.stringify(before[i]);
    const b = JSON.stringify(after[i]);
    if (a !== b) {
      failures.push(`${name} block ${i}\n  before ${a}\n  after  ${b}`);
      break;
    }
  }
  // A second pass must not keep changing the text.
  const again = manager.serialize(markdownToDocument(manager, back));
  if (again !== back) failures.push(`${name}: second round trip changed the text`);
}
if (failures.length) {
  console.error(failures.join("\n"));
  process.exit(1);
}
console.log(`check-editor-roundtrip: ${SAMPLES.length} samples unchanged`);
