// Post-deploy smoke test against the DEPLOYED site (which itself calls NK). Gentle: ≤ ~20 requests.
//   node scripts/smoke.ts https://<name>.<subdomain>.workers.dev
// Prints a pass/fail table with timings; exits 1 if any check fails.

export {}; // a module: top-level await

const base = (process.argv[2] ?? "").replace(/\/+$/, "");
if (!/^https?:\/\/[^/]+$/.test(base)) {
  console.error("usage: node scripts/smoke.ts https://<name>.<subdomain>.workers.dev");
  process.exit(2);
}

const TIMEOUT_MS = 20_000;
/** /api/now waits for the first cron run: delays between polls (≈ 3 min in total, 8 requests at most). */
const NOW_BACKOFF_S = [0, 5, 10, 15, 25, 35, 45, 45];

interface Row {
  name: string;
  ok: boolean;
  ms: number;
  detail: string;
}
const rows: Row[] = [];
let requests = 0;

class Fail extends Error {}
function expect(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Fail(msg);
}

async function get(path: string, init: RequestInit = {}): Promise<Response> {
  requests++;
  return fetch(base + path, {
    ...init,
    redirect: "manual",
    signal: AbortSignal.timeout(TIMEOUT_MS),
    headers: { "User-Agent": "btd6-opendata-smoke/1.0", ...(init.headers ?? {}) },
  });
}

/** Run one check; `fn` returns the detail shown on success. Failures never abort the remaining checks. */
async function check(name: string, fn: () => Promise<string>): Promise<void> {
  const t0 = performance.now();
  let ok = true;
  let detail: string;
  try {
    detail = await fn();
  } catch (err) {
    ok = false;
    detail = err instanceof Fail ? err.message : `${(err as Error).name}: ${(err as Error).message}`;
  }
  rows.push({ name, ok, ms: Math.round(performance.now() - t0), detail });
}

const nosniff = (r: Response) => r.headers.get("x-content-type-options") === "nosniff";
const hasModel = (text: string) => text.includes('"model":{');

// ─────────────────────────────── static site

let html = "";
await check("GET / → HTML 200", async () => {
  const r = await get("/");
  html = await r.text();
  expect(r.status === 200, `status ${r.status}`);
  expect((r.headers.get("content-type") ?? "").includes("text/html"), `content-type ${r.headers.get("content-type")}`);
  expect(/<html/i.test(html), "no <html> in body");
  return `${html.length} B, cache-control: ${r.headers.get("cache-control") ?? "-"}`;
});

await check("hashed /assets/*.js is immutable", async () => {
  const m = /["'](\/assets\/[^"']+\.js)["']/.exec(html);
  expect(m, "no /assets/*.js referenced from /");
  const r = await get(m[1]);
  await r.body?.cancel();
  const cc = r.headers.get("cache-control") ?? "";
  expect(r.status === 200, `${m[1]} → ${r.status}`);
  expect(cc.includes("immutable"), `${m[1]} cache-control: "${cc}"`);
  return `${m[1]} → ${cc}`;
});

await check("/sw.js is no-cache", async () => {
  const r = await get("/sw.js");
  await r.body?.cancel();
  const cc = r.headers.get("cache-control") ?? "";
  expect(r.status === 200, `status ${r.status}`);
  expect(cc.includes("no-cache"), `cache-control: "${cc}"`);
  return cc;
});

// ─────────────────────────────── API

await check("/api/health → JSON", async () => {
  const r = await get("/api/health");
  expect(r.status === 200, `status ${r.status}`);
  expect(nosniff(r), "missing X-Content-Type-Options: nosniff");
  const h = (await r.json()) as { hotGeneratedAt: string | null; hotKeys: number; archiveQueue: number | null; d1?: string };
  expect("hotKeys" in h && "hotGeneratedAt" in h, "unexpected shape");
  if (h.d1) expect(h.d1 === "ok", `D1: ${h.d1}`);
  return `hot ${h.hotKeys} keys @ ${h.hotGeneratedAt ?? "never"}, archive queue ${h.archiveQueue}, d1 ${h.d1 ?? "?"}`;
});

interface NowBundle {
  generatedAt: number;
  featured: Record<string, string | null>;
  entries: Record<string, { ok: boolean; data: Record<string, unknown> }>;
}
let now: NowBundle | null = null;
await check("/api/now → hot bundle (waits for 1st cron)", async () => {
  let last = "";
  for (const [i, delay] of NOW_BACKOFF_S.entries()) {
    if (delay) await new Promise((r) => setTimeout(r, delay * 1000));
    const r = await get("/api/now");
    const text = await r.text();
    if (r.status === 503) {
      last = `503 warming up after ${i + 1} polls`;
      continue;
    }
    expect(r.status === 200, `status ${r.status}`);
    expect(nosniff(r), "missing nosniff");
    now = JSON.parse(text) as NowBundle;
    expect(now.featured && typeof now.featured === "object", "no featured");
    const keys = Object.keys(now.entries ?? {});
    expect(keys.length > 0, "no entries");
    expect(!hasModel(text), "an entry still carries NK's `model`");
    const featured = Object.entries(now.featured).filter(([, v]) => v).map(([k, v]) => `${k}=${v}`).join(" ");
    return `${keys.length} entries, ${Math.round(text.length / 1024)} KB, featured: ${featured || "none"} (poll ${i + 1})`;
  }
  throw new Fail(last || "never became ready");
});

await check("/api/nk/btd6/bosses → X-Cache, then a cache hit", async () => {
  const r1 = await get("/api/nk/btd6/bosses");
  const t1 = await r1.text();
  const c1 = r1.headers.get("x-cache");
  expect(r1.status === 200, `status ${r1.status}`);
  expect(c1, "no X-Cache header");
  expect(nosniff(r1), "missing nosniff");
  expect((JSON.parse(t1) as { success: boolean }).success === true, "success !== true");
  expect(!hasModel(t1), "`model` not stripped");
  const r2 = await get("/api/nk/btd6/bosses");
  await r2.body?.cancel();
  const c2 = r2.headers.get("x-cache") ?? "";
  expect(/^(MEM|HOT|D1)/.test(c2), `2nd request X-Cache: ${c2}`);
  return `1st ${c1}, 2nd ${c2}`;
});

await check("/api/batch streams 3 NDJSON lines", async () => {
  expect(now, "needs /api/now");
  const f = now.featured;
  // Real keys: featured event documents first, then any other hot key.
  const preferred = [
    f.boss && `/btd6/bosses/${f.boss}/metadata/standard`,
    f.race && `/btd6/races/${f.race}/metadata`,
    f.ct && `/btd6/ct/${f.ct}/tiles`,
    f.odyssey && `/btd6/odyssey/${f.odyssey}/easy`,
  ].filter((k): k is string => !!k && k in now!.entries);
  const keys = [...new Set([...preferred, ...Object.keys(now.entries)])].slice(0, 3);
  expect(keys.length === 3, `only ${keys.length} keys in /api/now`);
  const t0 = performance.now();
  const r = await get(`/api/batch?${keys.map((k) => `k=${encodeURIComponent(k)}`).join("&")}`);
  expect(r.status === 200, `status ${r.status}`);
  expect((r.headers.get("content-type") ?? "").includes("application/x-ndjson"), `content-type ${r.headers.get("content-type")}`);
  expect(r.body, "no body");
  const reader = r.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  let firstLineMs = -1;
  const lines: { k: string; s: number; c: string; b: { success?: boolean } }[] = [];
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let nl: number;
    while ((nl = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, nl);
      buf = buf.slice(nl + 1);
      if (!line.trim()) continue;
      if (firstLineMs < 0) firstLineMs = Math.round(performance.now() - t0);
      expect(!hasModel(line), "`model` in a batch line");
      const l = JSON.parse(line);
      for (const field of ["k", "s", "a", "f", "t", "c", "b"]) expect(field in l, `line without "${field}"`);
      lines.push(l);
    }
  }
  expect(buf.trim() === "", "trailing partial line");
  expect(lines.length === 3, `${lines.length} lines`);
  expect(new Set(lines.map((l) => l.k)).size === 3 && lines.every((l) => keys.includes(l.k)), "keys don't match the request");
  const bad = lines.filter((l) => l.s !== 200);
  expect(bad.length === 0, `non-200 lines: ${bad.map((l) => `${l.k}=${l.s}`).join(", ")}`);
  return `first line after ${firstLineMs} ms; ${lines.map((l) => l.c).join("/")}`;
});

await check("invalid key → 404, save/OAK path → 403", async () => {
  const bad = await get("/api/nk/btd6/bosses/Vortex47_mu62cmt5/metadata/hard");
  await bad.body?.cancel();
  const oak = await get("/api/nk/btd6/save/not-a-real-oak");
  await oak.body?.cancel();
  expect(bad.status === 404, `invalid difficulty → ${bad.status}`);
  expect(oak.status === 403, `save/OAK → ${oak.status}`);
  return `404 (${bad.headers.get("x-cache")}), 403 (${oak.headers.get("x-cache")})`;
});

await check("/api/history/boss → items", async () => {
  const r = await get("/api/history/boss?limit=5");
  expect(r.status === 200, `status ${r.status}`);
  const j = (await r.json()) as { success: boolean; body: { id: string; start: number; archived: boolean }[] };
  expect(j.success && Array.isArray(j.body), "unexpected shape");
  expect(j.body.length > 0, "no items");
  expect(j.body.every((x, i) => typeof x.id === "string" && typeof x.archived === "boolean" && (i === 0 || j.body[i - 1].start >= x.start)), "items malformed or not newest first");
  return `${j.body.length} items, newest ${j.body[0].id}`;
});

// ─────────────────────────────── report

const w = Math.max(...rows.map((r) => r.name.length));
console.log(`\nSmoke test: ${base}\n`);
console.log(`${"check".padEnd(w)}  result      ms  detail`);
console.log(`${"-".repeat(w)}  ------  ------  ${"-".repeat(40)}`);
for (const r of rows) console.log(`${r.name.padEnd(w)}  ${(r.ok ? "PASS" : "FAIL").padEnd(6)}  ${String(r.ms).padStart(6)}  ${r.detail}`);
const failed = rows.filter((r) => !r.ok).length;
console.log(`\n${rows.length - failed}/${rows.length} passed, ${requests} requests.`);
process.exit(failed ? 1 : 0);
