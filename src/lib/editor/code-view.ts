import { Extension } from "@tiptap/core";
import type { Node as PMNode } from "@tiptap/pm/model";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";

type CodeView = { lineNumbers: boolean; collapsed: number[]; decorations: DecorationSet };
type CodeViewChange = { lineNumbers?: boolean; toggle?: number };

export const codeViewKey = new PluginKey<CodeView>("documentCodeView");

function lineNumber(n: number) {
  const mark = document.createElement("span");
  mark.className = "doc-code-line-number";
  mark.contentEditable = "false";
  mark.textContent = String(n);
  return mark;
}

function decorate(doc: PMNode, lineNumbers: boolean, collapsed: number[]) {
  const out: Decoration[] = [];
  doc.descendants((node, pos) => {
    if (node.type.name !== "codeBlock") return;
    if (collapsed.includes(pos)) out.push(Decoration.node(pos, pos + node.nodeSize, { class: "doc-code-collapsed" }));
    if (lineNumbers) {
      let offset = 0;
      node.textContent.split("\n").forEach((line, index) => {
        out.push(Decoration.widget(pos + 1 + offset, () => lineNumber(index + 1), { side: -1, key: `line-${index + 1}`, ignoreSelection: true }));
        offset += line.length + 1;
      });
    }
    return false;
  });
  return DecorationSet.create(doc, out);
}

// How code blocks are shown is the reader's view of the page, so none of it is saved.
export const CodeView = Extension.create({
  name: "documentCodeView",
  addProseMirrorPlugins() {
    return [
      new Plugin<CodeView>({
        key: codeViewKey,
        state: {
          init: (_config, state) => ({ lineNumbers: false, collapsed: [], decorations: decorate(state.doc, false, []) }),
          apply(tr, old) {
            const change = tr.getMeta(codeViewKey) as CodeViewChange | undefined;
            if (!change && !tr.docChanged) return old;
            const lineNumbers = change?.lineNumbers ?? old.lineNumbers;
            let collapsed = old.collapsed
              .map((pos) => tr.mapping.map(pos))
              .filter((pos) => tr.doc.nodeAt(pos)?.type.name === "codeBlock");
            if (change?.toggle !== undefined) {
              collapsed = collapsed.includes(change.toggle)
                ? collapsed.filter((pos) => pos !== change.toggle)
                : [...collapsed, change.toggle];
            }
            return { lineNumbers, collapsed, decorations: decorate(tr.doc, lineNumbers, collapsed) };
          },
        },
        props: {
          decorations: (state) => codeViewKey.getState(state)?.decorations,
        },
      }),
    ];
  },
});
