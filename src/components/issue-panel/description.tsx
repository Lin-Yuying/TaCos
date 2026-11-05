"use client";

import { useEffect, useRef, useState } from "react";
import { Markdown } from "@/components/markdown";
import { MarkdownEditor, type MarkdownEditorHandle } from "@/components/markdown-editor";
import { updateIssueDetailAction } from "@/app/actions";
import type { IssueUpdate } from "./types";
import { useT } from "@/components/i18n-context";

/**
 * The description takes every spare pixel above the footer. It reads as the document
 * agents and people actually wrote — checkboxes tick in place — and a click anywhere
 * else on it opens the same block editor the Overview uses.
 */
export function DescriptionSection({
  workspaceId,
  issueId,
  description,
  onUpdate,
}: {
  workspaceId: string;
  issueId: string;
  description: string;
  onUpdate: IssueUpdate;
}) {
  const t = useT();
  // The description is a Notion-style block editor while open (`doc`) and rendered
  // Markdown — checkboxes tickable — the rest of the time.
  const [doc, setDoc] = useState<string | null>(null);
  const boxRef = useRef<HTMLDivElement | null>(null);
  const editorRef = useRef<MarkdownEditorHandle | null>(null);
  // Latest local text, so a panel closed mid-edit still saves what was typed.
  const pending = useRef<string | null>(null);
  const saveRef = useRef<() => void>(() => {});
  // Unmount-time saves need the freshest server text to compare against.
  const descriptionRef = useRef(description);

  useEffect(() => {
    descriptionRef.current = description;
  });

  // Closing the editor — a click anywhere else, or the panel itself going away — saves
  // once. Typing stays local until then, so one writing session is one changelog entry.
  async function saveDescription() {
    // The line still being typed lives inside the editor until it is committed; ask for
    // it first or the last keystrokes never reach the save.
    const flushed = editorRef.current?.flush();
    const next = flushed ?? pending.current;
    pending.current = null;
    setDoc(null);
    if (next === null || next === descriptionRef.current) return;
    await onUpdate({ description: next });
  }

  useEffect(() => {
    saveRef.current = () => void saveDescription();
  });

  useEffect(() => {
    return () => {
      const next = pending.current;
      if (next === null || next === descriptionRef.current) return;
      // The panel is unmounting, so there is no state left to update — hand the text to
      // the action directly rather than losing the edit.
      void updateIssueDetailAction(workspaceId, issueId, { description: next });
    };
  }, [workspaceId, issueId]);

  useEffect(() => {
    if (doc === null) return;
    const onPointerDown = (event: PointerEvent) => {
      const box = boxRef.current;
      if (box && box.contains(event.target as Node)) return;
      saveRef.current();
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    return () => document.removeEventListener("pointerdown", onPointerDown, true);
  }, [doc]);

  if (doc === null) {
    return (
      <div
        role="button"
        tabIndex={0}
        title={t("Click to edit the description")}
        onClick={(event) => {
          // A link keeps its own click, and a checkbox ticks without opening the editor.
          if ((event.target as HTMLElement).closest("a, button")) return;
          pending.current = description;
          setDoc(description);
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            pending.current = description;
            setDoc(description);
          }
        }}
        className="min-h-[120px] w-full grow shrink-0 cursor-text rounded-md text-body leading-relaxed text-muted"
      >
        {description.trim() ? (
          <Markdown
            source={description}
            onSourceChange={(next) => void onUpdate({ description: next })}
          />
        ) : (
          <p className="text-body text-faint">{t("Add a description…")}</p>
        )}
      </div>
    );
  }

  return (
    <div ref={boxRef} className="-mx-2 min-h-[120px] w-full grow shrink-0">
      <MarkdownEditor
        ref={editorRef}
        value={doc}
        onChange={(next) => {
          pending.current = next;
          setDoc(next);
        }}
        placeholder={t("Write a description, type / for commands…")}
      />
    </div>
  );
}
