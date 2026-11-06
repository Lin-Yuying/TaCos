"use client";
import { OptionSearch,matchesOption } from "@/components/ui/option-search";

import { useEffect, useRef, useState } from "react";
import { Lock, Users } from "lucide-react";
import { useUI } from "@/components/ui-context";
import { Menu } from "@/components/menu";
import { AssigneeAvatar } from "@/components/issue-table";
import { useT } from "@/components/i18n-context";
import { listPageAccessAction, setPageMemberLevelAction, setPageShareLevelAction } from "@/app/pages-actions";
import type { Member } from "@/lib/issues";
import { PAGE_LEVELS, type PageLevel } from "@/lib/page-level";

const LEVEL_LABEL: Record<PageLevel, string> = {
  view: "Can view",
  comment: "Can comment",
  edit: "Can edit",
};

function LevelSelect({
  value,
  label,
  extra,
  onChange,
  disabled,
}: {
  disabled?:boolean;
  value: string;
  label: string;
  extra?: string;
  onChange: (next: string) => void;
}) {
  const t = useT();
  return (
    <select disabled={disabled}
      value={value}
      aria-label={label}
      onChange={(event) => onChange(event.target.value)}
      className="shrink-0 rounded border border-border bg-bg px-1 py-0.5 text-small text-muted"
    >
      {extra && <option value="">{extra}</option>}
      {PAGE_LEVELS.map((level) => (
        <option key={level} value={level}>
          {t(LEVEL_LABEL[level])}
        </option>
      ))}
    </select>
  );
}

/** What the page's owner uses to share it. Shared means every member can see it. */
export function DocShareMenu({
  workspaceId,
  pageId,
  ownerId,
  shared,
  compact,
  members,
  onToggleShared,
}: {
  workspaceId: string;
  pageId: string;
  ownerId: string;
  shared: boolean;
  compact: boolean;
  members: Member[];
  onToggleShared: () => Promise<void>;
}) {
  const t = useT();
  const [memberQuery,setMemberQuery]=useState("");
  const {confirm}=useUI();
  const running=useRef(false);const [busy,setBusy]=useState(false);
  const [attempt,setAttempt]=useState(0);
  const [level, setLevel] = useState<PageLevel>("edit");
  const [people, setPeople] = useState<Record<string, PageLevel>>({});
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    void listPageAccessAction(workspaceId, pageId).then((result) => {
      if (!live) return;
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setLevel(result.data.level);
      setPeople(result.data.people);setError(null);
    }).catch(()=>{if(live)setError("Could not load permissions. Retry.");});
    return () => {
      live = false;
    };
  }, [workspaceId, pageId,attempt]);

  async function change(work:()=>Promise<{ok:boolean;error?:string}>,done?:()=>void,confirmChange=true){if(running.current)return;running.current=true;setBusy(true);try{if(confirmChange&&!await confirm(t("Change permissions for this document and all its children?")))return;const result=await work();if(!result.ok){setError(result.error??"Could not save. Retry.");return;}done?.();setError(null);}catch{setError("Could not save. Retry.");}finally{running.current=false;setBusy(false);}}
  async function changeLevel(next:PageLevel){await change(()=>setPageShareLevelAction(workspaceId,pageId,next),()=>setLevel(next));}
  async function changePerson(userId:string,next:PageLevel|null){await change(()=>setPageMemberLevelAction(workspaceId,pageId,userId,next),()=>setPeople(current=>{const rest={...current};delete rest[userId];return next?{...rest,[userId]:next}:rest;}));}

  return (
    <Menu
      width={300}
      align="right"
      triggerClassName="flex items-center gap-1 rounded-md border border-border px-2 py-1 text-small font-medium text-muted transition-colors hover:border-border-strong hover:text-text"
      trigger={
        <>
          {shared ? <Users size={12} /> : <Lock size={12} />}
          {!compact && (shared ? t("Shared") : t("Share"))}
        </>
      }
    >
      {() => (
        <div data-doc-share className="space-y-2 p-2 text-small">
          <div className="flex items-center gap-2">
            <span className="min-w-0 flex-1 text-text">
              {shared ? t("Every member can see this document") : t("Only you can see this document")}
            </span>
            <button
              type="button"
              disabled={busy}
              onClick={()=>void change(async()=>{await onToggleShared();return{ok:true};},undefined,false)}
              className="shrink-0 rounded-md border border-border px-2 py-0.5 text-small text-muted hover:border-border-strong hover:text-text"
            >
              {shared ? t("Make private") : t("Share with the workspace")}
            </button>
          </div>
          {shared && (
            <>
              <div className="flex items-center gap-2 border-t border-border pt-2">
                <span className="min-w-0 flex-1 text-muted">{t("Everyone")}</span>
                <LevelSelect disabled={busy}
                  value={level}
                  label={t("Everyone")}
                  onChange={(next) => void changeLevel(next as PageLevel)}
                />
              </div>
              <OptionSearch value={memberQuery} onChange={setMemberQuery} selected={Object.keys(people).length}/>{members
                .filter((member) => member.id !== ownerId&&matchesOption(memberQuery,member.displayName,member.username))
                .map((member) => (
                  <div key={member.id} className="flex items-center gap-2">
                    <AssigneeAvatar displayName={member.displayName} avatar={member.avatar} size={16} />
                    <span className="min-w-0 flex-1 truncate text-text">{member.displayName}</span>
                    <LevelSelect disabled={busy}
                      value={people[member.id] ?? ""}
                      label={member.displayName}
                      extra={t("Same as everyone")}
                      onChange={(next) => void changePerson(member.id, (next || null) as PageLevel | null)}
                    />
                  </div>
                ))}
            </>
          )}
          {error && <div className="text-small text-danger">{t(error)} <button onClick={()=>setAttempt(old=>old+1)}>{t("Retry")}</button></div>}
        </div>
      )}
    </Menu>
  );
}
