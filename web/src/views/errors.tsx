// Friendly "not found" / "unavailable" panels, and the mapping from API error payloads to them.
// The API answers errors as NK envelopes ({success:false, error:"No challenge with that ID exists"}) or, from the
// Worker, {error, code}; both shapes are handled. Messages never show the raw developer text.
import type { ComponentChildren } from "preact";
import { Spr } from "../sprite.tsx";
import { A } from "../ui.tsx"; // cycle-safe: only used at render time

type Back = { href: string; label: string };

const DEFAULT_BACK: Back = { href: "/", label: "See what's on now" };

function Panel(p: {
  art: [string, string];
  kicker: string;
  title: ComponentChildren;
  children?: ComponentChildren;
  actions?: ComponentChildren;
  tone?: "warn" | "info";
  /** "h1" when the panel is the whole page; "h2" (default) when it sits under the page's own title. */
  heading?: "h1" | "h2";
}) {
  const H = p.heading ?? "h2";
  return (
    <section class={`oops${p.tone ? ` oops-${p.tone}` : ""}`} role={p.tone === "warn" ? "alert" : undefined}>
      <span class="oops-art" aria-hidden="true">
        <Spr family={p.art[0]} k={p.art[1]} size={72} label />
      </span>
      <div class="oops-t">
        <p class="oops-k">{p.kicker}</p>
        <H class="oops-h">{p.title}</H>
        {p.children && <div class="oops-p">{p.children}</div>}
        {p.actions && <p class="oops-a">{p.actions}</p>}
      </div>
    </section>
  );
}

/** Why a record is missing, by what it is: events expire at Ninja Kiwi, people and teams don't. */
function notFoundText(what: string): string {
  if (what === "player" || what === "team")
    return `That ID doesn't match a ${what} Ninja Kiwi knows. Check the link, or open ${what === "team" ? "teams" : "players"} from a leaderboard.`;
  if (what === "challenge") return "That code doesn't match a challenge. Check the code, or open challenges from the challenges list.";
  return "It may have been removed, or the link is mistyped. Ninja Kiwi only keeps recent events; older ones live on here only if we archived them.";
}

/** A page or record that doesn't exist (bad id, unknown route). `what` = "boss event", "player", "page"… */
export function NotFound(p: { what: string; back?: Back; children?: ComponentChildren; heading?: "h1" | "h2" }) {
  const back = p.back ?? DEFAULT_BACK;
  return (
    <Panel
      art={["bloon", "red"]}
      kicker="Not found"
      heading={p.heading ?? "h1"}
      title={`No such ${p.what}`}
      actions={
        <>
          <A href={back.href} class="oops-btn">
            {back.label}
          </A>
          {back.href !== "/" && (
            <A href="/" class="oops-link">
              Home
            </A>
          )}
        </>
      }
    >
      {p.children ?? <p>{notFoundText(p.what)}</p>}
    </Panel>
  );
}

// ─────────────────────────────── error classification

export type ErrorKind = "notfound" | "private" | "ratelimit" | "upstream" | "other";

/**
 * Status and/or {error, code} payload → what went wrong, in user terms. Worker codes: not_found, bad_request →
 * not found; private; rate_limited; upstream, unavailable, internal → upstream; anything else → generic.
 * NK's own envelopes have no code and are matched by their text.
 */
export function errorKind(p: { status?: number; code?: string; message?: string }): ErrorKind {
  const code = (p.code ?? "").toLowerCase();
  const msg = p.message ?? "";
  if (p.status === 429 || /rate|limit/.test(code) || /rate.?limit/i.test(msg)) return "ratelimit";
  if (/private|oak|forbidden/.test(code) || p.status === 403 || /^private\b|\bOAK\b/i.test(msg)) return "private";
  if (
    p.status === 404 ||
    /not.?found|no.?such|unknown|invalid|bad.?(id|request)/.test(code) ||
    /with that ID exists|^invalid\b.*\bid\b|no such|not found/i.test(msg)
  )
    return "notfound";
  if ((p.status ?? 0) >= 500 || /upstream|unavailable|timeout|internal|warming/.test(code) || /upstream|unavailable|internal error|warming up|timed? ?out/i.test(msg))
    return "upstream";
  return "other";
}

/** What a store key is, for "No such …" ("/btd6/users/…" → "player"). */
export function whatOfKey(k: string): string {
  if (k.startsWith("/btd6/users/")) return "player";
  if (k.startsWith("/btd6/guild/")) return "team";
  if (k.startsWith("/btd6/challenges/challenge/")) return "challenge";
  if (k.startsWith("/btd6/bosses/")) return "boss event";
  if (k.startsWith("/btd6/races/")) return "race";
  if (k.includes("/leaderboard/group/")) return "CT group";
  if (k.startsWith("/btd6/ct/")) return "CT event";
  if (k.startsWith("/btd6/odyssey/")) return "odyssey";
  return "page";
}

/**
 * A load that failed (upstream error, rate limit, private profile…), from a store entry's error payload.
 * `code`: the Worker's machine code when present; `onRetry`: shows a retry button; `retryIn`: seconds until the
 * automatic retry (rate limit).
 */
export function ErrorPanel(p: { status?: number; message?: string; code?: string; what?: string; onRetry?: () => void; retryIn?: number }) {
  const kind = errorKind(p);
  // player / team / challenge pages have nothing else on them: the panel is the page (h1); elsewhere it sits under the page title
  const heading = /^(player|team|challenge)$/.test(p.what ?? "") ? "h1" : "h2";
  const retry = p.onRetry && (
    <button type="button" class="oops-btn" onClick={p.onRetry}>
      Try again
    </button>
  );
  const home = (
    <A href="/" class={p.onRetry ? "oops-link" : "oops-btn"}>
      See what's on now
    </A>
  );
  switch (kind) {
    case "notfound":
      return <NotFound what={p.what ?? "page"} heading={heading} />;
    case "private":
      return (
        <Panel art={["bloon", "lead"]} kicker="Private" heading={heading} title="This profile can't be shown" actions={home}>
          <p>
            That link isn't a public player ID. It may be a private Open Access Key (OAK) — those stay between you and Ninja Kiwi and never go
            through this site. Open players from a leaderboard or a team page instead.
          </p>
        </Panel>
      );
    case "ratelimit":
      return (
        <Panel art={["bloon", "moab"]} kicker="Busy" heading={heading} title="Ninja Kiwi is rate-limiting us, retrying…" tone="info" actions={retry}>
          <p>
            Too many fresh lookups in a short time. Everything already loaded still works; this page fills in by itself
            {p.retryIn && p.retryIn > 0 ? ` in about ${Math.ceil(p.retryIn)} s` : " shortly"}.
          </p>
        </Panel>
      );
    case "upstream":
      return (
        <Panel
          art={["bloon", "ddt"]}
          kicker="Unavailable" heading={heading}
          title="Ninja Kiwi's data service isn't answering"
          tone="warn"
          actions={
            <>
              {retry}
              {home}
            </>
          }
        >
          <p>This usually clears up within a few minutes. Pages you've opened before still load from this device.</p>
        </Panel>
      );
    default:
      return (
        <Panel
          art={["bloon", "black"]}
          kicker="Unavailable" heading={heading}
          title="This couldn't be loaded"
          tone="warn"
          actions={
            <>
              {retry}
              {home}
            </>
          }
        >
          {p.message && <p class="quiet">Ninja Kiwi said: “{p.message.replace(/\.$/, "")}”.</p>}
        </Panel>
      );
  }
}
