# Non-farm income / discount / hero / Monkey Knowledge rules (from Cpp2IL ISIL dump)

Paths are relative to `.../isil/IsilDump/Assembly-CSharp/Assets/Scripts/`. "+N" = byte offset in the object. Field names are the Model `.ctor`
parameter names (Models/...Model.txt) matched to the stores; offsets are my reading of the asm (high confidence unless marked "?").
Numeric VALUES (cash amounts, percentages, costs) are never in code: "value in model data (field X)".

Float constants resolved from GameAssembly.dll (VA - 0x180000000): 0x183E4FC30 = 1.0, 0x183E4FC28 = 0.5, 0x183E4FC70 = -1.0,
0x183E4FC50 = 60.0 (seconds -> frames), 0x183E4FD10 = 1.4e-45 (epsilon, "distance == 0"), 0x183E4FE8C = FLT_MAX.
Unresolved: callee 0x180521800 (see C5 rounding), CashType / CashSource enum numbering (enum defs not in the dump).

Cash entry points: `Simulation.AddCash(double c, CashType from, int cashIndex, CashSource source, Tower tower=null, bool cashDoubleable=false)` and
`AddSharedCash(double c, CashType from, CashSource source, Tower tower=null, bool cashDoubleable=true)` (Simulation/Simulation.txt).
AddCash first offers c to every `ImfLoanCollection` sim behaviour (when `from > 4`, owner index must match; virtual call may reduce c = loan repayment),
then if c > 0 adds it to the cash manager. An `addsd c,c` (c*2) sits in a branch whose condition I could not read (likely `cashDoubleable` + a double-cash mode).
Income is float -> double; no rounding of income anywhere below.

---------------------------------------------------------------------------------------------------------------
## A. Per-round cash and XP from towers

### A1. PerRoundCashBonusTower  (Simulation/Towers/Behaviors/PerRoundCashBonusTower.txt: OnRoundComplete)
- Model: `cashPerRound`(+40), `cashRoundBonusMultiplier`(+44), `lifespan`(+48), `assetId`(+56), `distributeCash`(+64 bool).
- WHEN: each round end (roundArrayIndex is 0-based).
- FORMULA: `x = (roundArrayIndex+1) * cashRoundBonusMultiplier + cashPerRound; if x <= 0 -> nothing;`
  `distributeCash ? AddSharedCash(x) : AddCash(x, owner=tower.owner)`; then `tower.cashEarnedStat(+0x170) += x`. (Shared: popup shows x / inputManagerCount.)
  So the bonus grows linearly with the 1-based round number.
- Modifiers: TradeEmpireBuffMutator adds to cashPerRound (A3); knowledge CashPerRoundModModel adds `additionalMoney` (G).
- Rounding: none. Owner tower: unknown from code, see model export. OPEN: values.

### A2. MerchantShip  (MerchantShip.txt)
- Marker only (Initialise/UpdatedModel, no income logic; `MerchantShipModel(name)` has no fields). Its income comes from a PerRoundCashBonusTower (A1) boosted by A3.

### A3. TradeEmpireBuff + TradeEmpireBuffMutator  (TradeEmpireBuff.txt: Process, UpdateMutators, GetMatchingTradeEmpireCount; TradeEmpireBuffMutator.txt: Mutate)
- Model: `cashPerRoundPerMechantship`(+64), `cashPerRoundPerFavouredTrades`(+68), `maxMerchantmanCapBonus`(+72), buffLocsName, buffIconName, `isGlobalRange`, `damageBuff`, `ceramicDamageBuff`, `moabDamageBuff`, `mutatorId`.
- FORMULA (reading of UpdateMutators, medium confidence): `n = GetMatchingTradeEmpireCount()` (other Trade Empire buffs in range); ships in range (MerchantShip) are
  filtered/sorted by lambdas then `Take(maxMerchantmanCapBonus * n)`; `cashBonus = |favoured ships| * cashPerRoundPerFavouredTrades + |ships| * cashPerRoundPerMechantship`.
  Mutator.Mutate: for each `PerRoundCashBonusTowerModel` of the target tower model `cashPerRound += cashBonus`; also inserts "Trade Empire Ceramic/Moabs Damage Buff" DamageModifierForTagModel into projectiles. Mutator priority +52 = 999.
- Stacking: additive onto cashPerRound. OPEN: the ordering key and the "favoured" test (lambdas not decoded). Owner: Trade Empire upgrade of the ship tower; tower id unknown from code.

### A4. CashPerTowerInMakeshiftArea  (Simulation/Towers/Behaviors/CashPerTowerInMakeshiftArea.txt: OnRoundComplete)
- Model: `cashAmount`(+40 int), `cashTxtAssetId`(+48), `assetLifespan`(+56).
- WHEN: round end. FORMULA: `n = number of towers (TowerManager.GetTowers, any owner? no owner test seen) whose placement area id matches this tower's makeshift area set`; `AddCash(n*cashAmount, tower.owner)`; stat += same. No cap. Owner: unknown from code.

### A5. HeroXpPerRound  (HeroXpPerRound.txt: OnRoundComplete) - XP not cash
- Model `additionalXpPerRound`(+40). `xp = additionalXpPerRound * (hero scale at behaviour model +40)`; applied only if the Hero exists, hero tower not destroyed (+188), a sim flag (+720) clear, hero.isActive(+112);
  `hero.xp(+120) += xp*hero.scale(+128)` and `hero.totalXp(+124) += same`, then `Hero.CheckForLevelUp`. Level curve: repo heroXp.ts. Knowledge: HeroXpPerRoundModModel, TowerXpModModel (G).

---------------------------------------------------------------------------------------------------------------
## B. Bloon-worth modifiers and projectile cash

DistributeCashModel (Models/Bloons/Behaviors/DistributeCashModel) ctor: `cash`(+40), `additionalCash`(+52), `multiplier`(+44), `additive`(+48), `giveNoCash`(+56).
B1-B3 mutate every DistributeCashModel of the BloonModel (pop payout lives in Simulation/Bloons/Behaviors/DistributeCash.txt - not mine).

### B1. BonusCashZone + Mutator  (BonusCashZone.txt, BonusCashZone_NestedType_Mutator.txt: Mutate)
- Model: `multiplier`(+40), `stackName`(+48), `groupName`(+56), `stackLimit`(+64). The zone puts a Mutator(`isUnique, mutationId, multiplier`) on bloons in its range (GetRange = tower range, FilterBloon = always true, removed on leave).
- FORMULA: `dist.multiplier += (zone.multiplier - 1.0)`. Delta-additive: two x1.1 = x1.2.
- Stacking cap by stackName/stackLimit is in the generic mutator machinery (not decoded). Owner: unknown from code.

### B2. CashIncrease + BloonWorthMutator  (CashIncrease.txt, CashIncrease_NestedType_BloonWorthMutator.txt)
- Model `increase`(+40), `multiplier`(+44). Mutator id string "Village Cash Modifier" (so a Village upgrade; tier = model export).
- WHEN: `OnBloonDamaged(bloon, amount)` -> tower adds the mutator to the bloon (guarded by a field on the bloon model: `[bloonModel+392][+28] > 0`, meaning unknown).
- FORMULA: `dist.multiplier += (multiplier - 1.0); dist.additive += increase`. `GetCashIncrease()` returns `increase`.

### B3. Syphon  (Models/Towers/Behaviors/SyphonModel*, Simulation/.../Syphon.txt OnBloonCreate; Abilities/SyphonFunding)
- SyphonModel: mutationId, `multiplier`(+56), `charges`(+60), `lifespan`(+64; frames = lifespan*60), ignoreTags, overlayType. Mutate: `dist.multiplier += (multiplier - 1.0)`.
  `SyphonFundingModel(name, lifespan)` (+40, frames +44). By class name = hero ability "Syphon Funding" (hero id not in code).

### B4. Projectile cash helpers
- DepletionToCash: `minimum`(+48), `maximum`(+52), `salvage`(+56). `amount = min + (max-min)*0.5` (midpoint, deterministic). Pickup: `AddSharedCash(amount)`, projectile destroyed. OnDestroy uncollected: if salvage > 0 `AddSharedCash(amount*salvage)`.
- AddCashOnProjectileExpire: `cashToAdd`(+48 int). On Exhausted: `AddCash(cashToAdd, projectile owner)`, tower stat += cashToAdd. No multiplier.
- CashModel (projectile): `minimum`(+48), `maximum`(+52), `bonusMultiplier`(+56), `salvage`(+60); payout code in Projectiles/Behaviors/Cash.txt (farm agent).
- Owners: unknown from code, see model export.

### B5. CashBoost ability + CashBoostMutator  (Abilities/Behaviors/CashBoost.txt, CashBoostMutator.txt)
- Model: `lifespanFrames`(+40), `multiplier`(+44), `range`(+48), `filterTower`(+56).
- Activate creates a range zone around the ability tower; TowerEnter/TowerExit add/remove the mutator (incl. sub-towers); Process destroys it when `simTime > lifespanFrames + startTime`.
  CanUseAbility needs >= 1 tower in range with baseId == literal "BananaFarm".
- Mutate applies only to TowerModels with `baseId == filterTower` and `tiers[1] <= 2 && tiers[2] <= 2`. FORMULA: every projectile CashModel `minimum *= multiplier; maximum *= multiplier` (+48,+52). bonusMultiplier untouched.
- Owner: unknown from code (a temporary farm-payout boost).

### B6. CashPerTowerInRange ability  (Abilities/Behaviors/CashPerTowerInRange.txt: Activate, OnBadPopped, OnBossSkull, CanUseAbility)
- Model: `towerIds[]`(+40), `baseCash`(+48), `extraCashPerTier[]`(+56), `rangeIncrease`(+64), `maxCashGeneration`(+68), `badPopMultiplier`(+84), `bossSkullMultiplier`(+88), textAssetId, textLifespan.
- Activate: range = parent tower range + rangeIncrease; `cash = baseCash + SUM over towers in range with baseId in towerIds of extraCashPerTier[thatTower.tier(+100)]`;
  `cash = min(cash, maxCashGeneration) * mult(+112)`; `AddCash(cash)`; stat += cash; `mult := 1.0`.
- `mult` is set by events: OnBadPopped -> `mult = isBoss ? bossSkullMultiplier(+88) : badPopMultiplier(+84)` when non-zero, then triggers the ability; OnBossSkull -> `mult = bossSkullMultiplier`.
  (So bad pops / boss skulls scale or fire it.) Owner: unknown from code. Also referenced from MonkeyCityIncomeSupport and PrimordialWrath mutators (farm agent).

### B7. PrimordialWrath = cash SINK  (PrimordialWrath.txt: Process)
- Model `cashPerSecondMin`(+84 int), `cashPerSecondMax`(+88 int), `depletionPercent`(+224). While active, every 60 ticks: `drain = clamp(ownerCash*depletionPercent, min, max); RemoveCash(drain)`; if ownerCash < min the ability ends.
  MutatorCashGen (5200 asm lines) not decoded. Spending cash for damage; ignore for income.

### B8. DamageModifierForCashAmount: damage buff only while `owner cash >= cashThreshold(+56)` (fields damageMultiplier +48, damageAdditive +52, stackId +64). Not income.

### B9. BountyHunterZone (BountyHunterZone.txt + BountyHunterZoneModel nested mutator): mutator targets TowerModel "Desperado" (string); no cash maths in these files. Support buff only.

---------------------------------------------------------------------------------------------------------------
## C. Costs and discounts  (Simulation/Towers/TowerManager.txt: GetTowerCost, GetTowerUpgradeCost, GetZoneDiscount, GetDiscountMultiplier, GetAreaDiscount)

### C1. DiscountZone model (Simulation/Towers/Behaviors/DiscountZone.txt only has the placement-preview TestPlacementTowerBuff; the maths is in TowerManager)
`discountMultiplier`(+64 float; fraction off, value in model data), `stackLimit`(+68), `stackName`(+72), `affectSelf`(+80), `tierCap`(+84), `tierMin`(+88), buffLocsName, buffIconName,
`towerBaseIds`(+96 -> string[] +104), `upgradeId`(+120), `dontAffectOthersInCoop`(+128), `isGlobal`(+129), `isBuffFromArea`(+112?). Zone range = the zone tower's `towerModel.range`(+92).

### C2. GetZoneDiscount(towerModel, position, path, tier, owner, upgradeName) -> Dictionary<stackName, List<DiscountZone>>
Clears the dictionary lists, then for EVERY DiscountZone behaviour in the sim (all owners) skip it when:
1. its tower is destroyed/sold (tower+188);
2. `!isGlobal` and `distance(zoneTower, position) > range` (squared compare); distance ~0 (epsilon) counts only if `affectSelf`;
3. `path > -1` (upgrade) and `tierCap > 0 && tier > tierCap`;
4. `tier < tierMin` (placement passes path=-1, tier 0);
5. `dontAffectOthersInCoop` and `zoneTower.owner != owner`;
6. `upgradeId` non-empty and `!= upgradeName`;
7. `towerBaseIds` non-empty and not containing `towerModel.baseId`.
Survivors go into `dict[stackName]`. Per list: sort ascending by `model.discountMultiplier` (lambda `<GetZoneDiscount>b__6_0` = float CompareTo), Reverse (descending), `limit = list[0].model.stackLimit`,
`if Count > limit: RemoveRange(limit, Count - limit)`. => per stackName only the best `stackLimit` zones survive (limit taken from the strongest zone); different stack names do not compete.

### C3. GetDiscountMultiplier(dict) = SUM over all stackNames, over all kept zones, of `zone.model.discountMultiplier`. Different stack names ADD; same name = top-N by size.

### C4. GetAreaDiscount(pos) = SUM of `PriceAreaBuffModel`(+72) over the map area buffs at that point (Map.GetAreaAtPoint). Additive with C3. Value in map data.

### C5. Tower price (GetTowerCost(model, position, TowerInventory ti, owner))
```
if ti.IsFreeTowerAvailable(model): price 0 (UseFreeTowerCharge on placement)
(invMult, invFlat) = ti.GetTowerDiscount(model, useCharge)   # SUM entry.multiplier(+36), SUM entry.directValueChange(+40); each use decrements entry.charges(+32)
simSum = SUM over sim behaviours (vtbl +776) of their placement discount for (model, owner)   # e.g. FirstPlacedTowerDiscount returns model.discount(+40)
disc   = area(C4) + zones(C3) + invMult + simSum
price  = max(0, (1 - disc) * (towerModel.cost(+88) - invFlat))
return RoundToNearestInt(price, 5)?    # callee 0x180521800 with arg 5 (unresolved); Simulation/SMath/Math.RoundToNearestInt(value, n) = (int)(Round(value/n) * n)
```
Discounts are ADDED inside one `(1 - sum)` factor; they are not multiplied together; flat reductions come off the base first.

### C6. Upgrade price (GetTowerUpgradeCost(tower, path, tier, overrideBaseCost=-1, isParagon=false)) - partially decoded
- base from the upgrade model (or override), passed through TowerUpgradeLock-type behaviours (virtual may replace it); `GetFreeUpgrade` -> free flag.
- `disc = zones(GetZoneDiscount(model, pos, path, tier, owner, upgradeName)) + area + Simulation.GetSimulationBehaviorDiscount(tower, path, tier, currentDiscount)`.
- `price = notFree * base * (1 - disc)`; then for heroes a per-tier multiplier read from an array; Rogue `ArtifactBase.GetDiscount` multipliers (multiplicative); Sandbox mode special-cased; clamp to >= 0; then the same RoundToNearestInt(...,5)? step.
- Paragon: when no paragon upgrade exists returns FLT_MAX. Not decoded further.

### C7. MonkeyopolisUpgradeCost  (Simulation/Towers/Behaviors/MonkeyopolisUpgradeCost.txt: GetUpgradeCost, IsUpgradeBlocked, GetUpgradeBlockId, GetMaxTierForPath)
- Model: `costPerFarm`(+40), `path`(+44), `towerFilter`(+48).
- `GetUpgradeCost(baseCost, path, tier)`: if `path == model.path`: `N = count of towers within this tower's range, same owner, baseId == towerFilter, towerModel.tier(+100) >= 5`; `cost = N * costPerFarm`; else baseCost. IsUpgradeBlocked: blocked when N == 0 (block id string "MonkeyVillageRequirement"). GetMaxTierForPath = 0x3B9AC9FF (no cap).
- Owner / filter tower id: model data. OPEN: where this cost enters GetTowerUpgradeCost relative to the discount factor.

### C8. Sale value  (TowerManager.TransformSellAmount(tower) -> sell fraction; SellTower pays fraction * tower.SaleValue) - partially decoded
- Base fraction = `gameModel.(+60)`; if the computed value ends at 0 the base is returned.
- SellIncreaseZone (model: `sellMultiplier`(+72), filters, towerBaseIds; keyed by a stack key at +48): zones in range (dist^2 <= range^2, CheckBehavior ok) -> per key take the MAX; keys then SUMMED.
- CashbackZone (`cashbackZoneMultiplier`(+64), `cashbackMaxPercent`(+68), `groupName`, `maxStacks`(+80), `baseIds`; skipped when game-mode string == "Clicks"): per groupName accumulate `cashbackZoneMultiplier` for each zone in range while `stacks < maxStacks`, tracked max `cashbackMaxPercent`; groups summed. (Preview: CashbackZone.TestPlacementTowerBuff.)
- WorthReduction behaviours: subtract SUM(model.(+40)).
- IncreaseTowerWorthOverRounds.GetWorthMultiplier(currentRound, startedCountingAtRound): compounded `PRODUCT (1 + bracketNPercentPerRound)^(rounds in bracket N)`; fields `bracket1PercentPerRound`(+40), `bracket2PercentPerRound`(+44), `bracket3PercentPerRound`(+48), `bracket2Round`(+52), `bracket3Round`(+56);
  used as `v += (worthMult - 1) * v`; start round comes from Geraldo shop item "RareQuincyActionFigure" (string in code) if owned.
- Final cap: value limited to a tracked max (the largest cashback max), then `- sum(worth reductions)`. OPEN: exact ordering/caps.

---------------------------------------------------------------------------------------------------------------
## D. Powers
- CashDrop (Simulation/Powers/CashDrop.txt): Activate spawns `CashDropModel.projectileModel` at the location (terrain height); cash = that projectile's cash behaviour (CashModel / DepletionToCash / AddCashOnProjectileExpire). Amount: model data.
- SimPowerDiscount (SimulationBehaviors/SimPowerDiscount, Models/Powers/Mods/SimPowerDiscountModModel) -> PowerInventory.AddPowerDiscount(name, powers[], charges, multiplier, subtraction); PowerInventory.GetPowerCost applies multiplier+flat like towers. Powers cost cash? only in modes that price them; not traced.

## E. Heroes
- No hero-specific cash branch in Simulation except: Syphon / SyphonFunding (B3), IncreaseTowerWorthOverRounds (C8), hero XP classes (HeroXpPerRound A5, HeroXPBonus, HeroXpInjection, HeroXpScaleSupport, ScaleHeroXpWithTowerCount(towerIds, tier, percentPerTower, maxPercent)), Biohack (damage).
- Hero level gating is NOT in code: a hero is a TowerModel whose level-ups are upgrade models that add behaviours, so "which cash behaviour exists at hero level N" = hero tower model data.
- Hero price = GetTowerCost (C5); knowledge/mods that touch it: SimTowerDiscountModModel(tower, useAllHeroes), HeroCostToLevelModModel.

## F. Sim-level behaviours (started by game mods)
- BonusCashPerRound: OnRoundEnd -> `AddSharedCash(GetCashForRound(i), type ?, source 3)`, `GetCashForRound(i) = (i+1) * roundMultiple(+40) + baseCash(+44)`.
- AwardCashOnRound: OnRoundEnd when `roundArrayIndex + 2 == round(+40)` -> `AddSharedCash(cash(+44), type 6, source 10)`; PerformAction pays once.
- FirstPlacedTowerDiscount.GetTowerPlacementDiscount(model, owner) = `discount(+40)` when `FirstPlacedTowerDiscountModel.CheckTower` passes -> enters C5 simSum.
- IncreaseBloonWorthSimBehavior / Thrive power: bloon worth boost; HeroXPBonus, HeroXpInjection: hero XP on OnTowerCreated.

## G. Monkey Knowledge
- `Models/Knowledge/KnowledgeModel` ctor: `(name, idx, KnowledgeCategory category, investmentRequired, monkeyMoneyCost, prerequisiteIds[], ModModel mod)`: each knowledge = ONE ModModel in `mod`. Ids and numbers are data (GameModel.allKnowledge), not strings in the code.
- Application: `GameModel.CreateModded(activeMods: List<string>, ...)` loops `GameModel.AllMods` (knowledge mods + gameplay mods) and keeps mods whose `name` is in `activeMods`; then `CreateModded(result, mods, relicKnowledge)` applies them. `DisableMonkeyKnowledgeModModel` strips knowledge (some events). Relic knowledge (Contested Territory) goes through RelicKnowledgeManager (out of scope).
- Cash-relevant ModModel classes (type of `knowledge.mod`); effects verified from `Mutate` unless noted:
  * `StartingCashModModel(changeBase, addition, multiplier)`: GameModel.CalcStartingCash: `cash = base; if any changeBase>0 -> cash = LAST changeBase; cash += SUM(additions); cash = max(0,cash); cash += cash * SUM(multiplier-1) (mods with multiplier != 0,1); cash = max(0,cash)`. A wrapper ModModel is named "KnowlegeStartingCash" in code.
  * `CashPerRoundModModel(additionalMoney)`: PerRoundCashBonusTowerModel.cashPerRound += additionalMoney (A1).
  * `CashModModel(percentBonus, bonusMultiplierBuff)`: projectile CashModel `min += min*percentBonus; max += max*percentBonus; bonusMultiplier += bonusMultiplierBuff` (farm payouts).
  * `CashIncreaseModModel(additionalAmount, percentIncrease)`: CashIncreaseModel `increase += a; multiplier += p` (B2).
  * `BankModModel(additionalCapacity)`: BankModel capacity(+40) += additionalCapacity. `BankDepositsModModel(depositPercent, ...)`: adds/sets a BankDepositsModel. `ImfLoanModModel(additionalLoanAmount, interestRateDecreaseAmount)`: loan(+40) += a, interest(+44) -= d (IMF details: bank agent).
  * `DiscountZoneModModel(additionalMultiplier, specificScriptId)`: DiscountZoneModel.discountMultiplier(+64) += additionalMultiplier (two paths, with/without specificScriptId). Additive to the base zone value, so it also changes C2 sorting.
  * `ReduceCostModModel(amount)` (body not decoded; reduces a tower/upgrade cost by `amount`), `UpgradeCostModModel(amountReduced, percentageReduced, upgradeName)`, `GlobalCostModModel(multiplier)` (gameplay).
  * `TowerSellModModel(multiplier, additional, charges)` -> adds TowerSellModel; `SellMultiplierModModel(multiplier, addition)` -> base sell fraction (C8); `DisableSellTowerModModel`.
  * `FreeTowerModModel(baseTowerID, charges, mutuallyExclusiveWith, priority)` -> free-tower charge (C5 price 0). `SimTowerDiscountModModel(tower, useAllHeroes, multiplier, subtraction, charges)` -> TowerInventory discount (invMult/invFlat in C5).
  * `HealthyBananasModModel(marketplaceBonus, centralMarketLives, ...)` (farm agent). `HeroCostToLevelModModel(costMultiplier)`, `HeroXpPerRoundModModel(additionalXpBonus, applyGlobally)`, `HeroXpInjectionModModel(amount, levels, subtractHeroCost)`, `TowerXpModModel(multiplier)`.
  * Gameplay (event/mode) cash mods through the same pipeline: `ModifyAllCashModModel`, `ModifyPopCashModModel`, `ModifyRoundCashModModel`, `ModifyTowerCashModModel` (each `multiplier`), `IncomeSetModModel(incomesetName)`, `BonusCashPerRoundModModel(roundMultiple, baseCash)` (F), `MonkeyMoneyModModel`.
- Which knowledge ids use which ModModel: not in code. Read `allKnowledge[i].mod.$type` and its fields from the GameModel/knowledge export.
- Stacking: all tower mods above add to model fields, so order rarely matters (CashModModel's percent acts on the CURRENT min/max, so apply order = AllMods order matters there). OPEN: AllMods ordering.

## H. Out of scope (Rogue / Legends artifacts) - Simulation/Artifacts/Behaviors
- DiscountBoostBehavior: artifact discount (feeds `ArtifactBase.GetDiscount`, a multiplicative factor in C6). EndOfRoundCashBoostBehavior: artifact end-of-round cash. TowerCashBoostBehavior: artifact boost to tower cash. CostTrait: cost trait. BlockSellingTrait: blocks selling.
- Seen in Simulation/Towers/Behaviors but owned by the farm agent (not read): BananaBonusCashZone, BananaCashIncreaseSupport, MonkeyCityIncomeSupport, CollectCashZone, Monkeyopolis, Bank, BankDeposits, MonkeyBanker, ImfLoanCollection.

## Open questions
1. Rounding callee 0x180521800 / Math.Round at 0x180006930 (to-even vs away-from-zero) for tower/upgrade prices.
2. AddCash doubling branch and CashType > 4 meaning; CashSource ids (2, 3, 6, 10).
3. GetSimulationBehaviorDiscount implementers and the vtbl+776 placement-discount implementers.
4. TradeEmpire "favoured trades" and ordering lambdas; BonusCashZone stackLimit enforcement.
5. Upgrade-cost chain: hero array multiplier, Monkeyopolis replacement vs discount order, paragon path.
