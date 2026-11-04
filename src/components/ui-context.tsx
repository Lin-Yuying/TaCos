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

type UIState = {
  openIssueId: string | null;
  openIssue: (id: string) => void;
  closeIssue: () => void;
  // A document opened beside the page you were reading, the way a task opens in the
  // same right-hand pane. Only one of the two panes is up at a time.
  openPageId: string | null;
  openPage: (id: string) => void;
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
  toast: (message: string) => void;
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
  aiReady = false,
}: {
  children: ReactNode;
  aiReady?: boolean;
}) {
  const [openIssueId, setOpenIssueId] = useState<string | null>(null);
  const [openPageId, setOpenPageId] = useState<string | null>(null);
  const [panelExpanded, setPanelExpandedState] = useState(false);
  const openIssue = useCallback((id: string) => {
    setOpenIssueId(id);
    setOpenPageId(null);
    setPanelExpandedState(false);
  }, []);
  const closeIssue = useCallback(() => {
    setOpenIssueId(null);
    setPanelExpandedState(false);
  }, []);
  const openPage = useCallback((id: string) => {
    setOpenPageId(id);
    setOpenIssueId(null);
    setPanelExpandedState(false);
  }, []);
  const closePage = useCallback(() => {
    setOpenPageId(null);
    // An expanded pane is the only thing on screen; closing it must bring the page back.
    setPanelExpandedState(false);
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
  const [layout, setLayoutState] = useState<IssueLayout>("list");
  const [toasts, setToasts] = useState<{ id: number; message: string }[]>([]);
  const toastSeq = useRef(0);

  const toast = useCallback((message: string) => {
    const id = ++toastSeq.current;
    setToasts((prev) => [...prev, { id, message }].slice(-3));
    setTimeout(() => setToasts((prev) => prev.filter((entry) => entry.id !== id)), 3200);
  }, []);

  // One choice for every issue view, kept on the device rather than in the URL so
  // navigating between views does not reset it. Read after mount to match the server HTML.
  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(LAYOUT_KEY);
      if (saved === "board" || saved === "table" || saved === "calendar") setLayoutState(saved);
    } catch {
      /* storage unavailable — stay on the list layout */
    }
  }, []);

  function setLayout(next: IssueLayout) {
    setLayoutState(next);
    try {
      window.localStorage.setItem(LAYOUT_KEY, next);
    } catch {
      /* storage unavailable — the choice still applies to this page view */
    }
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteOpen((open) => !open);
        return;
      }
      if (isTyping(e) || e.metaKey || e.ctrlKey || e.altKey) return;
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
      <div className="pointer-events-none fixed bottom-6 left-1/2 z-50 flex -translate-x-1/2 flex-col items-center gap-1.5">
        {toasts.map((entry) => (
          <div
            key={entry.id}
            role="status"
            className="rounded-lg bg-text px-3.5 py-2 text-[12.5px] font-medium text-bg shadow-[0_6px_20px_rgba(0,0,0,0.18)]"
          >
            {entry.message}
          </div>
        ))}
      </div>
    </UIContext.Provider>
  );
}
