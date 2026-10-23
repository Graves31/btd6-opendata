// Freshness labels ("Updated 3 min ago", "Final", "Top 1,000 of 13,546").

import { useEffect, useState } from "preact/hooks";
import { freshParts } from "./boards.ts";
import { store } from "./nav.ts";

// One shared 30 s timer for every label on screen (minute resolution needs no more), stopped when none is.
const subs = new Set<() => void>();
let timer: ReturnType<typeof setInterval> | null = null;
function useMinuteTick(): number {
  const [, set] = useState(0);
  useEffect(() => {
    const fn = () => set((x) => x + 1);
    subs.add(fn);
    timer ??= setInterval(() => subs.forEach((f) => f()), 30_000);
    return () => {
      subs.delete(fn);
      if (!subs.size && timer) {
        clearInterval(timer);
        timer = null;
      }
    };
  }, []);
  return Date.now();
}

const exact = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit" });

/** "Updated N min ago" only says something when the data is stale (older than this) or the last fetch failed. */
const STALE_MS = 15 * 60_000;

/** `k` = store key of the page's main data; `ended` → "Final"; `shown`/`total` → "Top N of M". One muted line. */
export function Freshness(p: { k: string; ended?: boolean; shown?: number; total?: number; extra?: string }) {
  const now = useMinuteTick();
  const e = store.peek(p.k);
  const fetchedAt = e?.fetchedAt ?? null;
  const stale = fetchedAt !== null && now - fetchedAt > STALE_MS;
  const parts = freshParts({ fetchedAt: stale || e?.ok === false ? fetchedAt : null, now, ended: p.ended, shown: p.shown, total: p.total });
  if (p.extra) parts.push(p.extra);
  if (!parts.length) return null;
  const title = fetchedAt ? `Data fetched from Ninja Kiwi ${exact.format(fetchedAt)}` : undefined;
  return (
    <p class={`fresh${p.ended ? " final" : ""}`} title={title}>
      {parts.join(" · ")}
    </p>
  );
}
