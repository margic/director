# Race Narrative Improvements

> STATUS: PROPOSED. This document is a planning artefact. No code in `src/` implements
> it yet. Once approved, the implementation will be tracked through the GitHub issues
> drafted in the appendices at the end of this document, and this file's status will
> move to IMPLEMENTED with `src/` line references replacing the proposal text.

## 1. Problem statement

Live analysis of the "Jackie and Paul" session
(`5c2d8023-dda5-4c88-94aa-9e465913ea46`, 2026-05-10) showed three rigs in
Publisher Mode. Both driver rigs were emitting **session-scoped events for
every car on the grid** (PIT_ENTRY/EXIT/STOP, STINT_BEST_LAP for non-player
cars, POSITION_CHANGE, INCIDENT_POINT, FUEL_LEVEL_CHANGE), duplicating events
that the media rig already owns. At the same time, the cloud AI Director had
no rich telemetry for **the very drivers it is supposed to be narrating** —
the Sim RaceCenter drivers running on those rigs — because their
PERSONAL_BEST_LAP, LAP_TIME_DEGRADATION, STINT_MILESTONE, and personal fuel
state events were absent or sparse.

Two distinct problems:

1. **Scope contamination** — the driver-publisher detectors iterate `for (let i = 0;
   i < CAR_COUNT; i++)` and emit for every carIdx where they observe a state
   change, regardless of whether `i === playerCarIdx`. See
   `src/extensions/iracing/publisher/driver-publisher/pit-incident-detector.ts:55`,
   `pit-stop-detail-detector.ts:77`, and `lap-performance-driver.ts:50,63`.
2. **Race-state poverty** — the publisher tracks per-car bests, pit state, and
   fuel, but does **not** maintain the higher-order state an AI narrator
   needs to tell an evolving story: rolling gap deltas, "is the gap closing or
   opening", multi-car groups, class-relative position, stint strategy
   inferences, undercut/overcut potential, lap-on-lap fuel delta projection.

## 2. Current behaviour (as-built, May 2026)

### 2.1 Publisher pipelines

The publisher orchestrator constructs **both** sub-orchestrators
unconditionally and activates them as follows
(`src/extensions/iracing/publisher/orchestrator.ts:542-555`):

```text
                                         publisher.session.enabled  publisher.driver.enabled
Director Loop rig (race-control center)              true (default)         false (default)  → Session only
Driver-only rig (DIR-3 register flow)                true (default)         true            → Both pipelines active
```

A Driver rig (`registerDriver()` flow) **also** runs the Session Publisher
because no setting disables it. That is the source of the duplicate
session-scoped events. The fix is to make the driver-only flow set
`publisher.session.enabled = false` (or — preferred — replace both flags with
a single `publisher.scope: 'driver' | 'session' | 'both'` mode and enforce
that the Driver Publisher detectors filter to `playerCarIdx`).

### 2.2 Driver-publisher detectors that leak

All four currently scan all 64 carIdx slots:

| Detector | File | Events emitted | Should be scoped to |
|---|---|---|---|
| `detectPitAndIncidents` | `pit-incident-detector.ts` | `PIT_ENTRY`, `PIT_EXIT`, `OFF_TRACK`, `BACK_ON_TRACK`, `INCIDENT_POINT` | player only |
| `detectPitStopDetail` | `pit-stop-detail-detector.ts` | `PIT_STOP_BEGIN`, `PIT_STOP_END`, `FUEL_LEVEL_CHANGE` | player only |
| `detectDriverLapPerformance` | `lap-performance-driver.ts` | `STINT_BEST_LAP` (all cars), `PERSONAL_BEST_LAP`, `LAP_TIME_DEGRADATION` | `STINT_BEST_LAP` belongs to **session**; personal-best & degradation already gated on `i === playerCarIdx` |
| `detectPlayerPhysics` | `player-physics-detector.ts` | `BIG_HIT`, `SPIN_DETECTED`, `STOPPED_ON_TRACK`, `SLOW_CAR_AHEAD` | player only |

(`detectIncidentsAndMilestones` and `detectDriverSwap` already use
`playerCarIdx` only.)

### 2.3 AI Director input

`DirectorOrchestrator.getRaceContext()`
(`src/main/director-orchestrator.ts:200-260`) builds the snapshot that the AI
agent reads. The cars list **does** include `carClass: c.carClass || ''`
(line 219) — so the data is available at the Director level — but:

- The `PublisherEvent` stream that ends up in Race Control's `raceEvents`
  table only carries class context via `PublisherCarRef.carClassShortName`
  (`event-types.ts:48`), which is *optional* and **not populated** by
  `carRefFromRoster()` for events synthesised from the per-car arrays alone.
- `RaceContext.battles` (line 230-238) is computed cheaply from
  `gapToCarAhead < 1.0` on adjacent positions — it does not understand class
  groupings (a GT3 1 s behind an LMP2 is a "battle" in the current code,
  even though they're in different classes).
- `RaceContext` carries `drivers[]` and `recentEvents[]` but no derived
  trend information (closing rate, projected pit window, undercut
  opportunity).

### 2.4 Confirmed missing driver events

From the issue + a sweep of `event-types.ts` and the driver-publisher
detectors:

| Event | Emitted today? | Notes |
|---|---|---|
| `PERSONAL_BEST_LAP` | Code path exists in `lap-performance-driver.ts:96-109` but **only fires if `playerCarIdx` is set**. The DIR-3 flow does not always set it — see issue. |
| `LAP_TIME_DEGRADATION` | Same — gated on `playerCarIdx` being set. |
| `STINT_MILESTONE` | Emitted by `incident-stint-detector.ts` and gated correctly. Sparse because `estimatedStintLaps` is rarely set on driver rigs. |
| `FUEL_LOW` | Emitted by `pit-stop-detail-detector.ts` but suppressed by the all-car scan: triggers on every car's fuel level (which is meaningless — `FuelLevel` is player-only in the iRacing SDK). |
| `FUEL_LEVEL_CHANGE` | Same — fires on player car only because `FuelLevel` is player-only, but the detector loop still wastes cycles iterating 64 carIdx. |
| `SLOW_CAR_AHEAD` | Implemented in `player-physics-detector.ts`; we believe it fires correctly but reports indicate it's rare. |

## 3. Driver-specific iRacing data available

The iRacing SDK exposes far more per-driver state than we currently capture.
The publisher's `TelemetryFrame` (`session-state.ts:9-80`) already mirrors
the per-car arrays it needs for **session** events. For richer **driver**
narrative we want to also surface the following, which are all already in the
iRacing memory map:

| Field | Type | What it enables |
|---|---|---|
| `LapDeltaToBestLap`, `LapDeltaToOptimalLap` | float | "On pace for personal best" / "lap delta vs optimal" mid-lap callouts |
| `CarIdxEstTime` | f32[64] | Predicted lap time per car — basis for gap-trend projection |
| `CarIdxLapDistPct` (already captured) | f32[64] | Sector inference + group detection |
| `CarIdxRPM`, `CarIdxGear`, `CarIdxSteer` | f32/i32[64] | Driver workload, mistake detection |
| `PlayerCarPosition`, `PlayerCarClassPosition` | i32 | Class position vs overall position |
| `LapBestNLapTime`, `LapBestNLapLap` | f32/i32 | Rolling N-lap average (already buffered in `playerLapTimeBuffer`) |
| `OnPitRoad`, `PitSvFlags`, `PitSvFuel`, `PitSvLFP/RFP/LRP/RRP`, `PitSvTireCompound` | mixed | Pit service detail: who serviced what, what compound |
| `PlayerTrackSurface`, `PlayerTrackSurfaceMaterial` | i32 | Off-track surface classification |
| `LFcoldPressure`, `LFtempCL/M/R` (and RF/LR/RR) | f32 | Tyre temps + pressures — degradation context |
| `FuelUsePerHour` | f32 | More stable than per-lap fuel delta for stint projection |
| `dcBrakeBias`, `dcThrottleShape`, `dcTractionControl` | float | Setup-changes mid-stint |
| `BrakeABSactive`, `ShiftIndicatorPct` | bool/float | Driver style indicators |
| `RaceLaps`, `SessionLapsTotal`, `SessionLapsRemain`, `SessionTimeRemain` | mixed | Race phase ("opening laps" / "midrace" / "endgame") |
| `LapLasNLapSeq`, `dcStarter`, `EngineWarnings` | mixed | Mechanical narrative ("engine warning lit on lap 34") |

The point isn't to ship every one of these. The point is that **we are
nowhere near telemetry-bound** — we are *state*-bound. The next sections
define the minimum viable state model needed to drive a good narrative.

## 4. Race state we need to maintain

Today the publisher tracks per-car position/lap/pit state but throws away
the *trend*. To narrate a race we need each tick to update a small set of
derived series and cache the last N samples for change-detection.

Per-car state additions (extend `CarState`):

```ts
interface CarState {
  // ...existing fields...

  /** Rolling window of last 5 CarIdxF2Time samples (gap to car ahead). */
  recentGapToAhead: number[];
  /** Closing rate vs car ahead in seconds-per-lap; positive = closing. */
  closingRateToAhead: number;
  /** Same vs car behind. */
  recentGapToBehind: number[];
  closingRateToBehind: number;

  /** Last known carClassId — denormalised from setSessionMetadata roster. */
  carClassId: number;
  carClassShortName: string;

  /** Per-stint best, last 3 laps, and current stint-best — already partially tracked. */
  stintLapTimes: number[];

  /** Pit strategy: laps since last pit, projected pit window. */
  lapsSinceLastPit: number;
  estimatedFuelLapsRemaining: number;
  inPitWindow: boolean; // last 5 laps of estimated stint length

  /** Class-relative position trend — last 3 sample positions for hysteresis. */
  classPositionHistory: number[];
}
```

Session-level additions (extend `SessionState`):

```ts
interface SessionState {
  // ...existing fields...

  /** Race phase: 'opening' (< 25% laps) | 'midrace' | 'endgame' (> 75%) | 'final-laps' (< 5 laps to go). */
  racePhase: 'opening' | 'midrace' | 'endgame' | 'final-laps';

  /** Multi-car groups by class — cars within 1.0 s of each other. Rebuilt per tick. */
  classGroups: Map<number /* classId */, number[][] /* groups of carIdx */>;

  /** Strategy inferences: which car is on which fuel plan, last known undercut window. */
  pitStrategySummary: Map<number /* carIdx */, {
    estStintLaps: number;
    lapsRemainingInStint: number;
    undercutOpportunityAgainst: number | null; // carIdx
  }>;
}
```

The detectors then become **derived state observers**: they read the rolling
series and emit narrative events when a transition is observed (gap drops
below 0.5 s sustained 2 laps → `BATTLE_ENGAGED`; closing rate flips negative
→ `BATTLE_BROKEN`).

## 5. Driver-rig scope contract (the bug fix)

The fix the issue asks for is operationally simple. We propose the following
contract, replacing the two-flag (`publisher.session.enabled` +
`publisher.driver.enabled`) model:

```ts
type PublisherScope = 'session' | 'driver' | 'both';
//   'session' — Director Loop rig (race control center): all session-scoped
//               detectors run; driver-scoped detectors do not.
//   'driver'  — Driver rig in Publisher Mode: only driver-scoped detectors run,
//               and every detector is gated on `carIdx === playerCarIdx`. Session
//               events are never emitted.
//   'both'    — Reserved for development / single-rig demos. Not for production.
```

Stored at `publisher.scope`. Default `'session'`. Set to `'driver'` by the
`iracing.publisher.registerDriver` intent handler **before** activating the
pipeline. The legacy flags are migrated by `migrateConfig()` exactly the way
DIR-2/DIR-3 already migrates `publisher.enabled`.

### 5.1 Detector-level scope enforcement

Each detector in `driver-publisher/` is changed to accept a required
`playerCarIdx: number` (no `undefined` allowed) and replaces its
`for (let i = 0; i < CAR_COUNT; i++)` with a single-iteration access at
`playerCarIdx`. `STINT_BEST_LAP` (today in `lap-performance-driver.ts`)
is **moved** to `session-publisher/lap-performance-session.ts` where it
belongs — it is session-scoped (all cars get a stint-best signal).

This change is independent of the config refactor and could ship first; the
config refactor only changes **which** detectors fire on **which** rig.

### 5.2 Class context on every event

`PublisherCarRef` already has an optional `carClassShortName`. We propose
making `carClassShortName` **required** (or at minimum, always populated by
`carRefFromRoster()` whenever the roster carries it), and adding the numeric
`carClassId` as a stable identifier for class-aware filtering on the cloud
side. The roster propagation flow already plumbs both
(`orchestrator.setSessionMetadata` accepts `carClassByCarIdx` and
`carClassShortNames`), so this is a `carRefFromRoster()` change in
`session-state.ts` plus a small data-models doc update.

## 6. New / enriched events

We propose the following additions to the `PublisherEventType` union. All
are driver-pipeline events (`publisher.scope === 'driver'`) and gated on
`playerCarIdx`.

| New event | When to fire | Payload |
|---|---|---|
| `GAP_CLOSING` | Player's `CarIdxF2Time` to car ahead drops ≥ 0.3 s/lap, sustained 2 laps, gap < 3.0 s | `{ targetCar, gapSec, closingRateSecPerLap }` |
| `GAP_OPENING` | Reverse of above — gap to car ahead grows ≥ 0.3 s/lap | same |
| `PACE_DROP` | Last 2 laps both ≥ 1.5% slower than stint best, when not in pit window | `{ deltaPct, lapTimes: number[] }` |
| `SECTOR_PERSONAL_BEST` | Player improves a sector best (uses `LapDeltaToBestLap` zero-crossing) | `{ sector: 1\|2\|3, deltaSec }` |
| `CLASS_POSITION_GAIN` / `_LOSS` | `PlayerCarClassPosition` changes (filtered through 2-frame hysteresis) | `{ previousClassPos, newClassPos, classId, classShortName }` |
| `IN_PIT_WINDOW` | Player crosses into the last 5 laps of `estimatedStintLaps` for the first time this stint | `{ lapsRemainingInStint }` |
| `FUEL_PROJECTION` | Once per lap when projected `lapsRemaining = FuelLevel / FuelUsePerLap` falls below a threshold (e.g. ≤ stintLapsTarget) | `{ projectedLaps, fuelLevel, fuelPerLap }` |
| `TYRE_TEMP_DRIFT` | Any tyre LF/RF/LR/RR `tempCM` rises > 15 °C above its 5-sample baseline | `{ tyre, tempC, baselineC }` |
| `MISTAKE_OFF` (rename of OFF_TRACK in driver scope) | already exists; payload upgraded with `severity` derived from speed loss and lap-time impact | `{ lapDistPct, speedDeltaMps, lapTimeImpactSec }` |
| `ENGINE_WARNING` | iRacing `EngineWarnings` bitmask changes (water temp, fuel pressure, oil pressure, stalled, pit speed limiter) | `{ warningFlags, warningNames: string[] }` |

These give the AI Director the vocabulary it needs to say things like:
"#42 just gained class position on the GT3 in front and is closing at 0.4 s
per lap with three laps until their pit window opens — undercut is on the
table."

## 7. Race Control API changes

Race Control (`margic/racecontrol`) is the system of record for `raceEvents`.
Two changes are needed to support the new event types:

1. **Accept the new event type literals** at `POST /api/telemetry/events`.
   The endpoint today validates against the union in the OpenAPI spec; new
   types will fail validation until added. See appendix B for the issue
   draft to file at `margic/racecontrol/issues/new`.
2. **Surface car-class context** in the cloud-side `raceEvents` projection
   so the AI agent's snapshot includes class for every event it reads.
   Currently the cloud derives class from a separate roster table; when
   `carClassShortName` is missing on an event ref, the AI sees `"class": ""`.

We do not propose to change the existing event types' payloads — only to
**add** new ones. This is a backward-compatible change.

## 8. Implementation roadmap

Phased so each phase is independently shippable and testable.

### Phase 1 — Stop the bleeding (the bug fix)

1. **Director [#146](https://github.com/margic/director/issues/146)** Driver-publisher detectors: scope to `playerCarIdx` only.
2. **Director [#147](https://github.com/margic/director/issues/147)** Move `STINT_BEST_LAP` emission from
   `driver-publisher/lap-performance-driver.ts` to
   `session-publisher/lap-performance-session.ts`.
3. **Director [#148](https://github.com/margic/director/issues/148)** Introduce `publisher.scope` setting and migrate the two
   legacy flags. `registerDriver()` sets `scope = 'driver'`.

After Phase 1 the duplicate session events from driver rigs are gone, and
the existing `PERSONAL_BEST_LAP` / `LAP_TIME_DEGRADATION` / `FUEL_*` events
start arriving reliably because their gating no longer fights an all-car
loop that was overwriting state.

### Phase 2 — Class awareness end-to-end

4. **Director [#149](https://github.com/margic/director/issues/149)** Make `carRefFromRoster()` always populate
   `carClassShortName` and add `carClassId` to `PublisherCarRef`.
5. **Director [#150](https://github.com/margic/director/issues/150)** Class-aware `RaceContext.battles` — pair cars by
   class group, not just adjacent overall position.
6. **RaceControl [margic/racecontrol#324](https://github.com/margic/racecontrol/issues/324)** Accept and persist `carClassId` on event refs;
   include in raceEvents projection.

### Phase 3 — Race-state model

7. **Director [#151](https://github.com/margic/director/issues/151)** Extend `CarState` and `SessionState` with the trend
   fields in §4. Add a `RaceStateAggregator` that updates the rolling
   series on every frame.
8. **Director [#152](https://github.com/margic/director/issues/152)** Compute and persist `racePhase` and `classGroups`.

### Phase 4 — Narrative events

9. **Director [#153](https://github.com/margic/director/issues/153)** Implement `GAP_CLOSING` / `GAP_OPENING` (and emit them
   from a new `gap-trend-detector.ts`).
10. **Director [#154](https://github.com/margic/director/issues/154)** Implement `CLASS_POSITION_GAIN` / `CLASS_POSITION_LOSS`.
11. **Director [#155](https://github.com/margic/director/issues/155)** Implement `IN_PIT_WINDOW` and `FUEL_PROJECTION` using
    the new pit-strategy summary.
12. **Director [#156](https://github.com/margic/director/issues/156)** Implement `PACE_DROP`, `SECTOR_PERSONAL_BEST`,
    `TYRE_TEMP_DRIFT`, `ENGINE_WARNING`.
13. **RaceControl [margic/racecontrol#325](https://github.com/margic/racecontrol/issues/325)** Add the new event type literals to the OpenAPI spec
    and the validator.

Each new event type ships with detector unit tests in
`src/extensions/iracing/publisher/__tests__/` modelled on the existing
`lap-performance-detector.test.ts` pattern.

## 9. Testing notes

- Detector tests use deterministic `TelemetryFrame` fixtures from
  `__tests__/frame-fixtures.ts`. New detectors get their own
  `*-detector.test.ts` next to those.
- The scope refactor adds a single orchestrator-level test asserting that
  with `publisher.scope === 'driver'`, no session-pipeline event types
  (`OVERTAKE`, `LAP_COMPLETED` for non-player cars, `FLAG_*`, etc.) ever
  reach the transport queue, even when the input frame contains state
  changes for every carIdx.
- Race-state-aggregator tests use a multi-frame fixture (10–20 ticks)
  to exercise the rolling-window logic.

## 10. Open questions

- Should driver rigs *also* be able to emit a small set of session-scoped
  events for redundancy (e.g. `FLAG_RED`)? Current proposal says no —
  the media rig is authoritative — but if a media rig is offline the cloud
  loses red-flag visibility. May warrant a future "failover scope".
- `FuelUsePerHour` is averaged by iRacing over the last few laps and is more
  stable than computing our own `playerFuelPerLap`. Worth using directly?
- Should `STINT_MILESTONE` percent thresholds be configurable, or stay
  fixed at 25/50/75? Long endurance stints (≥ 2 h) would benefit from
  10/25/50/75/90.

---

## Appendix A — Director-repo issues to create

These are ready-to-file. Title format follows the existing `margic/director`
convention ("subsystem: imperative summary"). Body uses the same headings
as recent issues in the repo.

> NOTE: All issues below have been created. Links are included in each heading.

### Issue [#146](https://github.com/margic/director/issues/146) — `publisher: scope driver-rig detectors to playerCarIdx only`

```text
## Context
Live session analysis (5c2d8023-dda5-4c88-94aa-9e465913ea46) showed
driver rigs emitting PIT_ENTRY/EXIT/STOP, STINT_BEST_LAP, POSITION_CHANGE,
INCIDENT_POINT, and FUEL_LEVEL_CHANGE for every car in the session. The
driver-publisher detectors iterate `for (let i = 0; i < CAR_COUNT; i++)`
and emit on any per-car state change.

## Affected detectors
- src/extensions/iracing/publisher/driver-publisher/pit-incident-detector.ts (line 55)
- src/extensions/iracing/publisher/driver-publisher/pit-stop-detail-detector.ts (line 77)
- src/extensions/iracing/publisher/driver-publisher/lap-performance-driver.ts (lines 50, 63)
- src/extensions/iracing/publisher/driver-publisher/player-physics-detector.ts (line 151)

## Required change
Replace the all-cars loop with a single access at `ctx.playerCarIdx`. Make
`playerCarIdx` a required (non-optional) field on each detector's context
type. If `playerCarIdx` is unset at the time a frame is delivered, the
detector returns `[]` and logs once.

## Tests
- Add a multi-car telemetry fixture where every carIdx changes pit state
  and lap state on the same tick. Assert exactly one event of each type
  is emitted, and it carries `car.carIdx === playerCarIdx`.

## Out of scope
The `publisher.scope` config refactor (Issue N3) and the `STINT_BEST_LAP`
relocation (Issue N2).

Refs: documents/feature_race_narrative.md §5.1
```

### Issue [#147](https://github.com/margic/director/issues/147) — `publisher: move STINT_BEST_LAP to session-publisher`

```text
## Context
STINT_BEST_LAP is currently emitted by the driver pipeline in
src/extensions/iracing/publisher/driver-publisher/lap-performance-driver.ts
for every carIdx whose CarIdxLastLapTime improves. This is session-scoped
data: every rig sees it for every car. It should originate from the
session publisher only.

## Required change
1. Remove the STINT_BEST_LAP block from `detectDriverLapPerformance` (keep
   only PERSONAL_BEST_LAP and LAP_TIME_DEGRADATION for `playerCarIdx`).
2. Add an equivalent block in
   src/extensions/iracing/publisher/session-publisher/lap-performance-session.ts
   that tracks per-car stint bests and emits STINT_BEST_LAP from the
   session pipeline.
3. Tests in __tests__/lap-performance-detector.test.ts move accordingly.

Refs: documents/feature_race_narrative.md §5.1, §8 Phase 1
```

### Issue [#148](https://github.com/margic/director/issues/148) — `publisher: introduce publisher.scope setting`

```text
## Context
The driver-rig publisher today runs both pipelines because the orchestrator
keys driver-pipeline activation on `publisher.driver.enabled` independently
of session pipeline activation. There is no single switch that says
"this rig is driver-only".

## Required change
1. Add a new setting `publisher.scope`: `'session' | 'driver' | 'both'`,
   default `'session'`.
2. Update `PublisherOrchestrator.startSessionPipeline()` to use the new
   scope:
     - 'session' → activate SessionPublisher only.
     - 'driver'  → activate DriverPublisher only.
     - 'both'    → activate both (dev/demo only — log a warning).
3. `registerDriver()` must persist `publisher.scope = 'driver'` before
   activating the pipeline.
4. Migrate legacy keys in `migrateConfig()`:
     - `publisher.driver.enabled === true && publisher.session.enabled === true` → `'both'`
     - `publisher.driver.enabled === true && publisher.session.enabled === false` → `'driver'`
     - default → `'session'`
   Delete the legacy keys after migration.

## UI
The publisher panel renderer (`src/extensions/iracing/renderer/`) gains a
read-only "Scope: Driver / Session" badge.

## Tests
Extend `__tests__/orchestrator.test.ts` with three describe blocks, one per
scope value, asserting which sub-orchestrator is active.

Refs: documents/feature_race_narrative.md §5
```

### Issue [#149](https://github.com/margic/director/issues/149) — `publisher: always populate carClass on PublisherCarRef`

```text
## Context
PublisherCarRef.carClassShortName is optional today. carRefFromRoster()
(src/extensions/iracing/publisher/session-state.ts) does not populate it
unless the roster includes it. Result: events emitted from per-car array
sweeps arrive at Race Control with no class context, and the AI Director
sees `"class": ""` in raceEvents projection.

## Required change
1. Add `carClassId: number` to `PublisherCarRef`.
2. Update `carRefFromRoster()` to always populate `carClassShortName` and
   `carClassId` from the roster map seeded by
   `PublisherOrchestrator.setSessionMetadata()`.
3. When the roster has not yet resolved a carIdx, return `undefined` from
   `carRefFromRoster()` (current behaviour) — do not emit an event without
   class context.

## Tests
- session-state.test.ts: roster with class data → carRefFromRoster returns
  both fields populated.
- Orchestrator wiring test: setSessionMetadata with carClassByCarIdx + 
  carClassShortNames results in carRefFromRoster returning both fields.

Refs: documents/feature_race_narrative.md §5.2, §8 Phase 2
```

### Issue [#150](https://github.com/margic/director/issues/150) — `director: class-aware battles in RaceContext`

```text
## Context
DirectorOrchestrator.getRaceContext() currently builds `battles[]` by
walking adjacent overall positions and pairing cars with gapToCarAhead <
1.0 s. In a multi-class session this groups a GT3 with the LMP2 in front,
which is not a real battle.

## File
src/main/director-orchestrator.ts (lines 230-238)

## Required change
1. Group cars by `carClass` first.
2. Within each class, sort by classPosition and walk adjacent pairs.
3. Emit a battle only when both cars are in the same class AND gap < 1.0 s.

## Tests
- director-orchestrator.test.ts: 6-car mixed-class scenario (3 GT3, 3
  LMP2) where a GT3 sits 0.5 s behind an LMP2. Expect no battle for that
  pair, and a battle for any same-class pair under 1.0 s.

Refs: documents/feature_race_narrative.md §8 Phase 2
```

### Issue [#151](https://github.com/margic/director/issues/151) — `publisher: extend CarState/SessionState with trend fields`

```text
## Context
The publisher tracks point-in-time per-car state but discards trends.
Narrative events (gap closing, pit window approaching, pace dropping)
require rolling windows of recent samples.

## Required change
Extend interfaces in src/extensions/iracing/publisher/session-state.ts:

CarState additions:
- recentGapToAhead: number[];           // last 5 samples of CarIdxF2Time
- closingRateToAhead: number;
- recentGapToBehind: number[];
- closingRateToBehind: number;
- lapsSinceLastPit: number;
- estimatedFuelLapsRemaining: number;
- inPitWindow: boolean;
- classPositionHistory: number[];       // last 3 samples

SessionState additions:
- racePhase: 'opening' | 'midrace' | 'endgame' | 'final-laps';
- classGroups: Map<number, number[][]>;
- pitStrategySummary: Map<number, { estStintLaps; lapsRemainingInStint; undercutOpportunityAgainst }>;

## Aggregator
Add a new module `src/extensions/iracing/publisher/shared/race-state-aggregator.ts`
that updates all of the above each frame BEFORE detectors run. Wire into
SessionPublisherOrchestrator.onTelemetryFrame() at the top of the pipeline.

## Tests
- race-state-aggregator.test.ts: 20-frame fixture exercising window
  rollover, closing-rate flip, race-phase transition, class-group
  formation.

Refs: documents/feature_race_narrative.md §4, §8 Phase 3
```

### Issue [#152](https://github.com/margic/director/issues/152) — `publisher: compute racePhase and classGroups`

```text
Subset of #151 — split out so it can ship independently if the trend
window work blocks. racePhase derives from SessionLapsRemain/Total or
SessionTimeRemain. classGroups recomputes per frame from
CarIdxClassPosition + CarIdxF2Time.

Refs: documents/feature_race_narrative.md §4
```

### Issue [#153](https://github.com/margic/director/issues/153) — `publisher: emit GAP_CLOSING / GAP_OPENING events`

```text
## Context
The driver narrative needs to know when the player is closing on the car
ahead or being closed on from behind. Currently the publisher only emits
on the binary BATTLE_ENGAGED / BATTLE_BROKEN transitions inside 2.0 s,
which misses the entire approach phase.

## File (new)
src/extensions/iracing/publisher/driver-publisher/gap-trend-detector.ts

## Required change
1. Add event type GAP_CLOSING and GAP_OPENING to event-types.ts and the
   payload map. Payload: { targetCar, gapSec, closingRateSecPerLap, direction: 'ahead'|'behind' }.
2. Consume CarState.recentGapToAhead / .recentGapToBehind populated by N6.
3. Emit GAP_CLOSING when:
   - gapSec < 3.0 AND closingRateSecPerLap >= 0.3 sustained 2 frames
   - cooldown 30 s before re-emitting
4. Emit GAP_OPENING when the inverse holds.

## Tests
- gap-trend-detector.test.ts: 4-lap fixture where gap goes 2.8 → 2.4 → 2.0
  → 1.5. Assert exactly one GAP_CLOSING with the correct rate.

Refs: documents/feature_race_narrative.md §6, §8 Phase 4
```

### Issue [#154](https://github.com/margic/director/issues/154) — `publisher: emit CLASS_POSITION_GAIN / LOSS`

```text
Use PlayerCarClassPosition + 2-frame hysteresis. Payload:
{ previousClassPos, newClassPos, classId, classShortName, reason: 'overtake'|'pit_cycle'|'other' }.

Wire alongside the existing POSITION_CHANGE detector but driver-scoped.

Refs: documents/feature_race_narrative.md §6
```

### Issue [#155](https://github.com/margic/director/issues/155) — `publisher: emit IN_PIT_WINDOW and FUEL_PROJECTION`

```text
## Context
The AI Director should know when a driver enters their strategic pit window
and when fuel projection drops below their remaining stint plan.

## Required change
1. Detector new file: driver-publisher/pit-window-detector.ts.
2. IN_PIT_WINDOW fires once when CarState.inPitWindow flips false→true.
3. FUEL_PROJECTION fires at most once per lap when
   `estimatedFuelLapsRemaining` ≤ a configurable threshold (default = stint
   target laps).
4. Both depend on N6.

Refs: documents/feature_race_narrative.md §6
```

### Issue [#156](https://github.com/margic/director/issues/156) — `publisher: emit PACE_DROP, SECTOR_PERSONAL_BEST, TYRE_TEMP_DRIFT, ENGINE_WARNING`

```text
Combined narrative-polish issue. Each event implemented in its own
detector module; tests for each.

- PACE_DROP: 2 consecutive laps ≥ 1.5% slower than stint-best AND not in
  pit window.
- SECTOR_PERSONAL_BEST: LapDeltaToBestLap crosses < 0 in a sector boundary.
- TYRE_TEMP_DRIFT: any tyre middle temp rises > 15 °C above 5-sample
  baseline; cooldown 60 s per tyre.
- ENGINE_WARNING: EngineWarnings bitmask change.

Refs: documents/feature_race_narrative.md §6
```

## Appendix B — Race Control issues to create (`margic/racecontrol`)

### Issue [margic/racecontrol#324](https://github.com/margic/racecontrol/issues/324) — `telemetry: accept carClassId on PublisherCarRef`

```text
## Context
Director will start populating carClassId (numeric) and carClassShortName
(string) on every PublisherCarRef in raceEvents payloads. Cloud needs to
persist both and surface them on the raceEvents projection consumed by
the AI Director.

## Affected
- POST /api/telemetry/events validator schema.
- raceEvents table — add carClassId column (nullable for back-compat).
- AI snapshot builder — include carClassId/carClassShortName on every
  event's car ref.

## Compatibility
Backward compatible. Old events without the fields continue to validate
and persist with null class.

Refs: margic/director documents/feature_race_narrative.md §7
```

### Issue [margic/racecontrol#325](https://github.com/margic/racecontrol/issues/325) — `telemetry: register new event type literals`

```text
## Context
Director plans to add the following new event types as part of the
race-narrative work:

GAP_CLOSING, GAP_OPENING, PACE_DROP, SECTOR_PERSONAL_BEST,
CLASS_POSITION_GAIN, CLASS_POSITION_LOSS, IN_PIT_WINDOW, FUEL_PROJECTION,
TYRE_TEMP_DRIFT, ENGINE_WARNING

## Affected
- openapi.yaml — extend PublisherEventType enum.
- POST /api/telemetry/events validator.
- raceEvents projection — surface the new type names; AI Director will
  filter/use them.

## Payload schemas
See margic/director documents/feature_race_narrative.md §6 for proposed
payload shapes.

## Compatibility
Backward compatible — purely additive. Existing event types unchanged.

Refs: margic/director documents/feature_race_narrative.md §7
```

---

*End of document. When implementation begins, replace `STATUS: PROPOSED` at
the top with `STATUS: IMPLEMENTED` and add file-line refs to the new
detectors.*
