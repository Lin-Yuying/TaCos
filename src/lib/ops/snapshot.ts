// U-12: the System page data, assembled once per load or refresh.
import {
  backupCandidates,
  backupRetentionDays,
  latestPreUpgradeBackupAt,
  listBackupRuns,
  restoreGate,
} from "./backups";
import { systemHealth } from "./health";
import type { SystemSnapshot } from "./shared";
import { buildUpgradeStatus } from "./upgrade";
import { runnerAdminRows } from "./runner-admin";

export async function buildSystemSnapshot(workspaceId: string): Promise<SystemSnapshot> {
  const retentionDays = await backupRetentionDays();
  const [health, backups, candidates] = await Promise.all([
    systemHealth({ retentionDays }),
    Promise.resolve(listBackupRuns()),
    backupCandidates(),
  ]);
  return {
    runners: runnerAdminRows(workspaceId),
    health,
    backups,
    candidates,
    retentionDays,
    restoreGate: await restoreGate(candidates),
    upgrade: buildUpgradeStatus({
      health,
      candidates,
      latestPreUpgradeAt: latestPreUpgradeBackupAt(),
    }),
  };
}
