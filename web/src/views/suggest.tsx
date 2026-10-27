// /suggest: private suggestions box. Posts to the Worker's /api/suggest; only the site owner reads what comes in.
import { useEffect, useRef, useState } from "preact/hooks";
import { backTo } from "../nav.ts";
import { A } from "../ui.tsx";

declare const __APP_VERSION__: string;

const KINDS: [string, string][] = [
  ["bug", "Bug"],
  ["data", "Wrong data"],
  ["idea", "Idea"],
];
const MAX = 1000;
/** "Which page" choices: [label, group]; the label is what reaches Discord. */
const PAGES: [string, string][] = [
  ["Live", "Pages"],
  ["Bosses", "Pages"],
  ["Races", "Pages"],
  ["CT", "Pages"],
  ["Odysseys", "Pages"],
  ["Challenges", "Pages"],
  ["Maps", "Pages"],
  ["Players and teams", "Pages"],
  ["My stats", "Pages"],
  ["Round visualizer", "Tools"],
  ["Paragon calculator", "Tools"],
  ["Paragon scaling", "Tools"],
  ["Farming resources", "Tools"],
  ["Bank & IMF Loan planner", "Tools"],
  ["Hero XP planner", "Tools"],
  ["The whole site", "Other"],
];
const OTHER = "Other (specify above)";

/** Page-level robots meta, removed again on leaving (same approach as /stats). */
function useNoindex() {
  useEffect(() => {
    const m = document.createElement("meta");
    m.name = "robots";
    m.content = "noindex, nofollow";
    document.head.append(m);
    return () => m.remove();
  }, []);
}

type Status = { kind: "idle" } | { kind: "error" | "limit"; msg: string } | { kind: "sent" };

export function SuggestPage() {
  useNoindex();
  const from = backTo();
  const [text, setText] = useState("");
  const [kind, setKind] = useState("");
  const [page, setPage] = useState(OTHER);
  const [discord, setDiscord] = useState("");
  const [hp, setHp] = useState("");
  const [busy, setBusy] = useState(false);
  const [st, setSt] = useState<Status>({ kind: "idle" });
  const t0 = useRef(Date.now());
  const tooShort = st.kind === "error" && text.trim().length < 10;
  const msg = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    if (st.kind !== "idle") msg.current?.focus();
  }, [st]);

  const send = async (e: Event) => {
    e.preventDefault();
    if (busy) return;
    if (text.trim().length < 10) return setSt({ kind: "error", msg: "Please write at least 10 characters" });
    setBusy(true);
    try {
      const r = await fetch("/api/suggest", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          text: text.trim(),
          kind: kind || undefined,
          page,
          pageUrl: from?.href,
          discord: discord.trim() || undefined,
          width: window.innerWidth,
          version: __APP_VERSION__,
          hp,
          t: Date.now() - t0.current,
        }),
      });
      const j = (await r.json().catch(() => ({}))) as { success?: boolean; scope?: string; retryAfter?: number };
      if (r.ok && j.success) setSt({ kind: "sent" });
      else if (r.status === 429 && j.scope === "daily") setSt({ kind: "limit", msg: "Suggestions are paused for today. Please try again tomorrow." });
      else if (r.status === 429) {
        const n = Math.max(1, Math.ceil((j.retryAfter ?? 60) / 60));
        setSt({ kind: "error", msg: `You've sent a few suggestions already. Please try again in about ${n} minute${n === 1 ? "" : "s"}.` });
      } else setSt({ kind: "error", msg: "Couldn't send, please try again." });
    } catch {
      setSt({ kind: "error", msg: "Couldn't send, please try again." });
    }
    setBusy(false);
  };

  return (
    <div class="sug">
      <header class="page-h">
        <h1>Suggest</h1>
        <p class="lede">Found a bug, a wrong number, or have an idea? Tell me!</p>
      </header>
      {st.kind === "sent" ? (
        <div class="empty">
          <p class="empty-t" ref={msg} tabIndex={-1} role="status">
            Thanks, got it.
          </p>
          <p>I read every suggestion myself. If you left a Discord name I may reply there, but I can't reply to everything.</p>
          <p class="sug-after">
            <a
              href="/suggest"
              onClick={(e) => {
                e.preventDefault();
                setText("");
                setKind("");
                setPage(OTHER);
                setDiscord("");
                setSt({ kind: "idle" });
                t0.current = Date.now();
              }}
            >
              Send another
            </a>
            <A href={from?.href ?? "/"}>Back to the page</A>
          </p>
        </div>
      ) : (
        <form class="sug-form" onSubmit={send} noValidate>
          <fieldset disabled={busy}>
            <div class="sug-chips" role="group" aria-label="What kind of suggestion (optional)">
              {KINDS.map(([k, label]) => (
                <button key={k} type="button" class="sug-chip" aria-pressed={kind === k} onClick={() => setKind(kind === k ? "" : k)}>
                  {label}
                </button>
              ))}
            </div>
            <div class="sug-row">
              <label for="sug-text">Your suggestion</label>
              <div class="sug-field">
                <textarea id="sug-text" maxLength={MAX} value={text} onInput={(e) => setText(e.currentTarget.value)} aria-invalid={tooShort} aria-describedby={tooShort ? "sug-text-h sug-status" : "sug-text-h"} />
              </div>
              <div class="sug-sub">
                <span id="sug-text-h">A feature, a bug, a wrong number, anything</span>
                <span>
                  {text.length} / {MAX}
                </span>
              </div>
            </div>
            <div class="sug-row">
              <label for="sug-page">Which page is this about?</label>
              <div class="sug-field">
                <select id="sug-page" value={page} onChange={(e) => setPage(e.currentTarget.value)}>
                  <option value={OTHER}>{OTHER}</option>
                  {["Pages", "Tools", "Other"].map((g) => (
                    <optgroup key={g} label={g}>
                      {PAGES.filter(([, pg]) => pg === g).map(([l]) => (
                        <option key={l} value={l}>
                          {l}
                        </option>
                      ))}
                    </optgroup>
                  ))}
                </select>
              </div>
            </div>
            <div class="sug-row">
              <label for="sug-dc">Discord name, if you want a reply (optional)</label>
              <div class="sug-field">
                <input id="sug-dc" type="text" maxLength={40} autocomplete="off" value={discord} onInput={(e) => setDiscord(e.currentTarget.value)} aria-describedby="sug-dc-h" />
              </div>
              <div class="sug-sub">
                <span id="sug-dc-h">Your Discord username (not the old name#1234 tag)</span>
              </div>
            </div>
            <input class="sug-hp" type="text" name="website" tabIndex={-1} autocomplete="off" aria-hidden="true" value={hp} onInput={(e) => setHp(e.currentTarget.value)} />
            <button type="submit" class="sug-send">
              {busy ? "Sending…" : "Send suggestion"}
            </button>
          </fieldset>
          <p id="sug-status" class={`sug-status${st.kind === "error" ? " err" : ""}`} role="status" aria-live="polite" tabIndex={-1} ref={msg}>
            {st.kind === "error" || st.kind === "limit" ? st.msg : ""}
          </p>
          <p class="sug-priv">Only the site owner reads this.</p>
        </form>
      )}
    </div>
  );
}
