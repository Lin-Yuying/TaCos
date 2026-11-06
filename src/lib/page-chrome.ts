/** Left column where page titles line up with a project icon header (16px pad + 22px mark + 10px gap). */
export const PAGE_LEFT = "pl-[52px]";

/** Right gutter inside the workspace card; uses container width so a open task panel does not over-pad. */
export const PAGE_RIGHT = "pr-4 @2xl:pr-10 @4xl:pr-20 @6xl:pr-32";

/** Shared by page title bars, filter toolbars, and list/board body rows. */
export const PAGE_INSET = `${PAGE_LEFT} ${PAGE_RIGHT}`;

/** Board view: same left edge, minimal right pad so columns use the card width. */
export const PAGE_BOARD = `${PAGE_LEFT} pr-2 py-3`;
