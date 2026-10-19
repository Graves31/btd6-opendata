// "Share" on boss and race pages: the event as a 1200×630 picture, drawn on a canvas in the browser (event info
// only, no leaderboard) and offered to share / copy / download. Images that fail to load are left out of the card.

import { useEffect, useRef, useState } from "preact/hooks";
import type { ChallengeDocument, TowerRestriction } from "../../src/nk/types.ts";
import { ART } from "./art/index.ts";
import { fmtInt, fmtRounds, fmtWhen, mapName, status, unitName } from "./format.ts";
import { CATEGORY, DEFAULT_PARAGONS, HERO_ORDER, inOrder, modifierRows, NO_TOWER_CAP, TOWER_ORDER, tierCaps, x } from "./rules.tsx";
import { mapSrc, MODE_NAME, spriteCell } from "./sprite.tsx";

export interface CardSpec {
  eyebrow: string;
  title: string;
  /** Boss banner (the hero); without it the map is the hero. */
  banner?: string;
  start: number;
  end: number;
  meta: ChallengeDocument;
  /** Boss: the difficulty's scoring (ui sprite key + name) and its Normal/Elite label. */
  scoring?: { k: string; name: string };
  /** Race: the finishers line. */
  extra?: string;
  path: string;
}

// The dark theme's tokens (styles.css): the card looks the same whatever theme the viewer picked.
const C = { bg: "#0c111d", s1: "#141b2a", s2: "#1c2537", ink2: "#c4cbd8", ink3: "#9ea8ba", rule: "#28324a", accent: "#ffd60a", ban: "#ff5a4f", live: "#3ddc84", soon: "#62c6ff", ended: "#a3a3ab" };
const DISPLAY = '"Big Shoulders", "Arial Narrow", Impact, sans-serif';
const BODY = '"Archivo", system-ui, sans-serif';
const W = 1200;
const H = 630;
const PAD = 40;

/** Rule facts worth a chip: cash and lives always, then whatever differs from a normal game (as RuleFacts shows). */
export function factChips(d: ChallengeDocument): { icon: string; fam?: string; text: string }[] {
  const boat = d.lives === 0 && d.maxLives === 0;
  const t = (v: unknown): string => (typeof v === "string" ? v : String((v as { props?: { children?: unknown } })?.props?.children ?? ""));
  const rows = [{ icon: "StartingCash", text: `$${fmtInt(d.startingCash)} cash` }];
  if (!boat) rows.push({ icon: "StartingLives", text: `${fmtInt(d.lives)} lives` });
  if (d.maxTowers > 0 && d.maxTowers < NO_TOWER_CAP) rows.push({ icon: "MaxTowers", text: `Max ${fmtInt(d.maxTowers)} towers` });
  if (d.maxParagons < DEFAULT_PARAGONS) rows.push({ icon: "ParagonLimit", text: d.maxParagons === 0 ? "No paragons" : `Max ${fmtInt(d.maxParagons)} paragons` });
  if (d.leastCashUsed >= 0) rows.push({ icon: "LeastCashRule", text: `Cash cap $${fmtInt(d.leastCashUsed)}` });
  if (d.leastTiersUsed >= 0) rows.push({ icon: "LeastTiersRule", text: `Tier cap ${fmtInt(d.leastTiersUsed)}` });
  if (d.removeableCostMultiplier !== 1) rows.push({ icon: d.removeableCostMultiplier > 1 ? "RemovableCostIncrease" : "RemovableCostDecrease", text: `Obstacles ${x(d.removeableCostMultiplier)}` });
  return [...rows, ...modifierRows(d).map((r) => ({ icon: r.icon, fam: r.fam, text: `${r.k} ${t(r.v)}` }))];
}

/** The hero rule: one icon + name (any / none / a single hero), else the allowed heroes. */
export function heroCells(towers: TowerRestriction[]): { id: string; name: string }[] {
  const listed = towers.filter((t) => t.isHero && t.tower !== "ChosenPrimaryHero");
  const chosen = towers.find((t) => t.tower === "ChosenPrimaryHero");
  const allowed = inOrder(HERO_ORDER, listed.map((t) => t.tower)).filter((id) => listed.some((t) => t.tower === id && t.max !== 0));
  if ((chosen && chosen.max !== 0) || allowed.length === listed.length) return [{ id: "AnyHero", name: "Any hero" }];
  if (!allowed.length) return [{ id: "NoHero", name: "No heroes" }];
  return allowed.map((id) => ({ id, name: unitName(id) }));
}

const img = (src?: string | null) =>
  new Promise<HTMLImageElement | null>((done) => {
    if (!src) return done(null);
    const i = new Image();
    i.crossOrigin = "anonymous"; // NK art answers with CORS headers; without this the canvas could not be exported
    i.onload = () => done(i);
    i.onerror = () => done(null);
    i.src = src;
  });

const rr = (c: CanvasRenderingContext2D, x0: number, y: number, w: number, h: number, r: number) => (c.beginPath(), c.roundRect(x0, y, w, h, r));

export async function drawCard(s: CardSpec): Promise<Blob | null> {
  const d = s.meta;
  const cv = document.createElement("canvas");
  cv.width = W;
  cv.height = H;
  const c = cv.getContext("2d")!;
  await Promise.all([document.fonts.load(`800 40px ${DISPLAY}`), document.fonts.load(`600 20px ${BODY}`)]).catch(() => {});
  await document.fonts.ready;
  const sheets = new Map<string, HTMLImageElement | null>();
  await Promise.all(
    (["tower", "hero", "container", "ui"] as const).map(async (f) => {
      const sh = ART[f];
      if (sh) sheets.set(sh.url, await img(sh.url));
    }),
  );
  const [banner, map] = await Promise.all([img(s.banner), img(mapSrc(d.map, d.mapURL, 400))]);

  const sprite = (fam: string, k: string, x0: number, y: number, size: number) => {
    const p = spriteCell(fam, k);
    const im = p && sheets.get(p.url);
    if (p && im) c.drawImage(im, p.sx, p.sy, p.size, p.size, x0, y, size, size);
  };
  const text = (t: string, x0: number, y: number, font: string, color: string, maxW?: number) => {
    let px = +/(\d+)px/.exec(font)![1];
    c.font = font;
    while (maxW && c.measureText(t).width > maxW && px > 14) c.font = font.replace(/\d+px/, `${--px}px`);
    c.fillStyle = color;
    c.fillText(t, x0, y);
    return c.measureText(t).width;
  };
  c.textBaseline = "alphabetic";

  // background: dark, a tint and the accent edge
  c.fillStyle = C.bg;
  c.fillRect(0, 0, W, H);
  const g = c.createLinearGradient(0, 0, W, 0);
  g.addColorStop(0, "rgb(255 214 10 / 0.16)");
  g.addColorStop(1, "rgb(70 120 255 / 0.12)");
  c.fillStyle = g;
  c.fillRect(0, 0, W, H);
  c.fillStyle = C.accent;
  c.fillRect(0, 0, W, 8);

  // header: the hero art on the left, the title block on the right
  const st = status(s.start, s.end);
  const stText = st.label[0].toUpperCase() + st.label.slice(1);
  const stColor = st.s === "live" ? C.live : st.s === "upcoming" ? C.soon : C.ended;
  const mapLine = `${d.difficulty} · ${MODE_NAME[d.mode] ?? d.mode} · Rounds ${fmtRounds(d.startRound, d.endRound)}`;
  let tx = PAD;
  let tw = W - 2 * PAD;
  let ty = 62;
  if (s.banner) {
    const bw = 640;
    if (banner) c.drawImage(banner, PAD, 30, bw, Math.round((bw * banner.height) / banner.width));
    else text(s.title, PAD, 100, `800 64px ${DISPLAY}`, "#fff", bw);
    tx = PAD + bw + 34;
    tw = W - PAD - tx;
  } else {
    const [mw, mh] = [420, Math.round((420 * 400) / 597)];
    rr(c, PAD, 30, mw, mh, 6);
    c.fillStyle = "#070a12";
    c.fill();
    if (map) c.drawImage(map, PAD, 30, mw, mh);
    rr(c, PAD, 30, mw, mh, 6);
    c.strokeStyle = C.rule;
    c.lineWidth = 2;
    c.stroke();
    tx = PAD + mw + 34;
    tw = W - PAD - tx;
  }
  text(s.eyebrow.toUpperCase(), tx, ty, `800 26px ${DISPLAY}`, C.accent, tw);
  ty += 66;
  text(s.title, tx, ty, `800 68px ${DISPLAY}`, "#fff", tw);
  ty += 40;
  c.font = `800 24px ${DISPLAY}`;
  const pw = c.measureText(stText.toUpperCase()).width + 28;
  rr(c, tx, ty - 26, pw, 38, 4);
  c.fillStyle = stColor;
  c.fill();
  text(stText.toUpperCase(), tx + 14, ty + 1, `800 24px ${DISPLAY}`, "#0a0a0b");
  ty += 38;
  text(`${fmtWhen(s.start)} → ${fmtWhen(s.end)}`, tx, ty, `600 19px ${BODY}`, C.ink2, tw);
  if (s.banner) {
    // map row under the banner
    let my = 222;
    const [mw, mh] = [120, 80];
    rr(c, PAD, my, mw, mh, 5);
    c.fillStyle = "#070a12";
    c.fill();
    if (map) c.drawImage(map, PAD, my, mw, mh);
    rr(c, PAD, my, mw, mh, 5);
    c.strokeStyle = C.rule;
    c.lineWidth = 2;
    c.stroke();
    text(mapName(d.map), PAD + mw + 20, my + 36, `800 38px ${DISPLAY}`, "#fff", 470);
    text(mapLine, PAD + mw + 20, my + 70, `600 19px ${BODY}`, C.ink2, 470);
    if (s.scoring) {
      sprite("ui", s.scoring.k, tx, 222, 64);
      text(s.scoring.name, tx + 76, 262, `800 30px ${DISPLAY}`, "#fff", tw - 76);
    }
  } else {
    text(mapName(d.map), tx, ty + 52, `800 40px ${DISPLAY}`, "#fff", tw);
    text(mapLine, tx, ty + 86, `600 19px ${BODY}`, C.ink2, tw);
    if (s.extra) text(s.extra, tx, ty + 120, `800 28px ${DISPLAY}`, C.accent, tw);
  }

  // rule chips (two rows at most)
  let cx = PAD;
  let cy = 338;
  for (const f of factChips(d)) {
    c.font = `600 19px ${BODY}`;
    const w = c.measureText(f.text).width + 62;
    if (cx + w > W - PAD) {
      if (cy > 338) break;
      cx = PAD;
      cy += 46;
    }
    rr(c, cx, cy, w, 38, 6);
    c.fillStyle = C.s2;
    c.fill();
    c.strokeStyle = C.rule;
    c.lineWidth = 1.5;
    c.stroke();
    sprite(f.fam ?? "ui", f.icon, cx + 6, cy + 5, 28);
    text(f.text, cx + 42, cy + 26, `600 19px ${BODY}`, "#fff");
    cx += w + 10;
  }

  // rosters: every tower in game order (banned dimmed and crossed, limit badge, upgrade caps), then the hero rule
  const towers = d._towers ?? [];
  const by = new Map(towers.filter((t) => !t.isHero).map((t) => [t.tower as string, t]));
  const T = 60;
  const tile = (fam: "tower" | "hero", id: string, x0: number, y: number, max = 99, caps?: string) => {
    const ban = max === 0;
    const cat = fam === "hero" ? "Hero" : CATEGORY.get(id);
    c.globalAlpha = ban ? 0.28 : 1;
    if (cat) sprite("container", cat, x0, y, T);
    sprite(fam, id, x0 + T * 0.115, y + T * 0.115, T * 0.77);
    c.globalAlpha = 1;
    if (ban) {
      c.strokeStyle = C.ban;
      c.lineWidth = 4;
      c.beginPath();
      c.moveTo(x0 + 8, y + T - 8);
      c.lineTo(x0 + T - 8, y + 8);
      c.stroke();
    }
    if (max > 0 && max < 99) {
      c.fillStyle = "#1f8bff";
      c.strokeStyle = "#06234a";
      c.lineWidth = 3;
      c.beginPath();
      c.arc(x0 + 6, y + 6, 13, 0, 7);
      c.fill();
      c.stroke();
      c.textAlign = "center";
      text(String(max), x0 + 6, y + 13, `800 20px ${DISPLAY}`, "#fff");
      c.textAlign = "start";
    }
    if (caps) {
      c.textAlign = "center";
      c.lineWidth = 4;
      c.strokeStyle = "#000";
      c.font = `800 19px ${DISPLAY}`;
      c.strokeText(caps, x0 + T / 2, y + T - 3);
      text(caps, x0 + T / 2, y + T - 3, `800 19px ${DISPLAY}`, "#ff3b2f");
      c.textAlign = "start";
    }
  };
  const ry = 430;
  inOrder(TOWER_ORDER, by.keys()).forEach((id, i) => {
    const t = by.get(id);
    const k = t ? tierCaps(t).c.join("-") : "";
    tile("tower", id, PAD + (i % 13) * (T + 8), ry + Math.floor(i / 13) * (T + 8), t ? t.max : 0, k && k !== "5-5-5" ? k : undefined);
  });
  const hx = PAD + 13 * (T + 8) + 22;
  text("HERO", hx, ry + 14, `800 22px ${DISPLAY}`, C.ink3);
  const hs = heroCells(towers);
  hs.slice(0, 6).forEach((h, i) => (hs.length === 1 ? sprite("hero", h.id, hx, ry + 26, 64) : tile("hero", h.id, hx + (i % 3) * 56, ry + 26 + Math.floor(i / 3) * 56, 99)));
  if (hs.length === 1) text(hs[0].name, hx + 74, ry + 66, `800 28px ${DISPLAY}`, "#fff", W - PAD - hx - 74);

  // footer
  c.fillStyle = C.rule;
  c.fillRect(PAD, 584, W - 2 * PAD, 2);
  text("btd6data.com", PAD, 616, `800 28px ${DISPLAY}`, C.accent);
  text(s.path, PAD + 158, 614, `600 17px ${BODY}`, C.ink2, 520);
  c.textAlign = "right";
  text("Unofficial fan site · Art © Ninja Kiwi", W - PAD, 614, `600 16px ${BODY}`, C.ink3);
  c.textAlign = "start";

  return new Promise((done) => {
    try {
      cv.toBlob((b) => done(b), "image/png");
    } catch {
      done(null);
    }
  });
}

/** The "Share" button under an event's dates; opens a dialog with the card and share / copy / download. */
export function ShareButton(p: { spec: CardSpec | undefined }) {
  const [open, setOpen] = useState(false);
  const [pic, setPic] = useState<{ blob: Blob; url: string } | null>(null);
  const [state, setState] = useState("");
  const ref = useRef<HTMLDialogElement>(null);
  const spec = p.spec;
  const name = spec?.title.replace(/[^\w #-]+/g, "").trim() || "btd6-event";
  const file = pic && new File([pic.blob], `${name}.png`, { type: "image/png" });
  useEffect(() => {
    if (!open || !spec) return;
    let live = true;
    let url = "";
    setState("");
    void drawCard(spec).then((blob) => {
      if (!live) return;
      if (blob) setPic({ blob, url: (url = URL.createObjectURL(blob)) });
      else setState("Could not draw the card");
    });
    return () => {
      live = false;
      setPic(null);
      if (url) URL.revokeObjectURL(url);
    };
  }, [open]);
  useEffect(() => {
    const d = ref.current;
    if (open && d && !d.open) d.showModal();
  }, [open]);
  if (!spec) return null;
  const close = () => setOpen(false);
  const canShare = !!file && !!navigator.canShare?.({ files: [file] });
  const canCopy = typeof ClipboardItem !== "undefined" && !!navigator.clipboard?.write;
  return (
    <>
      <button type="button" class="share-btn" onClick={() => setOpen(true)}>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <circle cx="18" cy="5" r="3" />
          <circle cx="6" cy="12" r="3" />
          <circle cx="18" cy="19" r="3" />
          <path d="m8.6 13.5 6.8 4M15.4 6.5l-6.8 4" />
        </svg>
        Share
      </button>
      {open && (
        <dialog
          ref={ref}
          class="share-dlg"
          aria-labelledby="share-h"
          onClose={close}
          onClick={(e) => {
            if (e.target === e.currentTarget) close(); // backdrop
          }}
        >
          <h2 id="share-h" class="share-h">
            Share {spec.title}
          </h2>
          {pic ? <img class="share-img" src={pic.url} width={W} height={H} alt={`Card for ${spec.title}`} /> : <div class="share-img share-wait">{state || "Drawing the card…"}</div>}
          <div class="share-acts">
            {canShare && (
              <button
                type="button"
                class="share-btn on"
                onClick={() => void navigator.share({ files: [file!], title: spec.title, url: location.href }).catch(() => {})}
              >
                Share
              </button>
            )}
            {pic && canCopy && (
              <button
                type="button"
                class="share-btn"
                onClick={() =>
                  navigator.clipboard.write([new ClipboardItem({ "image/png": pic.blob })]).then(
                    () => setState("Copied"),
                    () => setState("Copy failed"),
                  )
                }
              >
                {state === "Copied" ? "Copied" : "Copy image"}
              </button>
            )}
            {pic && (
              <a class="share-btn" href={pic.url} download={`${name}.png`}>
                Download PNG
              </a>
            )}
            <button type="button" class="share-btn" onClick={close}>
              Close
            </button>
          </div>
        </dialog>
      )}
    </>
  );
}
