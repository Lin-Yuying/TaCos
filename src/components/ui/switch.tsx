"use client";

export function Switch({ checked, disabled, onChange, label }: {
  checked: boolean; disabled?: boolean; onChange: (checked: boolean) => void; label: string;
}) {
  return <input
    type="checkbox"
    role="switch"
    aria-label={label}
    checked={checked}
    disabled={disabled}
    onChange={(event) => onChange(event.target.checked)}
    className="relative h-4 w-7 shrink-0 cursor-pointer appearance-none rounded-full bg-border transition-colors before:absolute before:left-0.5 before:top-0.5 before:h-3 before:w-3 before:rounded-full before:bg-white before:transition-transform checked:bg-accent checked:before:translate-x-3 disabled:cursor-default disabled:opacity-40"
  />;
}
