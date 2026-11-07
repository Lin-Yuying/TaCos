const BAR = "block h-3 animate-pulse rounded bg-elevated motion-reduce:animate-none";
const ROW_WIDTHS = ["50%", "34%", "62%", "44%", "56%", "38%", "48%"];
const DOC_WIDTHS = ["40%", "92%", "86%", "70%", "30%", "90%", "64%"];

// Server-safe Suspense fallbacks: no hooks and no translated text.
export function ListSkeleton() {
  return (
    <div aria-busy="true" className="min-h-0 flex-1 overflow-hidden pt-[52px]">
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

export function DocSkeleton() {
  return (
    <div aria-busy="true" className="min-h-0 flex-1 overflow-hidden pt-[52px]">
      <div className="mx-auto flex max-w-[720px] flex-col gap-3 px-5 py-7">
        {DOC_WIDTHS.map((width) => <span key={width} className={BAR} style={{ width }} />)}
      </div>
    </div>
  );
}
