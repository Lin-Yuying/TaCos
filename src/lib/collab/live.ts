// The small part of the collaboration socket that the rest of the app talks to, so that the page
// code does not load the socket server. Set when the socket starts; absent in the desktop app.
type CollabLive = {
  replace: (pageId: string, markdown: string, revision: number) => void;
  accessChanged: (pageIds: string[], keepUserId?: string) => void;
  withStored: <T>(pageId: string, work: () => Promise<T>) => Promise<T>;
};

const shared = globalThis as unknown as { __tacosCollab?: CollabLive };

export function setCollabLive(live: CollabLive | undefined): void {
  shared.__tacosCollab = live;
}

export function collabRunning(): boolean {
  return Boolean(shared.__tacosCollab);
}

/** Text written some other way (an Agent, a restore) reaches the people in the document. */
export function collabDocWritten(pageId: string, markdown: string, revision: number): void {
  shared.__tacosCollab?.replace(pageId, markdown, revision);
}

export function withStoredCollabPage<T>(pageId: string, work: () => Promise<T>): Promise<T> {
  return shared.__tacosCollab?.withStored(pageId, work) ?? work();
}

export function collabAccessChanged(pageIds: string[], keepUserId?: string): void { shared.__tacosCollab?.accessChanged(pageIds,keepUserId); }
