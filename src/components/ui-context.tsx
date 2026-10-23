"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import type { Status } from "@/lib/constants";

// Fired on `window` after notifications are read so the sidebar badge and the bell
// refresh without waiting for their next poll.
export const NOTIFICATIONS_READ = "tacos:notifications-read";

export type FocusRef = {
  id: string;
  identifier: string;
  ref: string;
  title: string;
  status: string;
} | null;

export type IssueLayout = "list" | "board";

const LAYOUT_KEY = "tacos.issues.layout";

type UIState = {
  openIssueId: string | null;
  openIssue: (id: string) => void;
  closeIssue: () => void;
  composerOpen: boolean;
  // Set when the composer is opened from a status header: the draft starts in that status.
  composerStatus: Status | null;
  setComposerOpen: (open: boolean, status?: Status | null) => void;
  projectComposerOpen: boolean;
  setProjectComposerOpen: (open: boolean) => void;
  paletteOpen: boolean;
  setPaletteOpen: (open: boolean) => void;
  focused: FocusRef;
  setFocused: (focused: FocusRef) => void;
  layout: IssueLayout;
  setLayout: (layout: IssueLayout) => void;
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

export function UIProvider({ children }: { children: ReactNode }) {
  const [openIssueId, setOpenIssueId] = useState<string | null>(null);
  const [composer, setComposer] = useState<{ open: boolean; status: Status | null }>({
    open: false,
    status: null,
  });
  const setComposerOpen = useCallback((open: boolean, status: Status | null = null) => {
    setComposer(open ? { open: true, status } : { open: false, status: null });
  }, []);
  const [projectComposerOpen, setProjectComposerOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [focused, setFocused] = useState<FocusRef>(null);
  const [layout, setLayoutState] = useState<IssueLayout>("list");

  // One choice for every issue view, kept on the device rather than in the URL so
  // navigating between views does not reset it. Read after mount to match the server HTML.
  useEffect(() => {
    try {
      if (window.localStorage.getItem(LAYOUT_KEY) === "board") setLayoutState("board");
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
        openIssue: (id) => setOpenIssueId(id),
        closeIssue: () => setOpenIssueId(null),
        composerOpen: composer.open,
        composerStatus: composer.status,
        setComposerOpen,
        projectComposerOpen,
        setProjectComposerOpen,
        paletteOpen,
        setPaletteOpen,
        focused,
        setFocused,
        layout,
        setLayout,
      }}
    >
      {children}
    </UIContext.Provider>
  );
}
