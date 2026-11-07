"use client";
import { readImportedMarkdown } from "@/lib/import-markdown-stream";

import { useDetailSource } from "@/components/detail-navigation";
import { BatchSelection } from "@/components/ui/batch-selection";
import { EntityRow } from "@/components/ui/entity-row";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useScrollMemory } from "@/lib/ui/scroll-memory";
import { useMemo, useRef, useState } from "react";
import { FileText, FolderOpen, Lock, Upload, Users, X } from "lucide-react";
import { importMarkdownAction } from "@/app/pages-actions";
import { Menu, MenuItem } from "@/components/menu";
import { NewPageMenu } from "@/components/new-page-menu";
import { documentIndex } from "@/lib/ui/document-index";
import { useStoredJson } from "@/lib/use-stored-json";
import { useUI } from "@/components/ui-context";
import type { PageMetadata } from "@/lib/pages";
import type { UnresolvedPageLink } from "@/lib/page-links";
import { useLocale, useT } from "@/components/i18n-context";
import { Modal } from "@/components/ui/modal";
import { PAGE_HEADER, PAGE_INSET, PAGE_TITLE } from "@/lib/page-chrome";
import { formatDate } from "@/lib/format";

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
  pages,
  unresolvedLinks,
  backlinkCounts,
}: {
  workspaceId: string;
  pages: PageMetadata[];
  unresolvedLinks: UnresolvedPageLink[];
  backlinkCounts: Record<string, number>;
}) {
  const t = useT();
  const locale = useLocale();
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const filesRef = useRef<HTMLInputElement>(null);
  const folderRef = useRef<HTMLInputElement>(null);
  const importing = useRef(false);
  const {scope,pins}=useUI();
  const scroller=useRef<HTMLDivElement>(null);useScrollMemory(scroller,"documents-index");
  const [query,setQuery]=useState("");
  const [sort,setSort]=useStoredJson(`tacos.documents.sort.${scope}`,"updated");
  const [importResults,setImportResults]=useState<{file:File;stripRoot:boolean;status:string;error?:string}[]>([]);
  const index=useMemo(()=>documentIndex(pages),[pages]);
  const ranks=useMemo(()=>new Map(pins.filter(pin=>pin.kind==="document").map((pin,at)=>[pin.id,at])),[pins]);
  const shown=useMemo(()=>pages.filter(page=>index.search.get(page.id)?.includes(query.toLowerCase())).sort((a,b)=>
    ((ranks.get(a.id)??Infinity)-(ranks.get(b.id)??Infinity))||(sort==="title"?a.title.localeCompare(b.title):sort==="path"?(index.paths.get(a.id)??"").localeCompare(index.paths.get(b.id)??""):b.updatedAt.localeCompare(a.updatedAt))),[pages,index,query,sort,ranks]);
  const sharedPages = shown.filter((page) => page.shared);
  const privatePages = shown.filter((page) => !page.shared);

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
    const results:{file:File;stripRoot:boolean;status:string;error?:string}[]=[];
    try {
      for(const [index,file] of files.entries()) {
        setProgress({done:index,total:files.length});
        const raw=relativePath(file),path=stripRoot&&raw.includes("/")?raw.slice(raw.indexOf("/")+1):raw;
        try{const result=await importMarkdownAction(workspaceId,{path,parsed:await readImportedMarkdown(file.stream(),file.name.replace(/\.(md|markdown|txt)$/i,""))});results.push(result.ok?{file,stripRoot,status:result.data.created?"Imported":"Already existed"}:{file,stripRoot,status:"Failed",error:result.error});}
        catch(error){results.push({file,stripRoot,status:"Failed",error:error instanceof Error?error.message:"Could not import. Retry."});}
        setImportResults([...results]);
      }
      setNote(t("{count} imported",{count:results.filter(result=>result.status==="Imported").length}));
    }finally{importing.current=false;setProgress(null);}

    router.refresh();
  }

  useDetailSource("document",[...sharedPages,...privatePages].map(page=>page.id));
  const section = (sectionKey: "shared" | "private", title: string, items: PageMetadata[], empty: string) => (
    <section data-doc-index-section={sectionKey} className="mt-6 first:mt-0">
      <h2 className="mb-2 text-small font-medium text-faint">{title}</h2>
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
              <span className="shrink-0">{page.icon ?? <FileText size={14} className="text-muted" />}</span>
              <span className="min-w-0 flex-1"><span className="block truncate">{page.title}</span><span className="block truncate text-caption text-faint">{index.paths.get(page.id)}</span></span>
              {backlinkCounts[page.id] > 0 && (
                <span
                  data-doc-backlink-count={backlinkCounts[page.id]}
                  title={t("Linked from")}
                  className="shrink-0 text-caption text-faint"
                >
                  {t(backlinkCounts[page.id] === 1 ? "{count} link" : "{count} links", {
                    count: backlinkCounts[page.id],
                  })}
                </span>
              )}
              <span className="ml-auto flex shrink-0 items-center gap-1 rounded-full bg-elevated px-1.5 py-0.5 text-caption text-muted">
                {page.shared ? <Users size={11} /> : <Lock size={11} />}
                {page.shared ? t("Shared") : t("Private")}
              </span>
              <span className="shrink-0 text-small tabular-nums text-faint" suppressHydrationWarning>{formatDate(page.updatedAt, locale)}</span>
            </Link>
            </EntityRow>
          ))}
        </div>
      )}
    </section>
  );

  return (
    <div ref={scroller} className="flex-1 overflow-y-auto">
      <header className={`${PAGE_HEADER} ${PAGE_INSET}`}>
        <h1 className={PAGE_TITLE}>{t("Documents")}</h1>
        <span className="rounded-full bg-elevated px-2 py-0.5 text-caption tabular-nums text-muted">{pages.length}</span>
        <div className="ml-auto"><NewPageMenu workspaceId={workspaceId} className="flex items-center gap-1 rounded-md bg-accent px-2.5 py-1.5 text-small font-medium text-white transition-colors hover:bg-accent-hover" /></div>
      </header>
      <div className={`w-full pb-6 pt-3 ${PAGE_INSET}`}>
        <p className="text-small text-muted">
          {t("Markdown documents stored with your TaCos data. Private until you share them.")}
        </p>
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
        <div className="my-3 flex flex-wrap items-center gap-2"><input aria-label={t("Search documents")} placeholder={t("Search documents")} value={query} onChange={e=>setQuery(e.target.value)} className="min-w-0 flex-1 rounded border border-border bg-bg px-2 py-1 text-body max-[600px]:basis-full"/><select aria-label={t("Sort")} value={sort} onChange={e=>setSort(e.target.value)} className="rounded border border-border bg-bg p-1 text-small"><option value="updated">{t("Recently updated")}</option><option value="title">{t("Title")}</option><option value="path">{t("Path")}</option></select>{pages.length>0&&<span className="text-small tabular-nums text-faint">{shown.length} / {pages.length}</span>}{pages.length>0&&<BatchSelection workspaceId={workspaceId} kind="document" items={shown}/>}
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
        </div>
        <Modal open={importResults.length>0&&!progress} onClose={()=>setImportResults([])} title={t("Import results")} className="max-w-[480px]">
          <div className="rounded-xl border border-border bg-overlay shadow-2xl shadow-black/15">
            <div className="flex items-center justify-between border-b border-border px-4 py-3">
              <h2 className="text-lead font-semibold text-text">{t("Import results")}</h2>
              <button type="button" aria-label={t("Close")} onClick={()=>setImportResults([])} className="rounded p-1 text-faint transition-colors hover:bg-elevated hover:text-text"><X size={14} /></button>
            </div>
            <div className="p-4"><div className="max-h-[50dvh] overflow-auto text-small">{importResults.map((result,index)=><p key={index} className={result.status==="Failed"?"text-danger":"text-muted"}>{relativePath(result.file)}: {t(result.status)} {result.error}</p>)}</div>{importResults.some(result=>result.status==="Failed")&&<button disabled={!!progress} onClick={()=>{const failed=importResults.filter(result=>result.status==="Failed");void importFiles(failed.map(result=>result.file),failed[0]?.stripRoot??false);}} className="mt-2 rounded-md border border-border px-2.5 py-1 text-small text-text hover:bg-elevated">{t("Retry failed files")}</button>}</div>
          </div>
        </Modal>
        {error && <div className="mt-3 text-small text-danger">{t(error)}</div>}
        {!error && note && <div className="mt-3 text-small text-muted">{note}</div>}
        {section("shared", t("Shared"), sharedPages, t("No documents yet"))}
        {section("private", t("Private"), privatePages, t("No documents yet"))}
        {unresolvedLinks.length > 0 && (
          <section data-doc-unresolved className="mt-8">
            <h2 className="text-small font-medium text-faint">
              {t("Unresolved links")}
            </h2>
            <p className="mt-1 text-small text-muted">
              {t("These references point at a document in the Trash or one that is no longer available.")}
            </p>
            <div className="mt-2 space-y-0.5">
              {unresolvedLinks.map((link) => (
                <div
                  key={`${link.sourceId}:${link.targetPageId}`}
                  data-doc-unresolved-link={`${link.sourceId}:${link.targetPageId}`}
                  className="flex flex-wrap items-center gap-2 rounded-md px-2 py-1.5 text-body"
                >
                  <Link
                    href={`/${workspaceId}/docs/${link.sourceId}`}
                    className="min-w-0 truncate text-text underline decoration-border-strong underline-offset-2"
                  >
                    {link.sourceTitle}
                  </Link>
                  <span className="text-faint">→</span>
                  <span
                    title={t("Unresolved")}
                    className="min-w-0 truncate text-muted underline decoration-dashed decoration-border-strong underline-offset-2"
                  >
                    {link.targetTitle || t("Untitled")}
                  </span>
                </div>
              ))}
            </div>
          </section>
        )}
      </div>
    </div>
  );
}
