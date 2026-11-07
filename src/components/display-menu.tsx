"use client";

import { CHIP } from "@/lib/page-chrome";
import { SlidersHorizontal } from "lucide-react";
import { Menu } from "@/components/menu";
import { useT } from "@/components/i18n-context";
import {
  VIEW_GROUPINGS,
  VIEW_LAYOUTS,
  VIEW_ORDERINGS,
  VIEW_PROPERTIES,
  type TaskViewDisplay,
  type ViewGrouping,
  type ViewLayout,
  type ViewOrdering,
  type ViewProperty,
} from "@/lib/task-view";
import type { TaskViewSummary } from "@/lib/task-views";

const LAYOUT_LABEL: Record<ViewLayout, string> = {
  list: "List",
  board: "Board",
  table: "Table",
  calendar: "Calendar",
};

const GROUPING_LABEL: Record<ViewGrouping, string> = {
  status: "Status",
  assignee: "Assignee",
  project: "Project",
  priority: "Priority",
  label: "Label",
  dueDate: "Due date",
};

const ORDERING_LABEL: Record<ViewOrdering, string> = {
  manual: "Manual",
  status: "Status",
  priority: "Priority",
  created: "Created",
  updated: "Updated",
  dueDate: "Due date",
};

const PROPERTY_LABEL: Record<ViewProperty, string> = {
  id: "ID",
  status: "Status",
  assignee: "Assignee",
  priority: "Priority",
  project: "Project",
  dueDate: "Due date",
  labels: "Labels",
  dates: "Dates",
};

/**
 * Display options for the current list: layout, grouping, ordering, sub-issues,
 * empty groups and visible properties. Opened by the toolbar button or Shift V.
 */
export function DisplayMenu({
  open,
  onOpenChange,
  display,
  onChange,
  layout,
  onLayoutChange,
  activeView,
  onSaveForEveryone,
  onSavePersonal,
  onResetPersonal,
  saving,
  error,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  display: TaskViewDisplay;
  onChange: (next: TaskViewDisplay) => void;
  layout: ViewLayout;
  onLayoutChange: (next: ViewLayout) => void;
  activeView: TaskViewSummary | null;
  onSaveForEveryone: () => Promise<void>;
  onSavePersonal: () => Promise<void>;
  onResetPersonal: () => Promise<void>;
  saving: boolean;
  error: string | null;
}) {
  const t = useT();
  const toggleProperty = (property: ViewProperty) =>
    onChange({
      ...display,
      properties: display.properties.includes(property)
        ? display.properties.filter((value) => value !== property)
        : [...display.properties, property],
    });
  return (
    <Menu
      width={340}
      open={open}
      onOpenChange={onOpenChange}
      triggerClassName={CHIP}
      trigger={
        <>
          <SlidersHorizontal size={14} />
          {t("Display")}
        </>
      }
    >
      {() => (
        <div data-task-display className="space-y-2.5 p-2 text-small">
          <div>
            <div className="pb-1 text-caption uppercase tracking-wide text-faint">{t("Layout")}</div>
            <div className="flex gap-0.5 rounded-lg bg-elevated p-0.5">
              {VIEW_LAYOUTS.map((value) => (
                <button
                  key={value}
                  type="button"
                  data-display-layout={value}
                  aria-pressed={layout === value}
                  onClick={() => onLayoutChange(value)}
                  className={`flex-1 rounded-md px-1.5 py-0.5 text-small transition-colors ${
                    layout === value
                      ? "bg-bg font-medium text-text shadow-sm"
                      : "text-muted hover:text-text"
                  }`}
                >
                  {t(LAYOUT_LABEL[value])}
                </button>
              ))}
            </div>
          </div>
          <label className="flex items-center justify-between gap-2">
            <span className="shrink-0 text-small text-muted">{t("Grouping")}</span>
            <select
              data-display-grouping
              value={display.grouping}
              onChange={(event) =>
                onChange({ ...display, grouping: event.target.value as ViewGrouping })
              }
              className="h-[26px] w-[132px] shrink-0 rounded-[7px] px-2 border border-border bg-bg text-small text-text"
            >
              {VIEW_GROUPINGS.map((value) => (
                <option key={value} value={value}>
                  {t(GROUPING_LABEL[value])}
                </option>
              ))}
            </select>
          </label>
          <label className="flex items-center justify-between gap-2">
            <span className="shrink-0 text-small text-muted">{t("Ordering")}</span>
            <select
              data-display-ordering
              value={display.ordering}
              onChange={(event) =>
                onChange({ ...display, ordering: event.target.value as ViewOrdering })
              }
              className="h-[26px] w-[132px] shrink-0 rounded-[7px] px-2 border border-border bg-bg text-small text-text"
            >
              {VIEW_ORDERINGS.map((value) => (
                <option key={value} value={value}>
                  {t(ORDERING_LABEL[value])}
                </option>
              ))}
            </select>
          </label>
          <label className="flex items-center gap-2">
            <input
              data-display-subissues
              type="checkbox"
              checked={display.subIssues}
              onChange={(event) => onChange({ ...display, subIssues: event.target.checked })}
            />
            {t("Show sub-issues")}
          </label>
          <label className="flex items-center gap-2">
            <input
              data-display-empty
              type="checkbox"
              checked={display.showEmptyGroups}
              onChange={(event) => onChange({ ...display, showEmptyGroups: event.target.checked })}
            />
            {t("Show empty groups")}
          </label>
          <div>
            <div className="pb-1 text-caption uppercase tracking-wide text-faint">
              {t("Properties")}
            </div>
            <div className="grid grid-cols-2 gap-x-3 gap-y-1">
              {VIEW_PROPERTIES.map((property) => (
                <label key={property} className="flex items-center gap-1.5 text-muted">
                  <input
                    data-display-property={property}
                    type="checkbox"
                    checked={display.properties.includes(property)}
                    onChange={() => toggleProperty(property)}
                  />
                  {t(PROPERTY_LABEL[property])}
                </label>
              ))}
            </div>
          </div>
          {activeView ? (
            <div className="space-y-1.5 border-t border-border pt-2">
              <div className="text-caption text-faint">
                {activeView.canManage
                  ? t("Saving writes this display into the shared view.")
                  : t("This view is shared. Saving keeps your display private to you.")}
              </div>
              {activeView.canManage ? (
                <button
                  type="button"
                  data-display-save-shared
                  disabled={saving}
                  onClick={() => void onSaveForEveryone()}
                  className="inline-flex items-center justify-center gap-1.5 whitespace-nowrap h-[30px] rounded-lg px-2.5 text-small bg-accent font-medium text-white disabled:opacity-40 hover:bg-accent-hover"
                >
                  {t("Save display for everyone")}
                </button>
              ) : (
                <button
                  type="button"
                  data-display-save-personal
                  disabled={saving}
                  onClick={() => void onSavePersonal()}
                  className="inline-flex items-center justify-center gap-1.5 whitespace-nowrap h-[30px] rounded-lg px-2.5 text-small bg-accent font-medium text-white disabled:opacity-40 hover:bg-accent-hover"
                >
                  {t("Save my display")}
                </button>
              )}
              {activeView.hasPersonalOverride ? (
                <button
                  type="button"
                  data-display-reset
                  disabled={saving}
                  onClick={() => void onResetPersonal()}
                  className="ml-2 text-small text-muted underline hover:text-text"
                >
                  {t("Reset my display")}
                </button>
              ) : null}
            </div>
          ) : (
            <div className="border-t border-border pt-2 text-caption text-faint">
              {t("Display changes stay on this device until you save them as a view.")}
            </div>
          )}
          {error ? (
            <p role="alert" className="text-danger">
              {t(error)}
            </p>
          ) : null}
          <div className="text-caption text-faint">
            <kbd className="rounded border border-border px-1 font-mono">Shift V</kbd>{" "}
            {t("opens this menu")}
          </div>
        </div>
      )}
    </Menu>
  );
}
