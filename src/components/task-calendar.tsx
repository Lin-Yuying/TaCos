"use client";

import FullCalendar from "@fullcalendar/react";
import dayGridPlugin from "@fullcalendar/react/daygrid";
import interactionPlugin from "@fullcalendar/react/interaction";
import zhLocale from "@fullcalendar/react/locales/zh-cn";
import classicTheme from "@fullcalendar/react/themes/classic";
import "@fullcalendar/react/skeleton.css";
import "@fullcalendar/react/themes/classic/theme.css";
import "@fullcalendar/react/themes/classic/palette.css";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { updateIssueAction } from "@/app/actions";
import { useLocale, useT } from "@/components/i18n-context";
import { useUI } from "@/components/ui-context";
import type { IssueWithLabels } from "@/lib/issues";

/** The calendar view: tasks on their due dates. Dragging a task to another day moves its due date. */
export default function TaskCalendar({
  workspaceId,
  issues,
}: {
  workspaceId: string;
  issues: IssueWithLabels[];
}) {
  const t = useT();
  const locale = useLocale();
  const router = useRouter();
  const { openIssue } = useUI();
  const [error, setError] = useState<string | null>(null);
  const undated = issues.filter((issue) => !issue.dueDate).length;

  return (
    <div data-task-calendar className="task-calendar min-h-0 flex-1 overflow-auto px-4 py-3 text-[12.5px]">
      {(undated > 0 || error) && (
        <div className="mb-2 text-[12px] text-faint">
          {error ? <span className="text-danger">{t(error)}</span> : t("{count} tasks have no due date", { count: undated })}
        </div>
      )}
      <FullCalendar
        plugins={[dayGridPlugin, interactionPlugin, classicTheme]}
        initialView="dayGridMonth"
        locales={[zhLocale]}
        locale={locale === "zh" ? "zh-cn" : "en"}
        height="auto"
        editable
        eventDurationEditable={false}
        headerToolbar={{ left: "title", center: "", right: "today prev,next" }}
        events={issues
          .filter((issue) => issue.dueDate)
          .map((issue) => ({ id: issue.id, title: issue.title, start: issue.dueDate!, allDay: true }))}
        eventClick={({ event }) => openIssue(event.id)}
        eventDrop={async ({ event, revert }) => {
          const result = await updateIssueAction(workspaceId, event.id, { dueDate: event.startStr.slice(0, 10) });
          if (result.ok) {
            setError(null);
            router.refresh();
          } else {
            setError(result.error);
            revert();
          }
        }}
      />
    </div>
  );
}
