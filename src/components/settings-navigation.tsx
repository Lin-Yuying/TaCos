"use client";
import { useEffect, useState, type RefObject } from "react";
import { useT } from "@/components/i18n-context";
export function SettingsNavigation({
  root,
}: {
  root: RefObject<HTMLDivElement | null>;
}) {
  const t = useT();
  const [query, setQuery] = useState(""),
    [sections, setSections] = useState<{ id: string; title: string }[]>([]);
  useEffect(() => {
    const nodes = [
      ...(root.current?.querySelectorAll<HTMLElement>("section") ?? []),
    ].filter((node) => node.querySelector("h2"));
    const frame = requestAnimationFrame(() =>
      setSections(
        nodes.map((node, index) => {
          node.id = `settings-${index}`;
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
  useEffect(() => {
    const nodes = [
      ...(root.current?.querySelectorAll<HTMLElement>("section") ?? []),
    ];
    for (const node of nodes)
      node.hidden =
        !!query &&
        !node.textContent
          ?.toLocaleLowerCase()
          .includes(query.toLocaleLowerCase());
    return () => {
      for (const node of nodes) node.hidden = false;
    };
  }, [query, root]);
  return (
    <nav
      aria-label={t("Settings sections")}
      className="sticky top-0 z-20 space-y-2 border-b border-border bg-bg py-2"
    >
      <input
        aria-label={t("Search settings")}
        placeholder={t("Search settings")}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        className="w-full rounded border border-border bg-bg px-2 py-1 text-body"
      />
      <div className="flex flex-wrap gap-x-3 gap-y-1 text-small text-muted">
        {sections.map((section) => (
          <a
            key={section.id}
            href={`#${section.id}`}
            onClick={(e) => {
              e.preventDefault();
              setQuery("");
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
