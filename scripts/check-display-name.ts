/**
 * Pass condition of docs/plans/team-2.3.md item 3: a member changes their own display name, and
 * empty and over-long names are refused.
 *   npx tsx scripts/check-display-name.ts
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

process.env.TACOS_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "tacos-display-name-"));

async function main() {
  const { eq } = await import("drizzle-orm");
  const { getDb } = await import("../src/db/client");
  const { users } = await import("../src/db/schema");
  const { setMemberDisplayName } = await import("../src/lib/admin");
  const db = getDb();
  await db.insert(users).values({ id: "ann", username: "ann", displayName: "Ann", passwordHash: "x", createdAt: new Date().toISOString() } as never);
  const name = async () => (await db.select().from(users).where(eq(users.id, "ann")))[0].displayName;
  const refused = (value: string) =>
    setMemberDisplayName("ann", value).then(
      () => false,
      () => true
    );

  await setMemberDisplayName("ann", "  Ann Lee  ");
  assert((await name()) === "Ann Lee", "own name changes and is trimmed");
  assert(await refused("   "), "empty name refused");
  assert(await refused("x".repeat(41)), "over-long name refused");
  assert((await name()) === "Ann Lee", "a refused name changes nothing");
  fs.rmSync(process.env.TACOS_DATA_DIR!, { recursive: true, force: true });
  console.log("check-display-name: pass");
}

main();
