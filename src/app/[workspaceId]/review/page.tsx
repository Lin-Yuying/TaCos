import { ListSkeleton } from "@/components/ui/skeleton";
import { PAGE_HEADER, PAGE_INSET, PAGE_TITLE } from "@/lib/page-chrome";
import { Suspense } from "react";
import { connection } from "next/server";
import { redirect } from "next/navigation";
import { getSessionUser, requireWorkspace } from "@/lib/auth";
import { translator } from "@/lib/i18n";
import { resolveLocale } from "@/lib/locale";
import { listPendingReview } from "@/lib/issues";
import { ReviewView } from "@/components/review-view";

export default async function ReviewPage({
  params,
}: {
  params: Promise<{ workspaceId: string }>;
}) {
  return (
    <Suspense fallback={<ListSkeleton />}>
      <View params={params} />
    </Suspense>
  );
}

async function View({ params }: { params: Promise<{ workspaceId: string }> }) {
  await connection();
  const { workspaceId } = await params;
  const user = await getSessionUser();
  if (!user) redirect("/login");
  await requireWorkspace(workspaceId);
  const issues = await listPendingReview(workspaceId);
  return (
    <>
      <header className={`${PAGE_HEADER} ${PAGE_INSET}`}>
        <h1 className={PAGE_TITLE}>{translator(await resolveLocale(user))("Review")}</h1>
        <span className="text-small text-faint">{issues.length}</span>
      </header>
      <ReviewView workspaceId={workspaceId} issues={issues} />
    </>
  );
}
