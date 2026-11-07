import { Suspense } from "react";
import { connection } from "next/server";
import { redirect } from "next/navigation";
import { getSessionUser, requireWorkspace } from "@/lib/auth";
import {
  getNotificationPrefs,
  listNotificationMutes,
  listNotificationPage,
  notificationCounts,
  type NotificationTab,
} from "@/lib/issues";
import { NOTIFICATION_EVENT_GROUPS } from "@/lib/notification-constants";
import { NotificationsView } from "@/components/notifications-view";

const TABS: NotificationTab[] = ["unread", "mentions", "assigned", "reviews", "all"];

export default async function NotificationsPage({
  params,
  searchParams,
}: {
  params: Promise<{ workspaceId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  return (
    <Suspense fallback={<div className="p-6 text-body text-muted">Loading…</div>}>
      <View params={params} searchParams={searchParams} />
    </Suspense>
  );
}

async function View({
  params,
  searchParams,
}: {
  params: Promise<{ workspaceId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await connection();
  const { workspaceId } = await params;
  const query = await searchParams;
  const user = await getSessionUser();
  if (!user) redirect("/login");
  const ws = await requireWorkspace(workspaceId);
  const tabParam = typeof query.tab === "string" ? query.tab : "";
  const tab: NotificationTab = TABS.includes(tabParam as NotificationTab)
    ? (tabParam as NotificationTab)
    : "unread";
  const q = typeof query.q === "string" ? query.q : "";
  const cursor = typeof query.cursor === "string" ? query.cursor : null;
  const [page, counts, prefs, mutes] = await Promise.all([
    listNotificationPage(workspaceId, ws.user.id, { tab, q, cursor }),
    notificationCounts(workspaceId, ws.user.id),
    getNotificationPrefs(workspaceId, ws.user.id),
    listNotificationMutes(workspaceId, ws.user.id),
  ]);
  return (
    <NotificationsView
      workspaceId={workspaceId}
      items={page.rows}
      nextCursor={page.nextCursor}
      initialTab={tab}
      initialQuery={q}
      counts={counts}
      prefs={prefs}
      mutes={mutes}
      eventGroups={NOTIFICATION_EVENT_GROUPS.map((group) => ({
        id: group.id,
        label: group.label,
      }))}
    />
  );
}
