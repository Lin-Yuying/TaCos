"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Modal } from "@/components/ui/modal";
import { useT } from "@/components/i18n-context";
import { useUI } from "@/components/ui-context";
import {
  listTaskFieldsAction,
  updateTaskFieldAction,
  deleteTaskFieldAction,
  restoreTaskFieldAction,
  taskFieldImpactAction,
} from "@/app/actions";
import type { TaskField } from "@/lib/task-view";
export function TaskFieldManager({ workspaceId, open, onOpenChange: setOpen }: { workspaceId: string; open: boolean; onOpenChange: (open: boolean) => void }) {
  const t = useT(),
    router = useRouter(),
    { confirm } = useUI();
  const [fields, setFields] = useState<TaskField[]>([]),
    [edit, setEdit] = useState<{
      id: string;
      name: string;
      options: string;
    } | null>(null),
    [error, setError] = useState<string | null>(null),
    [busy, setBusy] = useState(false);
  const running = useRef(false);
  useEffect(() => {
    let live = true;
    if (open)
      void listTaskFieldsAction(workspaceId, true)
        .then((result) => {
          if (!live) return;
          if (result.ok) setFields(result.data);
          else setError(result.error);
        })
        .catch(() => {
          if (live) setError("Could not load fields. Reopen to retry.");
        });
    return () => {
      live = false;
    };
  }, [open, workspaceId]);
  async function change(
    field: TaskField,
    operation: "save" | "disable" | "restore",
  ) {
    if (running.current) return;
    running.current = true;
    setBusy(true);
    try {
      if (operation === "disable") {
        const impact = await taskFieldImpactAction(workspaceId, field.id);
        if (!impact.ok) {
          setError(impact.error);
          return;
        }
        if (
          !(await confirm(
            t(
              "Disable this field on {count} tasks? Values are kept and can be restored.",
              { count: impact.data },
            ),
          ))
        )
          return;
      }
      const result =
        operation === "save"
          ? await updateTaskFieldAction(workspaceId, field.id, {
              name: edit?.name ?? field.name,
              options: edit?.options.split(/[,，\n]/),
            })
          : operation === "restore"
            ? await restoreTaskFieldAction(workspaceId, field.id)
            : await deleteTaskFieldAction(workspaceId, field.id);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      const loaded = await listTaskFieldsAction(workspaceId, true);
      if (loaded.ok) setFields(loaded.data);
      setEdit(null);
      setError(null);
      router.refresh();
    } catch {
      setError("Could not save. Retry.");
    } finally {
      running.current = false;
      setBusy(false);
    }
  }
  return (
    <>
      <Modal
        open={open}
        title={t("Manage fields")}
        onClose={() => {
          if (!busy) setOpen(false);
        }}
      >
        <h2 className="text-title">{t("Manage fields")}</h2>
        <p className="my-2 text-small text-muted">
          {t("Disabled fields and removed options keep their existing values.")}
        </p>
        {error && (
          <p role="alert" className="text-small text-danger">
            {t(error)}
          </p>
        )}
        <fieldset
          disabled={busy}
          className="max-h-[60dvh] space-y-3 overflow-auto"
        >
          {fields.map((field) => (
            <div
              key={field.id}
              className="rounded border border-border p-2 text-body"
            >
              {edit?.id === field.id ? (
                <>
                  <input
                    aria-label={t("Field name")}
                    value={edit.name}
                    onChange={(e) => setEdit({ ...edit, name: e.target.value })}
                    className="w-full rounded border border-border bg-bg p-1"
                  />
                  {field.type === "select" && (
                    <textarea
                      aria-label={t("Options, separated by commas")}
                      value={edit.options}
                      onChange={(e) =>
                        setEdit({ ...edit, options: e.target.value })
                      }
                      className="mt-2 w-full rounded border border-border bg-bg p-1"
                    />
                  )}
                  <div className="mt-2 flex gap-3 text-small">
                    <button onClick={() => void change(field, "save")}>
                      {t("Save")}
                    </button>
                    <button onClick={() => setEdit(null)}>{t("Cancel")}</button>
                  </div>
                </>
              ) : (
                <div className="flex gap-3">
                  <span className="flex-1">
                    {field.name}
                    {field.disabledAt ? ` · ${t("Disabled")}` : ""}
                  </span>
                  <button
                    className="text-small"
                    onClick={() =>
                      setEdit({
                        id: field.id,
                        name: field.name,
                        options: field.options.join(", "),
                      })
                    }
                  >
                    {t("Edit")}
                  </button>
                  <button
                    className="text-small"
                    onClick={() =>
                      void change(
                        field,
                        field.disabledAt ? "restore" : "disable",
                      )
                    }
                  >
                    {t(field.disabledAt ? "Restore" : "Disable")}
                  </button>
                </div>
              )}
            </div>
          ))}
        </fieldset>
      </Modal>
    </>
  );
}
