import { Suspense } from "react";
import { connection } from "next/server";
import { redirect } from "next/navigation";
import { getSessionUser, requireWorkspace } from "@/lib/auth";

export default async function LabelsPage({
  params,
}: {
  params: Promise<{ workspaceId: string }>;
}) {
  await connection();
  const { workspaceId } = await params;
  const user = await getSessionUser();
  if (!user) redirect("/login");
  await requireWorkspace(workspaceId);
  redirect(`/${workspaceId}/settings#labels`);
}
