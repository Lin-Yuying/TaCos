import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/db/client";
import { personalTaskViews } from "@/db/schema";
import { TacosError } from "@/lib/tacos-error";
import { FILTER_OPS } from "@/lib/task-view";
const schema = z.object({
  filters: z
    .array(
      z.object({
        key: z.string().max(120),
        op: z.enum(FILTER_OPS),
        value: z.string().max(2000).optional(),
      }),
    )
    .max(40),
  sort: z
    .array(z.object({ key: z.string().max(120), dir: z.enum(["asc", "desc"]) }))
    .max(10),
  layout: z.enum(["list", "board", "table", "calendar"]),
});
export type PersonalView = { name: string; view: z.infer<typeof schema> };
export function listPersonalViews(
  ws: string,
  user: string,
  scope: string,
): PersonalView[] {
  return getDb()
    .select()
    .from(personalTaskViews)
    .where(
      and(
        eq(personalTaskViews.workspaceId, ws),
        eq(personalTaskViews.userId, user),
        eq(personalTaskViews.scope, scope),
      ),
    )
    .all()
    .map((row) => ({
      name: row.name,
      view: schema.parse(JSON.parse(row.value)),
    }));
}
export function savePersonalView(
  ws: string,
  user: string,
  scope: string,
  name: string,
  value: unknown,
) {
  const parsed = schema.safeParse(value);
  if (
    !parsed.success ||
    !name.trim() ||
    name.trim().length > 80 ||
    scope.length > 500
  )
    throw new TacosError("Enter a view name and valid filters", 400);
  const key = { workspaceId: ws, userId: user, scope, name: name.trim() };
  getDb()
    .insert(personalTaskViews)
    .values({ ...key, value: JSON.stringify(parsed.data) })
    .onConflictDoUpdate({
      target: [
        personalTaskViews.workspaceId,
        personalTaskViews.userId,
        personalTaskViews.scope,
        personalTaskViews.name,
      ],
      set: { value: JSON.stringify(parsed.data) },
    })
    .run();
  return listPersonalViews(ws, user, scope);
}
export function deletePersonalView(
  ws: string,
  user: string,
  scope: string,
  name: string,
) {
  getDb()
    .delete(personalTaskViews)
    .where(
      and(
        eq(personalTaskViews.workspaceId, ws),
        eq(personalTaskViews.userId, user),
        eq(personalTaskViews.scope, scope),
        eq(personalTaskViews.name, name),
      ),
    )
    .run();
  return listPersonalViews(ws, user, scope);
}
