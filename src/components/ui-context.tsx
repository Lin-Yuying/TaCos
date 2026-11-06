"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { listPinsAction } from "@/app/entity-actions";
import { PERSONAL_STATE_CHANGED, type PersonalPin } from "@/lib/ui/entity-actions";
import { usePathname, useSearchParams } from "next/navigation";
import { useStoredJson } from "@/lib/use-stored-json";
import { Modal } from "@/components/ui/modal";
import { useT } from "@/components/i18n-context";
import type { Priority, Status } from "@/lib/constants";

// Fired on `window` after notifications are read so the sidebar badge and the bell
// refresh without waiting for their next poll.
export const NOTIFICATIONS_READ = "tacos:notifications-read";

// Fired on `window` when a task lands in the Trash. A project Overview keeps the tasks
// it has already rendered, so it has to hear about the deletion directly: its page
// props arrive only after the server re-render finishes.
export const ISSUE_DELETED = "tacos:issue-deleted";

export type DeletedIssue = { id: string; identifier: string; title: string };

export type FocusRef = {
  id: string;
  identifier: string;
  ref: string;
  title: string;
  status: string;
} | null;

export type IssueLayout = "list" | "board" | "table" | "calendar";

export type CreatedProject = {
  id: string;
  name: string;
  key: string;
  color: string;
};

// The composer can be opened from a passage in a document; `onCreated` lets that page
// put the new task's reference where the passage was.
export type ComposerSeed = {
  dueDate?: string;
  title?: string;
  description?: string;
  onCreated?: (issue: {
    id: string;
    identifier: string;
    title: string;
    priority: Priority;
    status: Status;
  }) => void;
};

const LAYOUT_KEY = "tacos.issues.layout";

export type ToastAction = { label: string; run: () => void | Promise<void> };
type UIState = {
  scope: string;
  pins: PersonalPin[];
  density:"compact"|"comfortable";
  setDensity:(density:"compact"|"comfortable")=>void;
  refreshPins: () => void;
  confirm: (message: string) => Promise<boolean>;
  openIssueId: string | null;
  openIssue: (id: string,commentId?:string) => void;
  closeIssue: () => void;
  // A document opened beside the page you were reading, the way a task opens in the
  // same right-hand pane. Only one of the two panes is up at a time.
  openPageId: string | null;
  openPage: (id: string,commentId?:string) => void;
  closePage: () => void;
  // The detail panel normally shares the main card with the list; expanded hides the
  // list so the issue takes the whole workspace.
  panelExpanded: boolean;
  setPanelExpanded: (expanded: boolean) => void;
  composerOpen: boolean;
  // Set when the composer is opened from a status header: the draft starts in that status.
  composerStatus: Status | null;
  // Set when the composer is opened from a passage in a document.
  composerSeed: ComposerSeed | null;
  setComposerOpen: (open: boolean, status?: Status | null, seed?: ComposerSeed | null) => void;
  projectComposerOpen: boolean;
  // The Agent tab reuses the dialog to create a project without leaving the conversation;
  // when `onCreated` is set the new project is handed back instead of opened.
  setProjectComposerOpen: (open: boolean, onCreated?: ((project: CreatedProject) => void) | null) => void;
  projectComposerOnCreated: ((project: CreatedProject) => void) | null;
  paletteOpen: boolean;
  setPaletteOpen: (open: boolean) => void;
  focused: FocusRef;
  setFocused: (focused: FocusRef) => void;
  layout: IssueLayout;
  setLayout: (layout: IssueLayout) => void;
  // True when this workspace has an enabled AI provider; drives the sparkle buttons.
  aiReady: boolean;
  // Short-lived confirmations ("Task deleted") that replace dialogs for actions whose
  // outcome is otherwise invisible once the surrounding UI has already moved on.
  toast: (message: string, action?: ToastAction) => void;
};

const UIContext = createContext<UIState | null>(null);

export function useUI(): UIState {
  const ctx = useContext(UIContext);
  if (!ctx) throw new Error("useUI must be used inside UIProvider");
  return ctx;
}

export function isTyping(e: KeyboardEvent) {
  const target = e.target as HTMLElement | null;
  if (!target) return false;
  return (
    target.tagName === "INPUT" ||
    target.tagName === "TEXTAREA" ||
    target.tagName === "SELECT" ||
    target.isContentEditable
  );
}

export function UIProvider({
  children,
  userId, workspaceId,
  aiReady = false,
}: {
  children: ReactNode;
  userId: string; workspaceId: string;
  aiReady?: boolean;
}) {
  const t = useT();
  const pathname = usePathname();
  const params = useSearchParams();
  const scope = `${userId}.${workspaceId}`;
  const [density,setDensity]=useStoredJson<"compact"|"comfortable">(`tacos.density.${scope}`,"comfortable");
  useEffect(()=>{document.documentElement.dataset.density=density;return()=>{delete document.documentElement.dataset.density;};},[density]);
  const [pins, setPins] = useState<PersonalPin[]>([]);
  const refreshPins = useCallback(() => { void listPinsAction(workspaceId).then((result) => { if (result.ok) setPins(result.data); }); }, [workspaceId]);
  useEffect(() => { refreshPins(); window.addEventListener(PERSONAL_STATE_CHANGED, refreshPins); return () => window.removeEventListener(PERSONAL_STATE_CHANGED, refreshPins); }, [refreshPins]);
  const [confirmation, setConfirmation] = useState<{message: string; resolve: (ok: boolean) => void} | null>(null);
  const confirm = useCallback((message: string) => new Promise<boolean>((resolve) => setConfirmation({message, resolve})), []);
  const [openIssueId, setOpenIssueId] = useState<string | null>(null);
  const [openPageId, setOpenPageId] = useState<string | null>(null);
  const [panelExpanded, setPanelExpandedState] = useStoredJson(`tacos.panel.expanded.${scope}`, false);
  const openIssue = useCallback((id: string,commentId?:string) => {
    const url = new URL(window.location.href); url.searchParams.set("issue", id);url.searchParams.delete("doc");if(commentId)url.searchParams.set("comment",commentId);else url.searchParams.delete("comment");
    window.history.pushState(null, "", url);
    setOpenIssueId(id);
    setOpenPageId(null);
  }, []);
  const closeIssue = useCallback(() => {
    const url = new URL(window.location.href); url.searchParams.delete("issue");url.searchParams.delete("comment");
    window.history.pushState(null, "", url);
    setOpenIssueId(null);
  }, []);
  const openPage = useCallback((id: string,commentId?:string) => {
    const url=new URL(window.location.href);url.searchParams.set("doc",id);url.searchParams.delete("issue");if(commentId)url.searchParams.set("comment",commentId);else url.searchParams.delete("comment");window.history.pushState(null,"",url);
    setOpenPageId(id);
    setOpenIssueId(null);
  }, []);
  const closePage = useCallback(() => {
    const url=new URL(window.location.href);url.searchParams.delete("doc");url.searchParams.delete("comment");window.history.pushState(null,"",url);
    setOpenPageId(null);
    // An expanded pane is the only thing on screen; closing it must bring the page back.
  }, []);
  const setPanelExpanded = useCallback((expanded: boolean) => {
    setPanelExpandedState(expanded);
  }, []);
  const [composer, setComposer] = useState<{
    open: boolean;
    status: Status | null;
    seed: ComposerSeed | null;
  }>({ open: false, status: null, seed: null });
  const setComposerOpen = useCallback(
    (open: boolean, status: Status | null = null, seed: ComposerSeed | null = null) => {
      setComposer(open ? { open: true, status, seed } : { open: false, status: null, seed: null });
    },
    []
  );
  const [projectComposerOpen, setProjectComposerOpenState] = useState(false);
  const [projectComposerOnCreated, setProjectComposerOnCreated] = useState<
    ((project: CreatedProject) => void) | null
  >(null);
  const setProjectComposerOpen = useCallback(
    (open: boolean, onCreated: ((project: CreatedProject) => void) | null = null) => {
      setProjectComposerOpenState(open);
      // Wrapped in an updater because a bare function argument would be invoked by React.
      setProjectComposerOnCreated(() => (open ? onCreated : null));
    },
    []
  );
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [focused, setFocused] = useState<FocusRef>(null);
  const layoutKey = `${LAYOUT_KEY}.v2.${scope}.${pathname}.view=${params.get("view")??"all"}.assignee=${params.get("assignee")??""}`;
  const [layout, setLayoutState] = useStoredJson<IssueLayout>(layoutKey, "list");
  const [toasts, setToasts] = useState<{ id: number; message: string; action?: ToastAction }[]>([]);
  const toastSeq = useRef(0);

  const toast = useCallback((message: string, action?: ToastAction) => {
    const id = ++toastSeq.current;
    setToasts((prev) => [...prev, { id, message, action }].slice(-3));
    setTimeout(() => setToasts((prev) => prev.filter((entry) => entry.id !== id)), action ? 12000 : 5000);
  }, []);

  function setLayout(next: IssueLayout) { setLayoutState(next); }
  // Native history participates in Next navigation without reloading the list.
  useEffect(() => { setOpenIssueId(params.get("issue"));setOpenPageId(params.get("issue")?null:params.get("doc")); }, [params]);
  useEffect(() => {
    const failed = () => toast(t("Local storage is full. Keep this page open and copy your draft."));
    window.addEventListener("tacos:storage-error", failed);
    return () => window.removeEventListener("tacos:storage-error", failed);
  }, [t, toast]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteOpen((open) => !open);
        return;
      }
      if (e.defaultPrevented || document.querySelector('[role="dialog"], [role="menu"][data-state="open"]') || isTyping(e) || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === "c") {
        e.preventDefault();
        setComposerOpen(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <UIContext.Provider
      value={{
        scope, confirm, pins, refreshPins, density,setDensity,
        openIssueId,
        openIssue,
        closeIssue,
        openPageId,
        openPage,
        closePage,
        panelExpanded,
        setPanelExpanded,
        composerOpen: composer.open,
        composerStatus: composer.status,
        composerSeed: composer.seed,
        setComposerOpen,
        projectComposerOpen,
        setProjectComposerOpen,
        projectComposerOnCreated,
        paletteOpen,
        setPaletteOpen,
        focused,
        setFocused,
        layout,
        setLayout,
        aiReady,
        toast,
      }}
    >
      {children}
      <Modal open={!!confirmation} title={t("Confirm")} onClose={() => { confirmation?.resolve(false); setConfirmation(null); }}>
        <p className="text-body text-text">{confirmation?.message}</p>
        <div className="mt-4 flex justify-end gap-3">
          <button autoFocus onClick={() => { confirmation?.resolve(false); setConfirmation(null); }}>{t("Cancel")}</button>
          <button className="rounded bg-danger px-3 py-1.5 text-body text-white" onClick={() => { confirmation?.resolve(true); setConfirmation(null); }}>{t("Confirm")}</button>
        </div>
      </Modal>
      <div className="pointer-events-none fixed bottom-6 left-1/2 z-50 flex -translate-x-1/2 flex-col items-center gap-1.5">
        {toasts.map((entry) => (
          <div
            key={entry.id}
            role="status"
            className="rounded-lg bg-text px-3.5 py-2 text-small font-medium text-bg shadow-[0_6px_20px_rgba(0,0,0,0.18)]"
          >
            {entry.message}
            {entry.action && <button className="pointer-events-auto ml-3 underline" onClick={() => { void entry.action!.run(); setToasts((all) => all.filter((item) => item.id !== entry.id)); }}>{entry.action.label}</button>}
          </div>
        ))}
      </div>
    </UIContext.Provider>
  );
}
