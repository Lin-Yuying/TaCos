// H-COLLAB-11: start the due-date reminder scheduler when the Node server boots.
// #80: the automation due scheduler is the second (and only other) in-process interval.
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { warmHarnessDetectCache }=await import("./lib/harness/detect-bin");
  await warmHarnessDetectCache();
  const { failInterruptedRuns } = await import("./lib/runner/hub");
  await failInterruptedRuns();
  const { clearSharedChatTurns } = await import("./lib/agent-threads");
  await clearSharedChatTurns();
  const { isServerMode } = await import("./lib/server-mode");
  if (isServerMode() && process.env.TACOS_DISABLE_COLLAB !== "1") {
    const { startCollabServer } = await import("./lib/collab/server");
    // Documents still save the old way if the socket cannot start.
    await startCollabServer().catch((err) => console.error("collab socket did not start", err));
  }
  const {startStorageMaintenance}=await import("./lib/permanent-cleanup");startStorageMaintenance();
  if (process.env.TACOS_DISABLE_AUTOMATIONS !== "1") {
    const { startAutomationScheduler } = await import("./lib/automations/scheduler");
    startAutomationScheduler();
  }
  if (process.env.TACOS_DISABLE_REMINDERS === "1") return;
  const { startDueReminderScheduler } = await import("./lib/issues");
  startDueReminderScheduler();
}
