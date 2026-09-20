export type CheckState = "ok" | "wait" | "fail";

export function CheckIcon({ state }: { state: CheckState }) {
  if (state === "wait") return <svg className="ck ck-wait" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
    <circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeDasharray="10 28" />
  </svg>;
  if (state === "fail") return <svg className="ck ck-fail" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
    <path d="M4.5 4.5l7 7M11.5 4.5l-7 7" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
  </svg>;
  return <svg className="ck ck-ok" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
    <path d="M3 8.5l3.2 3.2L13 4.8" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
  </svg>;
}

const spoken: Record<CheckState, string> = { ok: "Ready", wait: "Still working", fail: "Needs attention" };

export function Checks({ items }: { items: { label: string; state: CheckState }[] }) {
  return <div className="checks">
    {items.map(item => <div key={item.label}>
      <CheckIcon state={item.state} />
      <span>{item.label}</span>
      <span className="sr">{spoken[item.state]}</span>
    </div>)}
  </div>;
}
