"use client";
import { Fragment, useRef, useState, type ReactNode } from "react";
import * as Context from "@radix-ui/react-context-menu";
import { MoreHorizontal } from "lucide-react";
import { useRouter } from "next/navigation";
import { Menu, MenuItem } from "@/components/menu";
import { Modal } from "@/components/ui/modal";
import { useT } from "@/components/i18n-context";
import { useUI } from "@/components/ui-context";
import { useDraft } from "@/lib/ui/draft-store";
import type { AgentThread } from "@/lib/agent-threads";
import {
  deleteAgentThreadAction,
  renameAgentThreadAction,
  setAgentThreadPinnedAction,
  setAgentThreadUnreadAction,
  setAgentThreadVisibilityAction,
  setAgentThreadProjectAction,
} from "@/app/agent-actions";
export function ThreadMenu({
  workspaceId,
  thread,
  projects,
  children,
  phoneItems,
}: {
  workspaceId: string;
  thread: AgentThread;
  projects: { id: string; name: string }[];
  children?: ReactNode;
  // Header actions that collapse into this menu on a phone.
  phoneItems?: (close: () => void) => ReactNode;
}) {
  const t = useT(),
    router = useRouter(),
    { confirm, toast } = useUI();
  const [renaming, setRenaming] = useState(false),
    [draft, setDraft] = useDraft<string | null>(
      "thread-title",
      thread.id,
      null,
    ),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<string | null>(null);
  const running = useRef(false);
  const [moving, setMoving] = useState(false);
  async function run(
    work: () => Promise<{ ok: boolean; error?: string; data?: AgentThread | {id:string} | void }>,
    done?: () => void,
  ) {
    if (running.current) return;
    running.current = true;
    setBusy(true);
    try {
      const result = await work();
      if (!result.ok) {
        setError(result.error ?? "Could not save. Retry.");
        toast(t(result.error ?? "Could not save. Retry."));
      } else {
        setError(null);
        done?.();
        window.dispatchEvent(
          new CustomEvent("tacos:thread-changed", {
            detail: { id: thread.id, thread: result.data && "workspaceId" in result.data ? result.data : null },
          }),
        );
        router.refresh();
      }
    } catch {
      setError("Could not save. Retry.");
      toast(t("Could not save. Retry."));
    } finally {
      running.current = false;
      setBusy(false);
    }
  }
  async function remove() {
    if (
      await confirm(
        t("Delete “{title}” and its history?", { title: thread.title }),
        { action: t("Delete") },
      )
    )
      await run(
        () => deleteAgentThreadAction(workspaceId, thread.id),
        () => {
          if (new URLSearchParams(location.search).get("thread") === thread.id)
            router.push(`/${workspaceId}/agent`);
        },
      );
  }
  const actions: { label: string; run: () => void }[] = [
    ...(thread.mine ? [{ label: "Rename", run: () => setRenaming(true) }] : []),
    {
      label: thread.pinnedAt ? "Unpin" : "Pin",
      run: () =>
        void run(() =>
          setAgentThreadPinnedAction(workspaceId, thread.id, !thread.pinnedAt),
        ),
    },
    ...(thread.mine
      ? [{ label: "Move to project", run: () => setMoving(true) }]
      : []),
    {
      label: "Mark as unread",
      run: () =>
        void run(() =>
          setAgentThreadUnreadAction(workspaceId, thread.id, true),
        ),
    },
    ...(thread.mine
      ? [
          {
            label:
              thread.visibility === "shared"
                ? "Make private"
                : "Share with workspace",
            run: () =>
              void run(() =>
                setAgentThreadVisibilityAction(
                  workspaceId,
                  thread.id,
                  thread.visibility === "shared" ? "private" : "shared",
                ),
              ),
          },
        ]
      : []),
    {
      label: "Copy link",
      run: () =>
        void navigator.clipboard
          .writeText(
            `${location.origin}/${workspaceId}/agent?thread=${thread.id}`,
          )
          .then(() => toast(t("Link copied")))
          .catch(() => toast(t("Could not copy the link"))),
    },
    {
      label: "Open in new window",
      run: () =>
        window.open(
          `/${workspaceId}/agent?thread=${thread.id}`,
          "_blank",
          "noopener,noreferrer",
        ),
    },
    ...(thread.mine ? [{ label: "Delete conversation", run: remove }] : []),
  ];
  const lead = ["Rename", "Move to project", "Copy link"];
  const rank = (label: string) => (label === "Delete conversation" ? 9 : lead.includes(label) ? lead.indexOf(label) : 5);
  actions.sort((a, b) => rank(a.label) - rank(b.label));
  const more = (
    <Menu
      align="right"
      width={220}
      trigger={<MoreHorizontal size={14} />}
      triggerClassName="rounded p-1 text-faint hover:bg-elevated"
    >
      {(close) => (
        <>
          {phoneItems?.(close)}
          {actions.map((action) => (
            <Fragment key={action.label}>
              {action.label === "Delete conversation" && <div className="my-1 h-px bg-border" />}
              <MenuItem
                danger={action.label === "Delete conversation"}
                disabled={busy}
                onSelect={() => {
                  close();
                  action.run();
                }}
              >
                {t(action.label)}
              </MenuItem>
            </Fragment>
          ))}
        </>
      )}
    </Menu>
  );
  return (
    <>
      <Modal
        open={moving}
        title={t("Move to project")}
        onClose={() => {
          if (!busy) setMoving(false);
        }}
      >
        <h2 className="text-lead font-semibold">{t("Move to project")}</h2>
        <select
          disabled={busy}
          aria-label={t("Move to project")}
          value={thread.projectId}
          onChange={(e) =>
            void run(
              () =>
                setAgentThreadProjectAction(
                  workspaceId,
                  thread.id,
                  e.target.value,
                ),
              () => setMoving(false),
            )
          }
          className="my-3 w-full rounded border border-border bg-bg p-2 text-body"
        >
          <option value="">{t("No project")}</option>
          {projects.map((project) => (
            <option key={project.id} value={project.id}>
              {project.name}
            </option>
          ))}
        </select>
        {error && (
          <p role="alert" className="text-small text-danger">
            {t(error)}
          </p>
        )}
      </Modal>
      <Context.Root>
        <Context.Trigger asChild>
          {children ? (
            <div className="group relative flex min-w-0 items-center rounded hover:bg-elevated">
              <div className="min-w-0 flex-1">{children}</div>
              {more}
            </div>
          ) : (
            <span>{more}</span>
          )}
        </Context.Trigger>
        <Context.Portal>
          <Context.Content
            collisionPadding={8}
            className="z-[80] min-w-52 rounded-lg border border-border bg-overlay p-1 shadow-xl"
          >
            {actions.map((action) => (
              <Context.Item
                key={action.label}
                disabled={busy}
                onSelect={() => action.run()}
                className="rounded px-2 py-1.5 text-body outline-none data-[highlighted]:bg-elevated"
              >
                {t(action.label)}
              </Context.Item>
            ))}
          </Context.Content>
        </Context.Portal>
      </Context.Root>
      <Modal
        open={renaming}
        title={t("Rename")}
        onClose={() => {
          if (!busy) setRenaming(false);
        }}
      >
        <h2 className="text-lead font-semibold">{t("Rename")}</h2>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (
              !(draft ?? thread.title).trim() ||
              (draft ?? thread.title).trim().length > 80
            ) {
              setError("Enter a name between 1 and 80 characters");
              return;
            }
            void run(
              () =>
                renameAgentThreadAction(
                  workspaceId,
                  thread.id,
                  (draft ?? thread.title).trim(),
                ),
              () => {
                setDraft(null);
                setRenaming(false);
              },
            );
          }}
        >
          <input
            autoFocus
            disabled={busy}
            aria-label={t("Conversation name")}
            value={draft ?? thread.title}
            onChange={(e) => setDraft(e.target.value)}
            className="my-3 w-full rounded border border-border bg-bg p-2 text-body"
          />
          {error && (
            <p role="alert" className="text-small text-danger">
              {t(error)}
            </p>
          )}
          <button
            disabled={busy}
            className="rounded border border-border px-3 py-1 text-body"
          >
            {t("Save")}
          </button>
        </form>
      </Modal>
    </>
  );
}
