import { connection } from "next/server";
import { redirect } from "next/navigation";
import { getSessionUser, landingWorkspaceId, listUserWorkspaces } from "@/lib/auth";

// Pure redirect entry point; it must see the session cookie on every request.
export const instant = false;

export default async function RootPage() {
  await connection();
  const user = await getSessionUser();
  if (!user) redirect("/login");
  const workspaces = await listUserWorkspaces(user.id);
  const landing = landingWorkspaceId(user.id, workspaces, user.lastWorkspaceId);
  if (!landing) redirect(user.siteRole === "admin" ? "/admin" : "/onboarding");
  redirect(`/${landing}`);
}
