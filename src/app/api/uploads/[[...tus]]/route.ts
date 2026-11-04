import { getSessionUser } from "@/lib/auth";
import { handleUpload } from "@/lib/uploads";

async function tus(req: Request) {
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Not signed in" }, { status: 401 });
  return handleUpload(req, user.id);
}

export const OPTIONS = tus;
export const HEAD = tus;
export const POST = tus;
export const PATCH = tus;
export const DELETE = tus;
