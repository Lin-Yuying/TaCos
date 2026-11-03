// H-COLLAB-11: start the due-date reminder scheduler when the Node server boots.
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  if (process.env.TACOS_DISABLE_REMINDERS === "1") return;
  const { startDueReminderScheduler } = await import("./lib/issues");
  startDueReminderScheduler();
}
