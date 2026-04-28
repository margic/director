/**
 * RaceAnalyzer — Field-public race narrative synthesizer for the Director Agent.
 *
 * ## Data boundary — STRICT
 *
 * This class operates exclusively on **public per-car (CarIdx[]) shared memory
 * arrays** that are broadcast to every observer on the network. It must NEVER
 * read or receive:
 *
 *   ✗ PlayerCarMyIncidentCount / PlayerCarTeamIncidentCount  (rig-specific)
 *   ✗ FuelLevel / FuelLevelPct                               (rig-specific)
 *   ✗ SteeringWheelAngle / Speed / physics scalars            (rig-specific)
 *   ✗ Any other `PlayerCar*` iRacing variable
 *
 * Those values are **publisher-domain events** — they belong to the sim rig
 * that owns the player car. The publisher emits them to Race Control. The
 * Director Agent receives them back as context from RC; it never reads them
 * directly from shared memory.
 *
 * ## Allowed data sources (all from CarIdx[] public arrays)
 *
 *   ✓ CarIdxPosition         — overall position
 *   ✓ CarIdxClassPosition    — class position
 *   ✓ CarIdxLapCompleted     — laps completed
 *   ✓ CarIdxLapDistPct       — lap distance %
 *   ✓ CarIdxF2Time           — gap to leader
 *   ✓ CarIdxLastLapTime      — last lap time
 *   ✓ CarIdxBestLapTime      — session best lap
 *   ✓ CarIdxOnPitRoad        — on pit road flag
 *   ✓ SessionLapsRemainEx    — laps remaining (session scalar)
 *   ✓ SessionLapsRemain      — laps remaining fallback
 *
 * ## Caller pattern
 *   1. Call `update(state)` on every raceStateChanged event.
 *   2. Call `consumeEvents()` in `buildRaceContext()` to drain the queue and
 *      include the events in the `recentEvents` field of NextSequenceRequest.
 *   3. Call `reset()` on SESSION_LOADED or session clear.
 */

export type SynthesizedEventType =
  | 'LEADER_CHANGE'
  | 'LAPS_MILESTONE'
  | 'RACE_DISTANCE_MILESTONE'
  | 'BATTLE_APPROACHING'
  | 'POSITION_TREND'
  | 'STRATEGY_DIVERGENCE'
  | 'CONSISTENT_PACE'
  | 'PACE_DEGRADING';

export interface SynthesizedRaceEvent {
  type: SynthesizedEventType;
  /** Plain-English description intended for the AI planner. */
  description: string;
  timestamp: string;
  /** The car most directly relevant to this event, if applicable. */
  carNumber?: string;
  /** Structured data for programmatic use. */
  data?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Internal per-car tracking state
// ---------------------------------------------------------------------------

interface CarHistory {
  /** Most recent laps-completed count we've seen for this car. */
  lapCount: number;
  /** Rolling map of lap → overall position (keeps last POSITION_TREND_LAPS*2). */
  positionAtLap: Map<number, number>;
  /** Rolling last N lap times in seconds. */
  lapTimes: number[];
  /** lapsCompleted value at the time of the last observed pit exit. */
  lastPitExitLap: number | null;
  /** Pit-road status from the previous frame, used to detect transitions. */
  wasOnPitRoad: boolean;
}

// ---------------------------------------------------------------------------
// Thresholds — easy to tune
// ---------------------------------------------------------------------------

const POSITION_TREND_LAPS        = 5;    // laps of history for trend detection
const POSITION_TREND_MIN_CHANGE  = 3;    // must move at least this many places
const LAP_TIME_HISTORY_SIZE      = 8;    // rolling window for lap-time analysis
const CONSISTENT_PACE_LAPS       = 5;    // consecutive laps to qualify as consistent
const CONSISTENT_PACE_VARIANCE   = 0.06; // max spread (seconds) between best/worst
const DEGRADATION_LAPS           = 4;    // laps of slow running to flag degradation
const DEGRADATION_THRESHOLD_SEC  = 0.8;  // average must exceed best by this much
const BATTLE_APPROACHING_GAP_SEC = 2.5;  // gap threshold for pre-battle alert
const BATTLE_APPROACHING_TTL_MS  = 90_000; // suppress repeat for same car pair
const CONSISTENT_PACE_TTL_MS     = 180_000;
const PACE_DEGRADING_TTL_MS      = 180_000;
const STRATEGY_DIVERGENCE_TTL_MS = 120_000;
const POSITION_TREND_TTL_MS      = 60_000;
const TOP_N_CARS_FOR_PACE        = 8;    // only watch pace for top N cars

// ---------------------------------------------------------------------------
// RaceAnalyzer
// ---------------------------------------------------------------------------

export class RaceAnalyzer {
  private readonly carHistory = new Map<string, CarHistory>();

  private previousLeaderCarNumber: string | null = null;
  private readonly lapMilestonesFired   = new Set<number>();
  private readonly distMilestonesFired  = new Set<number>();
  private readonly pendingEvents: SynthesizedRaceEvent[] = [];

  private lastLapsRemain  = -1;
  private lastLeaderLap   = 0;

  /** Cooldown map: `${eventType}:${key}` → last-fired timestamp (ms). */
  private readonly cooldowns = new Map<string, number>();

  // -------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------

  /**
   * Feed the latest raceStateChanged snapshot into the analyzer.
   * Safe to call at high frequency — all operations are O(n) on car count.
   */
  update(state: RaceState): void {
    if (!state || !Array.isArray(state.cars) || state.cars.length === 0) return;

    const { cars, leaderLap = 0, totalSessionLaps = 0, sessionLapsRemain = -1 } = state;

    this.detectLeaderChange(cars);
    this.detectLapsMilestones(sessionLapsRemain);
    this.detectDistanceMilestones(leaderLap, totalSessionLaps);
    this.detectBattleApproaching(cars);

    // Per-car lap-completion work
    for (let i = 0; i < cars.length; i++) {
      const car = cars[i];
      const carNum = String(car.carNumber ?? '');
      if (!carNum) continue;

      let h = this.carHistory.get(carNum);
      if (!h) {
        h = {
          lapCount: car.lapsCompleted ?? 0,
          positionAtLap: new Map(),
          lapTimes: [],
          lastPitExitLap: null,
          wasOnPitRoad: car.onPitRoad ?? false,
        };
        this.carHistory.set(carNum, h);
      }

      // Pit-exit detection (onPitRoad true → false)
      const nowOnPit = car.onPitRoad ?? false;
      if (h.wasOnPitRoad && !nowOnPit) {
        h.lastPitExitLap = car.lapsCompleted ?? null;
      }
      h.wasOnPitRoad = nowOnPit;

      // Lap completion detection
      const lapNow = car.lapsCompleted ?? 0;
      if (lapNow > h.lapCount) {
        h.lapCount = lapNow;

        // Record position and lap time at this lap
        h.positionAtLap.set(lapNow, car.position ?? 0);
        const lt = car.lastLapTime ?? 0;
        if (lt > 0) {
          h.lapTimes.push(lt);
          if (h.lapTimes.length > LAP_TIME_HISTORY_SIZE) h.lapTimes.shift();
        }

        // Only run expensive analysis for top cars
        if ((car.position ?? 99) <= TOP_N_CARS_FOR_PACE) {
          if (h.positionAtLap.size >= POSITION_TREND_LAPS) {
            this.detectPositionTrend(carNum, lapNow, h);
          }
          if (h.lapTimes.length >= Math.max(CONSISTENT_PACE_LAPS, DEGRADATION_LAPS)) {
            this.detectPaceTrend(carNum, car.bestLapTime ?? 0, h);
          }
        }

        // Prune stale position history
        for (const k of h.positionAtLap.keys()) {
          if (k < lapNow - POSITION_TREND_LAPS * 3) h.positionAtLap.delete(k);
        }
      }
    }

    // Strategy divergence — only on lap-count changes to avoid spamming
    if (totalSessionLaps > 0 && leaderLap > this.lastLeaderLap) {
      this.detectStrategyDivergence(cars, leaderLap, totalSessionLaps);
    }

    this.lastLeaderLap = leaderLap;
  }

  /**
   * Drain and return all synthesized events accumulated since the last call.
   * Call this once per `sequences/next` request.
   */
  consumeEvents(): SynthesizedRaceEvent[] {
    const events = this.pendingEvents.splice(0);
    return events;
  }

  /**
   * Compute the number of laps the given car has been on-track since its
   * last pit exit. Returns `null` if the car has not yet pitted.
   */
  getStintLaps(carNumber: string, currentLap: number): number | null {
    const h = this.carHistory.get(carNumber);
    if (!h || h.lastPitExitLap === null) return null;
    return Math.max(0, currentLap - h.lastPitExitLap);
  }

  /**
   * Reset all accumulated state. Call on SESSION_LOADED or session clear.
   */
  reset(): void {
    this.carHistory.clear();
    this.previousLeaderCarNumber = null;
    this.lapMilestonesFired.clear();
    this.distMilestonesFired.clear();
    this.pendingEvents.length = 0;
    this.lastLapsRemain = -1;
    this.lastLeaderLap = 0;
    this.cooldowns.clear();
  }

  // -------------------------------------------------------------------------
  // Detectors
  // -------------------------------------------------------------------------

  private detectLeaderChange(cars: RaceCarState[]): void {
    const leader = cars[0];
    if (!leader) return;
    const carNum = String(leader.carNumber ?? '');
    if (!carNum) return;

    if (this.previousLeaderCarNumber !== null && carNum !== this.previousLeaderCarNumber) {
      this.emit({
        type: 'LEADER_CHANGE',
        description: `Lead change: car #${carNum} takes P1 from #${this.previousLeaderCarNumber}`,
        carNumber: carNum,
        data: { newLeader: carNum, previousLeader: this.previousLeaderCarNumber },
      });
    }
    this.previousLeaderCarNumber = carNum;
  }

  private detectLapsMilestones(sessionLapsRemain: number): void {
    const lapsRemain = sessionLapsRemain > 32000 ? -1 : sessionLapsRemain;
    if (lapsRemain === this.lastLapsRemain || lapsRemain <= 0) return;

    for (const milestone of [10, 5, 3, 2, 1]) {
      if (lapsRemain === milestone && !this.lapMilestonesFired.has(milestone)) {
        this.lapMilestonesFired.add(milestone);
        this.emit({
          type: 'LAPS_MILESTONE',
          description: `${milestone} lap${milestone === 1 ? '' : 's'} to go`,
          data: { lapsRemain: milestone },
        });
      }
    }
    this.lastLapsRemain = lapsRemain;
  }

  private detectDistanceMilestones(leaderLap: number, totalSessionLaps: number): void {
    if (totalSessionLaps <= 0 || leaderLap <= 0) return;
    const pct = leaderLap / totalSessionLaps;

    for (const milestone of [0.25, 0.50, 0.75, 0.90]) {
      if (pct >= milestone && !this.distMilestonesFired.has(milestone)) {
        this.distMilestonesFired.add(milestone);
        this.emit({
          type: 'RACE_DISTANCE_MILESTONE',
          description: `Race is ${Math.round(milestone * 100)}% complete — lap ${leaderLap} of ${totalSessionLaps}`,
          data: { pct: milestone, leaderLap, totalSessionLaps },
        });
      }
    }
  }

  private detectBattleApproaching(cars: RaceCarState[]): void {
    const now = Date.now();
    for (const car of cars) {
      const pos = car.position ?? 0;
      if (pos <= 1) continue;

      const gap = car.gapToCarAhead ?? 0;
      if (gap <= 0 || gap >= BATTLE_APPROACHING_GAP_SEC) continue;

      const carNum = String(car.carNumber ?? '');
      const aheadCar = cars.find(c => (c.position ?? 0) === pos - 1);
      const aheadNum = aheadCar ? String(aheadCar.carNumber) : '?';
      const cooldownKey = `BATTLE_APPROACHING:${aheadNum}_${carNum}`;

      if (this.isCooledDown(cooldownKey, BATTLE_APPROACHING_TTL_MS, now)) {
        this.cooldowns.set(cooldownKey, now);
        this.emit({
          type: 'BATTLE_APPROACHING',
          description: `Car #${carNum} (P${pos}) closing on #${aheadNum} (P${pos - 1}) — gap ${gap.toFixed(3)}s`,
          carNumber: carNum,
          data: { attackerCarNumber: carNum, defenderCarNumber: aheadNum, gapSec: gap, attackerPos: pos },
        });
      }
    }
  }

  private detectPositionTrend(carNum: string, currentLap: number, h: CarHistory): void {
    const now = Date.now();
    const cooldownKey = `POSITION_TREND:${carNum}`;
    if (!this.isCooledDown(cooldownKey, POSITION_TREND_TTL_MS, now)) return;

    // Find the recorded position POSITION_TREND_LAPS laps ago
    const targetLap = currentLap - POSITION_TREND_LAPS;
    let earliestPos: number | undefined;
    let earliestLap = Infinity;
    for (const [lap, pos] of h.positionAtLap) {
      if (lap >= targetLap && lap < currentLap && lap < earliestLap) {
        earliestLap = lap;
        earliestPos = pos;
      }
    }
    if (earliestPos === undefined) return;

    const currentPos = h.positionAtLap.get(currentLap) ?? 0;
    if (currentPos <= 0) return;

    const change = earliestPos - currentPos; // positive = moving forward (gained positions)
    if (Math.abs(change) < POSITION_TREND_MIN_CHANGE) return;

    const direction = change > 0 ? 'gaining' : 'losing';
    this.cooldowns.set(cooldownKey, now);
    this.emit({
      type: 'POSITION_TREND',
      description: `Car #${carNum} is ${direction} — moved ${Math.abs(change)} places in ${POSITION_TREND_LAPS} laps, now P${currentPos}`,
      carNumber: carNum,
      data: { positionChange: change, currentPos, fromPos: earliestPos, overLaps: POSITION_TREND_LAPS },
    });
  }

  private detectPaceTrend(carNum: string, bestLapTime: number, h: CarHistory): void {
    const now = Date.now();

    // Consistent pace: last CONSISTENT_PACE_LAPS within CONSISTENT_PACE_VARIANCE of each other
    const recent = h.lapTimes.slice(-CONSISTENT_PACE_LAPS);
    if (recent.length >= CONSISTENT_PACE_LAPS) {
      const spread = Math.max(...recent) - Math.min(...recent);
      const avg = recent.reduce((a, b) => a + b, 0) / recent.length;

      if (spread < CONSISTENT_PACE_VARIANCE && bestLapTime > 0 && avg < bestLapTime * 1.012) {
        const ck = `CONSISTENT_PACE:${carNum}`;
        if (this.isCooledDown(ck, CONSISTENT_PACE_TTL_MS, now)) {
          this.cooldowns.set(ck, now);
          this.emit({
            type: 'CONSISTENT_PACE',
            description: `Car #${carNum} on a controlled run — ${CONSISTENT_PACE_LAPS} laps within ${(spread * 1000).toFixed(0)}ms variance`,
            carNumber: carNum,
            data: { avgLapTime: avg, spread, bestLapTime },
          });
        }
      }
    }

    // Pace degradation: average of last DEGRADATION_LAPS exceeds best by threshold
    const degradRecent = h.lapTimes.slice(-DEGRADATION_LAPS);
    if (degradRecent.length >= DEGRADATION_LAPS && bestLapTime > 0) {
      const avg = degradRecent.reduce((a, b) => a + b, 0) / degradRecent.length;
      if (avg > bestLapTime + DEGRADATION_THRESHOLD_SEC) {
        const ck = `PACE_DEGRADING:${carNum}`;
        if (this.isCooledDown(ck, PACE_DEGRADING_TTL_MS, now)) {
          this.cooldowns.set(ck, now);
          this.emit({
            type: 'PACE_DEGRADING',
            description: `Car #${carNum} pace degrading — averaging +${(avg - bestLapTime).toFixed(2)}s off best over ${DEGRADATION_LAPS} laps`,
            carNumber: carNum,
            data: { avgLapTime: avg, bestLapTime, deltaFromBest: avg - bestLapTime },
          });
        }
      }
    }
  }

  private detectStrategyDivergence(cars: RaceCarState[], leaderLap: number, totalSessionLaps: number): void {
    // Only relevant in second half of race
    if (leaderLap / totalSessionLaps < 0.40) return;

    const now = Date.now();
    const ck = 'STRATEGY_DIVERGENCE:field';
    if (!this.isCooledDown(ck, STRATEGY_DIVERGENCE_TTL_MS, now)) return;

    const pittedCars   = cars.filter(c => this.carHistory.get(String(c.carNumber ?? ''))?.lastPitExitLap !== null);
    const unpittedCars = cars.filter(c => this.carHistory.get(String(c.carNumber ?? ''))?.lastPitExitLap === null);
    const total = cars.length;
    if (total === 0 || unpittedCars.length === 0) return;

    const pittedFraction = pittedCars.length / total;

    // Fire when 60%+ have pitted and ≤5 cars are still on the original strategy
    if (pittedFraction >= 0.60 && unpittedCars.length <= 5) {
      this.cooldowns.set(ck, now);
      const nums = unpittedCars.slice(0, 5).map(c => `#${c.carNumber}`).join(', ');
      this.emit({
        type: 'STRATEGY_DIVERGENCE',
        description: `${Math.round(pittedFraction * 100)}% of field has pitted — ${unpittedCars.length} car(s) still on original strategy: ${nums}`,
        data: {
          pittedFraction,
          unpittedCarNumbers: unpittedCars.map(c => String(c.carNumber)),
          totalCars: total,
        },
      });
    }
  }

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------

  /** Returns true if enough time has passed since the cooldown key was last set. */
  private isCooledDown(key: string, ttlMs: number, now: number = Date.now()): boolean {
    const last = this.cooldowns.get(key) ?? 0;
    return (now - last) >= ttlMs;
  }

  private emit(event: Omit<SynthesizedRaceEvent, 'timestamp'>): void {
    this.pendingEvents.push({ ...event, timestamp: new Date().toISOString() });
  }
}

// ---------------------------------------------------------------------------
// Minimal local type mirrors (avoids circular imports with iracing extension)
// ---------------------------------------------------------------------------

/**
 * Only fields sourced from public CarIdx[] shared memory arrays are permitted
 * here. Do NOT add FuelLevel, incident counts, or any PlayerCar* variable.
 */
interface RaceCarState {
  // --- CarIdxPosition / CarIdxClassPosition ---
  carNumber: string | number;
  position: number;
  classPosition: number;
  // --- CarIdxLapCompleted / CarIdxLapDistPct ---
  lapsCompleted: number;
  lapDistPct: number;
  // --- CarIdxF2Time (gap to leader; gapToCarAhead computed in buildRaceState) ---
  gapToLeader: number;
  gapToCarAhead: number;
  // --- CarIdxOnPitRoad ---
  onPitRoad: boolean;
  // --- CarIdxLastLapTime / CarIdxBestLapTime ---
  lastLapTime: number;
  bestLapTime: number;
}

interface RaceState {
  cars: RaceCarState[];
  leaderLap?: number;
  totalSessionLaps?: number;
  sessionLapsRemain?: number;
  sessionTimeRemain?: number;
  focusedCarIdx?: number;
  sessionFlags?: number;
  trackName?: string;
}
