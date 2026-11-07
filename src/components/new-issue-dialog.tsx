"use client";
import { usePrimaryModifier } from "@/lib/ui/platform";
import { OptionSearch,matchesOption } from "@/components/ui/option-search";

import { DuePicker } from "@/components/ui/due-picker";
import { readJson } from "@/lib/ui/request";
import { Modal } from "@/components/ui/modal";
import { useDraft } from "@/lib/ui/draft-store";

import { useEffect, useRef, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { FileText, LoaderCircle, Sparkles, Trash2, Users, X } from "lucide-react";
import { useUI } from "@/components/ui-context";
import { Menu, MenuItem } from "@/components/menu";
import {
  LabelPill,
  PRIORITY_META,
  PriorityIcon,
  ProjectIcon,
  STATUS_META,
  StatusIcon,
} from "@/components/icons";
import { AssigneeAvatar, AssigneeStack } from "@/components/issue-table";
import { createIssueAction, listTaskFieldsAction } from "@/app/actions";
import {
  createTaskTemplateAction,
  deleteTaskTemplateAction,
  listTaskTemplatesAction,
} from "@/app/task-template-actions";
import type { TaskTemplate } from "@/lib/task-templates";
import { draftIssueAction } from "@/app/ai-actions";
import { STATUS_ORDER, type Priority, type Status, type ReminderPreset } from "@/lib/constants";
import type { TaskField } from "@/lib/task-view";
import type { Label, Member, Project } from "@/lib/issues";
import { useT } from "@/components/i18n-context";

export function NewIssueDialog({ workspaceId }: { workspaceId: string }) {
  const t = useT();
  const modifier=usePrimaryModifier();
  const [memberQuery,setMemberQuery]=useState(""),[labelQuery,setLabelQuery]=useState("");
  const { composerOpen, composerStatus, composerSeed, setComposerOpen, openIssue, aiReady, projectComposerOpen, setProjectComposerOpen, confirm } =
    useUI();
  const searchParams = useSearchParams();
  const pathname = usePathname();
  // Opened from a project's Overview page, the composer should stay in that project.
  const activeProjectId =
    searchParams.get("project") ?? pathname.match(/\/projects\/([^/]+)/)?.[1] ?? "";
  const [title, setTitle] = useDraft("create-new-issue-dialog.tsx", "title", "");
  const [description, setDescription] = useDraft("create-new-issue-dialog.tsx", "description", "");
  const [status, setStatus] = useDraft<Status>("create-new-issue-dialog.tsx", "status", "todo");
  const [priority, setPriority] = useDraft<Priority>("create-new-issue-dialog.tsx", "priority", 0);
  const [assigneeIds, setAssigneeIds] = useDraft<string[]>("create-new-issue-dialog.tsx", "assigneeIds", []);
  const [labelNames, setLabelNames] = useDraft<string[]>("create-new-issue-dialog.tsx", "labelNames", []);
  const [projectId, setProjectId] = useDraft<string>("create-new-issue-dialog.tsx", "projectId", "");
  const [dueDate,setDueDate]=useDraft<string|null>("create-task","dueDate",null);
  const [reminder,setReminder]=useDraft<ReminderPreset|null>("create-task","reminder",null);
  const [estimate,setEstimate]=useDraft<string>("create-task","estimate","");
  const [templates,setTemplates]=useState<TaskTemplate[]>([]);
  const [canManageTemplates,setCanManageTemplates]=useState(false);
  const [templateName,setTemplateName]=useState("");
  const [templateBusy,setTemplateBusy]=useState(false);
  const [fields,setFields]=useState<TaskField[]>([]);
  const [fieldValues,setFieldValues]=useDraft<Record<string,string>>("create-task","fields",{});
  const [continueCreating,setContinueCreating]=useState(false);
  const [projects, setProjects] = useState<Project[]>([]);
  const [projectsLoaded, setProjectsLoaded] = useState(false);
  const [labels, setLabels] = useState<Label[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [aiOpen, setAiOpen] = useState(false);
  const [aiPrompt, setAiPrompt] = useState("");
  const [aiBusy, setAiBusy] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);

  useEffect(() => {
    if (!composerOpen) return;
    if(composerSeed?.dueDate)setDueDate(composerSeed.dueDate);
    if(composerSeed?.title !== undefined) setTitle(composerSeed.title);
    if(composerSeed?.description !== undefined) setDescription(composerSeed.description);
    if(composerStatus) setStatus(composerStatus);
    setError(null);
    setBusy(false);
    setAiOpen(false);
    setAiPrompt("");
    setAiBusy(false);
    setAiError(null);
    setProjectsLoaded(false);
    readJson<Project[]>(`/api/internal/${workspaceId}/projects`,(data):data is Project[]=>Array.isArray(data))
      .then((data: Project[]) => {
        setProjects(data);
        setProjectId(
          data.find((p) => p.id === (projectId || activeProjectId))?.id ?? data[0]?.id ?? ""
        );
      })
      .catch((error) => {setProjects([]);setError(error.message);})
      .finally(() => setProjectsLoaded(true));
    void listTaskFieldsAction(workspaceId).then(result=>{if(result.ok)setFields(result.data);else setError(result.error);});
    void listTaskTemplatesAction(workspaceId)
      .then((result) => {
        if (result.ok) {
          setTemplates(result.data.templates);
          setCanManageTemplates(result.data.canManage);
        }
      })
      .catch(() => {});
    setTemplateName("");
    readJson<Label[]>(`/api/internal/${workspaceId}/labels`,(data):data is Label[]=>Array.isArray(data))
      .then((data) => setLabels(data as Label[]))
      .catch((error) => {setLabels([]);setError(error.message);});
    readJson<Member[]>(`/api/internal/${workspaceId}/members`,(data):data is Member[]=>Array.isArray(data))
      .then((data) => setMembers(data as Member[]))
      .catch((error) => {setMembers([]);setError(error.message);});
  }, [composerOpen, composerStatus, composerSeed, workspaceId, activeProjectId]);


  const submitRunning=useRef(false);
  if (!composerOpen) return null;

  function newProject() {
    setProjectComposerOpen(true, (created) => {
      setProjects((current) => [...current, created as Project]);
      setProjectId(created.id);
    });
  }

  async function submit() {
    const project = projects.find((p) => p.id === projectId);
    if (!title.trim() || !project || submitRunning.current) return;
    submitRunning.current=true;
    setBusy(true);
    try {
    const result = await createIssueAction(workspaceId, {
      title,
      description,
      status,
      priority,
      assigneeIds,
      labelNames,
      project: project.id,
      dueDate,reminder,fieldValues,
      estimate: estimate.trim() === "" ? null : Number(estimate),
    });

    if (result.ok) {
      // Pages that opened the composer from a passage use this to drop the task
      // reference exactly where the passage was.
      setFieldValues({});setDueDate(null);setReminder(null);setEstimate("");
      setTitle("");setDescription("");setStatus("todo");setPriority(0);setAssigneeIds([]);setLabelNames([]);
      composerSeed?.onCreated?.(result.data);
      if(!continueCreating){setComposerOpen(false);openIssue(result.data.id);}
    } else {
      setError(t(result.error));
    }
    }catch{setError(t("Could not save. Retry."));}finally{submitRunning.current=false;setBusy(false);}
  }

  const project = projects.find((p) => p.id === projectId);

  async function aiDraft() {
    if (!aiPrompt.trim() || aiBusy) return;
    setAiBusy(true);
    setAiError(null);
    const result = await draftIssueAction(workspaceId, {
      prompt: aiPrompt,
      projectId: projectId || undefined,
    });
    setAiBusy(false);
    if (!result.ok) {
      setAiError(t(result.error));
      return;
    }
    const task = result.data;
    setTitle(task.title);
    setDescription(task.description);
    setPriority(task.priority);
    if (task.labels.length > 0) {
      setLabelNames((prev) => [...new Set([...prev, ...task.labels])]);
    }
    setAiOpen(false);
    setAiPrompt("");
  }

  function applyTemplate(template: TaskTemplate) {
    setTitle(template.title);
    setDescription(template.description);
    setPriority(template.priority);
    setLabelNames(template.labelNames);
    setFieldValues(
      Object.fromEntries(
        Object.entries(template.fieldValues).filter(([id]) => fields.some((field) => field.id === id))
      )
    );
  }

  async function saveTemplate() {
    if (!templateName.trim() || !title.trim() || templateBusy) return;
    setTemplateBusy(true);
    try {
      const result = await createTaskTemplateAction(workspaceId, {
        name: templateName,
        title,
        description,
        priority,
        labelNames,
        fieldValues,
      });
      if (result.ok) {
        setTemplates((current) => [...current, result.data]);
        setTemplateName("");
        setError(null);
      } else setError(result.error);
    } catch {
      setError(t("Could not save. Retry."));
    } finally {
      setTemplateBusy(false);
    }
  }

  async function removeTemplate(template: TaskTemplate) {
    if (!(await confirm(t("Delete the template “{name}”?", { name: template.name }), { action: t("Delete") }))) return;
    const result = await deleteTaskTemplateAction(workspaceId, template.id);
    if (result.ok) setTemplates((current) => current.filter((item) => item.id !== template.id));
    else setError(result.error);
  }

  return (
    <Modal open={composerOpen} onClose={() => {if(!busy)setComposerOpen(false);}} title={t("New task")} className="max-w-[640px] max-[600px]:h-dvh max-[600px]:max-h-dvh max-[600px]:w-screen max-[600px]:max-w-none max-[600px]:rounded-none max-[600px]:border-0">
      <fieldset disabled={busy}>
        <div
          className="rounded-xl border border-border bg-overlay shadow-2xl shadow-black/15"
          onKeyDown={(e) => {
            if (!e.defaultPrevented && (e.metaKey || e.ctrlKey) && e.key === "Enter" && !e.nativeEvent.isComposing && e.nativeEvent.keyCode !== 229) {
              e.preventDefault();
              void submit();
            }
          }}
        >
          <div className="flex items-center justify-between border-b border-border px-4 py-3">
            <h2 className="text-lead font-semibold text-text">{t("New task")}</h2>
            <button
              type="button"
              onClick={() => {if(!submitRunning.current)setComposerOpen(false);}}
              aria-label={t("Close")}
              className="rounded p-1 transition-colors hover:bg-elevated hover:text-text"
            >
              <X size={14} />
            </button>
          </div>
          <div className="p-4">
            <input
              autoFocus
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.metaKey && !e.ctrlKey && !e.nativeEvent.isComposing && e.nativeEvent.keyCode !== 229) {
                  e.preventDefault();e.stopPropagation();
                  void submit();
                }
              }}
              placeholder={t("Task title")}
              className="w-full rounded-md border border-border bg-bg px-2.5 py-1.5 text-body text-text placeholder:text-faint focus:border-border-strong focus:outline-none"
            />
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder={t("Add description…")}
              rows={4}
              className="mt-2 w-full resize-none rounded-md border border-border bg-bg px-2.5 py-1.5 text-body leading-relaxed text-text placeholder:text-faint focus:border-border-strong focus:outline-none"
            />
            <div className="mt-3 flex flex-wrap items-center gap-2">

              <Menu
                width={200}
                trigger={
                  <>
                    <span className="text-muted">{t("Project")}</span>
                    {project ? (
                      <span className="flex items-center gap-1 text-small text-muted">
                        <ProjectIcon color={project.color} icon={project.icon} size={12} />
                        {project.name}
                      </span>
                    ) : null}
                  </>
                }
              >
                {(close) => (
                  <>
                    {projects.map((option) => (
                      <MenuItem
                        key={option.id}
                        active={option.id === projectId}
                        onSelect={() => {
                          setProjectId(option.id);
                          close();
                        }}
                      >
                        <ProjectIcon color={option.color} icon={option.icon} size={13} />
                        {option.name}
                      </MenuItem>
                    ))}
                    <MenuItem
                      onSelect={() => {
                        close();
                        newProject();
                      }}
                    >
                      {t("New project")}
                    </MenuItem>
                  </>
                )}
              </Menu>

              <Menu
                width={180}
                trigger={
                  <>
                    <StatusIcon status={status} size={13} />
                    {t(STATUS_META[status].label)}
                  </>
                }
              >
                {(close) => (
                  <>
                    {STATUS_ORDER.map((option) => (
                      <MenuItem
                        key={option}
                        active={option === status}
                        onSelect={() => {
                          setStatus(option);
                          close();
                        }}
                      >
                        <StatusIcon status={option} size={13} />
                        {t(STATUS_META[option].label)}
                      </MenuItem>
                    ))}
                  </>
                )}
              </Menu>

              <Menu
                width={180}
                trigger={
                  <>
                    <PriorityIcon priority={priority} size={13} />
                    {t(PRIORITY_META[priority].label)}
                  </>
                }
              >
                {(close) => (
                  <>
                    {([4, 3, 2, 1, 0] as Priority[]).map((option) => (
                      <MenuItem
                        key={option}
                        active={option === priority}
                        onSelect={() => {
                          setPriority(option);
                          close();
                        }}
                      >
                        <PriorityIcon priority={option} size={13} />
                        {t(PRIORITY_META[option].label)}
                      </MenuItem>
                    ))}
                  </>
                )}
              </Menu>

              <Menu
                width={220}
                trigger={
                  <>
                    {assigneeIds.length === 0 ? (
                      t("Assignee…")
                    ) : (
                      <>
                        <AssigneeStack
                          assignees={members.filter((member) => assigneeIds.includes(member.id))}
                          size={16}
                        />
                        <span className="max-w-[140px] truncate">
                          {assigneeIds.length === 1
                            ? members.find((member) => member.id === assigneeIds[0])?.displayName ??
                              t("Assignee")
                            : t("{count} assignees", { count: assigneeIds.length })}
                        </span>
                      </>
                    )}
                  </>
                }
              >
                {(close) => (
                  <>
                    <MenuItem
                      active={assigneeIds.length === 0}
                      onSelect={() => {
                        setAssigneeIds([]);
                        close();
                      }}
                    >
                      <span className="text-faint">—</span> {t("Unassigned")}
                    </MenuItem>
                    <MenuItem
                      active={
                        members.length > 0 &&
                        members.every((member) => assigneeIds.includes(member.id))
                      }
                      onSelect={() => {
                        setAssigneeIds(members.map((member) => member.id));
                        close();
                      }}
                    >
                      <Users size={14} className="text-muted" /> {t("Everyone")}
                    </MenuItem>
                    <div className="my-1 border-t border-border" />
                    <OptionSearch value={memberQuery} onChange={setMemberQuery} selected={assigneeIds.length}/>{members.filter(member=>matchesOption(memberQuery,member.displayName,member.username)).map((member) => {
                      const on = assigneeIds.includes(member.id);
                      return (
                        <MenuItem
                          key={member.id}
                          active={on}
                          onSelect={() =>
                            setAssigneeIds((ids) =>
                              on ? ids.filter((id) => id !== member.id) : [...ids, member.id]
                            )
                          }
                        >
                          <AssigneeAvatar
                            displayName={member.displayName}
                            avatar={member.avatar}
                            size={16}
                          />
                          {member.displayName}
                        </MenuItem>
                      );
                    })}
                  </>
                )}
              </Menu>

              <Menu
                width={220}
                trigger={
                  <>
                    <span>{t("Labels")}</span>
                    {labelNames.length > 0 && (
                      <span className="text-faint">· {labelNames.length}</span>
                    )}
                  </>
                }
              >
                {() => (
                  <>
                    <OptionSearch value={labelQuery} onChange={setLabelQuery} selected={labelNames.length}/>{labels.filter(label=>matchesOption(labelQuery,label.name)).map((label) => {
                      const on = labelNames.includes(label.name);
                      return (
                        <MenuItem
                          key={label.id}
                          active={on}
                          onSelect={() => {
                            setLabelNames((names) =>
                              on
                                ? names.filter((n) => n !== label.name)
                                : [...names, label.name]
                            );
                          }}
                        >
                          <LabelPill name={label.name} color={label.color} small />
                        </MenuItem>
                      );
                    })}
                    {labels.length === 0 && (
                      <div className="px-2 py-1.5 text-small text-faint">
                        {t("No labels yet — create some in Settings.")}
                      </div>
                    )}
                  </>
                )}
              </Menu>

              <DuePicker value={dueDate} reminder={reminder} onSave={async(date,next)=>{setDueDate(date);setReminder(next);return true;}}/>
              <label className="flex items-center gap-1 text-small text-muted">{t("Estimate")}<input aria-label={t("Estimate")} data-task-estimate type="number" min="0" step="1" value={estimate} onChange={event=>setEstimate(event.target.value)} className="w-14 rounded border border-border bg-bg px-1 py-0.5 text-small text-text"/></label>
            </div>
              {Object.keys(fieldValues).some(id=>!fields.some(field=>field.id===id))&&<p role="alert" className="text-small text-danger">{t("Some saved properties are no longer available.")} <button type="button" onClick={()=>setFieldValues(old=>Object.fromEntries(Object.entries(old).filter(([id])=>fields.some(field=>field.id===id))))} className="underline">{t("Remove unavailable properties")}</button></p>}
            {fields.length>0&&<details className="my-2 text-small"><summary className="cursor-pointer">{t("More properties")}</summary><div className="mt-2 grid grid-cols-2 gap-2">{fields.map(field=><label key={field.id} className="block">{field.name}{field.type==="select"?<select disabled={busy} value={fieldValues[field.id]??""} onChange={e=>setFieldValues(old=>({...old,[field.id]:e.target.value}))} className="block w-full rounded border border-border bg-bg p-1"><option value=""/>{field.options.map(option=><option key={option}>{option}</option>)}</select>:<input disabled={busy} type={field.type==="checkbox"?"checkbox":field.type==="number"?"number":field.type==="date"?"date":"text"} checked={fieldValues[field.id]==="1"} value={fieldValues[field.id]??""} onChange={e=>setFieldValues(old=>({...old,[field.id]:field.type==="checkbox"?(e.target.checked?"1":""):e.target.value}))} className="block w-full rounded border border-border bg-bg p-1"/>}</label>)}</div></details>}
            <div className="mt-2 flex flex-wrap items-center gap-2">
            {aiReady && (
              <div className={aiOpen ? "w-full" : undefined}>
                {aiOpen ? (
                  <div className="flex items-center gap-1.5">
                    <input
                      autoFocus
                      value={aiPrompt}
                      onChange={(event) => setAiPrompt(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" && !event.nativeEvent.isComposing && event.nativeEvent.keyCode !== 229) {
                          event.preventDefault();event.stopPropagation();
                          void aiDraft();
                        }
                        if (event.key === "Escape") {event.stopPropagation();setAiOpen(false);}
                      }}
                      placeholder={t("Describe the task, e.g. 修复微信登录回调偶发失败")}
                      className="min-w-0 flex-1 rounded-md border border-border bg-elevated/40 px-2.5 py-1.5 text-small text-text placeholder:text-faint focus:border-border-strong"
                    />
                    <button
                      type="button"
                      onClick={() => void aiDraft()}
                      disabled={!aiPrompt.trim() || aiBusy}
                      className="flex shrink-0 items-center gap-1 rounded-md bg-accent px-2.5 py-1.5 text-small font-medium text-white disabled:opacity-40"
                    >
                      {aiBusy ? <LoaderCircle size={11} className="animate-spin" /> : <Sparkles size={11} />}
                      {aiBusy ? t("Drafting…") : t("Draft")}
                    </button>
                    <button
                      type="button"
                      onClick={() => setAiOpen(false)}
                      aria-label={t("Close AI draft")}
                      className="shrink-0 rounded p-1 text-faint hover:bg-elevated hover:text-text"
                    >
                      <X size={13} />
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => setAiOpen(true)}
                    className="flex items-center gap-1 rounded-md px-1.5 py-1 text-small text-muted transition-colors hover:bg-elevated hover:text-text"
                  >
                    <Sparkles size={12} /> {t("Draft")}
                  </button>
                )}
                {aiError && <div className="mt-1 text-small text-danger">{t(aiError)}</div>}
              </div>
            )}
              <Menu
                width={280}
                trigger={
                  <>
                    <FileText size={12} />
                    {t("Template")}
                  </>
                }
              >
                {(close) => (
                  <div data-task-templates className="space-y-1 p-1">
                    {templates.length === 0 ? (
                      <div className="px-2 py-1 text-small text-faint">{t("No templates yet.")}</div>
                    ) : (
                      templates.map((template) => (
                        <div key={template.id} className="flex items-center gap-1">
                          <MenuItem
                            onSelect={() => {
                              applyTemplate(template);
                              close();
                            }}
                          >
                            <span className="min-w-0 flex-1 truncate">{template.name}</span>
                            <span className="shrink-0 text-caption text-faint">{t(template.priority ? PRIORITY_META[template.priority].label : "No priority")}</span>
                          </MenuItem>
                          {canManageTemplates ? (
                            <button
                              type="button"
                              aria-label={t("Delete template {name}", { name: template.name })}
                              onClick={() => void removeTemplate(template)}
                              className="shrink-0 rounded p-1 text-faint hover:text-danger"
                            >
                              <Trash2 size={12} />
                            </button>
                          ) : null}
                        </div>
                      ))
                    )}
                    {canManageTemplates ? (
                      <div className="flex gap-1 border-t border-border pt-1">
                        <input
                          data-template-name
                          aria-label={t("Template name")}
                          placeholder={t("Template name")}
                          value={templateName}
                          onChange={(event) => setTemplateName(event.target.value)}
                          className="min-w-0 flex-1 rounded border border-border bg-bg p-1 text-small"
                        />
                        <button
                          type="button"
                          data-template-save
                          disabled={templateBusy || !templateName.trim() || !title.trim()}
                          onClick={() => void saveTemplate()}
                          className="rounded border border-border px-2 text-small text-muted disabled:opacity-40"
                        >
                          {t("Save draft as template")}
                        </button>
                      </div>
                    ) : null}
                  </div>
                )}
              </Menu>
            </div>
            {projectsLoaded && projects.length === 0 && (
              <div role="status" className="mt-3 flex flex-wrap items-center gap-2 rounded-md bg-elevated px-3 py-2 text-small text-muted">
                <span className="min-w-0 flex-1">{t("A task goes in a project. Create one first.")}</span>
                <button type="button" onClick={newProject} className="rounded-md border border-border px-2.5 py-1 text-small text-text hover:bg-overlay">{t("New project")}</button>
              </div>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2 border-t border-border px-4 py-3">
            <label className="flex items-center gap-2 text-small text-muted"><input type="checkbox" checked={continueCreating} onChange={event=>setContinueCreating(event.target.checked)}/>{t("Create and continue")}</label>
            <span className="flex-1" />
            {error && <span className="text-small text-danger">{t(error)}</span>}
            <button type="button" onClick={() => {if(!submitRunning.current)setComposerOpen(false);}} className="rounded-md border border-border px-3 py-1.5 text-body text-text transition-colors hover:bg-elevated">{t("Cancel")}</button>
                <button
                  type="button"
                  onClick={() => void submit()}
                  disabled={!title.trim() || !project || busy}
                  className="rounded-md bg-accent px-3 py-1.5 text-body font-medium text-white transition-colors hover:bg-accent-hover disabled:opacity-40"
                >
                  {t("Create task")}
                  <span className="ml-2 text-caption opacity-75">{modifier}↵</span>
                </button>
          </div>
        </div>
      </fieldset>
    </Modal>
  );
}
