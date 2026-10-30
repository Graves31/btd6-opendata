# BTD6 economy rules from the game code: round cash, costs, selling, mode modifiers

Source: Cpp2IL ISIL dump (`.../isil/IsilDump/Assembly-CSharp/Assets/Scripts/`, paths below relative to it).
Float constants were resolved by reading GameAssembly.dll at the referenced address (PE parse). Resolved:
0x183E4FC30 = 1.0, 0x183E4FD48 = 5.0, 0x183E4FC70 = -1.0, 0x183E4FE8C = FLT_MAX, 0x183E5016C = 0.95,
0x183E50170 = 10,000,000. Field names come from constructor parameter names in the dump; where only an
object offset is known it is written `Class.[+N]`. All numeric game values (costs, multipliers, sell %)
are "value in model data (field X)", never taken from here. Round indexes: see open questions (0-based internal).

Enum names (global-metadata strings, order not guaranteed): CashType: Normal, Ability, EndOfRound, NonTransformed,
CoopCash, QuestAwarded; CashSource: EcoEarned, CoopTransferedCash, TowerSold, TowerBrought, TowerUpgraded, BankDeposit,
GeraldoPurchase, MapInteractableUsed, PropSold, CorvusNourishment. Code uses numeric values; observed: CashType 0 = pop/sell,
3 = round-end bonus, 4 = coop (skips loan handling), 6 = AwardCashOnRound; CashSource 1 = pop (GiveCashOnPop), 3 = tower sold,
10 = AwardCashOnRound. Exact name-to-number mapping UNRESOLVED (do not rely on names).

## 0. Cash plumbing (all rules end here)

- Files: `Simulation/Simulation.txt` AddCash, AddSharedCash, RemoveCash, GetCash, UpdateStagedCash;
  `Simulation/Simulation_NestedType_CashManager.txt` (ctor only: `cash` (double, stored in a KonFuze obfuscated
  holder at +16), `doubleCash` bool (+24), `isActivePlayer` bool (+25)). No other CashManager logic.
- AddSharedCash(c, from, source, tower, cashDoubleable): when. any gain not tied to one player.
  share = c / (number of InputManagers/players); for each cash manager: if `GameModel.[+118]` (bool, name unresolved)
  AND cashDoubleable AND that manager's `doubleCash` then share *= 2; then AddCash(share, from, thatPlayer, source,
  tower, cashDoubleable=false). One player: share = c.
- AddCash(c, from, cashIndex, source, tower, cashDoubleable): if `from != 4(coop)`: pass c through the sim behaviours' loan
  hook (`ImfLoanCollection` of that player; it may take part of c to repay a loan; returned remainder continues).
  If remainder > 0: when cashDoubleable AND GameModel.[+118] AND manager.doubleCash then remainder *= 2.
  cash = manager.cash + remainder (no rounding, double). Marks sim dirty flag (+360), calls analytics OnCashEarned.
  Negative amounts are added unchanged (no doubling).
- RemoveCash(c, from, cashIndex, source): loan hook (if from != 4); if c > 0: cash -= c (no floor shown); for some
  sources a "spent" total on cash manager at `Simulation.[+536]` is increased (analytics-like; source test unresolved).
- UpdateStagedCash (per sim tick that calls it): sum over all non-destroyed towers of `Tower.GetAppliedCash()`,
  then AddSharedCash(sum, from 0, source 0, tower null, cashDoubleable = true) if sum > 0.
- Order/stacking: loan repayment first, then doubling. Doubling is applied exactly once per gain (AddSharedCash
  doubles then calls AddCash with doubleable=false; direct AddCash callers pass their own flag).
- Open: which game setting sets GameModel.[+118] and manager.doubleCash (profile "DoubleCashModeLoot"; not read).

## 1. Pop cash (per layer popped)

- Files: `Simulation/Bloons/Behaviors/DistributeCash.txt` (PostDegrade), `Simulation/Bloons/BloonDegradeStepper.txt`
  (UpdateDamageResult, GetCashForLayers), `Models/Bloons/Behaviors/DistributeCashModel.txt` (ctor, fields),
  `Simulation/Simulation.txt` (GetIncomeMultiplierForRound, GetCashModifierFromSimBehaviors),
  `Models/Rounds/IncomeSetModel.txt` (IncomeMultiplierForRound), `Simulation/Towers/Tower.txt` (AddPoppedCash, GetAppliedCash).
- When: every degrade (pop of one or more layers) of a bloon that has a DistributeCash behaviour.
- Base cash of the damage (BloonDegradeStepper.GetCashForLayers(bloonModel, layers, lowestLayer)):
  `cash(model, layers) = (cond ? DistributeCashModel.cash + DistributeCashModel.additionalCash : 0)
   + sum over child bloon models of cash(child, layers-1)` (recursion while layers-1 > 0).
  cond = `BloonModel.[+200] <= lowestLayer` (field unresolved; probably layer index). So popping a ceramic through to
  its children sums the DistributeCash cash of each layer popped, per the model data of each bloon model.
  `UpdateDamageResult` stores this in `DamageResult.[+52]`.
- DistributeCash.PostDegrade (rate formula, evaluated per degrade):
  ```
  if model.giveNoCash or !bloon.[+372]: dr.cash = 0
  else:
    inc  = IncomeSetModel.IncomeMultiplierForRound(bloon.round)        // see sec 2 (bloon.round = spawn round, children inherit)
    v    = dr.cash * inc
    v    = v * model.multiplier + model.additive                      // DistributeCashModel fields multiplier, additive
    dr.cash = v * GetCashModifierFromSimBehaviors()                   // sec 3, default 1.0
  ```
  DistributeCashModel fields (ctor order): cash, additionalCash, multiplier, additive, giveNoCash.
  (offsets: cash +40, multiplier +44, additive +48, additionalCash +52, giveNoCash +56.)
  If bloon.[+120] one-shot flag is set the call only clears the flag and gives nothing (meaning unresolved).
- Delivery: if the popping `tower` is non-null and not destroyed: `tower.AddPoppedCash(dr.cash)` only (adds to
  tower.[+372]); cash reaches the player later via UpdateStagedCash -> GetAppliedCash (sec 0 and below).
  Otherwise (no tower or tower destroyed): AddSharedCash(dr.cash) immediately (doubleable = true). If sim-behaviour
  modifier produced an extra (v*mod - v > 0) the extra is sent as a separate AddSharedCash call (from = 1, source 0); sum unchanged.
- Tower.GetAppliedCash: `applied = poppedCash; poppedCash = 0; if applied > 0: applied *= max(1.0, max over the tower's
  CashIncrease behaviours of CashIncreaseModel.increase)`. Max, not stacking. (CashIncreaseModel ctor: increase, multiplier;
  only `increase` is read here.)
- Rounding: none (floats/doubles all the way). Cash is stored as double.
- Other pop-cash bloon behaviours: `GiveCashOnPop` (PreDegrade): `v = layersPopped * IncomeMult(bloon.round) *
  model.cashMultiplier + model.flatCashAmount` (GiveCashOnPopModel fields flatCashAmount +48, cashMultiplier +52),
  then AddCash(v, from 0, owner of tower, source 1, tower, cashDoubleable = model.allowDoubleCash); NOT multiplied by the
  sim-behaviour modifier, NOT staged. `GiveCashOnBloonHit`, `EatBloon`, `Vigilante`: also call GetIncomeMultiplierForRound
  (not analysed further).
- Open: meaning of bloon.[+372] and the one-shot flag [+120]; GetCashForLayers `cond`.

## 2. Income set (pop-cash multiplier by round)

- Files: `Models/Rounds/IncomeSetModel.txt` (IncomeMultiplierForRound, ctor), `Simulation/Simulation.txt`
  (GetIncomeMultiplierForRound), `Models/Gameplay/Mods/IncomeSetModModel.txt` (Mutate), `Models/GameModel.txt` (SetIncomeSet).
- When: on each pop (sec 1). Round used = the bloon's own round field (set in `Spawner.Emit(roundNumber)`;
  `SpawnChildren`/`SpawnBloonsAction` copy the parent's), i.e. the spawn round, not the current round.
- Formula (IncomeSetModel.IncomeMultiplierForRound(round)): thresholds array of pairs (int roundThreshold, float multiplier)
  walked in order; return the first pair with `round < roundThreshold` (signed int compare), else `finalMultiplier`.
  Fields: thresholds (RoundThresholdMultiplier[]), finalMultiplier (ctor param names).
- The site's `INCOME_SETS` uses `n <= th` with 1-based display rounds: equivalent iff internal round = display round - 1 (0-based
  RoundArrayIndex, see sec 4: roundArrayIndex+1 is the display round). Strongly suggested, not directly proven for Emit's roundNumber.
- `IncomeSetModModel(name, incomesetName).Mutate`: replaces `GameModel.incomeSet` by `GameData.IncomeSetByName(incomesetName)`.
- Rounding: none.

## 3. Sim-behaviour pop modifier (IncreaseBloonWorth)

- Files: `Simulation/Simulation.txt` GetCashModifierFromSimBehaviors.
- Formula: cached in `Simulation.[+760]` (rebuilt if <= 0): `mod = 1.0 + sum over IncreaseBloonWorthSimBehavior models of
  (model.[+40] - 1.0)`, entries with `model.[+44]` true counted once per distinct `model.[+32]` name (HashSet dedupe); others
  counted every time. Multiplies final per-pop cash in sec 1. Additive stacking of (m-1) terms. Model field names unresolved.

## 4. End-of-round cash

- Files: `Models/SimulationBehaviors/BonusCashPerRoundModel.txt` (ctor, GetCashForRound),
  `Simulation/SimulationBehaviors/BonusCashPerRound.txt` (OnRoundEnd),
  `Models/Gameplay/Mods/ModifyRoundCashModModel.txt`, `BonusCashPerRoundModModel.txt`,
  `Simulation/Simulation.txt` RoundEnd (calls sim behaviours' OnRoundEnd), `AwardCashOnRound(.Model)`.
- When: at round end, once, for the round just completed. `roundArrayIndex` = 0-based index of the finished round.
- Formula: `cash = (roundArrayIndex + 1) * roundMultiple + baseCash` -> AddSharedCash(cash, CashType 3, source 0,
  tower null, cashDoubleable = true). Fields: BonusCashPerRoundModel.roundMultiple (+40), baseCash (+44). So with
  display round R: `R * roundMultiple + baseCash` (the site's "100 + round" means roundMultiple = baseCash-model values
  from the mode data: value in model data; I did not read the actual numbers).
- Rounding: none in code (floats; doubled when double cash active).
- ModifyRoundCashModModel(multiplier): at model build, `roundMultiple *= m` and `baseCash *= m` for every BonusCashPerRoundModel.
- BonusCashPerRoundModModel(roundMultiple, baseCash): Mutate not analysed (6 KB; presumably adds/sets a BonusCashPerRoundModel).
- AwardCashOnRound(round, cashAmount): OnRoundEnd(idx): if `model.round == idx + 2` -> AddSharedCash(cashAmount, CashType 6,
  source 10, doubleable = false). i.e. awarded when round (model.round-1) ends (start of model.round). PerformAction at
  match start awards immediately when current round <= 0 and model.round <= 1. Not scaled by ModifyAllCash.
- CashRushGameMode / Artifacts EndOfRoundCashBoostBehavior: cash-goal victory logic and artifact boosts, not analysed.
- CHIMPS: `ChimpsModModel` zeroes income fields (sec 8) but does not touch BonusCashPerRoundModel; whether CHIMPS pays
  end-of-round cash therefore depends on the ModModels listed in the mode data (e.g. a ModifyRoundCash 0), not code.

## 5. Tower purchase cost

- Files: `Simulation/Towers/TowerManager.txt` GetTowerCost, GetZoneDiscount, GetDiscountMultiplier, GetAreaDiscount;
  `Simulation/Input/TowerInventory.txt` GetTowerCost, GetTowerDiscount, GetFreeTowerCount, AddTowerDiscount;
  `Simulation/Input/TowerDiscount.txt` TowerCostTransform; `SimulationBehaviors/FirstPlacedTowerDiscount.txt`
  GetTowerPlacementDiscount; `Models/SimulationBehaviors/SimTowerDiscountModel.txt`, `FirstPlacedTowerDiscountModel.txt`;
  `Models/Gameplay/Mods/GlobalCostModModel.txt`, `SimTowerDiscountModModel.txt`.
- When: on purchase (TowerManager.GetTowerCost(tower, position, inventory, owner)) and for the shop label
  (TowerInventory.GetTowerCost, same maths without the zone/area terms).
- Formula (TowerManager.GetTowerCost):
  ```
  if inventory.IsFreeTowerAvailable(model): UseFreeTowerCharge; return 0
  (invMult, invDirect) = inventory.GetTowerDiscount(model, useCharge=true)   // sum over matching TowerDiscount with charges > 0
  simD = sum over sim behaviours of GetTowerPlacementDiscount(model, owner)   // FirstPlacedTowerDiscount: its discountMultiplier
                                                                              // (field discountMultiplier) once per owner, if not yet used & tower matches
  zoneD = GetDiscountMultiplier(GetZoneDiscount(model, position))           // sum of DiscountZone.discountMultiplier (stackLimit per stackName)
  areaD = GetAreaDiscount(position)                                          // map-area discount
  total = zoneD + areaD + invMult + simD
  cost  = (1.0 - total) * (model.cost - invDirect)                          // TowerModel.cost at +88
  if cost < 0 -> 0 else cost = Math.RoundToNearestInt(cost, 5)              // Round(cost / 5) * 5 (default Round = ToEven; unverified)
  ```
  TowerDiscount fields: towers (matched on TowerModel.baseId), charges (+32), multiplier (+36), subtraction/direct (+40);
  SimTowerDiscountModel ctor: towers, multiplier, subtraction, charges. Discounts ADD; they are not multiplied together.
- model.cost already contains difficulty and mode multipliers (sec 7). Rounding is only at the very end, to the nearest 5.
- Open: the first-placed-discount trigger set (OnTowerCreated) and GetAreaDiscount not read in detail.

## 6. Upgrade cost

- Files: `Simulation/Towers/TowerManager.txt` GetTowerUpgradeCost, GetFreeUpgrade; `Simulation/Simulation.txt`
  GetSimulationBehaviorDiscount (ComeOnEverybody.GetDiscount); `Models/Gameplay/Mods/UpgradeCostModModel.txt`.
- Formula:
  ```
  base = overrideBaseCost if overrideBaseCost > -1.0 else UpgradeModel.cost (+40)   // paragon upgrade uses paragon UpgradeModel.cost
  (TowerUpgradeLock behaviours on the tower may transform base via a virtual call; not decoded)
  free = GetFreeUpgrade(...)                       // free upgrades => factor 0
  disc = free || isParagon ? 0 : zoneD + areaD     // same zone/area terms as sec 5
  disc = GetSimulationBehaviorDiscount(...)  = disc + sum of ComeOnEverybody.GetDiscount(...)
  cost = (free ? 0 : 1) * base * (1.0 - disc)
  [Legends/rogue branches multiply further by per-tier arrays and artifact GetDiscount values; ignore for boss events]
  if cost < 0 -> 0 else RoundToNearestInt(cost, 5)
  if the upgrade is not found -> returns FLT_MAX
  ```
- UpgradeModel.cost already includes difficulty (sec 7). Upgrade discounts also add (1 - sum).
- UpgradeCostModModel(name, amountReduced, percentageReduced, upgradeName).Mutate(UpgradeModel): per-upgrade reduction (not decoded).

## 7. Difficulty / global cost modifiers (applied once when the GameModel is built)

- Files: `Models/Gameplay/Mods/GlobalCostModModel.txt` (ctor(name, multiplier), Mutate), `Models/GameModel.txt` CreateModded
  (both overloads), `GameModel.CalcStartingCash`.
- GlobalCostModModel.Mutate(model, unmodded): for every TowerModel: `cost += (multiplier - 1.0) * unmoddedTower.cost`
  (float, +88). For every UpgradeModel: `cost(int,+40) += (int)((multiplier - 1.0) * unmoddedUpgrade.cost)` (truncation toward 0).
  GeraldoItemModel cost (+80) same as upgrades. Stacks ADDITIVELY across several GlobalCostModModels because each term
  uses the UNMODDED base: e.g. two mods m1, m2 -> cost = base + (m1-1)*base + (m2-1)*base.
  Multiplier values come from the mode/difficulty ModModel data (field multiplier). No rounding to 5 here.
- Mutation order = order of the mod list given to CreateModded (activeMods -> GameModel.AllMods lookup; dcm mod, relics);
  not traced beyond that, but since GlobalCost uses the unmodded base the order does not change its result.

## 8. Mode cash multipliers (applied once when the GameModel is built; they mutate model fields)

Common: all take one `multiplier` (ctor name, multiplier); `IsGameModeMod() = true`.
- ModifyAllCashModModel: multiplies cash fields of 20 model types (Mutate): DistributeCashModel cash (+40), additive (+48),
  additionalCash (+52) (NOT multiplier +44); GiveCashOnPopModel flatCashAmount (+48) and cashMultiplier (+52);
  BonusCashPerRoundModel roundMultiple (+40), baseCash (+44); PerRoundCashBonusTowerModel (+40,+44); CashModel (+48,+52);
  DepletionToCashModel (+48,+52); CashPerTowerInRangeModel (+48); SkimBloonsModel (+40); ImfLoanModel (+40);
  MoabTakedownModel (+64); CashIncreaseModel increase (+40); IncreaseBloonWorthModel / WithTier (+64); TradeEmpireBuffModel (+64);
  VigilanteTowerBehaviorModel (+88 float plus int fields via cvttss2si truncation); MonkeyopolisModel,
  CashPerTowerInMakeshiftAreaModel (int fields, truncated); DesperadoMarkModel (+52); EatBloonModel (+52); WallOfTreesModel (+52).
  Not touched: tower/upgrade costs, sell value, AwardCashOnRound, starting cash. So "half cash" = this mod with
  multiplier from data (I did not locate which named mod carries 0.5; value in model data, field multiplier).
- ModifyPopCashModModel: DistributeCashModel cash (+40), additive (+48), additionalCash (+52) only.
- ModifyRoundCashModModel: BonusCashPerRoundModel roundMultiple (+40), baseCash (+44) only.
- ModifyTowerCashModModel: the tower-income model types above (banks, farms, depletion, etc.), not pop cash, not round bonus.
  `ScaleAmount(x) = x * multiplier` exists on these three for other callers.
- Stacking: mods are applied one after another, each multiplies the current field value -> multipliers multiply.
- Rounding: none for float fields; int fields truncate toward zero.
- ChimpsModModel.Mutate: sets income fields to 0: GiveCashOnPopModel.flatCashAmount (+48), CashModel (+48 and +72),
  DepletionToCashModel (+48), PerRoundCashBonusTowerModel (+40), ImfLoanModel (+40), SkimBloonsModel (+40), CashIncreaseModel
  increase (+40), IncreaseBloonWorthModel/WithTier (+64), TradeEmpireBuffModel (+64), MonkeyopolisModel (+52),
  MoabTakedownModel (+56), MonkeyCityIncomeSupportModel (+96), VigilanteTowerBehaviorModel (+88), DesperadoMarkModel,
  CashPerTowerInRangeModel (+48), plus EatBloon/WallOfTrees/Syphon/BonusCashZone/AbilityModel handling (not decoded).
  Not touched: DistributeCashModel (pop cash stays), BonusCashPerRoundModel, tower costs, sell.
- DisableMonkeyKnowledgeModModel.Mutate: no-op returning true; the effect is read as a flag elsewhere (not in this scope).
- DisableSellTowerModModel (exists) blocks selling; `SellMultiplierModModel` sec 9.
- StartingCashModModel(name, changeBase, addition, multiplier) + GameModel.CalcStartingCash(result, mods):
  ```
  cash = result.startingCash
  if any mod.changeBase > 0: cash = last such changeBase          // "last wins" in mod-list order
  cash += sum(mod.addition)                                       // every nonzero addition
  cash = max(cash, 0)
  for each mod with multiplier != 0 and != 1.0: cash += (multiplier - 1.0) * cash   // sequential multiply
  cash = max(cash, 0); result.startingCash = cash                  // no rounding shown
  ```
  Relic knowledge adds an extra mod "KnowlegeStartingCash" (from RelicKnowledge) before CalcStartingCash in CreateModded.
- MonkeyMoneyModModel(changeBase, multiplier): Mod(value) for Monkey Money rewards only (not in-game cash).

## 9. Selling

- Files: `Simulation/Towers/TowerManager.txt` SellTower, TransformSellAmount; `Simulation/Towers/Tower.txt` get_SaleValue,
  GetTotalSaleTransforms, GetAdditionalSaleAmounts, OnSold; `Models/Gameplay/Mods/SellMultiplierModModel.txt`;
  `Simulation/Towers/Behaviors/SellIncreaseZone.txt`, `SellStackedTowers.txt` (only referenced, not read in detail).
- When: on sell. TowerManager.SellTower: `AddCash(tower.SaleValue, from 0, cashIndex = owner, source 3 (tower sold), tower null,
  cashDoubleable = false)`, then Tower.OnSold(saleValue), then DestroyTower. Not doubled, no staging, not loan-filtered if from != 4.
- Tower.get_SaleValue (all floats, final rounding):
  ```
  mult    = TowerManager.TransformSellAmount(tower) + tower.<call@vtable 2216>()     // second term likely GetTotalSaleTransforms (sum of
                                                                                      // ITowerBehavior sale-transform values); inferred from neighbours
  worth   = tower.worth (+344)                                                       // cash invested, maintained elsewhere
  if tower.TowerModel.[+301] == false: worth = min(worth, worth * min(0.95, mult))   // cap on the sell factor at 0.95
  else:                                 worth = worth * mult
  total   = worth + tower.<call@vtable 2232>()                                       // likely GetAdditionalSaleAmounts (flat adds)
  total  *= GameModel.[+220]                                                         // global factor, name unresolved
  total   = min(total, 10,000,000)
  return Math.Round((double)total)                                                   // System.Math.Round(double): default ToEven (unverified)
  ```
- TransformSellAmount (value of the sell factor): `sum of SellIncreaseZone / stacked-cashback contributions from nearby towers
  (distance-based, per-zone dictionary, max or sum per stack rule not decoded) + GameModel.[+60] (sellMultiplier, the field changed
  by SellMultiplierModModel) + TowerModel.[+320]`; special case Geraldo item "RareQuincyActionFigure" scales worth over rounds
  (IncreaseTowerWorthOverRoundsModel.GetWorthMultiplier). If the sum is 0 it returns GameModel.[+60].
  Base sell fraction: value in model data (GameModel sell multiplier + TowerModel +320 field).
- SellMultiplierModModel(name, multiplier, addition).Mutate(GameModel): `GameModel.[+60] = GameModel.[+60] * multiplier + addition`.
- Where tower.worth grows (purchase + upgrade costs actually paid, banked pops?) not read: `Tower.worth` updates are in
  purchase/upgrade code (TowerManager.UpgradeTower, Tower.OnPlace); UNRESOLVED here.

## 10. Other modifiers touched

- CashRushGameMode / DisableMonkeyKnowledge / Impoppable / etc.: not analysed beyond the above.
- Double cash: sec 0.
- Monkey Knowledge / relic knowledge: `RelicKnowledgeManager.ApplyTowerEffects/ApplyBloonEffects/ApplySimulationEffects` run inside
  CreateModded(result, mods, relics) after CalcStartingCash; their numbers are data (not analysed).
- IMF loan: AddCash/RemoveCash route through `ImfLoanCollection` (repayment); details not read.

## Open questions / unresolved (summary)
1. Round index base for bloon.round and IncomeSet thresholds (likely 0-based; consistent with the site's `n <= th`).
2. Meaning of Bloon.[+372], DistributeCash one-shot [+120], GameModel.[+118], GameModel.[+220], TowerModel.[+301], [+320].
3. Exact CashType/CashSource numeric-to-name map; which sources count in RemoveCash's "spent" total.
4. SellIncreaseZone / stacked cashback maths inside TransformSellAmount; tower.worth accrual.
5. Mod application order and BonusCashPerRoundModModel / UpgradeCostModModel / GetAreaDiscount / GetFreeUpgrade bodies not decoded.
6. `Math.Round` semantics for the 5-rounding and sell rounding (assumed default banker's rounding; the called routine is a thunk).
