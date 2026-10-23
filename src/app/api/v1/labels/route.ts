import { errorResponse, readJsonBody, requireApiKey } from "@/lib/api-auth";
import { createLabel, listLabels } from "@/lib/issues";

export async function GET(req: Request) {
  try {
    const key = await requireApiKey(req);
    return Response.json(await listLabels(key.workspaceId));
  } catch (err) {
    return errorResponse(err);
  }
}

export async function POST(req: Request) {
  try {
    const key = await requireApiKey(req);
    const body = await readJsonBody(req);
    if (typeof body.name !== "string" || !body.name.trim()) {
      return Response.json({ error: "name is required" }, { status: 400 });
    }
    const label = await createLabel(key.workspaceId, {
      name: body.name,
      color: typeof body.color === "string" ? body.color : undefined,
    });
    return Response.json(label, { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}
