"use client";
import { useT } from "@/components/i18n-context";
export function OptionSearch({
  value,
  onChange,
  selected,
}: {
  value: string;
  onChange: (value: string) => void;
  selected?: number;
}) {
  const t = useT();
  return (
    <div className="sticky top-0 z-10 space-y-1 bg-overlay p-1">
      <input
        aria-label={t("Search options")}
        placeholder={t("Search options")}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-[34px] rounded-lg px-2.5 w-full border border-border-strong bg-bg text-body"
      />
      {selected !== undefined && (
        <p className="text-caption text-faint">
          {t("{count} selected", { count: selected })}
        </p>
      )}
    </div>
  );
}
export function matchesOption(
  query: string,
  ...text: (string | null | undefined)[]
) {
  return text
    .join(" ")
    .toLocaleLowerCase()
    .includes(query.trim().toLocaleLowerCase());
}
