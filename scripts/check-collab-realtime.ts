/**
 * Pass condition of docs/plans/team-2.2.md item 14: two clients editing one document converge, the
 * stored page follows, and text written some other way reaches open clients without doubling.
 * Runs the real socket server and real providers; only the browser is left out.
 *   npx tsx scripts/check-collab-realtime.ts
 */
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { HocuspocusProvider, HocuspocusProviderWebsocket } from "@hocuspocus/provider";
import WebSocket from "ws";
import * as Y from "yjs";

process.env.TACOS_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "tacos-collab-"));

function assert(ok: unknown, message: string) {
  if (!ok) {
    console.error(`FAIL ${message}`);
    process.exit(1);
  }
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function until(what: string, test: () => boolean | Promise<boolean>, ms = 15_000) {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (await test()) return;
    await sleep(50);
  }
  assert(false, `timed out waiting for ${what}`);
}

function freePort(): Promise<number> {
  return new Promise((resolve) => {
    const probe = net.createServer().listen(0, "127.0.0.1", () => {
      const { port } = probe.address() as net.AddressInfo;
      probe.close(() => resolve(port));
    });
  });
}

async function main() {
  const { getDb } = await import("../src/db/client");
  const { users, workspaceMembers, workspaces } = await import("../src/db/schema");
  const pages = await import("../src/lib/pages");
  const { startCollabServer } = await import("../src/lib/collab/server");
  const { issueCollabToken } = await import("../src/lib/collab/token");
  const { collabRunning } = await import("../src/lib/collab/live");

  const db = getDb();
  const now = new Date().toISOString();
  for (const id of ["ann", "bob", "cam", "out"]) {
    await db.insert(users).values({ id, username: id, displayName: id, passwordHash: "x", createdAt: now } as never);
  }
  await db.insert(workspaces).values({ id: "w1", name: "W", key: "W", createdBy: "ann", createdAt: now } as never);
  for (const userId of ["ann", "bob", "cam"]) {
    await db.insert(workspaceMembers).values({ workspaceId: "w1", userId, role: "member", createdAt: now } as never);
  }

  const created = await pages.createPage("w1", "ann", { title: "Plan" });
  const pageId = created.id;
  await pages.updatePage("w1", pageId, "ann", { doc: "First line.\n\n- [ ] one\n- [x] two" });
  await pages.setPageShared("w1", pageId, "ann", true);
  const original = (await pages.getPage("w1", pageId, "ann"))!;

  const port = await freePort();
  const collab = await startCollabServer(port);
  assert(collabRunning(), "the app can tell the socket is running");

  const clients: HocuspocusProvider[] = [];
  function open(userId: string, name = pageId, token?: string) {
    const doc = new Y.Doc();
    const websocketProvider = new HocuspocusProviderWebsocket({
      url: `ws://127.0.0.1:${port}`,
      WebSocketPolyfill: WebSocket as never,
    });
    let refused = false;
    const provider = new HocuspocusProvider({
      websocketProvider,
      name,
      document: doc,
      token: token ?? issueCollabToken({ workspaceId: "w1", pageId, userId }),
      onAuthenticationFailed: () => {
        refused = true;
      },
    });
    provider.attach();
    clients.push(provider);
    const text = () => doc.getXmlFragment("default").toString();
    return { doc, provider, text, refused: () => refused };
  }

  // Edit the way the editor does: inside the shared fragment, on its first paragraph.
  function typeInto(doc: Y.Doc, words: string, at = 0) {
    const first = doc.getXmlFragment("default").get(0) as Y.XmlElement;
    (first.get(0) as Y.XmlText).insert(at, words);
  }

  const stored = async () => (await pages.getPage("w1", pageId, "ann"))!;

  // The refused cases come first: nobody has loaded the document yet.
  const forged = open("ann", pageId, "abc.def");
  await until("a bad token to be refused", () => forged.refused());
  const outsider = open("out");
  await until("a non-member to be refused", () => outsider.refused());
  const elsewhere = open("ann", "another-page");
  await until("a token for another page to be refused", () => elsewhere.refused());

  const a = open("ann");
  const b = open("bob");
  await until("both clients to sync", () => a.provider.isSynced && b.provider.isSynced);
  assert(a.text() === b.text() && a.text().includes("First line."), `both see the page: ${a.text()}`);
  assert(a.text().includes("<taskitem"), `task lists come through the socket as task lists: ${a.text()}`);

  // Nobody has typed: opening a document must not write to the page.
  await sleep(2600);
  assert((await stored()).revision === original.revision, "opening a document does not change the page");

  // Both type at once.
  typeInto(a.doc, "Ann ");
  typeInto(b.doc, "Bob ");
  await until("the clients to converge", () => a.text() === b.text() && a.text().includes("Ann ") && a.text().includes("Bob "));

  await until("the page to store", async () => {
    const page = await stored();
    return page.doc.includes("Ann ") && page.doc.includes("Bob ");
  });
  const afterTyping = await stored();
  assert(afterTyping.revision > original.revision, "typing moves the page revision");
  assert(afterTyping.doc.includes("- [ ] one") && afterTyping.doc.includes("- [x] two"), "the task list survives");
  const versions = await pages.listPageVersions("w1", pageId, "ann");
  assert(versions.length > 0, "typing leaves a version in Updates");

  // Reader: sees everything, changes nothing.
  await pages.setPageMemberLevel("w1", pageId, "ann", "cam", "view");
  const c = open("cam");
  await until("the reader to sync", () => c.provider.isSynced);
  assert(c.text() === a.text(), "the reader sees the document");
  const beforeReader = a.text();
  const revisionBeforeReader = (await stored()).revision;
  typeInto(c.doc, "Reader ");
  await sleep(2600);
  assert(!a.text().includes("Reader "), "what a reader types does not reach anyone");
  const pageAfterReader = await stored();
  assert(a.text() === beforeReader && pageAfterReader.revision === revisionBeforeReader, "what a reader types does not reach the page");
  assert(!pageAfterReader.doc.includes("Reader "), "the page has none of the reader's text");

  // Text written some other way, which is how an Agent edit or a restore arrives.
  const external = `Written by an Agent.\n\n${afterTyping.doc}`;
  await pages.updatePage("w1", pageId, "ann", { doc: external });
  await until("the outside text to reach the clients", () => a.text().includes("Written by an Agent.") && b.text().includes("Written by an Agent."));
  assert(a.text().split("Ann ").length === 2, `outside text does not double what was there: ${a.text()}`);
  assert(a.text() === b.text(), "the clients agree after outside text");
  const revisionAfterExternal = (await stored()).revision;
  await sleep(2600);
  assert((await stored()).revision === revisionAfterExternal, "outside text is not written back as a new edit");

  // And typing still stores afterwards.
  typeInto(b.doc, "Later ");
  await until("typing after outside text to store", async () => (await stored()).doc.includes("Later "));

  // Everyone leaves, and the text changes while the document is closed.
  await until("the store to finish", async () => (await stored()).doc.includes("Later "));
  await sleep(2600);
  for (const client of clients) client.destroy();
  clients.length = 0;
  await until("the document to unload", () => !collab.hocuspocus.documents.has(pageId));
  const closed = await stored();
  await pages.updatePage("w1", pageId, "ann", { doc: `${closed.doc}\n\nAdded while closed.` });

  const again = open("ann");
  await until("reopening to sync", () => again.provider.isSynced);
  assert(again.text().includes("Added while closed."), "text from while the document was closed arrives");
  assert(again.text().split("Later ").length === 2, `reopening does not double the text: ${again.text()}`);
  assert(again.text().split("Added while closed.").length === 2, "the new text comes in once");

  for (const client of clients) client.destroy();
  await collab.stop();
  assert(!collabRunning(), "a stopped socket stops taking outside text");
  console.log("check-collab-realtime: ok");
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
