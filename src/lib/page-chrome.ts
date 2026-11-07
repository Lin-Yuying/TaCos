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
export const PAGE_BOARD = `${PAGE_LEFT} pr-2 py-3`;

// Settings pages sit beside the settings navigation: left-aligned, title in the scroll area.
export const SETTINGS_SCROLL = "min-h-0 min-w-0 flex-1 overflow-auto";
export const SETTINGS_PAGE = "space-y-6 px-5 pb-10 pt-6";
export const SETTINGS_TITLE = "text-title font-semibold";
