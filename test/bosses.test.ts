// Boss stats page: /bosses/<type> routing, event modifier maths, skull HP maths and the skull-action wording.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { BAR_EXTRA, bossMods, passiveLines, speedReference, speedVal, shieldHp, shieldLabel, effect, effects, modHealth, modSpeed, mult, NO_BOSS_MODS, sameEffects, skullRows, speedShare, spawnName, tierRatio, type BossStatsData } from "../web/src/bosses.ts";
import { BOSS_TYPES, href, needs, parse, setBossStatsUrl } from "../web/src/routes.ts";

const at = (p: string) => parse(new URL(p, "https://x.invalid"));
const data = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../web/src/data/bosses.json"), "utf8")) as BossStatsData;

describe("boss stats route", () => {
  it("parses /bosses/<type> with defaults and params", () => {
    assert.deepEqual(at("/bosses/lych"), { name: "bossstats", type: "lych", d: "standard", t: 5, mod: true });
    assert.deepEqual(at("/bosses/vortex?d=elite&t=3&ev=Vortex47_mu62cmt5&mod=0"), { name: "bossstats", type: "vortex", d: "elite", t: 3, ev: "Vortex47_mu62cmt5", mod: false });
    assert.equal((at("/bosses/lych?t=9") as { t: number }).t, 5);
    assert.equal((at("/bosses/lych?ev=a/b") as { ev?: string }).ev, undefined);
  });
  it("a bad type is not found; /bosses stays the list", () => {
    assert.equal(at("/bosses/nope").name, "notfound");
    assert.equal(at("/bosses/lych/extra").name, "notfound");
    assert.deepEqual(at("/bosses"), { name: "events", kind: "boss" });
    for (const t of BOSS_TYPES) assert.equal(at(`/bosses/${t}`).name, "bossstats");
  });
  it("formats only non-default values and round-trips", () => {
    assert.equal(href.bossstats("lych"), "/bosses/lych");
    const h = href.bossstats("dreadbloon", { d: "elite", t: 2, ev: "msi6n2qi", mod: false });
    assert.equal(h, "/bosses/dreadbloon?d=elite&t=2&ev=msi6n2qi&mod=0");
    assert.deepEqual(at(h), { name: "bossstats", type: "dreadbloon", d: "elite", t: 2, ev: "msi6n2qi", mod: false });
  });
  it("needs: the data file, the lists, and the event's ruleset when ev is set", () => {
    setBossStatsUrl("/assets/bosses-abc.json");
    assert.deepEqual(needs(at("/bosses/lych")), ["/assets/bosses-abc.json", "/btd6/bosses", "/api/history/boss?limit=50"]);
    assert.ok(needs(at("/bosses/lych?d=elite&ev=Lych30_abcd")).includes("/btd6/bosses/Lych30_abcd/metadata/elite"));
    setBossStatsUrl("");
  });
});

describe("modifier maths", () => {
  it("reads the boss multipliers, defaults to none", () => {
    assert.deepEqual(bossMods({ healthMultipliers: { boss: 1.25 }, bossSpeedMultiplier: 0.9 }), { health: 1.25, speed: 0.9 });
    assert.deepEqual(bossMods(undefined), NO_BOSS_MODS);
  });
  it("scales HP (whole HP) and speed", () => {
    assert.equal(modHealth(1_000_000, { health: 1.25, speed: 1 }), 1_250_000);
    assert.equal(modHealth(333, { health: 0.9, speed: 1 }), 300);
    assert.equal(modSpeed(2, { health: 1, speed: 0.9 }), 1.8);
    assert.equal(speedShare(1.25, 25), 0.05);
  });
  it("formats percentages like the rules panel", () => {
    assert.equal(mult(0.9), "90%");
    assert.equal(mult(1.25), "125%");
    assert.equal(mult(0.8333), "83.3%");
  });
  it("Elite / Normal T5 ratio", () => {
    assert.equal(tierRatio(300, 100), 3);
    assert.equal(tierRatio(250, 100), 2.5);
  });
});

describe("skull maths", () => {
  it("HP to each skull, shield on every stretch, and the last stretch to defeat", () => {
    const rows = skullRows(1_000_000, [
      { at: 0.75, do: [] },
      { at: 0.5, do: [] },
      { at: 0.25, do: [] },
    ], 400_000);
    assert.deepEqual(rows, [
      { n: 1, at: 0.75, hp: 250_000, shield: 400_000 },
      { n: 2, at: 0.5, hp: 250_000, shield: 400_000 },
      { n: 3, at: 0.25, hp: 250_000, shield: 400_000 },
      { n: 0, at: 0, hp: 250_000, shield: 400_000 },
    ]);
  });
  it("uses the modified HP", () => {
    const hp = modHealth(800_000, { health: 1.25, speed: 1 });
    assert.equal(skullRows(hp, [{ at: 0.5, do: [] }])[0].hp, 500_000);
  });
  it("every tier in the data has skulls descending, HP rising", () => {
    for (const b of Object.values(data.bosses)) {
      for (const tiers of [b.normal, b.elite]) {
        assert.equal(tiers.length, 5);
        tiers.forEach((t, i) => {
          if (i) assert.ok(t.health > tiers[i - 1].health);
          const r = skullRows(t.health, t.skulls);
          assert.ok(r.every((x) => x.hp > 0 && x.shield >= 0));
        });
      }
    }
  });
});

describe("skull action wording", () => {
  it("maps known names, drops animation / sound names", () => {
    assert.deepEqual(effect("AttkSpew"), { text: "Spews bloons" });
    assert.deepEqual(effect("InvulnOn"), effect("MakeInvulnerable"));
    assert.equal(effect("SkullAnim"), null);
    assert.equal(effect("PlayStunSound"), null);
    assert.equal(effect("InvulnerabilityDuration"), null);
  });
  it("dedupes Lych souls within a skull and keeps order", () => {
    const fx = effects(["EtherealAnim", "SpeedDown", "SpawnLychSoul1", "SpawnLychSoul2", "SpawnLychSoul5", "SkullDelay"]);
    assert.deepEqual(fx.map((e) => e.text), ["Ethereal phase", "Slows down", "Spawns Lych souls"]);
  });
  it("unknown names become words with an internal-name flag", () => {
    assert.deepEqual(effect("SomeNewThing"), { text: "Some new thing", internal: true });
    assert.deepEqual(effect("RockTimer"), { text: "Rock timer" });
  });
  it("sameEffects: identical skulls collapse, differing ones don't", () => {
    assert.equal(sameEffects([{ at: 0.5, do: ["AttkSpew"] }, { at: 0.25, do: ["AttkSpew", "SkullAnim"] }]), true);
    assert.equal(sameEffects([{ at: 0.5, do: ["AttkSpew"] }, { at: 0.25, do: ["Fireball"] }]), false);
  });
  it("every action name in the data is mapped or dropped (none falls back)", () => {
    const unknown = new Set<string>();
    for (const b of Object.values(data.bosses)) {
      for (const t of [...b.normal, ...b.elite]) for (const a of [...t.skulls, ...t.triggers]) for (const n of a.do) if (effect(n)?.internal) unknown.add(n);
    }
    assert.deepEqual([...unknown], []);
  });
  it("spawn names come from the UI table (the data has none)", () => {
    assert.equal(spawnName({ key: "MiniLych", name: null }), "Lych soul");
    assert.equal(spawnName({ key: "DreadRockBloon", name: null }), "Rock bloon");
  });
});

describe("immunity per stretch", () => {
  it("every tier with immunity has skulls + 1 entries, each with an icon key", () => {
    const manifest = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../web/src/art/manifest.json"), "utf8")) as { families: Record<string, { keys: string[] }> };
    const keys = new Set(manifest.families.boss.keys);
    let n = 0;
    for (const b of Object.values(data.bosses)) {
      for (const t of [...b.normal, ...b.elite]) {
        if (!t.immunity) continue;
        n++;
        assert.equal(t.immunity.length, t.skulls.length + 1, t.id);
        for (const s of t.immunity) assert.ok(keys.has(`immunity:${s}`), s);
      }
    }
    assert.ok(n > 0);
  });
});

describe("shield line and boss bar art", () => {
  it("shield HP follows the event health modifier like the boss HP", () => {
    const dread = data.bosses.dreadbloon.normal.find((t) => t.shield?.health === 500000)!.shield!;
    assert.equal(shieldLabel(dread), "Ceramic Armor Shell");
    assert.equal(shieldHp(dread, NO_BOSS_MODS), 500000);
    assert.equal(shieldHp(dread, { health: 1.5, speed: 1 }), 750000);
    const phayze = data.bosses.phayze.normal.find((t) => t.shield?.health === 362500)!.shield!;
    assert.equal(shieldLabel(phayze), "Reality Shield");
    assert.equal(shieldHp(phayze, { health: 0.5, speed: 1 }), 181250);
  });
  it("only Dreadbloon and Phayze tiers carry a shield, rebuilt per skull", () => {
    for (const [type, b] of Object.entries(data.bosses)) {
      for (const t of [...b.normal, ...b.elite]) {
        assert.equal(!!t.shield, type === "dreadbloon" || type === "phayze", `${type} ${t.id}`);
        if (t.shield) assert.equal(t.shield.per, "skull");
      }
    }
  });
  it("every boss has its HUD icons and extra gauge pieces in the art manifest", () => {
    const art = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../web/src/art/manifest.json"), "utf8")) as {
      bossBar: { parts: Record<string, unknown>; hud: Record<string, { file: string; w: number; h: number }> };
    };
    for (const type of Object.keys(data.bosses)) {
      for (const k of [`hud:${type}`, `hud:elite:${type}`]) assert.ok(art.bossBar.hud[k]?.file && art.bossBar.hud[k].w > 0, k);
      const x = BAR_EXTRA[type];
      const need = x === "armour" ? [`armour:${type}:fill`, `armour:${type}:edge`] : x === "heat" ? ["heat:fill", "heat:frame", "bar:heatGauge"] : x === "tail" ? ["tail:fill", "tail:frame", "bar:tailOn"] : [];
      for (const k of need) assert.ok(art.bossBar.parts[k], `${type}: ${k}`);
    }
    for (const k of ["hp:frame", "hp:fill", "hp:bg", "marker:skull", "marker:line", "hud"]) assert.ok(art.bossBar.parts[k], k);
  });
});

const tierOf = (type: string, n = 3) => data.bosses[type].normal[n - 1];
const lines = (type: string, n = 3) => passiveLines(tierOf(type, n)).map((l) => l.text);

describe("always-active wording", () => {
  it("Bloonarius: every 1% of health lost, bleed + the decoded WeakerSpawn count and bloon", () => {
    assert.deepEqual(lines("bloonarius"), ["Every 1% of health lost: bleed attack · spawns 25 Pink"]);
    assert.equal(tierOf("bloonarius").triggers.length, 0);
  });
  it("timers: seconds, 'also at spawn', the wait in seconds", () => {
    assert.deepEqual(lines("vortex"), ["Every 5 s: storm pulse destroys projectiles"]);
    assert.deepEqual(lines("phayze").slice(0, 2), [
      "Every 24 s, also at spawn: Radar Jam, Camo-seeing buffs off for 12 s",
      "Every 24 s: pulls Bloons to Phayze and gives them Camo",
    ]);
    assert.ok(lines("blastapopoulos").includes("Every 2 s: burns off damage-over-time effects"));
    assert.deepEqual(lines("lych").slice(0, 3), ["Every 12 s: drain, first after 2 s", "Every 9 s: regrow, first after 2 s", "Every 18 s: tombstone, first after 10 s"]);
  });
  it("stat lines: damage reduction, shield speed, heat limit, segments, tombstone HP", () => {
    assert.deepEqual(lines("dreadbloon"), ["Takes 1 less damage from every hit"]);
    assert.ok(passiveLines({ passives: [{ kind: "damageReduction", amount: 0 }] }).some((l) => l.text === "No damage reduction"));
    assert.ok(lines("phayze").includes("140% speed while the Reality Shield is up"));
    assert.ok(lines("blastapopoulos").includes("Heat limit 30,000"));
    assert.deepEqual(lines("diamondback"), ["5 middle segments"]);
    assert.ok(lines("lych").includes("Tombstone HP 17,600"));
  });
  it("only whitelisted numbers render: unknown fields and kinds never show", () => {
    const out = passiveLines({
      passives: [
        { kind: "heat", maxHeatLevel: 30000, stunDuration: 4, heatPercents: 777, damagedHeat: 555 },
        { kind: "speedBoost", speedBoost: 2.5, debuffInRadius: 40 },
        { kind: "rangeZone", rangeMultiplier: -0.08 },
        { kind: "timer", seconds: 7, do: ["DestroyProjectiles"], radius: 987654 },
        { kind: "brandNew", amount: 31337 },
      ],
      actions: { DestroyProjectiles: [{ model: "DestroyProjectiles", radius: 60, ignorePowerProjectiles: true }] },
    }).map((l) => l.text);
    assert.deepEqual(out, ["Every 7 s: storm pulse destroys projectiles", "Heat limit 30,000"]);
  });
  it("skull spawns carry count + bloon; unmodelled ones are never mentioned", () => {
    const b = tierOf("bloonarius");
    assert.ok(effects(b.skulls[0].do, b).some((e) => /^Spawns \d+ /.test(e.text)));
    const l = tierOf("lych", 1);
    const fx = effects(l.skulls[l.skulls.length - 1].do, l).map((e) => e.text);
    assert.ok(fx.some((t) => /^Spawns \d+ Lych souls?$/.test(t)));
    assert.ok(!fx.includes("Spawns Lych souls"));
    assert.deepEqual(effects(["SpawnLychSoul3"], { actions: {}, noModel: ["SpawnLychSoul3"] }), []);
  });
  it("every boss tier yields no internal-name fallbacks in its passives except unknown actions", () => {
    for (const b of Object.values(data.bosses)) for (const t of [...b.normal, ...b.elite]) for (const l of passiveLines(t)) assert.ok(l.text.length > 0);
  });
});

describe("speed", () => {
  it("reference line groups equal speeds, from the data", () => {
    assert.equal(speedReference(data.speed), "Speed in the game's units: Red and MOAB 25 · BFB 6.25 · ZOMG and BAD 4.5");
    assert.equal(speedVal(1.25), "1.25");
  });
});

describe("stun wording (seconds + radius, owner-confirmed)", () => {
  it("Vortex skull stun has its tier's radius and seconds; Blastapopoulos fireball its seconds", () => {
    const v = data.bosses.vortex.normal[4];
    const vt = effects(v.skulls[0].do, { actions: v.actions }).map((e) => e.text);
    const st = (v.actions!.StunTowers as unknown as { radius: number; stunDuration: number }[])[0];
    assert.ok(vt.includes(`Stuns towers within radius ${st.radius} for ${st.stunDuration} s`), vt.join(" | "));
    const b = data.bosses.blastapopoulos.elite[4];
    const bt = effects(b.skulls[0].do, { actions: b.actions }).map((e) => e.text);
    const fb = (b.actions!.Fireball as unknown as { stunDuration: number }[])[0];
    assert.ok(bt.includes(`Fireball: stuns its target tower for ${fb.stunDuration} s`), bt.join(" | "));
  });
});

describe("speed comparison and identical stretches", () => {
  it("compares a boss speed with the reference bloons, from the data", async () => {
    const { speedCompare, commonStretch } = await import("../web/src/bosses.ts");
    assert.equal(speedCompare(4.2, data.speed), "slower than ZOMG and BAD (4.5)");
    assert.equal(speedCompare(4.5, data.speed), "same speed as ZOMG and BAD (4.5)");
    assert.equal(speedCompare(10, data.speed), "between BFB (6.25) and Red and MOAB (25)");
    assert.equal(speedCompare(30, data.speed), "faster than Red and MOAB (25)");
    const row = (hp: number, shield = 0) => ({ n: 1, at: 0.5, hp, shield });
    assert.deepEqual(commonStretch([row(10, 2), row(10, 2)]), { row: row(10, 2), approx: false });
    assert.deepEqual(commonStretch([row(4_000_800), row(3_998_400)]), { row: row(4_000_800), approx: true });
    assert.equal(commonStretch([row(10), row(11)]), null);
    assert.equal(commonStretch([row(10)]), null);
  });
});
