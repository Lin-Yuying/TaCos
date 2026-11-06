"use client";

import { EntityRow } from "@/components/ui/entity-row";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { FileText, FolderOpen, Lock, Plus, Upload, Users } from "lucide-react";
import { createPageAction, importMarkdownAction } from "@/app/pages-actions";
import { Menu, MenuItem } from "@/components/menu";
import type { DocPage } from "@/lib/pages";
import { useT } from "@/components/i18n-context";

const MARKDOWN_FILE = /\.(md|markdown|mdx|txt)$/i;

function relativePath(file: File): string {
  return (file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name;
}

// Hidden files and dependency folders are never notes; a folder import skips them.
function junkPath(path: string): boolean {
  return path.split("/").some((part) => part.startsWith(".") || part === "node_modules");
}

export function DocsIndex({
  workspaceId,
  userId,
  pages,
}: {
  workspaceId: string;
  userId: string;
  pages: DocPage[];
}) {
  const t = useT();
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const filesRef = useRef<HTMLInputElement>(null);
  const folderRef = useRef<HTMLInputElement>(null);
  const importing = useRef(false);
  const creatingRef=useRef(false);
  const [creating,setCreating]=useState(false);
  const mine = pages.filter((page) => page.createdBy === userId);
  const shared = pages.filter((page) => page.createdBy !== userId);

  async function createPage() {
    if(creatingRef.current)return;
    creatingRef.current=true;setCreating(true);
    try {
    const result = await createPageAction(workspaceId);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    router.push(`/${workspaceId}/docs/${result.data.id}`);
    }catch{setError("Could not save. Retry.");}finally{creatingRef.current=false;setCreating(false);}
  }

  async function importFiles(picked: File[], stripRoot: boolean) {
    if (importing.current) return;
    const files = picked.filter(
      (file) => MARKDOWN_FILE.test(file.name) && !junkPath(relativePath(file))
    );
    if (files.length === 0) {
      setNote(t("That selection had no Markdown files."));
      return;
    }
    importing.current = true;
    setError(null);
    setNote(null);
    let created = 0;
    let skipped = 0;
    let failed = 0;
    // A bare count says nothing about what to fix, so keep the first reason.
    let reason: string | null = null;
    for (const [index, file] of files.entries()) {
      setProgress({ done: index, total: files.length });
      const raw = relativePath(file);
      // The picked folder is the container, not a note: drop its own name from the tree.
      const path = stripRoot && raw.includes("/") ? raw.slice(raw.indexOf("/") + 1) : raw;
      let content: string;
      try {
        content = await file.text();
      } catch {
        failed += 1;
        reason ??= `${file.name} could not be read from disk.`;
        continue;
      }
      const result = await importMarkdownAction(workspaceId, { path, content });
      if (!result.ok) {
        failed += 1;
        reason ??= `${file.name}: ${result.error}`;
      } else if (result.data.created) created += 1;
      else skipped += 1;
    }
    importing.current = false;
    setProgress(null);
    setNote(
      [
        created > 0 ? t("{count} imported", { count: created }) : "",
        skipped > 0 ? t("{count} already existed", { count: skipped }) : "",
        failed > 0
          ? reason
            ? t("{count} failed — {reason}", { count: failed, reason })
            : t("{count} failed", { count: failed })
          : "",
      ]
        .filter(Boolean)
        .join(" · ") || t("Nothing imported")
    );
    router.refresh();
  }

  const section = (title: string, items: DocPage[], empty: string) => (
    <section className="mt-6 first:mt-0">
      <h2 className="mb-2 text-small font-medium uppercase tracking-wider text-faint">{title}</h2>
      {items.length === 0 ? (
        <p className="text-body text-faint">{empty}</p>
      ) : (
        <div className="space-y-0.5">
          {items.map((page) => (
            <EntityRow key={page.id} kind="document" id={page.id} title={page.title}>
            <Link
              key={page.id}
              href={`/${workspaceId}/docs/${page.id}`}
              className="flex items-center gap-2 rounded-md px-2 py-1.5 text-body text-text transition-colors hover:bg-elevated/60"
            >
              <span className="shrink-0">{page.icon ?? "📄"}</span>
              <span className="truncate">{page.title}</span>
              <span className="ml-auto flex shrink-0 items-center gap-1 text-caption text-faint">
                {page.shared ? <Users size={11} /> : <Lock size={11} />}
                {page.shared ? t("Shared") : t("Private")}
              </span>
            </Link>
            </EntityRow>
          ))}
        </div>
      )}
    </section>
  );

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="w-full px-10 py-6 lg:px-20 xl:px-32">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h1 className="text-heading font-semibold tracking-tight">{t("Docs")}</h1>
            <p className="mt-0.5 text-small text-muted">
              {t("Markdown documents stored with your TaCos data. Private until you share them.")}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <Menu
              align="right"
              width={220}
              triggerClassName="flex items-center gap-1 rounded-md border border-border px-2.5 py-1.5 text-small font-medium text-muted transition-colors hover:border-border-strong hover:text-text"
              trigger={
                <>
                  <Upload size={13} />
                  {progress ? t("Importing {done}/{total}", { done: progress.done + 1, total: progress.total }) : t("Import")}
                </>
              }
            >
              {(close) => (
                <>
                  <MenuItem
                    onSelect={() => {
                      close();
                      filesRef.current?.click();
                    }}
                  >
                    <FileText size={13} /> {t("Markdown files…")}
                  </MenuItem>
                  <MenuItem
                    onSelect={() => {
                      close();
                      folderRef.current?.click();
                    }}
                  >
                    <FolderOpen size={13} /> {t("Folder…")}
                  </MenuItem>
                </>
              )}
            </Menu>
            <button
              type="button"
              disabled={creating} onClick={() => void createPage()}
              className="flex shrink-0 items-center gap-1 rounded-md border border-border px-2.5 py-1.5 text-small font-medium text-muted transition-colors hover:border-border-strong hover:text-text"
            >
              <Plus size={13} /> {t("New page")}
            </button>
          </div>
        </div>
        {/* Folder structure becomes the page tree, so subfolders arrive as subpages. */}
        <input
          ref={filesRef}
          type="file"
          multiple
          accept=".md,.markdown,.mdx,.txt,text/markdown"
          className="hidden"
          onChange={(event) => {
            const list = Array.from(event.target.files ?? []);
            event.target.value = "";
            void importFiles(list, false);
          }}
        />
        <input
          ref={folderRef}
          type="file"
          multiple
          // Chromium-only; the only way a page can receive a whole folder at all.
          {...({ webkitdirectory: "", directory: "" } as Record<string, string>)}
          className="hidden"
          onChange={(event) => {
            const list = Array.from(event.target.files ?? []);
            event.target.value = "";
            void importFiles(list, true);
          }}
        />
        {error && <div className="mt-3 text-small text-danger">{t(error)}</div>}
        {!error && note && <div className="mt-3 text-small text-muted">{note}</div>}
        {section(t("My pages"), mine, t("No pages yet — create one."))}
        {section(t("Shared with the workspace"), shared, t("Nothing has been shared with you yet."))}
      </div>
    </div>
  );
}
