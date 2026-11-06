import {
  apiActor,
  assertKeyIssueProject,
  errorResponse,
  readJsonBody,
  requireApiKey,
} from "@/lib/api-auth";
import { assertSeesIssue, findIssueRow, TacosError } from "@/lib/issues";
import { setTaskFieldValuesByName } from "@/lib/task-fields";

type Ctx = { params: Promise<{ id: string }> };

// Custom task fields are raw key/value: values are stored as strings (checkbox "1"),
// and null clears one. Keys are a field id or its name, ignoring case.
export async function PUT(req: Request, ctx: Ctx) {
  try {
    const key = await requireApiKey(req);
    const { id } = await ctx.params;
    const body = await readJsonBody(req);
    const input = body.fields;
    if (!input || typeof input !== "object" || Array.isArray(input)) {
      return Response.json(
        { error: "fields must be an object", hint: 'Send {"fields": {"Stage": "beta"}}; null clears a value' },
        { status: 400 }
      );
    }
    const values: Record<string, string | null> = {};
    for (const [field, raw] of Object.entries(input)) {
      if (raw !== null && typeof raw !== "string") {
        return Response.json(
          { error: `Field "${field}" must be a string or null` },
          { status: 400 }
        );
      }
      values[field] = raw;
    }
    await assertSeesIssue(key.workspaceId, id, key.createdBy);
    await assertKeyIssueProject(key, id);
    const row = await findIssueRow(key.workspaceId, id);
    if (!row) throw new TacosError(`Issue "${id}" not found`, 404);
    const fields = await setTaskFieldValuesByName(
      key.workspaceId,
      row.id,
      values,
      key.createdBy,
      apiActor(key)
    );
    return Response.json({ id: row.id, identifier: row.identifier, fields });
  } catch (err) {
    return errorResponse(err);
  }
}
