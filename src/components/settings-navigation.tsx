"use client";
import { useEffect, useState, type RefObject } from "react";
import { useT } from "@/components/i18n-context";
export function SettingsNavigation({
  root,
}: {
  root: RefObject<HTMLDivElement | null>;
}) {
  const t = useT();
  const [sections, setSections] = useState<{ id: string; title: string }[]>([]);
  useEffect(() => {
    const nodes = [
      ...(root.current?.querySelectorAll<HTMLElement>("section") ?? []),
    ].filter((node) => node.querySelector("h2"));
    const frame = requestAnimationFrame(() =>
      setSections(
        nodes.map((node, index) => {
          // A section with an explicit id keeps it: deep links such as #labels or
          // #page-templates point at the same section the navigation lists.
          if (!node.id) node.id = `settings-${index}`;
          node.style.scrollMarginTop = "100px";
          return {
            id: node.id,
            title: node.querySelector("h2")!.textContent ?? "",
          };
        }),
      ),
    );
    return () => cancelAnimationFrame(frame);
  }, [root, t]);
  return (
    <nav
      aria-label={t("Settings sections")}
      className="sticky top-0 z-20 border-b border-border bg-bg py-2"
    >
      <div className="flex flex-wrap gap-x-3 gap-y-1 text-small text-muted">
        {sections.map((section) => (
          <a
            key={section.id}
            href={`#${section.id}`}
            onClick={(e) => {
              e.preventDefault();
              requestAnimationFrame(() => {
                document
                  .getElementById(section.id)
                  ?.scrollIntoView({ block: "start" });
                history.replaceState(null, "", `#${section.id}`);
              });
            }}
          >
            {section.title}
          </a>
        ))}
      </div>
    </nav>
  );
}
