import { and, asc, desc, eq, inArray, isNull, isNotNull, ne, sql } from "drizzle-orm";
import crypto from "node:crypto";
import { getDb } from "../../db/client";
import {
  cycleSettings,
  cycles,
  events,
  issues,
  projects,
  users,
  workspaceMembers,
} from "../../db/schema";
import {
  CYCLE_COOLDOWN_RANGE,
  CYCLE_UPCOMING_RANGE,
  CYCLE_WEEK_RANGE,
  type CycleStatus,
} from "../constants";
import {
  listIssues,
  nowIso,
  recordEvent,
  updateIssue,
  type IssueWithLabels,
  type MutationActor,
} from "../issues";
import { TacosError } from "../tacos-error";
import {
  addDays,
  compareDays,
  daysBetween,
  eachDay,
  isoWeekday,
  onOrAfterWeekday,
  todayDay,
} from "./dates";

/**
 * U-03 cycles.
 *
 * A cycle is a workspace time box (plan decision 1: TaCos has no team layer). The
 * lifecycle is lazy: every read of the planning surface runs `syncCycleLifecycle`,
 * which creates the configured upcoming cycles, activates and completes the ones whose
 * dates arrived, rolls unfinished work forward once, and (only when the workspace opted
 * in) adds unplanned active tasks. There is no daemon.
 *
 * Idempotency comes from the data, not from a scheduler flag:
 *   - `cycles_workspace_start_idx` makes a repeated create a no-op;
 *   - `status='completed'` is claimed with a conditional UPDATE, so only one process
 *     completes a cycle;
 *   - rollover is retried while `rolled_over_at` is null, and a repeated move to the
 *     same next cycle changes nothing.
 */

export type CycleSettings = {
  workspaceId: string;
  enabled: boolean;
  durationWeeks: number;
  // ISO weekday 1..7 (1 Monday)
  startDay: number;
  cooldownWeeks: number;
  upcomingCount: number;
  autoAdd: boolean;
  updatedAt: string | null;
};

export type CycleSettingsInput = Partial<{
  enabled: boolean;
  durationWeeks: number;
  startDay: number;
  cooldownWeeks: number;
  upcomingCount: number;
  autoAdd: boolean;
}>;

export type CycleProgress = {
  total: number;
  done: number;
  open: number;
  canceled: number;
  percent: number;
  estimate: number;
  unsized: number;
};

export type CycleSummary = {
  id: string;
  workspaceId: string;
  number: number;
  name: string;
  startsAt: string;
  endsAt: string;
  status: CycleStatus;
  rolledOverAt: string | null;
  createdAt: string;
  progress: CycleProgress;
};

export type CycleCapacity = {
  // null when no completed cycle has tasks yet
  average: number | null;
  unit: "points" | "tasks";
  samples: number;
};

export type BurndownPoint = { day: string; remaining: number; ideal: number };

export type CycleDetail = {
  cycle: CycleSummary;
  tasks: IssueWithLabels[];
  burndown: BurndownPoint[];
  capacity: CycleCapacity;
};

export type CycleSweepResult = {
  created: number;
  completed: number;
  rolledOver: number;
  autoAdded: number;
};

export const DEFAULT_CYCLE_SETTINGS: Omit<CycleSettings, "workspaceId" | "updatedAt"> = {
  enabled: false,
  durationWeeks: 2,
  startDay: 1,
  cooldownWeeks: 0,
  upcomingCount: 2,
  autoAdd: false,
};

// Lifecycle writes need an actor. Planning is internal automation, so it uses the same
// shape an automation rule uses and every moved task still gets its own timeline row.
const LIFECYCLE_ACTOR: MutationActor = {
  kind: "agent",
  label: "Planning · Cycle rollover",
  via: "web",
};

function emptyProgress(): CycleProgress {
  return { total: 0, done: 0, open: 0, canceled: 0, percent: 0, estimate: 0, unsized: 0 };
}

export function progressOf(
  tasks: Array<{ status: string; estimate: number | null }>
): CycleProgress {
  const progress = emptyProgress();
  for (const task of tasks) {
    progress.total += 1;
    if (task.status === "canceled") {
      progress.canceled += 1;
      continue;
    }
    if (task.status === "done") progress.done += 1;
    else progress.open += 1;
    if (task.estimate === null || task.estimate === undefined) progress.unsized += 1;
    else progress.estimate += task.estimate;
  }
  const counted = progress.total - progress.canceled;
  progress.percent = counted > 0 ? Math.round((progress.done / counted) * 100) : 0;
  progress.estimate = Math.round(progress.estimate * 100) / 100;
  return progress;
}

async function assertAdmin(workspaceId: string, userId: string): Promise<void> {
  const [row] = await getDb()
    .select({ role: workspaceMembers.role })
    .from(workspaceMembers)
    .where(and(eq(workspaceMembers.workspaceId, workspaceId), eq(workspaceMembers.userId, userId)))
    .limit(1);
  if (!row) throw new TacosError("Workspace not found or you are not a member", 404);
  if (row.role !== "admin") {
    throw new TacosError("Only workspace admins can change cycle settings", 403);
  }
}

function integerInRange(value: unknown, min: number, max: number, label: string): number {
  const number = Number(value);
  if (!Number.isInteger(number) || number < min || number > max) {
    throw new TacosError(`${label} must be a whole number between ${min} and ${max}`);
  }
  return number;
}

export function normalizeCycleSettingsInput(input: CycleSettingsInput): Required<CycleSettingsInput> {
  const base = DEFAULT_CYCLE_SETTINGS;
  return {
    enabled: input.enabled ?? base.enabled,
    durationWeeks: integerInRange(
      input.durationWeeks ?? base.durationWeeks,
      CYCLE_WEEK_RANGE.min,
      CYCLE_WEEK_RANGE.max,
      "Cycle length"
    ),
    startDay: integerInRange(input.startDay ?? base.startDay, 1, 7, "Start day"),
    cooldownWeeks: integerInRange(
      input.cooldownWeeks ?? base.cooldownWeeks,
      CYCLE_COOLDOWN_RANGE.min,
      CYCLE_COOLDOWN_RANGE.max,
      "Cooldown"
    ),
    upcomingCount: integerInRange(
      input.upcomingCount ?? base.upcomingCount,
      CYCLE_UPCOMING_RANGE.min,
      CYCLE_UPCOMING_RANGE.max,
      "Upcoming cycles"
    ),
    autoAdd: input.autoAdd ?? base.autoAdd,
  };
}

export async function getCycleSettings(workspaceId: string): Promise<CycleSettings> {
  const [row] = await getDb()
    .select()
    .from(cycleSettings)
    .where(eq(cycleSettings.workspaceId, workspaceId))
    .limit(1);
  if (!row) return { workspaceId, ...DEFAULT_CYCLE_SETTINGS, updatedAt: null };
  return {
    workspaceId,
    enabled: row.enabled === 1,
    durationWeeks: row.durationWeeks,
    startDay: row.startDay,
    cooldownWeeks: row.cooldownWeeks,
    upcomingCount: row.upcomingCount,
    autoAdd: row.autoAdd === 1,
    updatedAt: row.updatedAt,
  };
}

export async function saveCycleSettings(
  workspaceId: string,
  input: CycleSettingsInput,
  userId: string
): Promise<CycleSettings> {
  await assertAdmin(workspaceId, userId);
  const next = normalizeCycleSettingsInput(input);
  const now = new Date().toISOString();
  await getDb()
    .insert(cycleSettings)
    .values({
      workspaceId,
      enabled: next.enabled ? 1 : 0,
      durationWeeks: next.durationWeeks,
      startDay: next.startDay,
      cooldownWeeks: next.cooldownWeeks,
      upcomingCount: next.upcomingCount,
      autoAdd: next.autoAdd ? 1 : 0,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: cycleSettings.workspaceId,
      set: {
        enabled: next.enabled ? 1 : 0,
        durationWeeks: next.durationWeeks,
        startDay: next.startDay,
        cooldownWeeks: next.cooldownWeeks,
        upcomingCount: next.upcomingCount,
        autoAdd: next.autoAdd ? 1 : 0,
        updatedAt: now,
      },
    });
  // Saving settings is the one moment a workspace expects new cycles to appear.
  await syncCycleLifecycle(workspaceId);
  return getCycleSettings(workspaceId);
}

type CycleRow = typeof cycles.$inferSelect;

async function listCycleRows(workspaceId: string): Promise<CycleRow[]> {
  return getDb()
    .select()
    .from(cycles)
    .where(eq(cycles.workspaceId, workspaceId))
    .orderBy(asc(cycles.startsAt));
}

/** Insert one cycle with a number allocated inside the same write transaction. */
async function insertCycle(
  workspaceId: string,
  startsAt: string,
  endsAt: string,
  status: CycleStatus,
  createdBy: string | null
): Promise<number> {
  const db = getDb();
  const now = new Date().toISOString();
  const before = db
    .select({ n: sql<number>`COUNT(*)` })
    .from(cycles)
    .where(and(eq(cycles.workspaceId, workspaceId), eq(cycles.startsAt, startsAt)))
    .get();
  if ((before?.n ?? 0) > 0) return 0;
  return db.transaction((tx) => {
    const next = tx
      .select({ number: sql<number>`COALESCE(MAX(${cycles.number}), 0)` })
      .from(cycles)
      .where(eq(cycles.workspaceId, workspaceId))
      .get();
    const number = Number(next?.number ?? 0) + 1;
    const written = tx
      .insert(cycles)
      .values({
        id: crypto.randomUUID(),
        workspaceId,
        number,
        name: `Cycle ${number}`,
        startsAt,
        endsAt,
        status,
        createdBy,
        createdAt: now,
      })
      .onConflictDoNothing()
      .run();
    // A concurrent process may have inserted this start date between the check and the
    // transaction; then nothing was written and the caller stops instead of looping.
    return Number(written.changes ?? 0);
  });
}

function statusFor(start: string, end: string, today: string): CycleStatus {
  if (end < today) return "completed";
  if (start <= today) return "active";
  return "upcoming";
}

/**
 * Fill the schedule. The first cycle is always created once cycles are enabled, even
 * with `upcomingCount` 0, so the workspace has something to plan; after that the setting
 * is the number of future cycles kept ready.
 */
export async function ensureUpcomingCycles(
  workspaceId: string,
  settings: CycleSettings,
  today: string,
  createdBy: string | null
): Promise<number> {
  if (!settings.enabled) return 0;
  const rows = await listCycleRows(workspaceId);
  let created = 0;
  if (rows.length === 0) {
    const start = onOrAfterWeekday(today, settings.startDay);
    const end = addDays(start, settings.durationWeeks * 7 - 1);
    created += await insertCycle(workspaceId, start, end, statusFor(start, end, today), createdBy);
    rows.push({
      id: "",
      workspaceId,
      number: 0,
      name: "",
      startsAt: start,
      endsAt: end,
      status: statusFor(start, end, today),
      rolledOverAt: null,
      createdBy,
      createdAt: "",
    });
  }
  let guard = 0;
  while (guard < 32) {
    guard += 1;
    const last = (await listCycleRows(workspaceId)).at(-1);
    if (!last) break;
    const upcoming = (await listCycleRows(workspaceId)).filter((row) => row.startsAt > today).length;
    if (upcoming >= settings.upcomingCount) break;
    const start = addDays(last.endsAt, 1 + settings.cooldownWeeks * 7);
    // A cooldown must still land on the configured start day; nudge forward if a manual
    // cycle ended off-grid.
    const aligned = onOrAfterWeekday(start, settings.startDay);
    const end = addDays(aligned, settings.durationWeeks * 7 - 1);
    const added = await insertCycle(workspaceId, aligned, end, statusFor(aligned, end, today), createdBy);
    if (added === 0) break;
    created += added;
  }
  return created;
}

/** The cycle after `cycle`, created on demand so rollover never strands unfinished work. */
async function ensureNextCycle(
  workspaceId: string,
  cycle: CycleRow,
  today: string
): Promise<CycleRow | null> {
  const existing = (await listCycleRows(workspaceId)).find(
    (row) => row.startsAt > cycle.startsAt && row.id !== cycle.id
  );
  if (existing) return existing;
  const settings = await getCycleSettings(workspaceId);
  const start = addDays(cycle.endsAt, 1 + settings.cooldownWeeks * 7);
  const end = addDays(start, settings.durationWeeks * 7 - 1);
  await insertCycle(workspaceId, start, end, statusFor(start, end, today), cycle.createdBy);
  return (await listCycleRows(workspaceId)).find((row) => row.startsAt === start) ?? null;
}

/**
 * Move one task into `next` with one conditional UPDATE, then record its event. The
 * WHERE clause is the claim: two sweeps, a restart or two processes can call this for
 * the same task, and only the one whose UPDATE changed a row writes the event.
 */
async function moveTaskToCycle(
  issueId: string,
  from: CycleRow | null,
  next: CycleRow,
  actor: MutationActor = LIFECYCLE_ACTOR
): Promise<boolean> {
  const db = getDb();
  const result = from
    ? await db.run(
        sql`UPDATE issues SET cycle_id = ${next.id}, updated_at = ${nowIso()}
          WHERE id = ${issueId} AND cycle_id = ${from.id}`
      )
    : await db.run(
        sql`UPDATE issues SET cycle_id = ${next.id}, updated_at = ${nowIso()}
          WHERE id = ${issueId} AND cycle_id IS NULL`
      );
  if (Number(result.changes) === 0) return false;
  await recordEvent(
    issueId,
    "cycle_changed",
    { from: from?.id ?? null, to: next.id, fromName: from?.name ?? null, toName: next.name },
    actor
  );
  return true;
}

async function rolloverUnfinished(
  workspaceId: string,
  cycle: CycleRow,
  next: CycleRow,
  actor: MutationActor = LIFECYCLE_ACTOR
): Promise<number> {
  if (cycle.id === next.id) return 0;
  const rows = await getDb()
    .select({ id: issues.id })
    .from(issues)
    .where(
      and(
        eq(issues.workspaceId, workspaceId),
        eq(issues.cycleId, cycle.id),
        inArray(issues.status, ["todo", "in_progress"]),
        isNull(issues.deletedAt)
      )
    )
    .orderBy(asc(issues.createdAt))
    .limit(500);
  let moved = 0;
  for (const row of rows) {
    if (await moveTaskToCycle(row.id, cycle, next, actor)) moved += 1;
  }
  return moved;
}

async function autoAddActiveIssues(
  workspaceId: string,
  active: CycleRow,
  today: string
): Promise<number> {
  const candidates = await getDb()
    .select({ id: issues.id })
    .from(issues)
    .where(
      and(
        eq(issues.workspaceId, workspaceId),
        inArray(issues.status, ["todo", "in_progress"]),
        isNull(issues.cycleId),
        isNull(issues.deletedAt),
        ne(issues.reviewStatus, "rejected"),
        sql`EXISTS (SELECT 1 FROM projects WHERE projects.id = ${issues.projectId} AND projects.deleted_at IS NULL)`,
        // Only tasks already open when the cycle is running; a future task is not
        // silently pulled into the plan.
        sql`substr(${issues.createdAt}, 1, 10) <= ${today}`
      )
    )
    .orderBy(asc(issues.createdAt))
    .limit(200);
  let added = 0;
  for (const row of candidates) {
    // Same conditional claim as rollover: concurrent ticks never add a task twice.
    if (await moveTaskToCycle(row.id, null, active)) added += 1;
  }
  return added;
}

/**
 * The lazy sweep. Cheap when nothing is due: it reads cycles and only writes the
 * transitions that the calendar has reached. Callers include the planning page, the
 * cycle settings save and the cycle checks.
 */
export async function syncCycleLifecycle(
  workspaceId: string,
  options: { today?: string; actorId?: string | null } = {}
): Promise<CycleSweepResult> {
  const today = options.today ?? todayDay();
  const settings = await getCycleSettings(workspaceId);
  const result: CycleSweepResult = { created: 0, completed: 0, rolledOver: 0, autoAdded: 0 };
  if (settings.enabled) {
    result.created = await ensureUpcomingCycles(workspaceId, settings, today, options.actorId ?? null);
  }
  let rows = await listCycleRows(workspaceId);
  for (const cycle of rows) {
    if (cycle.status === "completed") continue;
    if (cycle.endsAt < today) {
      // Claim: only the process whose UPDATE changed a row completes and rolls it.
      const claimed = await getDb().run(
        sql`UPDATE cycles SET status = 'completed' WHERE id = ${cycle.id} AND status <> 'completed'`
      );
      if (Number(claimed.changes) > 0) result.completed += 1;
    } else if (cycle.startsAt <= today && cycle.status !== "active") {
      await getDb()
        .update(cycles)
        .set({ status: "active" })
        .where(and(eq(cycles.id, cycle.id), ne(cycles.status, "completed")));
    }
  }
  // Rollover has its own marker so a crash after completion still finishes the move.
  rows = (await listCycleRows(workspaceId)).filter(
    (cycle) => cycle.status === "completed" && !cycle.rolledOverAt
  );
  for (const cycle of rows) {
    const next = await ensureNextCycle(workspaceId, cycle, today);
    if (next) result.rolledOver += await rolloverUnfinished(workspaceId, cycle, next);
    await getDb()
      .update(cycles)
      .set({ rolledOverAt: new Date().toISOString() })
      .where(eq(cycles.id, cycle.id));
  }
  if (settings.enabled && settings.autoAdd) {
    const active = (await listCycleRows(workspaceId)).find(
      (cycle) => cycle.startsAt <= today && cycle.endsAt >= today
    );
    if (active) result.autoAdded = await autoAddActiveIssues(workspaceId, active, today);
  }
  return result;
}

async function progressByCycle(workspaceId: string): Promise<Map<string, CycleProgress>> {
  const rows = await getDb()
    .select({ cycleId: issues.cycleId, status: issues.status, estimate: issues.estimate })
    .from(issues)
    .innerJoin(projects, eq(projects.id, issues.projectId))
    .where(
      and(
        eq(issues.workspaceId, workspaceId),
        isNotNull(issues.cycleId),
        isNull(issues.deletedAt),
        isNull(projects.deletedAt)
      )
    );
  const grouped = new Map<string, Array<{ status: string; estimate: number | null }>>();
  for (const row of rows) {
    if (!row.cycleId) continue;
    const list = grouped.get(row.cycleId) ?? [];
    list.push({ status: row.status, estimate: row.estimate });
    grouped.set(row.cycleId, list);
  }
  return new Map([...grouped].map(([id, list]) => [id, progressOf(list)]));
}

export async function listCycles(workspaceId: string): Promise<CycleSummary[]> {
  const [rows, progress] = await Promise.all([
    listCycleRows(workspaceId),
    progressByCycle(workspaceId),
  ]);
  return rows.map((row) => ({
    id: row.id,
    workspaceId: row.workspaceId,
    number: row.number,
    name: row.name,
    startsAt: row.startsAt,
    endsAt: row.endsAt,
    status: row.status as CycleStatus,
    rolledOverAt: row.rolledOverAt ?? null,
    createdAt: row.createdAt,
    progress: progress.get(row.id) ?? emptyProgress(),
  }));
}

export async function getCycle(workspaceId: string, cycleId: string): Promise<CycleSummary | null> {
  const rows = await listCycles(workspaceId);
  return rows.find((cycle) => cycle.id === cycleId) ?? null;
}

/**
 * Simple burndown: remaining non-canceled tasks per day, using the moment each task
 * entered its current done state (its last "to done" event, or `updated_at` when no
 * event exists). Scope added mid-cycle shows up on its creation day; this is a rough
 * planning line, not a historical ledger.
 */
export async function cycleBurndown(
  cycle: CycleSummary,
  tasks: IssueWithLabels[],
  today: string = todayDay()
): Promise<BurndownPoint[]> {
  if (compareDays(today, cycle.startsAt) < 0) return [];
  const counted = tasks.filter((task) => task.status !== "canceled");
  const doneAt = new Map<string, string>();
  if (counted.length > 0) {
    const ids = counted.map((task) => task.id);
    const rows = getDb()
      .select({ issueId: events.issueId, data: events.data, createdAt: events.createdAt })
      .from(events)
      .where(and(inArray(events.issueId, ids), eq(events.type, "status_changed")))
      .orderBy(asc(events.createdAt))
      .all();
    for (const row of rows) {
      try {
        const data = JSON.parse(row.data) as { to?: string };
        if (data.to === "done") doneAt.set(row.issueId, row.createdAt);
      } catch {
        /* a malformed legacy event cannot prove completion */
      }
    }
  }
  for (const task of counted) {
    if (task.status === "done" && !doneAt.has(task.id)) doneAt.set(task.id, task.updatedAt);
  }
  const end = today < cycle.endsAt ? today : cycle.endsAt;
  const days = eachDay(cycle.startsAt, end);
  if (days.length === 0) return [];
  // Count a task as remaining from its creation day; tasks that existed before the
  // cycle started are in scope from day one.
  const created = new Map(counted.map((task) => [task.id, task.createdAt.slice(0, 10)]));
  const points: BurndownPoint[] = [];
  const total = counted.length;
  for (let index = 0; index < days.length; index += 1) {
    const day = days[index];
    let remaining = 0;
    for (const task of counted) {
      const entered = created.get(task.id) ?? cycle.startsAt;
      if (entered > day) continue;
      const finished = doneAt.get(task.id);
      if (finished && finished.slice(0, 10) <= day) continue;
      remaining += 1;
    }
    const ideal = days.length === 1 ? 0 : Math.max(0, Math.round(total * (1 - index / (days.length - 1))));
    points.push({ day, remaining, ideal });
  }
  return points;
}

/**
 * Capacity from the last three completed cycles (plan decision 5). Points are used only
 * when every counted task in those cycles has a U-09 estimate; one unsized task would
 * make a points average lie, so the fallback is the number of tasks.
 */
export async function cycleCapacity(
  workspaceId: string,
  excludeCycleId?: string
): Promise<CycleCapacity> {
  const completed = await getDb()
    .select({ id: cycles.id })
    .from(cycles)
    .where(and(eq(cycles.workspaceId, workspaceId), eq(cycles.status, "completed")))
    .orderBy(desc(cycles.endsAt))
    .limit(5)
    .all();
  const ids = completed
    .map((cycle) => cycle.id)
    .filter((id) => id !== excludeCycleId)
    .slice(0, 3);
  if (ids.length === 0) return { average: null, unit: "points", samples: 0 };
  const rows = await getDb()
    .select({ cycleId: issues.cycleId, status: issues.status, estimate: issues.estimate })
    .from(issues)
    .innerJoin(projects, eq(projects.id, issues.projectId))
    .where(
      and(
        inArray(issues.cycleId, ids),
        isNull(issues.deletedAt),
        isNull(projects.deletedAt)
      )
    )
    .all();
  const byCycle = new Map<string, Array<{ status: string; estimate: number | null }>>();
  for (const row of rows) {
    if (!row.cycleId) continue;
    const list = byCycle.get(row.cycleId) ?? [];
    list.push({ status: row.status, estimate: row.estimate });
    byCycle.set(row.cycleId, list);
  }
  const samples = [...byCycle.values()].map((list) => progressOf(list));
  if (samples.length === 0) return { average: null, unit: "points", samples: 0 };
  const anyTask = samples.some((sample) => sample.total - sample.canceled > 0);
  if (!anyTask) return { average: null, unit: "points", samples: 0 };
  const allSized = samples.every((sample) => sample.unsized === 0);
  if (allSized) {
    const total = samples.reduce((sum, sample) => sum + sample.estimate, 0);
    return { average: Math.round((total / samples.length) * 100) / 100, unit: "points", samples: samples.length };
  }
  const total = samples.reduce((sum, sample) => sum + (sample.total - sample.canceled), 0);
  return { average: Math.round((total / samples.length) * 100) / 100, unit: "tasks", samples: samples.length };
}

export async function getCycleDetail(
  workspaceId: string,
  cycleId: string,
  viewerId?: string,
  today: string = todayDay()
): Promise<CycleDetail | null> {
  const cycle = await getCycle(workspaceId, cycleId);
  if (!cycle) return null;
  const [tasks, capacity] = await Promise.all([
    listIssues(workspaceId, {
      cycleId,
      status: "all",
      viewerId,
      summary: true,
      limit: 500,
    }),
    cycleCapacity(workspaceId, cycleId),
  ]);
  const burndown = await cycleBurndown(cycle, tasks, today);
  return { cycle, tasks, burndown, capacity };
}

/** Create a cycle by hand (tests and imports); the UI uses the scheduled lifecycle. */
export async function createCycle(
  workspaceId: string,
  input: { startsAt: string; endsAt: string; name?: string; status?: CycleStatus },
  createdBy: string | null
): Promise<CycleSummary> {
  const startsAt = String(input.startsAt);
  const endsAt = String(input.endsAt);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(startsAt) || !/^\d{4}-\d{2}-\d{2}$/.test(endsAt)) {
    throw new TacosError("Cycle dates must be calendar dates (YYYY-MM-DD)");
  }
  if (endsAt < startsAt) throw new TacosError("A cycle must end on or after it starts");
  const days = daysBetween(startsAt, endsAt) + 1;
  if (days > 7 * CYCLE_WEEK_RANGE.max) throw new TacosError("A cycle can be at most 8 weeks");
  const today = todayDay();
  const added = await insertCycle(
    workspaceId,
    startsAt,
    endsAt,
    input.status ?? statusFor(startsAt, endsAt, today),
    createdBy
  );
  if (added === 0) throw new TacosError("A cycle already starts on that day", 409);
  const created = (await listCycles(workspaceId)).find((cycle) => cycle.startsAt === startsAt);
  if (!created) throw new TacosError("Cycle was not created", 500);
  if (input.name) {
    await getDb().update(cycles).set({ name: input.name }).where(eq(cycles.id, created.id));
    created.name = input.name;
  }
  return created;
}

/**
 * Mark a cycle complete now (the "Complete cycle" action). Completing through the
 * calendar dates goes through `syncCycleLifecycle` instead.
 */
export async function completeCycle(
  workspaceId: string,
  cycleId: string,
  actor: MutationActor
): Promise<{ completed: boolean; moved: number; nextCycleId: string | null }> {
  const [row] = await getDb()
    .select()
    .from(cycles)
    .where(and(eq(cycles.workspaceId, workspaceId), eq(cycles.id, cycleId)))
    .limit(1);
  if (!row) throw new TacosError("Cycle not found", 404);
  if (row.status === "completed") {
    return { completed: false, moved: 0, nextCycleId: null };
  }
  const today = todayDay();
  const claimed = await getDb().run(
    sql`UPDATE cycles SET status = 'completed' WHERE id = ${cycleId} AND status <> 'completed'`
  );
  if (Number(claimed.changes) === 0) {
    return { completed: false, moved: 0, nextCycleId: null };
  }
  const next = await ensureNextCycle(workspaceId, { ...row, status: "completed" }, today);
  const moved = next ? await rolloverUnfinished(workspaceId, row, next, actor) : 0;
  await getDb()
    .update(cycles)
    .set({ rolledOverAt: new Date().toISOString() })
    .where(eq(cycles.id, cycleId));
  return { completed: true, moved, nextCycleId: next?.id ?? null };
}

/** Move a set of tasks into a cycle (or out of every cycle with `cycleId: null`). */
export async function assignIssuesToCycle(
  workspaceId: string,
  cycleId: string | null,
  issueIds: string[],
  actor: MutationActor
): Promise<{ moved: number; skipped: number }> {
  if (cycleId) {
    const [cycle] = await getDb()
      .select({ id: cycles.id })
      .from(cycles)
      .where(and(eq(cycles.workspaceId, workspaceId), eq(cycles.id, cycleId)))
      .limit(1);
    if (!cycle) throw new TacosError("Cycle not found", 404);
  }
  const ids = [...new Set(issueIds)].slice(0, 200);
  let moved = 0;
  let skipped = 0;
  for (const issueId of ids) {
    try {
      await updateIssue(workspaceId, issueId, { cycleId }, actor);
      moved += 1;
    } catch {
      // A hidden or trashed task is skipped, not a reason to abort the whole batch.
      skipped += 1;
    }
  }
  return { moved, skipped };
}

/** Members who can be the owner of an initiative (and the UI's owner picker). */
export async function planningMembers(workspaceId: string) {
  return getDb()
    .select({ id: users.id, displayName: users.displayName, avatar: users.avatar })
    .from(users)
    .innerJoin(workspaceMembers, eq(workspaceMembers.userId, users.id))
    .where(eq(workspaceMembers.workspaceId, workspaceId))
    .orderBy(asc(users.displayName));
}

/** Calendar dates for an .ics subscription; shared by the route and the checks. */
export function cycleCalendar(cycle: {
  id: string;
  name: string;
  startsAt: string;
  endsAt: string;
}): string {
  const stamp = (day: string) => day.replaceAll("-", "");
  const end = addDays(cycle.endsAt, 1).replaceAll("-", "");
  return [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//TaCos//Cycles//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:${cycle.id}@tacos`,
    `DTSTART;VALUE=DATE:${stamp(cycle.startsAt)}`,
    `DTEND;VALUE=DATE:${end}`,
    `SUMMARY:${cycle.name}`,
    "TRANSP:TRANSPARENT",
    "END:VEVENT",
    "END:VCALENDAR",
    "",
  ].join("\r\n");
}

/** The cycle that covers today, else the next one (used by the planning header). */
export async function currentCycle(workspaceId: string): Promise<CycleSummary | null> {
  const today = todayDay();
  const all = await listCycles(workspaceId);
  return (
    all.find((cycle) => cycle.startsAt <= today && cycle.endsAt >= today) ??
    all.find((cycle) => cycle.startsAt > today) ??
    all.at(-1) ??
    null
  );
}

export function cycleLengthWeeks(cycle: { startsAt: string; endsAt: string }): number {
  return Math.max(1, Math.round((daysBetween(cycle.startsAt, cycle.endsAt) + 1) / 7));
}

export function weekdayLabel(day: number): string {
  return ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"][day - 1] ?? "Monday";
}

export { isoWeekday };
