/**
 * Workspace page templates (U-04): owner/admin management, variables, the source
 * recorded on the page and its first version, and deletion that leaves pages alone.
 *   npx tsx scripts/check-doc-templates.ts
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

process.env.TACOS_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "tacos-doc-templates-"));

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
  const { users, workspaceMembers, workspaces, projects } = await import("../src/db/schema");
  const templates = await import("../src/lib/page-templates");
  const pages = await import("../src/lib/pages");
  const db = getDb();
  const at = new Date().toISOString();
  const ws = "w-templates";
  const owner = "owner";
  const admin = "admin";
  const member = "member";
  await db.insert(workspaces).values({ id: ws, name: "Templates", key: "TPL", createdBy: owner, createdAt: at } as never);
  for (const [id, username, role] of [[owner, "own", "admin"], [admin, "adm", "admin"], [member, "mem", "member"]] as const) {
    await db.insert(users).values({
      id,
      username,
      displayName: id === member ? "Mia Member" : id === admin ? "Ada Admin" : "Owen Owner",
      passwordHash: "x",
      createdAt: at,
    } as never);
    await db.insert(workspaceMembers).values({ workspaceId: ws, userId: id, role, createdAt: at } as never);
  }
  await db.insert(projects).values({ id: "p1", workspaceId: ws, name: "Rocket", key: "ROCK", createdAt: at } as never);

  // Who may curate.
  assert(templates.canManagePageTemplates(ws, owner), "the workspace owner manages templates");
  assert(templates.canManagePageTemplates(ws, admin), "an admin manages templates");
  assert(!templates.canManagePageTemplates(ws, member), "a member uses but does not manage templates");
  assert(
    (await status(async () => templates.createPageTemplate(ws, member, { name: "Nope", title: "Nope", doc: "" }))) === 403,
    "a member cannot create a template"
  );
  assert((await status(async () => templates.createPageTemplate(ws, owner, { name: "", title: "T", doc: "" }))) === 400, "a template needs a name");
  assert((await status(async () => templates.createPageTemplate(ws, owner, { name: "N", title: "", doc: "" }))) === 400, "a template needs a page title");

  const template = templates.createPageTemplate(ws, owner, {
    name: "Weekly review",
    title: "Week of {date}",
    doc: "Written by {author} for {project}. {owner} stays as written.\n\n## Notes\n",
    icon: "📝",
  });
  assert(template.name === "Weekly review" && template.icon === "📝", "create keeps the name and icon");
  assert(templates.listPageTemplates(ws).length === 1, "the workspace lists its template");
  assert(
    (await status(async () => templates.updatePageTemplate(ws, member, template.id, { name: "x", title: "x", doc: "" }))) === 403,
    "a member cannot edit a template"
  );
  assert(
    (await status(async () => templates.deletePageTemplate(ws, member, template.id))) === 403,
    "a member cannot delete a template"
  );

  // Variables: the three supported ones, filled at creation from the person and project.
  const day = new Date().toISOString().slice(0, 10);
  const page = await templates.createPageFromTemplate(ws, member, template.id, { projectId: "p1" });
  assert(page.title === `Week of ${day}`, `{date} fills the title: ${page.title}`);
  assert(page.doc.includes("Written by Mia Member for Rocket."), "author and project fill the text");
  assert(page.doc.includes("{owner} stays as written."), "an unknown placeholder is left alone");
  assert(page.templateId === template.id && page.templateName === "Weekly review", "the page records its template");
  const versions = await pages.listPageVersions(ws, page.id, member);
  assert(versions.length === 1 && versions[0].reason === "template", "the first version says it came from a template");
  assert(versions[0].templateName === "Weekly review", "the version keeps the template name");
  assert((await pages.getPage(ws, page.id, member))?.doc === page.doc, "the filled text is the page text");

  // Project variable outside a project is empty; a title that empties falls back.
  const emptyTemplate = templates.createPageTemplate(ws, owner, {
    name: "Project brief",
    title: "Brief for {project}",
    doc: "Project: {project}\n",
  });
  const outside = await templates.createPageFromTemplate(ws, member, emptyTemplate.id);
  assert(outside.title === "Brief for", `an empty project leaves the words around it: ${outside.title}`);
  assert(outside.doc === "Project: \n", "an empty project fills an empty string");
  assert(outside.projectId === null, "no project stays no project");

  // Editing a template changes future pages only.
  templates.updatePageTemplate(ws, admin, template.id, {
    name: "Weekly review v2",
    title: "Review {date}",
    doc: "New template body.\n",
    icon: null,
  });
  const afterEdit = await templates.createPageFromTemplate(ws, member, template.id);
  assert(afterEdit.title === `Review ${day}`, "an edited template is used for new pages");
  assert(afterEdit.doc === "New template body.\n", "new text is used for new pages");
  assert((await pages.getPage(ws, page.id, member))?.doc.startsWith("Written by Mia Member"), "an existing page is unchanged");

  // Deleting a template leaves pages and their history intact.
  templates.deletePageTemplate(ws, owner, template.id);
  assert(templates.listPageTemplates(ws).every((row) => row.id !== template.id), "the template leaves the list");
  const kept = await pages.getPage(ws, page.id, member);
  assert(kept?.templateName === "Weekly review", "an existing page keeps the template's name");
  assert((await pages.listPageVersions(ws, page.id, member)).some((version) => version.templateName === "Weekly review"), "history keeps it too");
  assert((await status(async () => templates.createPageFromTemplate(ws, member, template.id))) === 404, "a deleted template cannot create a page");
  assert((await status(async () => pages.updatePage(ws, page.id, member, { doc: "still editable" }))) === 200, "a page from a deleted template stays editable");

  console.log("check-doc-templates: ok");
}

void main();
