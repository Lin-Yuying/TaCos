/** One left edge for every page: titles, toolbars and list rows all start 20px in. */
export const PAGE_LEFT = "pl-5";

/** Right gutter inside the workspace card. */
export const PAGE_RIGHT = "pr-5";

/** One height for every page title bar, whatever sits in it. */
export const PAGE_HEADER = "flex min-h-[52px] shrink-0 flex-wrap items-center gap-x-2.5 gap-y-1.5 border-b border-border py-2";

/** The title inside a PAGE_HEADER. */
export const PAGE_TITLE = "min-w-0 truncate text-lead font-semibold";

/** Shared by page title bars, filter toolbars, and list/board body rows. */
export const PAGE_INSET = `${PAGE_LEFT} ${PAGE_RIGHT}`;

/** Board view: same left edge, minimal right pad so columns use the card width. */
/** A small neutral tag: role, state, or a short fact about a row. */
export const BADGE = "inline-flex h-[18px] shrink-0 items-center whitespace-nowrap rounded-[5px] bg-elevated px-1.5 text-caption text-muted";

export const BADGE_GREEN = `${BADGE} !bg-[#e7f4ee] !text-[#17694a]`;
export const BADGE_ORANGE = `${BADGE} !bg-[#fdf1e0] !text-[#955006]`;

export const PAGE_BOARD = `${PAGE_LEFT} ${PAGE_RIGHT} py-3`;

// One control vocabulary, taken from the design canvas: 8px corners, 30px buttons, 26px chips.
const CONTROL = "inline-flex shrink-0 items-center justify-center gap-1.5 whitespace-nowrap transition-colors disabled:cursor-not-allowed disabled:opacity-50";
export const BTN = `${CONTROL} h-[30px] rounded-lg border border-border bg-bg px-2.5 text-small text-text hover:bg-active`;
export const BTN_PRIMARY = `${CONTROL} h-[30px] rounded-lg border border-accent bg-accent px-2.5 text-small font-medium text-white hover:border-accent-hover hover:bg-accent-hover`;
export const BTN_GHOST = `${CONTROL} h-[30px] rounded-lg px-2.5 text-small text-muted hover:bg-elevated hover:text-text`;
export const ICON_BTN = `${CONTROL} size-[30px] rounded-lg text-muted hover:bg-elevated hover:text-text`;
export const CHIP = `${CONTROL} h-[26px] rounded-[7px] border border-border bg-bg px-2 text-small text-muted hover:bg-active hover:text-text`;
export const SEARCH_FIELD = "search-field flex h-[30px] min-w-0 items-center gap-[7px] rounded-lg border border-border bg-bg px-2.5 text-small text-muted focus-within:border-text focus-within:shadow-[0_0_0_3px_rgba(13,13,13,0.08)]";
export const SEGMENTED = "inline-flex shrink-0 gap-px rounded-lg bg-elevated p-0.5";
export const segment = (on: boolean) => `inline-flex h-[26px] items-center justify-center gap-1.5 whitespace-nowrap rounded-md px-[9px] text-small transition-colors ${on ? "bg-bg text-text shadow-[0_1px_2px_rgba(0,0,0,0.08)]" : "text-muted hover:text-text"}`;
export const vtab = (on: boolean) => `inline-flex h-[26px] items-center gap-[5px] whitespace-nowrap rounded-md px-2 text-small transition-colors ${on ? "bg-elevated font-medium text-text" : "text-muted hover:bg-elevated hover:text-text"}`;
export const KBD = "rounded border border-border-strong bg-bg px-1 text-caption text-muted";

// List vocabulary from the design canvas: 44px rows, hairline dividers, optional framed box.
export const LINE = "flex min-h-11 items-center gap-2.5 border-b border-border px-5 py-2 text-body transition-colors hover:bg-active";
export const LINE_SUB = "text-small text-faint";
export const BOX = "overflow-hidden rounded-[10px] border border-border bg-bg [&>*:last-child]:border-b-0";
export const NARROW_PAGE = "mx-auto flex w-full flex-col gap-[22px] px-5 pb-10 pt-6";
export const SEC = "flex flex-col gap-2.5";
export const SEC_TITLE = "text-body font-semibold";
export const FILTER_BAR = "flex min-h-10 shrink-0 flex-wrap items-center gap-1 border-b border-border px-5 py-1";
export const PAGE_HINT = "shrink-0 border-b border-border px-5 py-2.5 text-small text-faint";

// Settings pages sit beside the settings navigation: left-aligned, title in the scroll area.
export const SETTINGS_SCROLL = "min-h-0 min-w-0 flex-1 overflow-auto";
export const SETTINGS_PAGE = "space-y-6 px-5 pb-10 pt-6";
export const SETTINGS_TITLE = "text-title font-semibold";

// Sign-in, registration, onboarding and invite screens: one card centered on the surface color.
export const GATE = "flex h-full justify-center overflow-auto bg-surface p-6 [align-items:safe_center]";
export const GATE_CARD = "flex w-full max-w-[380px] flex-col gap-4 rounded-[14px] border border-border bg-bg p-7";
export const GATE_INPUT = "w-full rounded-md border border-border bg-bg px-2.5 py-2 text-body text-text placeholder:text-faint focus:border-border-strong focus:outline-none";
