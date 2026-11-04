"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { removeModelEndpointAction, saveEditModelAction, saveModelEndpointAction } from "@/app/ai-actions";
import type { ModelEndpointView, ModelKeysView } from "@/lib/ai-constants";
import { useT } from "@/components/i18n-context";

const BUTTON =
  "rounded-md border border-border px-2.5 py-1 text-[12px] font-medium text-muted transition-colors hover:border-border-strong hover:text-text disabled:opacity-40";
const INPUT =
  "w-full rounded-md border border-border bg-elevated/50 px-2.5 py-1.5 text-[12px] text-text placeholder:text-faint focus:border-border-strong";

export function ModelKeysSection({ workspaceId, view: initial }: { workspaceId: string; view: ModelKeysView }) {
  const t = useT();
  const router = useRouter();
  const [view, setView] = useState(initial);
  // null: form closed. "": adding a new API. Otherwise the API being changed.
  const [formId, setFormId] = useState<string | null>(initial.endpoints.length === 0 ? "" : null);
  const [form, setForm] = useState({ label: "", baseUrl: "", key: "", models: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  function openForm(current?: ModelEndpointView) {
    setFormId(current?.id ?? "");
    setForm({
      label: current?.label ?? "",
      baseUrl: current?.baseUrl ?? "",
      key: "",
      models: current?.models.join(", ") ?? "",
    });
    setError(null);
    setNotice(null);
  }

  async function save() {
    if (busy || formId === null) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    const result = await saveModelEndpointAction(workspaceId, { ...form, id: formId || undefined });
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setView(result.data.view);
    setFormId(null);
    setNotice(
      result.data.verified ? t("Saved. The API accepted this key.") : form.key.trim() ? t("Saved, not verified: the API could not be reached from this server.") : t("Saved.")
    );
    router.refresh();
  }

  async function remove(endpoint: ModelEndpointView) {
    if (busy || !window.confirm(t("Delete {name} and its key?", { name: endpoint.label }))) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    const result = await removeModelEndpointAction(workspaceId, endpoint.id);
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setView(result.data);
    if (result.data.endpoints.length === 0) openForm();
    router.refresh();
  }

  async function pickEditModel(value: string) {
    const [id, ...model] = value.split("/");
    setBusy(true);
    setError(null);
    setNotice(null);
    const result = await saveEditModelAction(workspaceId, id, model.join("/"));
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setView(result.data);
    router.refresh();
  }

  return (
    <section className="space-y-3" data-testid="model-keys-settings">
      <h2 className="text-[13px] font-semibold">{t("Model API")}</h2>
      <p className="text-[13px] leading-relaxed text-muted">
        {t(
          "Your own APIs, for you only. Each member fills in their own. Any service that speaks the OpenAI API works, and its models appear in every harness's model menu. A harness needs something to spend: its own subscription or your API. Pi and DeepSeek Harness have no subscription, so they need an API, and DeepSeek Harness only runs on a DeepSeek address. Other members cannot see or use your API. Keys are stored encrypted and never reach the browser."
        )}
      </p>
      {view.endpoints.map((endpoint) => (
        <div
          key={endpoint.id}
          data-testid="model-endpoint"
          className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-border px-3 py-2.5"
        >
          <div className="min-w-0 flex-1">
            <div className="text-[13px] font-medium">{endpoint.label}</div>
            <div className="truncate font-mono text-[11.5px] text-faint">{endpoint.baseUrl}</div>
            <div className="truncate text-[11.5px] text-faint">
              {t("{count} models", { count: endpoint.models.length })}: {endpoint.models.slice(0, 6).join(" · ")}
            </div>
          </div>
          <span className="font-mono text-[12px] text-muted">{endpoint.keyHint}</span>
          <button type="button" onClick={() => openForm(endpoint)} disabled={busy} className={BUTTON}>
            {t("Edit")}
          </button>
          <button type="button" onClick={() => void remove(endpoint)} disabled={busy} className={BUTTON}>
            {t("Delete")}
          </button>
        </div>
      ))}
      {formId === null ? (
        <button type="button" onClick={() => openForm()} disabled={busy} className={BUTTON}>
          {t("Add API")}
        </button>
      ) : (
        <div className="space-y-2 rounded-lg border border-border p-3" data-testid="model-endpoint-form">
          {(
            [
              { field: "baseUrl", label: "Base URL", placeholder: "https://api.deepseek.com/v1" },
              { field: "key", label: "API key", placeholder: formId ? t("Leave blank to keep the saved one") : "" },
              { field: "models", label: t("Models"), placeholder: t("Leave blank to read them from the API") },
              { field: "label", label: t("Name"), placeholder: t("Leave blank to use the address") },
            ] as const
          ).map((input) => (
            <label key={input.field} className="block space-y-1 text-[12px] text-muted">
              <span>{input.label}</span>
              <input
                type={input.field === "key" ? "password" : "text"}
                autoComplete={input.field === "key" ? "new-password" : "off"}
                spellCheck={false}
                value={form[input.field]}
                onChange={(event) => setForm({ ...form, [input.field]: event.target.value })}
                placeholder={input.placeholder}
                className={`${INPUT} ${input.field === "label" ? "" : "font-mono"}`}
              />
            </label>
          ))}
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => void save()}
              disabled={busy || !form.baseUrl.trim() || (!formId && !form.key.trim())}
              className="rounded-md bg-accent px-3 py-1.5 text-[12.5px] font-medium text-white transition-colors hover:bg-accent-hover disabled:opacity-40"
            >
              {busy ? t("Saving…") : t("Save")}
            </button>
            {view.endpoints.length > 0 && (
              <button type="button" onClick={() => setFormId(null)} disabled={busy} className={BUTTON}>
                {t("Cancel")}
              </button>
            )}
          </div>
        </div>
      )}
      {error && <div className="text-[12px] text-danger">{t(error)}</div>}
      {notice && <div className="text-[12px] text-muted">{notice}</div>}
      {view.endpoints.length > 0 && (
        <label className="block space-y-1 text-[12px] text-muted">
          <span>{t("Model for inline edits and task drafts")}</span>
          <select
            value={view.editProvider ? `${view.editProvider}/${view.editModel}` : ""}
            onChange={(event) => void pickEditModel(event.target.value)}
            disabled={busy}
            className="block w-full rounded-md border border-border bg-elevated/50 px-2 py-1.5 text-[12.5px] text-text"
          >
            {view.endpoints.flatMap((endpoint) =>
              endpoint.models.map((model) => (
                <option key={`${endpoint.id}/${model}`} value={`${endpoint.id}/${model}`}>
                  {endpoint.label} · {model}
                </option>
              ))
            )}
          </select>
        </label>
      )}
    </section>
  );
}
