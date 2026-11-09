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

// Deliberately no Suspense boundary: the inbox refreshes itself after every read, archive and
// live pulse, and a boundary would swap the list for the skeleton each time — taking the row
// the reader had just opened with it. The route blocks instead, so the client keeps the
// current rows on screen until the next render arrives.
export const instant = false;

export default async function NotificationsPage({
  params,
  searchParams,
}: {
  params: Promise<{ workspaceId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  // Request time before anything else: the session check reads the clock, and a prerendered
  // page would freeze that to build time.
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
