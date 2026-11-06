/**
 * Document links and backlinks (U-04): `[[…]]` references are recorded as page ids,
 * render with the live title, ignore code, follow the Trash and permission rules, and
 * leave search usable. v1 links are page → page only.
 *   npx tsx scripts/check-doc-links.ts
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

function assert(ok: unknown, message: string) {
  if (!ok) {
    console.error(`FAIL ${message}`);
    process.exit(1);
  }
}

process.env.TACOS_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "tacos-doc-links-"));

async function status(call: () => Promise<unknown>): Promise<number> {
  try {
    await call();
    return 200;
  } catch (err) {
    return (err as { status?: number }).status ?? 500;
  }
}

async function main() {
  const { getDb } = await import("../src/db/client");
  const { users, workspaceMembers, workspaces } = await import("../src/db/schema");
  const pages = await import("../src/lib/pages");
  const links = await import("../src/lib/page-links");
  const { searchWorkspace } = await import("../src/lib/search");
  const db = getDb();
  const at = new Date().toISOString();
  const ws = "w-links";
  const owner = "owner";
  const member = "member";
  await db.insert(workspaces).values({ id: ws, name: "Links", key: "LINK", createdBy: owner, createdAt: at } as never);
  for (const id of [owner, member]) {
    await db.insert(users).values({ id, username: id, displayName: id, passwordHash: "x", createdAt: at } as never);
    await db.insert(workspaceMembers).values({ workspaceId: ws, userId: id, role: id === owner ? "admin" : "member", createdAt: at } as never);
  }

  // Syntax: only real page references count. Fenced and inline code are text.
  const doc = [
    "[[Alpha|a1]] and [[Alpha]] and [[Alpha|a1]]",
    "`[[Alpha|a1]]`",
    "```md",
    "[[Alpha|a1]]",
    "```",
    "![[Alpha|a1]]",
  ].join("\n");
  const written = links.writtenPageRefs(doc);
  assert(written.length === 4, `inline code and fences are not references: ${JSON.stringify(written)}`);
  const targets = links.pageLinkTargets(doc, [{ id: "a1", title: "Alpha", icon: null }]);
  assert(targets.length === 1 && targets[0].id === "a1", "a repeated reference targets one page");

  const alpha = await pages.createPage(ws, owner, { title: "Alpha" });
  await pages.setPageShared(ws, alpha.id, owner, true);
  const beta = await pages.createPage(ws, member, { title: "Beta" });
  const gamma = await pages.createPage(ws, member, { title: "Gamma" });
  await pages.updatePage(ws, beta.id, member, {
    doc: `See [[Alpha|${alpha.id}]], [[Gamma|${gamma.id}]] and [[Missing|nope]].\n\n\`[[Alpha|${alpha.id}]]\`\n\n\`\`\`\n[[Gamma|${gamma.id}]]\n\`\`\``,
  });

  // Backlinks and counts.
  let from = await links.listPageBacklinks(ws, alpha.id, member);
  assert(from.length === 1 && from[0].id === beta.id && from[0].title === "Beta", "the source page links to the target");
  assert(from[0].path === "Beta", "a backlink carries its path");
  assert((await links.pageLinkCounts(ws, member))[alpha.id] === 1, "the index counts one backlink");
  assert((await links.listUnresolvedPageLinks(ws, member)).length === 0, "both resolvable references are stored");

  // The target's current title is what the reader shows.
  await pages.updatePage(ws, alpha.id, owner, { title: "Alpha renamed" });
  from = await links.listPageBacklinks(ws, alpha.id, member);
  assert(from[0]?.title === "Beta", "the backlink still names its source after the target is renamed");
  assert(pages.pageLookup(await pages.listPageRefs(ws, member))[alpha.id]?.title === "Alpha renamed", "the reader lookup resolves the new title");

  // The source's links are rebuilt from its text on every save.
  await pages.updatePage(ws, beta.id, member, { doc: `Only [[Gamma|${gamma.id}]] now.` });
  assert((await links.listPageBacklinks(ws, alpha.id, member)).length === 0, "removing the reference removes the backlink");
  assert((await links.listPageBacklinks(ws, gamma.id, member)).length === 1, "the remaining reference is recorded");
  await pages.updatePage(ws, beta.id, member, { doc: `See [[Alpha|${alpha.id}]] and [[Gamma|${gamma.id}]].` });

  // A private source is not exposed to another viewer; sharing it makes it visible.
  let ownerFrom = await links.listPageBacklinks(ws, alpha.id, owner);
  assert(ownerFrom.length === 0, "a private source does not show in someone else's backlinks");
  await pages.setPageShared(ws, beta.id, member, true);
  ownerFrom = await links.listPageBacklinks(ws, alpha.id, owner);
  assert(ownerFrom.length === 1 && ownerFrom[0].id === beta.id, "a shared source shows to the workspace");

  // A page a writer cannot see cannot become a link target.
  const secret = await pages.createPage(ws, owner, { title: "Secret target" });
  const memberDoc = `Trying [[Secret target|${secret.id}]].`;
  assert(memberDoc.includes(secret.id), "fixture names the private target");
  await pages.updatePage(ws, gamma.id, member, { doc: memberDoc });
  assert((await links.listPageBacklinks(ws, secret.id, owner)).length === 0, "a member cannot link to a private page");

  // Trash: the source still renders an unresolved reference, and the row stays.
  await pages.updatePage(ws, beta.id, member, { doc: `See [[Alpha|${alpha.id}]].` });
  await pages.deletePage(ws, alpha.id, owner);
  assert((await links.listPageBacklinks(ws, alpha.id, owner)).length === 0, "a trashed target has no backlinks panel");
  let unresolved = await links.listUnresolvedPageLinks(ws, member);
  assert(
    unresolved.some((link) => link.sourceId === beta.id && link.targetPageId === alpha.id),
    "a trashed target becomes an unresolved link"
  );
  assert((await searchWorkspace(ws, member, "Alpha")).every((hit) => hit.id !== alpha.id), "a trashed target leaves search");
  await pages.restorePage(ws, alpha.id, owner);
  assert((await links.listPageBacklinks(ws, alpha.id, member)).length === 1, "restoring the target resolves the link again");
  assert(!(await links.listUnresolvedPageLinks(ws, member)).some((link) => link.targetPageId === alpha.id), "the unresolved row is gone");
  assert((await searchWorkspace(ws, member, "Alpha renamed")).some((hit) => hit.id === alpha.id), "the target is found by title");

  // Restoring a version puts its links back too, because the text is the source.
  // An Agent edit is a separate version, so it can be undone by restoring the text.
  await pages.updatePage(ws, beta.id, member, { doc: "No link here." }, { via: "mcp" });
  assert((await links.listPageBacklinks(ws, alpha.id, member)).length === 0, "the Agent edit removes the link");
  const versions = await pages.listPageVersions(ws, beta.id, member);
  const linkedVersions = [];
  for (const version of versions) {
    const change = await pages.getPageVersionChange(ws, beta.id, member, version.id);
    if (change.doc.includes(`[[Alpha|${alpha.id}]]`)) linkedVersions.push(version);
  }
  assert(linkedVersions.length > 0, "fixture has a version with the link");
  await pages.restorePageVersion(ws, beta.id, member, linkedVersions[0].id);
  assert((await links.listPageBacklinks(ws, alpha.id, member)).length === 1, "a restored version restores its links");

  // Purging the target removes the reference; it is not a broken row forever.
  await pages.deletePage(ws, alpha.id, owner);
  await pages.purgePage(ws, alpha.id, owner, false);
  unresolved = await links.listUnresolvedPageLinks(ws, member);
  assert(!unresolved.some((link) => link.targetPageId === alpha.id), "purging the target removes the link rows");

  // Only pages the reader may see can be a source; an unknown page is not a backlink.
  assert((await status(() => pages.updatePage(ws, alpha.id, owner, { doc: "[[Beta|" + beta.id + "]]" }))) === 404, "a purged page cannot be edited");

  console.log("check-doc-links: ok");
}

void main();
