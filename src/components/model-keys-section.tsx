"use client";
import { safeAction } from "@/lib/ui/safe-action";
import { useConfirmation } from "@/components/ui/confirmation";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { removeModelEndpointAction, saveEditModelAction, saveModelEndpointAction } from "@/app/ai-actions";
import type { ModelEndpointView, ModelKeysView } from "@/lib/ai-constants";
import { desktopRunner, type DesktopResult } from "@/components/runner-bridge";
import { useT } from "@/components/i18n-context";

const BUTTON =
  "rounded-md border border-border px-2.5 py-1 text-small font-medium text-muted transition-colors hover:border-border-strong hover:text-text disabled:opacity-40";
const INPUT =
  "w-full rounded-md border border-border bg-elevated/50 px-2.5 py-1.5 text-small text-text placeholder:text-faint focus:border-border-strong";

// Connected to a server, keys live in a file on this computer and the page reaches them through
// the desktop app. They never pass through the server.
function keyStore(workspaceId: string, serverMode: boolean) {
  if (!serverMode) {
    return {
      save: (input: { id?: string; label: string; baseUrl: string; key: string; models: string }) =>
        saveModelEndpointAction(workspaceId, input),
      remove: (id: string) => removeModelEndpointAction(workspaceId, id),
      setEditModel: (id: string, model: string) => saveEditModelAction(workspaceId, id, model),
    };
  }
  const missing = <T,>(): Promise<DesktopResult<T>> =>
    Promise.resolve({ ok: false, error: "Open TaCos on your own computer to change them." });
  const keys = desktopRunner()?.keys;
  return {
    save: (input: { id?: string; label: string; baseUrl: string; key: string; models: string }) =>
      keys ? keys.save(input) : missing<{ view: ModelKeysView; verified: boolean }>(),
    remove: (id: string) => (keys ? keys.remove(id) : missing<ModelKeysView>()),
    setEditModel: (id: string, model: string) => (keys ? keys.setEditModel(id, model) : missing<ModelKeysView>()),
  };
}

export function ModelKeysSection({
  workspaceId,
  view: initial,
  serverMode = false,
}: {
  workspaceId: string;
  view: ModelKeysView;
  serverMode?: boolean;
}) {
  const t = useT();
  const {confirm,dialog}=useConfirmation();
  const router = useRouter();
  const [view, setView] = useState(initial);
  // null: form closed. "": adding a new API. Otherwise the API being changed.
  const [formId, setFormId] = useState<string | null>(initial.endpoints.length === 0 ? "" : null);
  const [form, setForm] = useState({ label: "", baseUrl: "", key: "", models: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  // null until the page has asked the desktop app, which a server render cannot do.
  const [onThisComputer, setOnThisComputer] = useState<boolean | null>(serverMode ? null : true);
  const store = keyStore(workspaceId, serverMode);

  useEffect(() => {
    if (!serverMode) return;
    const keys = desktopRunner()?.keys;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the desktop bridge exists only in the browser
    setOnThisComputer(Boolean(keys));
    if (!keys) return;
    void keys.list().then((result) => {
      if (!result.ok) return;
      setView(result.data);
      setFormId(result.data.endpoints.length === 0 ? "" : null);
    });
  }, [serverMode]);

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
    const result = await store.save({ ...form, id: formId || undefined });
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setView(result.data.view);
    setFormId(null);
    setNotice(
      result.data.verified
        ? t("Saved. The API accepted this key.")
        : !form.key.trim()
          ? t("Saved.")
          : serverMode
            ? t("Saved, not verified: the API could not be reached from this computer.")
            : t("Saved, not verified: the API could not be reached from this server.")
    );
    router.refresh();
  }

  async function remove(endpoint: ModelEndpointView) {
    if (busy || !await confirm(t("Delete {name} and its key?", { name: endpoint.label }))) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    const result = await store.remove(endpoint.id);
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
    const result = await store.setEditModel(id, model.join("/"));
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setView(result.data);
    router.refresh();
  }

  if (onThisComputer !== true) {
    return (
      <section className="space-y-3" data-testid="model-keys-settings">{dialog}
        <h2 className="text-body font-semibold">{t("Model API")}</h2>
        <p className="text-small leading-relaxed text-faint">
          {t("Your APIs stay on your own computer. Open the TaCos desktop app to add or change them.")}
        </p>
      </section>
    );
  }

  return (
    <section className="space-y-3" data-testid="model-keys-settings">{dialog}
      <h2 className="text-body font-semibold">{t("Model API")}</h2>
      {serverMode ? (
        <p className="text-small leading-relaxed text-faint">
          {t(
            "Your own APIs, for you only. Each member fills in their own. They are saved on this computer, in a file only your account can read, not encrypted, and they never reach the server. Pi and DeepSeek Harness have no subscription, so they need an API, and DeepSeek Harness only runs on a DeepSeek address."
          )}
        </p>
      ) : (
      <p className="text-small leading-relaxed text-faint">
        {t(
          "Your own APIs, for you only. Each member fills in their own. Any service that speaks the OpenAI API works, and its models appear in every harness's model menu. A harness needs something to spend: its own subscription or your API. Pi and DeepSeek Harness have no subscription, so they need an API, and DeepSeek Harness only runs on a DeepSeek address. Other members cannot see or use your API. Keys are stored encrypted and never reach the browser."
        )}
      </p>
      )}
      {view.endpoints.length > 0 && (
        <div className="divide-y divide-border rounded-lg border border-border">
          {view.endpoints.map((endpoint) => (
            <div
              key={endpoint.id}
              data-testid="model-endpoint"
              title={`${endpoint.baseUrl}\n${endpoint.models.slice(0, 6).join(" · ")}`}
              className="flex flex-wrap items-center gap-3 px-4 py-3"
            >
              <div className="min-w-0 flex-1">
                <div className="text-body font-medium">{endpoint.label}</div>
                <div className="truncate text-small text-faint">
                  {t("{count} models", { count: endpoint.models.length })} · <span className="font-mono">{endpoint.keyHint}</span>
                </div>
              </div>
              <button type="button" onClick={() => openForm(endpoint)} disabled={busy} className={BUTTON}>
                {t("Edit")}
              </button>
              <button type="button" onClick={() => void remove(endpoint)} disabled={busy} className={BUTTON}>
                {t("Delete")}
              </button>
            </div>
          ))}
        </div>
      )}
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
            <label key={input.field} className="block space-y-1 text-small text-muted">
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
              className="inline-flex items-center justify-center gap-1.5 whitespace-nowrap h-[30px] rounded-lg px-2.5 text-small bg-accent font-medium text-white transition-colors hover:bg-accent-hover disabled:opacity-40"
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
      {error && <div className="text-small text-danger">{t(error)}</div>}
      {notice && <div className="text-small text-muted">{notice}</div>}
      {view.endpoints.length > 0 && (
        <label className="block space-y-1 text-small text-muted">
          <span>{t("Model for inline edits and task drafts")}</span>
          <select
            value={view.editProvider ? `${view.editProvider}/${view.editModel}` : ""}
            onChange={(event) => void pickEditModel(event.target.value)}
            disabled={busy}
            className="h-[26px] rounded-[7px] px-2 block w-full border border-border bg-elevated/50 text-small text-text"
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
