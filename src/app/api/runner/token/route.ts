import { getSessionUser } from "@/lib/auth";
import { issueRunnerToken } from "@/lib/runner/hub";
import { isServerMode } from "@/lib/server-mode";

// The desktop app asks for this once it is signed in, then gives it to its runner. It stands
// for the signed-in person, so it needs their session and comes back only to them.
export async function POST() {
  if (!isServerMode()) return Response.json({ serverMode: false });
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Sign in first" }, { status: 401 });
  return Response.json({ serverMode: true, token: await issueRunnerToken(user.id), userId: user.id });
}
