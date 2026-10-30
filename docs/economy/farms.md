# Banana Farm economy: rules from the game code (Cpp2IL ISIL, v57.x dump)

Root: `Assets/Scripts/Simulation/Towers/` (abbrev `T/`). Model classes: `Assets/Scripts/Models/Towers/...` (abbrev `M/`).
Decoding notes: ISIL offsets are decimal (`[rdi+128]` = 0x80). Float constants resolved by reading GameAssembly.dll
(PE section map): 0x183E4FC30 = 1.0f, 0x183E4FC28 = 0.5f. No BTD6 data values (costs, capacity, interest, counts) appear in code:
those are "value in model data (field X)". Class field layout below is inferred from ctor/getter offsets (marked [inferred]).
Unresolved enums: Simulation.CashType / CashSource are not in the dump, so numeric ids (from=0, source=1/6, from=4 ...) are raw.

## 0. Overview: where the money moves (one-line map)
- Bank farm (path-2 "Monkey Bank", see R2 filter): EmissionsPerRoundFilter schedules N emissions per round -> weapon fires -> `SendToBank.Emit`
  adds packet value to `Bank.Cash` (clamped to capacity) and to the interest base -> at OnRoundEnd `Bank.PayInterest` -> player empties it with
  `Bank.Collect` (button = CollectFromBank ability, auto-collect, sell, or Monkey Banker).
- Plain farm: same schedule, but each emission is a `Cash` projectile (banana) that the player/collector picks up (`Cash.Pickup`) or that expires
  (`Cash.Exhausted`, pays only the salvage fraction).
- Buff mutators change CashModel fields (`bonusMultiplier`, `minimum`, `maximum`) on the farm's model, and EmissionsPerRoundFilterModel.count.

## R1. Packet / banana value (CashModel)
Files: M/Projectiles/Behaviors/CashModel (ctor); T/Projectiles/Behaviors/Cash (`Initialise`, `RollAmount`, `Pickup`, `Exhausted`); T/Emissions/SendToBank (`Emit`).
CashModel fields [ctor order; offsets inferred]: minimum(+0x30), maximum(+0x34), bonusMultiplier(+0x38), salvage(+0x3C), noTransformCash(+0x40),
distributeSalvage(+0x41), forceCreateProjectile(+0x42), isDoubleable(+0x43), distributeBonusIncome(+0x44), emittedByCashEarnedMultiplier(+0x48), isPowerCash(+0x4C).
- Bank packets (`SendToBank.Emit`): `value = (1.0 + cash.bonusMultiplier) * cash.maximum`  (reads `maximum`, NOT a random roll; minimum unused here).
  Float32, no rounding. Text effect "+$" uses FloatAsIntStr (display only).
- Banana pickup (`Cash.RollAmount`): `lo=(1+bonusMultiplier)*minimum; hi=(1+bonusMultiplier)*maximum; if lo==hi -> hi else lo + rand01*(hi-lo)` (sim BufferedRandom
  `NextDouble`, i.e. deterministic RNG stream). Float32, no rounding.
  NB `Cash.Initialise` caches minimum/maximum into instance fields (+116/+120) when the projectile is created; `RollAmount` multiplies the
  CURRENT model `bonusMultiplier` with those cached min/max. So min/max mutations (Central, Banker) affect bananas created after the mutation.
- `Cash.Pickup(tower)`: `amount=RollAmount(); a=amount*emittedByCashEarnedMultiplier(model +72 cached at +124); b=amount-a`; both parts paid with
  `AddCash`/`AddSharedCash` (distributeBonusIncome decides shared), tower cashEarned stat (+0x170) += a. Total paid = amount. CashModel.isDoubleable is
  passed on as the "cashDoubleable" argument of AddCash (see R10).
- Expiry (`Cash.Exhausted`, banana not picked up when its lifespan ends): if `salvage > 0` and (amount>0 or forceCreateProjectile):
  `paid = RollAmount()*salvage` split the same way; if `salvage == 0` nothing is paid. So uncollected bananas EXPIRE and pay only the salvage fraction.
  Lifespan = ProjectileModel lifespan (value in model data: projectile `lifespan`; not in Cash.cs). `salvage` = "value in model data (CashModel.salvage)".
- Open: the Round-end check that the pickup happens "in time" for farms with auto-collect is not in these classes (see R9, CollectCashZone).

## R2. Emissions per round (how many packets/bananas and when)
Files: T/Weapons/Behaviors/EmissionsPerRoundFilter (`Initialise`, `RoundStart`, `Process`, `FilterEmission`, `EmissionStarted`); M/.../EmissionsPerRoundFilterModel (ctor name,count).
- Model field: `count` (+0x28). Value in model data (EmissionsPerRoundFilterModel.count). bank.ts quotes 4/6/8 (wiki); not verifiable from code.
- WHEN: `RoundStart(spawnedRound)` stores `dict[spawnedRound] = (startTick = sim.currentTick+1, duration = Spawner.GetRoundDuration())` (duration truncated to int).
  `Process(elapsed)` each tick, for every stored round and i in 0..count-1:
  ```
  if count > 1: step = duration / (count - 1.0f); tick_i = trunc(i*step + start)
  else:         tick_0 = start + duration/2   (integer halving)
  if elapsed == tick_i:  pending += 1   (unless a weapon-model flag +126 or tower flag +188 is set)
  when i == count-1 fires: round entry is queued for removal
  ```
  => packets are evenly spaced over the round: first at round start, last at start+duration (count>1), or one packet mid-round (count==1).
  `duration` = Spawner.GetRoundDuration() (round length from the round's spawn data; exact definition not read here).
- A weapon emission only goes through while `pending > 0` (`FilterEmission`) and `EmissionStarted` decrements it. So the real emission tick is the first weapon
  fire at/after the scheduled tick; weapon `rate` can delay it slightly (pending accumulates, nothing is lost within the round).
- Tower placed/loaded mid-round: `Initialise` seeds the dictionary from the spawner for the current round; ticks already in the past never match the equality test, so they are lost
  [inferred, uncertain].
- Rounds are keyed by number, so a packet scheduled for round r always counts toward round r's PayInterest only if it lands before OnRoundEnd(r). Late packets (last one at
  exactly start+duration) vs round end ordering: open question (OnRoundEnd fires after the last bloon leaves, usually later than the spawn duration).
- Rate buffs (R8) change `count`, see below.

## R3. Bank storage, interest, collect
Files: T/Behaviors/Bank (`Initialise`, `set_Cash`, `PayInterest`, `Collect`, `DepositCash`, `OnDestroy`, `Attatched`); M/Behaviors/BankModel (ctor).
BankModel fields: capacity(+0x28), interest(+0x2C), assetId, fullBankAssetId, lifespan(+0x40, not used by the methods read), autoCollect(+0x44 bool), collectAnimation(+0x48).
Values in model data. Bank instance state: Cash(+0x80), depositedTotal(+0x84), interestBase(+0x88).
- `set_Cash(v)`: `Cash = min(v, capacity)` (shows the full display when clamped).
- Packet in (`SendToBank.Emit`): `bank.Cash = min(cap, Cash + value); bank.interestBase += value` (base is NOT clamped; harmless, see below).
- WHEN interest: registered on `BridgeMessagingDelegates.OnRoundEnd` in `Attatched`; `PayInterest(round)` runs at EVERY round end.
  ```
  if tower.flag(+0xBC)==false:                      // tower not sold/destroyed [inferred]
      Cash = min(cap, Cash + interestBase * interest)
      interestBase = Cash                           // base resets to the post-interest balance
      if Cash >= cap && autoCollect: Collect()
  ```
  Consequences: interest on this round's packets is included (base had them); manual deposits are in Cash but not in base until the next PayInterest
  copies Cash to base (matches bank.ts: deposits earn from the second round end). No rounding anywhere (float32).
- `Collect()` (returns `Cash - depositedTotal`; returns 0 and does nothing if Cash==0):
  ```
  earned = Cash - depositedTotal
  tower.cashEarnedStat += earned
  AddCash(depositedTotal, from=0, source=6, doubleable=false)   // principal back FIRST
  AddCash(earned,         from=0, source=1, doubleable=false)   // then the earnings
  Cash = 0; depositedTotal = 0; interestBase = 0                // one 8-byte store zeroes both
  ```
  Collect is NOT doubleable (R10) and goes through loan skim (R7); the principal call is skimmed before the earnings call.
  Collecting zeroes the interest base, so after a collect the next interest only applies to packets received after it.
- `OnDestroy` (sell/destroy) calls `Collect()`: selling a bank pays out its balance.
- `DepositCash(x)`: `Cash=min(cap, Cash+x); depositedTotal += (newCash-oldCash)` (only the amount that fitted).
- UpdatedModel (upgrade): capacity re-read; if `Cash >= new capacity` the full display is refreshed; Cash is not changed otherwise.
- Cross-check bank.ts: `B' = min(cap, 1.15*(B+P))` is equivalent (interest includes this round's packets; clamp per packet only matters when B+P>cap, then result is cap either way). OK.

## R4. Manual deposit (BankDeposits, MK "Bank Deposits")
Files: T/Behaviors/BankDeposits (`GetDepositAmount`, `OnTsmThemeAction`); model BankDepositsModel(depositPercent +0x28, displayPath, displayLifetime).
```
room   = bank.model.capacity - bank.Cash
amount = trunc(room * depositPercent)          // cvttss2si then back to float
amount = min(amount, playerCash)               // Simulation.GetCash(owner)
if amount < 1.0 -> 0
```
Button: `RemoveCash(amount, source=6)` then `bank.DepositCash(amount)`. depositPercent: value in model data (BankDepositsModel.depositPercent); bank.ts has 0.5 ("half of remaining"): consistent with
formula, value not verifiable from code. Deposit is not in the interest base until next PayInterest (R3). Returned unchanged on Collect (source 6).

## R5. Monkey Banker (MonkeyBanker + BankIncomeMutator)  [a bank-farm helper tower; field names from ctor]
MonkeyBankerModel: bankIncomeMultiplierBase(+64), bankIncomeMultiplierPerStack(+68), bankIncomeMaxStacks(+72 int), isBananaFinancier(+76 bool),
bankInstaDepositAmount(+80), bankInstaDepositStackAmount(+84), bankInstaDepositMaxStackAmount(+88), bankCollectAnimation(+92). All values in model data.
Target filter (`CheckTowerModel`): towerModel.baseId == "BananaFarm" AND tiers[1] >= 3 (middle path 3+, the bank path); same owner.
- Income buff: on tower enter it adds two mutators to the farm: MutatorBase (multiplier = Base) and MutatorStacking (id "BankIncomeMutatorStacking", multiplier = PerStack,
  stacks up to MaxStacks, one stack per banker in range). `BankIncomeMutator.Mutate` (only if tiers[1] >= 3): for each CashModel of the farm, paired with the
  UNMODIFIED base model's CashModel:
  ```
  cash.minimum += base.minimum * mutator.multiplier;  cash.maximum += base.maximum * mutator.multiplier
  ```
  => ADDITIVE on the base min/max (does not touch bonusMultiplier or interest). Total = base * (1 + Base + PerStack*stacks) before other buffs; it then interacts with
  Banana Central (multiplies current min/max, R6) depending on mutator application order (open: not read).
- Insta deposit (`Deposit(farm)`, called when a bank farm is created/upgraded into range and from `Process`): 
  ```
  amount = min(bankInstaDepositAmount, playerCash) + min(bankInstaDepositMaxStackAmount, n * bankInstaDepositStackAmount)  (n = bankers covering the farm incl. self) [inferred]
  bank.DepositCash(amount)   // NOT removed from player cash: it is a LOAN, see R7
  ```
  `Process` then registers a loan per deposit: `Simulation.AddLoan(amount, collectionRate=0.5 (constant 0x183E4FC28), ImfLoanCollectionModel("MonkeyBanker"+id,...))` and clears the pending dict.
  => while the loan is outstanding 50% of each AddCash (R7) is taken until `amount` is repaid.
- `Process`: for each bank farm in the zone: when `bank.IsAtMaxCapacity`, optional collect animation; then `Bank.Collect()` (+ stat), and if isBananaFinancier a new `Deposit`.
  i.e. a full bank is auto-collected by the Banker every tick it is at capacity. Details of the full branch are partly uncertain.

## R6. Farm income buffs (CashModel mutators)  -- stacking
All three act on `CashModel`s found under the farm's TowerModel (descendants), so they apply to bank packets AND banana projectiles.
1. BananaCashIncreaseSupport (M: BananaCashIncreaseSupportModel: multiplier(+0x58), isUnique, mutatorId, filters, useTiers(+0x69), first/second/thirdPathTier(+0x6C/70/74)):
   `MutatorTower.Mutate`: if useTiers, apply only if tower.tiers[i] >= pathTier_i for all 3 paths; then `cash.bonusMultiplier += multiplier` (ADDITIVE into the shared bonusMultiplier).
   isUnique / mutatorId => same buff from several sources does not stack (standard mutator id rule, not read here).
2. MonkeyCityIncomeSupport (M: incomeModifier +0x60 = m): `Mutate`: `cash.bonusMultiplier += (m - 1.0)` (ADDITIVE); also `PerRoundCashBonusTower` amounts *= m,
   `CashPerTowerInRange` *= m, MoabTakedown bonus `(x-1)*m+1`, `ImfLoanModel.amount *= m`; `ScaleCost(c) = c*m`. Does not touch BankModel interest/capacity.
   (MonkeyCity.txt = a different behavior: after `roundsTillMultiplier` rounds it gives free towers via AddFreeTowers; not income.)
3. BananaCentralBuff (M: multiplier +0x40): `TestTower` adds the mutator (once per tower: skipped if already `IsMutatedBy` the same mutator) to towers with the same
   baseId as the Central's tower (Banana Farm) AND tiers[0] == 4 (exactly; top-path tier 4). `Mutate` (also needs tiers[0]==4):
   `cash.minimum *= m; cash.maximum *= m` (MULTIPLICATIVE on min/max, bonusMultiplier untouched).
Resulting packet = `(1 + bonusMultiplier_total) * maximum_total` with
`bonusMultiplier_total = ModelBase + sum(BananaCashIncrease multipliers) + sum(MonkeyCity (m-1))`  (additive group, like bank.ts: "income buffs add to one multiplier")
`maximum_total = ((base.max [+ Banker adds]) * Central)` (order of Banker vs Central depends on mutator order: open).
The "+25% valuable bananas" in bank.ts is one of the bonusMultiplier terms (model data). Interest and capacity are never multiplied by these.
Banana bonus-zone: `BananaBonusCashZone` stores `BananaBonusCashZoneModel.multiplier(+0x28)` but NO code in the dump reads it (grep: only its own Initialise/UpdatedModel) => no effect found. Open.

## R7. IMF loan / debt skim
Files: T/Behaviors/Abilities/Behaviors/ImfLoan (`Activate`, `AddLoanCollectionBehavior`, `CanUseAbility`, `HasImfLoanDebt`); SimulationBehaviors/ImfLoanCollection (`AddCashTransform`, `GetCollectedAmount`);
Simulation.AddCash (loop over loans). ImfLoanModel fields: amount(+0x28), incomeRecoveryRate(+0x2C), assetId, lifespan.
- Ability use: `AddCash(amount, from=2)`, tower cashEarned += amount, then `AddLoan(amount, collectionRate=incomeRecoveryRate, ...)`. Usable only if the owner has no outstanding IMF loan
  (CanUseAbility = !HasImfLoanDebt). Values in model data (bank.ts/wiki numbers not verifiable from code). MonkeyCityIncomeSupport multiplies `amount` (R6).
- Skim (`ImfLoanCollection.AddCashTransform(amount)`; loan model: collectionRate(+0x28), amount(+0x2C); state collected(+0x58) counts *remaining/collected* [inferred]):
  ```
  skim = float(amount) * collectionRate
  if collected + skim >= loanAmount: skim = loanAmount - collected; remove loan behavior
  collected += skim; return amount - skim        // player receives the remainder
  ```
  No test on CashSource inside the transform.
- WHERE it applies: `Simulation.AddCash(c, from, cashIndex, source, tower, doubleable)`: unless `from == 4`, it walks the loans list and applies `AddCashTransform`
  of the FIRST loan whose owner (+0x6C) == cashIndex (only one loan per AddCash call); a finished loan is removed. So ALL income of that player except from-type 4 is skimmed:
  bank Collect (from=0, both principal and earnings calls), banana pickups, other towers' income. Meaning of from==4 (probably the loan payout/exempt type): unresolved enum.
- Order vs doubling: skim first, then the doubling in R10 on the remainder.

## R8. Overclock (rate) and its effect on packets per round
Files: M/Behaviors/Abilities/Behaviors/OverclockModel_NestedType_OverclockMutator (`Mutate`), OverclockPermanentModel_NestedType_OverclockPermanentMutator (`Mutate`);
OverclockModel(lifespanFrames, rateModifier(+0x2C), villageRangeModifier(+0x30), mutatorId, maxStacks, tierBasedDurationMultiplier, paragonDurationMultiplier ...), OverclockPermanentModel(rateModifier, villageRangeModifier, maxStacks, mutatorsByStack).
- Overclock mutator: every WeaponModel `rate *= rateModifier`; if baseId == "MonkeyVillage" range *= villageRangeModifier; if baseId == "BananaFarm":
  `EmissionsPerRoundFilterModel.count = Math.Round(count * (1.0 / rateModifier))` (System.Math.Round(double): default midpoint = to-even [inferred from call, not decoded]).
  So a farm emits Round(count / rateModifier) packets per round while it is overclocked (the schedule in R2 uses the new count; 1/rate scaling, rounded, so not a plain multiplier). Values (rateModifier, duration) in model data.
- OverclockPermanent: `eff = 1 - (1 - rateModifier) * stacks` (stacks = mutator stack count (+120)); `rate *= eff`; farm: `count = Math.Round(count * (1/eff))`. A further
  `x *= eff`-style multiply of another model field at the end (line ~404-406, target class unknown) is not decoded: open.
- Neither touches BankModel (interest/capacity). Whether new count applies mid-round: count is read per `Process` tick, so the schedule of an already started round changes
  immediately [inferred; step recomputed each tick from model count].

## R9. Pickup helpers (plain farms only)
- `CollectCashZone` (CollectCashZoneModel: attractRange, collectRange, lerpMultiplier, towerFilter, useTowerRange, countCollectedCash, animateTower, rotate, onlyAttractsCamo, minEmitWaitTime):
  `Process` pulls Cash projectiles within attractRange and collects within collectRange via `Pickup.StartFarmerPickup` -> `Cash.Pickup` (full amount, R1). Counter +112 = collected count.
- Camo/Regrow farmer behaviors (BananaFarmerCamoBananas, BananaFarmerRegrowBananas): no Cash/Bank references in the code: they do not change income.
- Manual click pickup and the farmer/collector all end in `Cash.Pickup`. No code found that removes a banana before its lifespan except pickup.

## R10. Cash entry point (Simulation.AddCash) as seen from the farm
`AddCash(double c, CashType from, int cashIndex, CashSource source, Tower tower=null, bool cashDoubleable=true)`:
1. loan skim (R7) unless from==4;
2. if `cashDoubleable` and a sim flag (+0x76) and the player's cash manager flag (+0x18) is set (the game's double-cash option/mode): `c *= 2` on the remainder (addsd c,c);
3. adds to the player's cash manager and fires analytics `OnCashEarned`.
Bank.Collect passes cashDoubleable=false => bank income is never doubled by this flag. Banana pickups pass CashModel.isDoubleable. (Interpretation of flags +0x76/+0x18 is [inferred]; the enum names are not in the dump.)

## Open questions / not verified
- Mutator application order (Banker add vs Central multiply vs BananaCashIncrease add): needs the Mutable.AddMutator priority / ordering code.
- Exact `Spawner.GetRoundDuration` definition and whether the final packet (start+duration) always precedes OnRoundEnd.
- Meaning of tower flags +0xBC / +188 and weapon flag +126 (assumed destroyed/selling).
- CashType/CashSource numeric meanings (from==4 exemption, source 1/6).
- BananaBonusCashZone multiplier unused in code read; OverclockPermanent last multiply target.
- All numeric values (capacity, interest, packet value, counts, salvage, deposit %, loan amount/rate, Banker numbers, buff multipliers) are model data; this dump does not contain them
  (look in the TowerModel JSON/NK data: BankModel, CashModel, EmissionsPerRoundFilterModel, BananaCashIncreaseSupportModel, MonkeyCityIncomeSupportModel, BananaCentralBuffModel, MonkeyBankerModel, BankDepositsModel, ImfLoanModel, OverclockModel).
