import { Server, type Hocuspocus } from "@hocuspocus/server";
import { getSchema, type AnyExtension } from "@tiptap/core";
import { Node as PmNode } from "@tiptap/pm/model";
import { updateYFragment, yXmlFragmentToProseMirrorRootNode } from "@tiptap/y-tiptap";
import { and, eq } from "drizzle-orm";
import * as Y from "yjs";
import { getDb } from "@/db/client";
import { pageCollab, workspaceMembers } from "@/db/schema";
import { documentMarkdown, markdownToDocument } from "@/lib/editor/document-markdown";
import { documentExtensions } from "@/lib/editor/extensions";
import { getPage, requirePageLevel, updatePage } from "@/lib/pages";
import { setCollabLive } from "./live";
import { readCollabToken } from "./token";

// Realtime documents, on the team server only. The stored Markdown stays what everything else
// reads: this socket keeps it current, and takes in text written some other way.
const FIELD = "default";
const STORE_AFTER_MS = 2000;
const STORE_AT_MOST_MS = 10_000;

type Context = { workspaceId: string; userId: string };

const manager = documentMarkdown();
const schema = getSchema(documentExtensions() as AnyExtension[]);

function toMarkdown(doc: Y.Doc): string {
  return manager.serialize(yXmlFragmentToProseMirrorRootNode(doc.getXmlFragment(FIELD), schema).toJSON());
}

// Applied to the existing history, so a client that still holds the old text merges cleanly.
function writeText(doc: Y.Doc, markdown: string): void {
  const node = PmNode.fromJSON(schema, markdownToDocument(manager, markdown));
  doc.transact(() => {
    updateYFragment(doc, doc.getXmlFragment(FIELD), node, { mapping: new Map(), isOMark: new Map() });
  }, "tacos-text");
}

// The same text as the document would serialize it, without touching the document.
function readBack(markdown: string): string {
  const doc = new Y.Doc();
  writeText(doc, markdown);
  const text = toMarkdown(doc);
  doc.destroy();
  return text;
}

async function saveState(pageId: string, update: Uint8Array, revision: number): Promise<void> {
  const state = Buffer.from(update);
  await getDb()
    .insert(pageCollab)
    .values({ pageId, state, revision, updatedAt: new Date().toISOString() })
    .onConflictDoUpdate({ target: pageCollab.pageId, set: { state, revision, updatedAt: new Date().toISOString() } });
}

export function collabPort(): number {
  return Number(process.env.TACOS_COLLAB_PORT) || Number(process.env.PORT || 3000) + 1;
}

export async function startCollabServer(port = collabPort()): Promise<{ stop: () => Promise<void>; hocuspocus: Hocuspocus }> {
  // What the document's text was when it last matched the page, whoever wrote it. Text that
  // only differs by how Markdown reads back is not an edit.
  const settled = new Map<string, string>();
  // Who to write the text as. Hocuspocus reports only the latest change, and an outside write has
  // no person on it: going by that would drop typing that was still waiting to store.
  const editors = new Map<string, Context>();

  async function persistDocument(documentName: string, document: Y.Doc): Promise<void> {
      const editor = editors.get(documentName);
      if (!editor) return;
      const { workspaceId, userId } = editor;
      const state = Y.encodeStateAsUpdate(document);
      const text = toMarkdown(document);
      const page = await getPage(workspaceId, documentName, userId);
      if (!page) {
        // In the Trash: the page cannot take the text, and restoring it should bring the text back.
        await getDb()
          .update(pageCollab)
          .set({ state: Buffer.from(state), updatedAt: new Date().toISOString() })
          .where(eq(pageCollab.pageId, documentName));
        return;
      }
      let revision = page.revision;
      try {
        if (text !== page.doc && text !== settled.get(documentName)) {
          const written = await updatePage(
            workspaceId,
            documentName,
            userId,
            { doc: text, baseRevision: page.revision },
            { fromCollab: true }
          );
          revision = written.revision;
          settled.set(documentName, text);
        }
      } finally {
        // Also when the page refused the text: it stays here for the next store to try.
        await saveState(documentName, state, revision);
      }
  }

  const server = new Server<Context>({
    port,
    address: "127.0.0.1",
    quiet: true,
    debounce: STORE_AFTER_MS,
    maxDebounce: STORE_AT_MOST_MS,

    async onAuthenticate({ token, documentName, connectionConfig }) {
      const claim = readCollabToken(token);
      if (!claim || claim.pageId !== documentName) throw new Error("Not allowed");
      // Someone removed since the token was issued does not get back in on it.
      const [member] = await getDb()
        .select({ userId: workspaceMembers.userId })
        .from(workspaceMembers)
        .where(and(eq(workspaceMembers.workspaceId, claim.workspaceId), eq(workspaceMembers.userId, claim.userId)))
        .limit(1);
      if (!member) throw new Error("Not allowed");
      const page = await getPage(claim.workspaceId, claim.pageId, claim.userId);
      if (!page) throw new Error("Not allowed");
      const canEdit = await requirePageLevel(page, claim.userId, "edit").then(
        () => true,
        () => false
      );
      connectionConfig.readOnly = !canEdit;
      return { workspaceId: claim.workspaceId, userId: claim.userId };
    },

    async onLoadDocument({ document, documentName, context }) {
      const page = await getPage(context.workspaceId, documentName, context.userId);
      if (!page) throw new Error("Not allowed");
      const [saved] = await getDb().select().from(pageCollab).where(eq(pageCollab.pageId, documentName)).limit(1);
      if (saved) Y.applyUpdate(document, new Uint8Array(saved.state));
      if (!saved || saved.revision !== page.revision) {
        writeText(document, page.doc);
        // Saved before anyone syncs. A client that reconnects later has to meet this same history:
        // text rebuilt a second time would merge in beside its copy and show up twice.
        await saveState(documentName, Y.encodeStateAsUpdate(document), page.revision);
      }
      settled.set(documentName, readBack(page.doc));
      return document;
    },

    async onChange({ documentName, context }) {
      if (context.userId) editors.set(documentName, context);
    },

    async onStoreDocument({ document, documentName }) {
      await persistDocument(documentName, document);
    },

    async afterUnloadDocument({ documentName }) {
      settled.delete(documentName);
      editors.delete(documentName);
    },
  });

  await server.listen();
  const { hocuspocus } = server;

  setCollabLive({
    async withStored(pageId, work) {
      const document = hocuspocus.documents.get(pageId);
      if (!document) return work();
      return document.saveMutex.runExclusive(async () => {
        await persistDocument(pageId, document);
        return work();
      });
    },
    replace(pageId, markdown, revision) {
      const document = hocuspocus.documents.get(pageId);
      if (!document) return;
      const saved = getDb().select().from(pageCollab).where(eq(pageCollab.pageId, pageId)).get();
      if (!saved) {
        writeText(document, markdown);
        settled.set(pageId, toMarkdown(document));
        void saveState(pageId, Y.encodeStateAsUpdate(document), revision);
        return;
      }
      // Whoever wrote this started from the stored page, so it is applied to the stored state and
      // merged in. Applying it to the live text would delete whatever was typed since the last store.
      const stored = new Y.Doc();
      Y.applyUpdate(stored, new Uint8Array(saved.state));
      const before = Y.encodeStateVector(stored);
      writeText(stored, markdown);
      Y.applyUpdate(document, Y.encodeStateAsUpdate(stored, before), "tacos-text");
      settled.set(pageId, toMarkdown(stored));
      void saveState(pageId, Y.encodeStateAsUpdate(stored), revision);
      stored.destroy();
    },
  });

  return {
    hocuspocus,
    stop: async () => {
      setCollabLive(undefined);
      await server.destroy();
    },
  };
}
