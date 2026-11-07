"use client";

import { EntityRow } from "@/components/ui/entity-row";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronRight, FileText, Lock, Users } from "lucide-react";
import {
  draggable,
  dropTargetForElements,
  monitorForElements,
} from "@atlaskit/pragmatic-drag-and-drop/element/adapter";
import {
  attachInstruction,
  extractInstruction,
  type Instruction,
} from "@atlaskit/pragmatic-drag-and-drop-hitbox/tree-item";
import { useUI } from "@/components/ui-context";
import { movePageAction, previewPageMoveAction } from "@/app/pages-actions";
import { NewPageMenu } from "@/components/new-page-menu";
import { useT } from "@/components/i18n-context";
import type { PageSummary } from "@/lib/pages";
import { useStoredJson } from "@/lib/use-stored-json";

const EXPANDED_KEY = "tacos.sidebar.docTree";
const INDENT = 12;

const NO_EXPANDED: Record<string, boolean> = {};

function DocRow({
  workspaceId,
  page,
  depth,
  children,
  byParent,
  isOpen,
  onToggle,
  active,
  blocked,
  rootShared,
}: {
  workspaceId: string;
  page: PageSummary;
  depth: number;
  children: PageSummary[];
  byParent: Map<string | null, PageSummary[]>;
  isOpen: (id: string) => boolean;
  onToggle: (id: string) => void;
  active: string | null;
  // This row and its subtree: a page cannot move inside itself.
  blocked: (sourceId: string, targetId: string) => boolean;
  rootShared: boolean;
}) {
  const t = useT();
  const ref = useRef<HTMLDivElement>(null);
  const [instruction, setInstruction] = useState<Instruction | null>(null);
  const open = isOpen(page.id);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const stopDrag = draggable({ element, canDrag: () => page.canEdit === true, getInitialData: () => ({ pageId: page.id }) });
    const stopDrop = dropTargetForElements({
      element,
      canDrop: ({ source }) =>
        page.canEdit === true && typeof source.data.pageId === "string" && !blocked(source.data.pageId, page.id),
      getData: ({ input, element: target }) =>
        attachInstruction(
          { rowId: page.id },
          {
            input,
            element: target,
            currentLevel: depth,
            indentPerLevel: INDENT,
            mode: open && children.length ? "expanded" : "standard",
          }
        ),
      onDrag: ({ self }) => setInstruction(extractInstruction(self.data)),
      onDragLeave: () => setInstruction(null),
      onDrop: () => setInstruction(null),
    });
    return () => {
      stopDrag();
      stopDrop();
    };
  }, [page.id, page.canEdit, depth, open, children.length, blocked]);

  return (
    <>
      <EntityRow kind="document" id={page.id} title={page.title}>
      <div
        ref={ref}
        data-doc-row={page.id}
        style={{ paddingLeft: Math.min(depth, 8) * INDENT }}
        className={`relative flex items-center rounded-md transition-colors ${
          instruction?.type === "make-child" ? "ring-1 ring-accent" : ""
        } ${active === page.id ? "bg-elevated font-medium text-text" : "text-muted hover:bg-elevated/60 hover:text-text"}`}
      >
        {instruction?.type === "reorder-above" && (
          <span className="absolute inset-x-0 top-0 h-0.5 rounded bg-accent" />
        )}
        {instruction?.type === "reorder-below" && (
          <span className="absolute inset-x-0 bottom-0 h-0.5 rounded bg-accent" />
        )}
        <button
          type="button"
          aria-label={open ? t("Collapse") : t("Expand")}
          onClick={() => onToggle(page.id)}
          className={`flex h-6 w-5 shrink-0 items-center justify-center text-faint hover:text-muted ${
            children.length ? "" : "invisible"
          }`}
        >
          <ChevronRight size={11} className={`transition-transform ${open ? "rotate-90" : ""}`} />
        </button>
        <Link
          href={`/${workspaceId}/docs/${page.id}`}
          draggable={false}
          className="flex min-w-0 flex-1 items-center gap-1.5 py-1 pr-2"
        >
          <span className="flex w-4 shrink-0 items-center justify-center text-faint">
            {page.icon ?? <FileText size={13} />}
          </span>
          <span className="truncate">{page.title || t("Untitled")}</span><span title={t(page.canEdit?"Can edit":"Read only")} className="ml-auto flex shrink-0 gap-1 text-faint">{page.shared?<Users size={10}/>:<Lock size={10}/>}{!page.canEdit&&t("Read only")}</span>
        </Link>
      </div>
      </EntityRow>
      {open &&
        children.map((child) => (
          <DocRow
            key={child.id}
            workspaceId={workspaceId}
            page={child}
            depth={depth + 1}
            byParent={byParent}
            isOpen={isOpen}
            onToggle={onToggle}
            active={active}
            blocked={blocked}
            rootShared={rootShared}
          >
            {byParent.get(child.id) ?? []}
          </DocRow>
        ))}
    </>
  );
}

function DocSection({
  workspaceId,
  sectionShared,
  label,
  icon,
  roots,
  rowProps,
}: {
  workspaceId: string;
  sectionShared: boolean;
  label: string;
  icon: React.ReactNode;
  roots: PageSummary[];
  rowProps: Pick<
    React.ComponentProps<typeof DocRow>,
    "byParent" | "isOpen" | "onToggle" | "active" | "blocked"
  >;
}) {
  const t = useT();
  const ref = useRef<HTMLDivElement>(null);
  const [over, setOver] = useState(false);

  // The whole section is a drop target: letting go on its heading or empty space moves the
  // page to the top level here (reorder / un-nest) without changing its sharing.
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    return dropTargetForElements({
      element,
      canDrop: ({ source }) => typeof source.data.pageId === "string",
      getData: () => ({ sectionShared }),
      onDrag: ({ location }) => setOver(location.current.dropTargets[0]?.element === element),
      onDragLeave: () => setOver(false),
      onDrop: () => setOver(false),
    });
  }, [sectionShared]);

  return (
    <div ref={ref} data-doc-section={sectionShared ? "shared" : "private"} className={`rounded-md pb-1 ${over ? "ring-1 ring-accent" : ""}`}>
      <div className="flex items-center justify-between pr-1 pt-1">
        <span className="flex min-w-0 items-center gap-1 px-1.5 py-0.5 text-small font-medium uppercase tracking-wider text-faint">
          <span className="flex shrink-0 items-center justify-center">{icon}</span>
          {label}
        </span>
        <NewPageMenu
          workspaceId={workspaceId}
          shared={sectionShared}
          variant="icon"
          className="rounded p-1 text-faint transition-colors hover:bg-elevated hover:text-text disabled:opacity-50"
        />
      </div>
      {roots.length === 0 ? (
        <div className="px-2 py-1 text-small text-faint">{t("No documents yet")}</div>
      ) : (
        <div className="space-y-0.5">
          {roots.map((page) => (
            <DocRow
              key={page.id}
              workspaceId={workspaceId}
              page={page}
              depth={0}
              rootShared={sectionShared}
              {...rowProps}
            >
              {rowProps.byParent.get(page.id) ?? []}
            </DocRow>
          ))}
        </div>
      )}
    </div>
  );
}

/** The sidebar's document tree: one section for shared documents, one for private ones. */
export function DocTree({ workspaceId, pages }: { workspaceId: string; pages: PageSummary[] }) {
  const t = useT();
  const {confirm,scope,openPageId}=useUI();
  const moving=useRef(false);
  const router = useRouter();
  const pathname = usePathname();
  const [expanded, setExpanded] = useStoredJson(`${EXPANDED_KEY}.${scope}`, NO_EXPANDED);
  const [error, setError] = useState<string | null>(null);
  const root=useRef<HTMLDivElement>(null);
  const routeActive = pathname.match(new RegExp(`^/${workspaceId}/docs/([^/]+)$`))?.[1] ?? null;
  const active=openPageId??routeActive;
  useEffect(()=>{if(active)root.current?.querySelector(`[data-doc-row="${CSS.escape(active)}"]`)?.scrollIntoView({block:"nearest"});},[active,pages]);
  const { byId, byParent } = useMemo(() => {
    const ids = new Map(pages.map((page) => [page.id, page]));
    const children = new Map<string | null, PageSummary[]>();
    for (const page of pages) {
      // A parent this person cannot see leaves its child at the top level.
      const key = page.parentId && ids.has(page.parentId) ? page.parentId : null;
      const bucket=children.get(key)??[];bucket.push(page);children.set(key,bucket);
    }
    return { byId: ids, byParent: children };
  }, [pages]);

  const openByDefault = useMemo(() => {
    const out = new Set<string>();
    let at = active ? byId.get(active)?.parentId ?? null : null;
    while (at && !out.has(at)) {
      out.add(at);
      at = byId.get(at)?.parentId ?? null;
    }
    return out;
  }, [active, byId]);

  const isOpen = (id: string) => openByDefault.has(id) || expanded[id] === true;

  function toggle(id: string) {
    setExpanded({ ...expanded, [id]: !isOpen(id) });
  }

  const blocked = useMemo(
    () => (sourceId: string, targetId: string) => {
      let at: string | null = targetId;
      const seen = new Set<string>();
      while (at && !seen.has(at)) {
        if (at === sourceId) return true;
        seen.add(at);
        at = byId.get(at)?.parentId ?? null;
      }
      return false;
    },
    [byId]
  );

  async function move(pageId: string, target: { parentId: string | null; beforeId: string | null; shared?: boolean }) {
    if(moving.current)return;moving.current=true;
    try {
      const preview=await previewPageMoveAction(workspaceId,pageId,target);
      if(!preview.ok){setError(preview.error);return;}
      const impact=preview.data;
      if(impact.requiresConfirmation&&!(await confirm(t("Move this document and {count} children?",{count:impact.descendantCount}),{body:t("Visibility: {visibility}; permission: {level}; project: {project}.",{visibility:t(impact.shared?"Shared":"Private"),level:impact.level,project:impact.projectId??t("None")}),action:t("Move"),tone:"primary"})))return;
      const result = await movePageAction(workspaceId, pageId, {...target,confirmedImpact:impact.token});
    if (result.ok) {
      setError(null);
      router.refresh();
    } else {
      setError(result.error);
    }
    }catch{setError(t("Could not save. Retry."));}finally{moving.current=false;}
  }

  const moveRef = useRef(move);
  useEffect(() => {
    moveRef.current = move;
  });

  useEffect(
    () =>
      monitorForElements({
        canMonitor: ({ source }) => typeof source.data.pageId === "string",
        onDrop: ({ source, location }) => {
          const target = location.current.dropTargets[0];
          const pageId = source.data.pageId as string;
          if (!target) return;
          if (typeof target.data.sectionShared === "boolean") {
            void moveRef.current(pageId, { parentId: null, beforeId: null });
            return;
          }
          const rowId = target.data.rowId as string;
          const instruction = extractInstruction(target.data);
          if (!instruction) return;
          if (instruction.type === "make-child") {
            void moveRef.current(pageId, { parentId: rowId, beforeId: null });
            return;
          }
          const parentId = byId.get(rowId)?.parentId ?? null;
          const key = parentId && byId.has(parentId) ? parentId : null;
          if (instruction.type === "reorder-above") {
            void moveRef.current(pageId, { parentId: key, beforeId: rowId });
          } else if (instruction.type === "reorder-below") {
            const siblings = (byParent.get(key) ?? []).filter((page) => page.id !== pageId);
            const next = siblings[siblings.findIndex((page) => page.id === rowId) + 1];
            void moveRef.current(pageId, { parentId: key, beforeId: next?.id ?? null });
          }
        },
      }),
    [byId, byParent]
  );

  const roots = byParent.get(null) ?? [];
  const rowProps = { byParent, isOpen, onToggle: toggle, active, blocked };

  return (
    <div ref={root} data-doc-tree className="pb-1">
      <DocSection
        workspaceId={workspaceId}
        sectionShared
        label={t("Shared")}
        icon={<Users size={11} />}
        roots={roots.filter((page) => page.shared)}
        rowProps={rowProps}
      />
      <DocSection
        workspaceId={workspaceId}
        sectionShared={false}
        label={t("Private")}
        icon={<Lock size={11} />}
        roots={roots.filter((page) => !page.shared)}
        rowProps={rowProps}
      />
      {error && <div className="px-2 py-1 text-small text-danger">{t(error)}</div>}
    </div>
  );
}
