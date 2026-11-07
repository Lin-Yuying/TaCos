const BAR = "block h-3 animate-pulse rounded bg-elevated motion-reduce:animate-none";
const TITLE_BAR = "block h-4 animate-pulse rounded bg-elevated motion-reduce:animate-none";
const ACTION_BAR =
  "ml-auto block h-[30px] w-[94px] animate-pulse rounded-lg bg-elevated motion-reduce:animate-none";
// The task rows, widest to shortest, in the order the canvas draws them.
const ROW_WIDTHS = ["49%", "34%", "61%", "43%", "28%", "55%"];
const DOC_WIDTHS = ["40%", "92%", "86%", "70%", "30%", "90%", "64%"];

// Server-safe Suspense fallbacks: no hooks and no translated text. The page header is a
// skeleton too — the same fallback serves every list, so it cannot know the page's title.
// Title and primary action sit where the real ones do (52px header, one toolbar row).
export function ListSkeleton() {
  return (
    <div aria-busy="true" className="min-h-0 flex-1 overflow-hidden">
      <div className="flex min-h-[52px] items-center gap-2.5 border-b border-border px-5 py-2">
        <span className={`${TITLE_BAR} w-16`} />
        <span className={ACTION_BAR} />
      </div>
      <div className="flex h-10 items-center gap-1.5 border-b border-border px-5">
        <span className={`${BAR} w-16`} />
        <span className={`${BAR} w-16`} />
      </div>
      {ROW_WIDTHS.map((width) => (
        <div key={width} className="flex min-h-11 items-center gap-3 border-b border-border px-5">
          <span className={`${BAR} w-4`} />
          <span className={`${BAR} w-[60px]`} />
          <span className="min-w-0 flex-1"><span className={BAR} style={{ width }} /></span>
          <span className={`${BAR} w-12`} />
        </div>
      ))}
    </div>
  );
}

// The document page: 52px header with its title, then the writing column. The canvas has no
// action in this header, so neither does the skeleton.
export function DocSkeleton() {
  return (
    <div aria-busy="true" className="min-h-0 flex-1 overflow-hidden">
      <div className="flex min-h-[52px] items-center gap-2.5 border-b border-border px-5 py-2">
        <span className={`${TITLE_BAR} w-16`} />
      </div>
      <div className="mx-auto flex max-w-[720px] flex-col gap-3 px-5 py-7">
        {DOC_WIDTHS.map((width) => <span key={width} className={BAR} style={{ width }} />)}
      </div>
    </div>
  );
}
