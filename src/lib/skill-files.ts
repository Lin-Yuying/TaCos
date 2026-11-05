import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { TacosError } from "./tacos-error";
import { isServerMode } from "./server-mode";

// Codex reads skills from these two folders on the machine running the server. TaCos may
// add and remove skills there, but never inside its bundled `.system` skills, plugin
// caches or a project folder: those belong to Codex and its marketplaces.

const HOME = os.homedir();
const CODEX_ROOT = path.join(HOME, ".codex", "skills");
const AGENTS_ROOT = path.join(HOME, ".agents", "skills");
const AGENTS_LOCK = path.join(HOME, ".agents", ".skill-lock.json");
const ROOTS = [CODEX_ROOT, AGENTS_ROOT];

const SKILL_NAME = /^[a-z0-9][a-z0-9._-]{0,63}$/;

// Both Codex and the `skills` CLI install one folder per skill, so a manageable skill is
// exactly `<root>/<name>/SKILL.md` two levels deep.
type SkillFolder = { root: string; dir: string; name: string };

function resolveSkillFolder(file: string): SkillFolder | null {
  if (typeof file !== "string" || !file.trim()) return null;
  const resolved = path.resolve(file);
  if (path.basename(resolved) !== "SKILL.md") return null;
  const dir = path.dirname(resolved);
  const name = path.basename(dir);
  const root = path.dirname(dir);
  if (!ROOTS.includes(root)) return null;
  if (!name || name.startsWith(".")) return null;
  return { root, dir, name };
}

// Drives the trash button: the UI may only offer removal for folders TaCos owns.
export function isManagedSkillPath(file: string): boolean {
  return resolveSkillFolder(file) !== null;
}

export type NewSkillInput = { name: string; description: string; instructions: string };

export type CreatedSkill = { name: string; path: string; description: string };

function titleFromName(name: string): string {
  return name
    .split(/[._-]+/)
    .filter(Boolean)
    .map((word) => word[0].toUpperCase() + word.slice(1))
    .join(" ");
}

function refuseOnServer() {
  // These folders belong to whoever runs this machine, not to the people using TaCos on it.
  if (isServerMode()) throw new TacosError("Skills live on your own computer, not on this server", 400);
}

export function createSkillFile(input: NewSkillInput): CreatedSkill {
  refuseOnServer();
  const name = input.name.trim().toLowerCase();
  if (!SKILL_NAME.test(name)) {
    throw new TacosError(
      "Skill names use lowercase letters, digits, dots, dashes or underscores",
      400,
      "For example: release-notes"
    );
  }
  // Frontmatter is line-based YAML, so the description has to be one line.
  const description = input.description.replace(/\s+/g, " ").trim();
  if (!description) throw new TacosError("Say what the skill does and when to use it", 400);
  if (description.length > 1024) throw new TacosError("Keep the description under 1024 characters", 400);

  const dir = path.join(CODEX_ROOT, name);
  fs.mkdirSync(CODEX_ROOT, { recursive: true });
  try {
    // A non-recursive mkdir is the atomic "claim this name" check.
    fs.mkdirSync(dir);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "EEXIST") {
      throw new TacosError(`A skill named "${name}" already exists`, 409);
    }
    throw err;
  }

  const instructions = input.instructions.trim();
  const body = instructions ? `\n${instructions}\n` : "";
  const content = `---\nname: ${name}\ndescription: ${JSON.stringify(description)}\n---\n\n# ${titleFromName(name)}\n${body}`;
  const file = path.join(dir, "SKILL.md");
  try {
    fs.writeFileSync(file, content, { encoding: "utf8", flag: "wx" });
  } catch (err) {
    fs.rmSync(dir, { recursive: true, force: true });
    throw err;
  }
  return { name, path: file, description };
}

// The `skills` CLI tracked its installs in a lock file; leaving the entry behind would make
// a later install believe the folder is still there.
function dropLockEntry(name: string) {
  let raw: string;
  try {
    raw = fs.readFileSync(AGENTS_LOCK, "utf8");
  } catch {
    return;
  }
  let parsed: { skills?: Record<string, unknown> } | null = null;
  try {
    parsed = JSON.parse(raw) as { skills?: Record<string, unknown> };
  } catch {
    return;
  }
  const skills = parsed?.skills;
  if (!skills || !(name in skills)) return;
  delete skills[name];
  try {
    fs.writeFileSync(AGENTS_LOCK, `${JSON.stringify(parsed, null, 2)}\n`, "utf8");
  } catch {
    /* the skill folder is already gone; a stale lock entry is not worth failing the delete */
  }
}

export function deleteSkillFile(file: string): { name: string } {
  refuseOnServer();
  const folder = resolveSkillFolder(file);
  if (!folder) {
    throw new TacosError("That skill is not one TaCos can remove", 400, "Only skills in ~/.codex/skills or ~/.agents/skills can be deleted here.");
  }
  let stat: fs.Stats;
  try {
    stat = fs.lstatSync(folder.dir);
  } catch {
    throw new TacosError("That skill is already gone", 404);
  }
  // rm on a symlink removes the link, not the folder it points at.
  if (!stat.isDirectory() && !stat.isSymbolicLink()) {
    throw new TacosError("That skill folder looks wrong on disk", 400);
  }
  fs.rmSync(folder.dir, { recursive: true, force: true });
  if (folder.root === AGENTS_ROOT) dropLockEntry(folder.name);
  return { name: folder.name };
}
