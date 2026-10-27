// CT hex board: tile code → hex, checked against the game's own table and the captured tile lists.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { hexDist, tileHex } from "../web/src/ctMap.ts";

// NinjaKiwi.GUTS CtMapGenerator.TileCodes (v57 game code): code + grid (x, y), doubled rows.
const GAME =
  "MRX0,0 AAA0,-14 AAB0,-12 AAC0,-10 AAD0,-8 AAE0,-6 AAF0,-4 AAG0,-2 ABA1,-13 ABB1,-11 ABC1,-9 ABD1,-7 " +
  "ABE1,-5 ABF1,-3 ACA-1,-13 ACB-1,-11 ACC-1,-9 ACD-1,-7 ACE-1,-5 ADA2,-12 ADB2,-10 ADC2,-8 ADD2,-6 " +
  "AEA-2,-12 AEB-2,-10 AEC-2,-8 AFA3,-11 AFB3,-9 AGA-3,-11 BAA7,-7 BAB6,-6 BAC5,-5 BAD4,-4 BAE3,-3 " +
  "BAF2,-2 BAG1,-1 BBA7,-5 BBB6,-4 BBC5,-3 BBD4,-2 BBE3,-1 BBF2,0 BCA6,-8 BCB5,-7 BCC4,-6 BCD3,-5 " +
  "BCE2,-4 BDA7,-3 BDB6,-2 BDC5,-1 BDD4,0 BEA5,-9 BEB4,-8 BEC3,-7 BFA7,-1 BFB6,0 BGA4,-10 CAA7,7 " +
  "CAB6,6 CAC5,5 CAD4,4 CAE3,3 CAF2,2 CAG1,1 CBA6,8 CBB5,7 CBC4,6 CBD3,5 CBE2,4 CBF1,3 CCA7,5 CCB6,4 " +
  "CCC5,3 CCD4,2 CCE3,1 CDA5,9 CDB4,8 CDC3,7 CDD2,6 CEA7,3 CEB6,2 CEC5,1 CFA4,10 CFB3,9 CGA7,1 DAA0,14 " +
  "DAB0,12 DAC0,10 DAD0,8 DAE0,6 DAF0,4 DAG0,2 DBA-1,13 DBB-1,11 DBC-1,9 DBD-1,7 DBE-1,5 DBF-1,3 " +
  "DCA1,13 DCB1,11 DCC1,9 DCD1,7 DCE1,5 DDA-2,12 DDB-2,10 DDC-2,8 DDD-2,6 DEA2,12 DEB2,10 DEC2,8 " +
  "DFA-3,11 DFB-3,9 DGA3,11 EAA-7,7 EAB-6,6 EAC-5,5 EAD-4,4 EAE-3,3 EAF-2,2 EAG-1,1 EBA-7,5 EBB-6,4 " +
  "EBC-5,3 EBD-4,2 EBE-3,1 EBF-2,0 ECA-6,8 ECB-5,7 ECC-4,6 ECD-3,5 ECE-2,4 EDA-7,3 EDB-6,2 EDC-5,1 " +
  "EDD-4,0 EEA-5,9 EEB-4,8 EEC-3,7 EFA-7,1 EFB-6,0 EGA-4,10 FAA-7,-7 FAB-6,-6 FAC-5,-5 FAD-4,-4 " +
  "FAE-3,-3 FAF-2,-2 FAH-1,-1 FBA-6,-8 FBB-5,-7 FBC-4,-6 FBD-3,-5 FBE-2,-4 FBF-1,-3 FCA-7,-5 FCB-6,-4 " +
  "FCC-5,-3 FCD-4,-2 FCE-3,-1 FDA-5,-9 FDB-4,-8 FDC-3,-7 FDD-2,-6 FEA-7,-3 FEB-6,-2 FEC-5,-1 FFA-4,-10 " +
  "FFB-3,-9 FGA-7,-1";
const fixture = (id: string) =>
  JSON.parse(readFileSync(new URL(`../docs/api/fixtures/btd6__ct__${id}__tiles.json`, import.meta.url), "utf8")).body
    .tiles as { id: string; type: string }[];

describe("CT map", () => {
  it("matches the game's tile table for all 169 codes", () => {
    const rows = GAME.trim().split(" ");
    assert.equal(rows.length, 169);
    for (const row of rows) {
      const [x, y] = row.slice(3).split(",").map(Number);
      assert.deepEqual(tileHex(row.slice(0, 3)), { q: x, r: -(x + y) / 2 || 0 }, row);
    }
  });
  it("unknown codes have no hex", () => {
    for (const id of ["", "FAG", "AAH", "AGB", "GAA", "MRY", "aaa"]) assert.equal(tileHex(id), undefined, id);
  });
  for (const ct of ["mtv62zza", "muekp4st"]) {
    it(`${ct}: every tile maps to its own hex inside radius 7`, () => {
      const tiles = fixture(ct);
      assert.equal(tiles.length, 169);
      const seen = new Set<string>();
      for (const t of tiles) {
        const h = tileHex(t.id);
        assert.ok(h, t.id);
        assert.ok(hexDist(h, { q: 0, r: 0 }) <= 7, t.id);
        seen.add(`${h.q},${h.r}`);
      }
      assert.equal(seen.size, 169);
      assert.deepEqual(tileHex("MRX"), { q: 0, r: 0 });
      // team starts are the six corners; each team's three first-capture tiles touch its start
      for (const t of tiles.filter((t) => t.type === "TeamStart")) assert.equal(hexDist(tileHex(t.id)!, { q: 0, r: 0 }), 7);
      for (const t of tiles.filter((t) => t.type === "TeamFirstCapture"))
        assert.equal(hexDist(tileHex(t.id)!, tileHex(`${t.id[0]}AA`)!), 1, t.id);
    });
  }
});
