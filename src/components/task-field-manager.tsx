"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Modal } from "@/components/ui/modal";
import { useT } from "@/components/i18n-context";
import { useUI } from "@/components/ui-context";
import {
  createTaskFieldAction,
  listTaskFieldsAction,
  updateTaskFieldAction,
  deleteTaskFieldAction,
  restoreTaskFieldAction,
  taskFieldImpactAction,
} from "@/app/actions";
import { FIELD_TYPES, type FieldType, type TaskField } from "@/lib/task-view";
const TYPE_LABEL: Record<FieldType, string> = {
  text: "Text",
  number: "Number",
  select: "Select",
  date: "Date",
  checkbox: "Checkbox",
};
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
    [name, setName] = useState(""),
    [type, setType] = useState<FieldType>("text"),
    [options, setOptions] = useState(""),
    [busy, setBusy] = useState(false);
  const running = useRef(false);
  async function addField() {
    if (!name.trim() || busy) return;
    setBusy(true);
    try {
      const result = await createTaskFieldAction(workspaceId, {
        name,
        type,
        options: options.split(/[,，\n]/),
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setName("");
      setOptions("");
      setError(null);
      const loaded = await listTaskFieldsAction(workspaceId, true);
      if (loaded.ok) setFields(loaded.data);
      router.refresh();
    } catch {
      setError("Could not save. Retry.");
    } finally {
      setBusy(false);
    }
  }
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
              "Disable this field on {count} tasks?",
              { count: impact.data },
            ),
            { body: t("Values are kept and can be restored."), action: t("Disable") },
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
                    className="h-[34px] rounded-lg px-2.5 w-full border border-border-strong bg-bg p-1 text-body"
                  />
                  {field.type === "select" && (
                    <textarea
                      aria-label={t("Options, separated by commas")}
                      value={edit.options}
                      onChange={(e) =>
                        setEdit({ ...edit, options: e.target.value })
                      }
                      className="mt-2 w-full rounded-lg border border-border-strong bg-bg p-1"
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
                  <div className="min-w-0 flex-1">
                    <div>
                      {field.name}
                      {field.disabledAt ? ` · ${t("Disabled")}` : ""}
                    </div>
                    <div className="truncate text-small text-faint">
                      {t(TYPE_LABEL[field.type])}
                      {field.type === "select" && field.options.length > 0
                        ? ` · ${field.options.join("、")}`
                        : ""}
                    </div>
                  </div>
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
        <div className="mt-3 space-y-1.5 border-t border-border pt-3">
          <div className="flex items-center gap-1.5">
            <input
              data-task-field-name
              aria-label={t("Field name")}
              value={name}
              disabled={busy}
              placeholder={t("Field name")}
              onChange={(e) => setName(e.target.value)}
              className="h-[30px] min-w-0 flex-1 rounded-lg border border-border bg-bg px-2 text-small text-text"
            />
            <select
              data-task-field-type
              aria-label={t("Type")}
              value={type}
              disabled={busy}
              onChange={(e) => setType(e.target.value as FieldType)}
              className="h-[30px] shrink-0 rounded-lg border border-border bg-bg px-1.5 text-small text-text"
            >
              {FIELD_TYPES.map((value) => (
                <option key={value} value={value}>
                  {t(TYPE_LABEL[value])}
                </option>
              ))}
            </select>
            <button
              type="button"
              data-task-field-add
              disabled={busy || !name.trim()}
              onClick={() => void addField()}
              className="inline-flex h-[30px] shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-lg border border-border bg-bg px-2.5 text-small text-text hover:bg-active disabled:opacity-40"
            >
              {t("Add field")}
            </button>
          </div>
          {type === "select" && (
            <input
              data-task-field-options
              aria-label={t("Options, separated by commas")}
              value={options}
              disabled={busy}
              placeholder={t("Options, separated by commas")}
              onChange={(e) => setOptions(e.target.value)}
              className="h-[30px] w-full rounded-lg border border-border bg-bg px-2 text-small text-text"
            />
          )}
        </div>
        <div className="mt-3 flex justify-end">
          <button
            type="button"
            disabled={busy}
            onClick={() => setOpen(false)}
            className="rounded-md px-2 py-1 text-small text-muted hover:bg-elevated hover:text-text"
          >
            {t("Done")}
          </button>
        </div>
      </Modal>
    </>
  );
}
