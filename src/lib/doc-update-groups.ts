// Human edits that start within DOC_UPDATE_MERGE_MS of the first edit in a run are one
// Updates entry. The window is fixed to that first edit: a later edit past the window
// starts a new entry even when it sits close to the edit just before it. Agent edits,
// restores, undos, kept unsaved text, and the earlier-version row each stay their own
// entry and end the run. Same-person typing is already one stored version; this groups
// the separate versions several people leave inside the same window.

export const DOC_UPDATE_MERGE_MS = 10 * 60 * 1000;

export type DocUpdateRef = {
  id: string;
  seq: number;
  via: string;
  reason: string;
  createdAt: string;
  updatedAt: string;
};

export type DocUpdateGroup<T> = {
  id: string;
  versions: T[];
  updatedAt: string;
};

function humanEdit(version: DocUpdateRef): boolean {
  return version.reason === "edit" && version.via === "you";
}

function withinWindow(start: string, at: string): boolean {
  const from = Date.parse(start);
  const to = Date.parse(at);
  if (Number.isNaN(from) || Number.isNaN(to) || to < from) return false;
  return to - from < DOC_UPDATE_MERGE_MS;
}

/** Newest group first. Versions inside a group are newest first. */
export function groupDocUpdates<T extends DocUpdateRef>(versions: readonly T[]): DocUpdateGroup<T>[] {
  const oldestFirst = [...versions].sort((a, b) => a.seq - b.seq);
  const runs: T[][] = [];
  for (const version of oldestFirst) {
    const run = runs[runs.length - 1];
    const anchor = run?.[0];
    if (run && anchor && humanEdit(anchor) && humanEdit(version) && withinWindow(anchor.createdAt, version.createdAt)) {
      run.push(version);
    } else {
      runs.push([version]);
    }
  }
  return runs.reverse().map((run) => {
    const newestFirst = [...run].reverse();
    const newest = newestFirst[0];
    return { id: newest.id, versions: newestFirst, updatedAt: newest.updatedAt };
  });
}
