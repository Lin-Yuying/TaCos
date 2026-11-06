// Inbox UI contract: five tabs, triage actions, preferences/mutes, snooze, search,
// keyboard shortcuts, load more, retention note, and the global G I shortcut.
import fs from "node:fs";
import path from "node:path";

function assert(ok: unknown, message: string): asserts ok {
  if (!ok) throw new Error(message);
}
function read(rel: string): string {
  return fs.readFileSync(path.join(process.cwd(), rel), "utf8");
}

function main() {
  const view = read("src/components/notifications-view.tsx");
  for (const copy of [
    "data-inbox-tabs",
    "data-inbox-read",
    "data-inbox-preferences",
    "data-inbox-snooze",
    "data-inbox-undo",
    "Mark all read",
    "Clear all",
    "Snooze…",
    "Mute this task",
    "Mute this document",
    "Mute this project",
    "Mark unread",
    "Load more",
    "Notifications are kept for 90 days.",
    "Search notifications…",
  ]) {
    assert(view.includes(copy), `inbox view must include ${copy}`);
  }
  assert(view.includes("Backspace"), "Backspace must delete the selected notification");
  assert(view.includes("shiftKey"), "Shift+S must mute the selected scope");
  assert(view.includes("altKey"), "Alt+U must mark all read");
  assert(view.includes("loadNotificationsAction"), "load more must page through notifications");
  assert(view.includes("parseLegacyNotificationBody"), "old rows must render through the legacy parser");
  assert(view.includes('data?.actorName') || view.includes("data.actorName"), "sentences must render from structured data");

  const page = read("src/app/[workspaceId]/notifications/page.tsx");
  assert(page.includes("searchParams"), "the page must read tab/q/cursor from the URL");
  assert(page.includes("listNotificationPage"), "the page must use the paginated inbox query");
  assert(page.includes("notificationCounts"), "the page must compute tab counts");
  assert(page.includes("getNotificationPrefs") && page.includes("listNotificationMutes"), "preferences and mutes must load with the page");

  const actions = read("src/app/workspace-misc-actions.ts");
  for (const name of [
    "markNotificationUnreadAction",
    "setNotificationStateAction",
    "snoozeNotificationAction",
    "restoreNotificationsAction",
    "saveNotificationPrefsAction",
    "muteNotificationScopeAction",
    "unmuteNotificationScopeAction",
    "loadNotificationsAction",
  ]) {
    assert(actions.includes(name), `actions must expose ${name}`);
  }

  const shell = read("src/components/workspace-shell.tsx");
  assert(shell.includes("G then I opens the Inbox"), "the shell must document the G I shortcut");
  assert(shell.includes('event.key === "g"') && shell.includes('event.key === "i"'), "the shell must handle G then I");

  const schema = read("src/db/schema.ts");
  for (const column of ["snoozedUntil", "deletedAt", "state", "data"]) {
    assert(schema.includes(column), `notifications must carry ${column}`);
  }
  assert(schema.includes("notificationPrefs") && schema.includes("notificationMutes"), "preferences and mutes tables must exist");

  console.log("check-inbox-ui: pass");
}

main();
