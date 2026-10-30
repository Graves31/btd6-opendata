// Open Access Key (OAK): a player's private key to their own save. It lives only in this browser (localStorage)
// and is sent only to data.ninjakiwi.com, browser → NK directly: never to our Worker, the store, IndexedDB or a
// URL. The save is kept in localStorage too, so pages that read it (/me, map medals, bank planner) render at once;
// a page that finds it older than OAK_STALE_MS refreshes it in the background (one request pair to NK).
import { useEffect, useReducer } from "preact/hooks";
import type { UserProfile, UserSave } from "../../src/nk/types.ts";

const NK = "https://data.ninjakiwi.com";
const KEY = "oak";
const SAVE = "oak-save";
/** The key owner's public 48-hex player id: found by name (autoLink) or confirmed with "This is me". "" = "Not me". */
const ME = "oak-player";
export const OAK_STALE_MS = 60 * 60_000;
export const OAK_FORMAT = /^oak_[0-9a-z]{8,64}$/i;

export interface Mine {
  save: UserSave;
  profile: UserProfile;
  /** When NK answered (epoch ms). */
  at: number;
}
/** invalid = NK doesn't know the key · busy = NK rate limit (429) · network = offline / blocked. */
export type OakError = "invalid" | "busy" | "network";
export interface OakState {
  key: string | null;
  mine: Mine | null;
  loading: boolean;
  error: OakError | null;
  playerId: string | null;
}

const ls = {
  get(k: string): string | null {
    try {
      return localStorage.getItem(k);
    } catch {
      return null;
    }
  },
  set(k: string, v: string | null) {
    try {
      if (v === null) localStorage.removeItem(k);
      else localStorage.setItem(k, v);
    } catch {
      /* private mode / quota: the state still holds it for this visit */
    }
  },
};

let state: OakState | null = null;
const listeners = new Set<() => void>();

export function oak(): OakState {
  if (!state) {
    let mine: Mine | null = null;
    try {
      mine = JSON.parse(ls.get(SAVE) ?? "null");
    } catch {
      /* corrupt cache: refetched below */
    }
    state = { key: ls.get(KEY), mine, loading: false, error: null, playerId: ls.get(ME) || null };
  }
  return state;
}

function set(p: Partial<OakState>) {
  state = { ...oak(), ...p };
  for (const fn of listeners) fn();
}

export function subscribeOak(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** NK's envelope → body, or the error to show. */
export function unwrap<T>(status: number, json: unknown): T | OakError {
  if (status === 429) return "busy";
  const env = json as { success?: boolean; body?: T } | null;
  return env?.success && env.body ? env.body : "invalid";
}

async function get<T>(path: string, key: string): Promise<T | OakError> {
  try {
    const r = await fetch(`${NK}${path}${encodeURIComponent(key)}`, { credentials: "omit", referrerPolicy: "no-referrer", cache: "no-store" });
    return unwrap<T>(r.status, await r.json().catch(() => null));
  } catch {
    return "network";
  }
}

let inflight: Promise<void> | null = null;

/** Fetch save + profile for the saved key. Keeps the last good save on failure. */
export function refreshOak(): Promise<void> {
  const key = oak().key;
  if (!key) return Promise.resolve();
  if (inflight) return inflight;
  set({ loading: true, error: null });
  inflight = (async () => {
    const [save, profile] = await Promise.all([get<UserSave>("/btd6/save/", key), get<UserProfile>("/btd6/users/", key)]);
    inflight = null;
    if (oak().key !== key) return; // forgotten or replaced meanwhile
    const err = typeof save === "string" ? save : typeof profile === "string" ? profile : null;
    if (err) return set({ loading: false, error: err });
    const mine: Mine = { save: save as UserSave, profile: profile as UserProfile, at: Date.now() };
    ls.set(SAVE, JSON.stringify(mine));
    set({ loading: false, mine });
    if (ls.get(ME) === null) void autoLink(mine.profile);
  })();
  return inflight;
}

/** Save a new key (trimmed) and load it. A different key drops the old save and player link. */
export function setOak(key: string): Promise<void> {
  key = key.trim();
  if (key !== oak().key) {
    ls.set(KEY, key);
    ls.set(SAVE, null);
    ls.set(ME, null);
    set({ key, mine: null, playerId: null, error: null });
  }
  return refreshOak();
}

export function forgetOak() {
  for (const k of [KEY, SAVE, ME]) ls.set(k, null);
  set({ key: null, mine: null, loading: false, error: null, playerId: null });
}

/** null = "Not me": remembered, so autoLink doesn't link it again for this key. */
export function setPlayerId(id: string | null) {
  ls.set(ME, id ?? "");
  set({ playerId: id });
}

/**
 * Find the key owner's public profile: the IDs seen under their name on archived leaderboards (/api/players),
 * each checked against their own profile (looksLikeMe). Links only when exactly one matches; finds nothing for
 * players who never reached a top-1,000 board, and "This is me" on the player page stays the way then.
 */
async function autoLink(mine: UserProfile) {
  const key = oak().key;
  try {
    const r = await fetch(`/api/players?name=${encodeURIComponent(mine.displayName)}`);
    const ids = r.ok ? ((await r.json()) as { ids: string[] }).ids.slice(0, 5) : [];
    const hits: string[] = [];
    for (const id of ids) {
      const pub = await fetch(`/api/nk/btd6/users/${id}`).then((x) => (x.ok ? x.json() : null)).catch(() => null);
      const body = unwrap<UserProfile>(200, pub);
      if (typeof body !== "string" && looksLikeMe(body, mine)) hits.push(id);
    }
    if (hits.length === 1 && oak().key === key && ls.get(ME) === null) setPlayerId(hits[0]);
  } catch {
    /* offline / no match: "This is me" still works */
  }
}

/**
 * Does this public profile look like the key's own? Same name and avatar, and every counter moved the same way
 * between the two snapshots (both are taken at different times, so counters only grow from the older to the newer).
 * A hint for "Is this you?" only; the owner confirms with a click.
 */
export function looksLikeMe(pub: UserProfile, mine: UserProfile): boolean {
  if (pub.displayName !== mine.displayName || pub.avatar !== mine.avatar) return false;
  let up = false, down = false;
  for (const g of ["gameplay", "bloonsPopped"] as const) {
    const a = pub[g] as unknown as Record<string, unknown>, b = mine[g] as unknown as Record<string, unknown>;
    for (const k in a) {
      if (typeof a[k] !== "number" || typeof b?.[k] !== "number") continue;
      if ((b[k] as number) > (a[k] as number)) up = true;
      if ((b[k] as number) < (a[k] as number)) down = true;
    }
  }
  return !(up && down);
}

/** Re-render on key/save changes; refresh a stale save once per mount. */
export function useOak(): OakState {
  const [, bump] = useReducer((x: number) => x + 1, 0);
  useEffect(() => {
    const off = subscribeOak(() => bump(0));
    const s = oak();
    if (s.key && !s.loading && (!s.mine || Date.now() - s.mine.at > OAK_STALE_MS)) void refreshOak();
    return off;
  }, []);
  return oak();
}
