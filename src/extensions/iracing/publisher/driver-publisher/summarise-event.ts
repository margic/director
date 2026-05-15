/**
 * summarise-event.ts — Issue #179
 *
 * Pure function turning a PublisherEvent into a 1-line human-readable summary
 * suitable for downstream LLM prompts and renderer logs. Strictly read-only;
 * never mutates state. Returns a fallback when the event type is unknown so
 * future event types remain forward-compatible.
 */

import type { PublisherEvent } from '../event-types';

/**
 * Returns a one-line, human-readable summary of `event`. Format intentionally
 * compact (≤ 120 chars) — designed for inclusion in DRIVER_STATE_SNAPSHOT
 * payloads where many summaries are concatenated.
 */
export function summariseEvent(event: PublisherEvent): string {
  const carNum = event.car?.carNumber ? `#${event.car.carNumber}` : '';
  const driver = event.car?.driverName ?? '';
  const who = [carNum, driver].filter(Boolean).join(' ').trim();

  switch (event.type) {
    // §1 Lifecycle
    case 'PUBLISHER_HELLO':       return 'Publisher online';
    case 'PUBLISHER_HEARTBEAT':   return 'Heartbeat';
    case 'PUBLISHER_GOODBYE':     return 'Publisher offline';
    case 'IRACING_CONNECTED':     return 'iRacing connected';
    case 'IRACING_DISCONNECTED':  return 'iRacing disconnected';
    case 'SESSION_LOADED':        return 'Session loaded';
    case 'SESSION_STATE_CHANGE':  return `Session state → ${(event.payload as any).newState}`;
    case 'SESSION_TYPE_CHANGE':   return `Session type → ${(event.payload as any).newType}`;
    case 'RACE_GREEN':            return 'Race green flag';
    case 'RACE_CHECKERED':        return 'Race finished';
    case 'SESSION_ENDED':         return 'Session ended';

    // §2 Flags
    case 'FLAG_GREEN':              return 'Green flag';
    case 'FLAG_YELLOW_LOCAL':       return 'Local yellow';
    case 'FLAG_YELLOW_FULL_COURSE': return 'Full-course yellow';
    case 'FLAG_RED':                return 'Red flag';
    case 'FLAG_WHITE':              return 'White flag (last lap)';
    case 'FLAG_BLUE_DRIVER':        return `Blue flag for ${who}`;
    case 'FLAG_BLACK_DRIVER':       return `Black flag for ${who}`;
    case 'FLAG_MEATBALL_DRIVER':   return `Meatball for ${who}`;
    case 'FLAG_DEBRIS':             return 'Debris flag';
    case 'FLAG_DISQUALIFY':         return `Disqualified: ${who}`;

    // §3 Lap performance
    case 'LAP_COMPLETED': {
      const p = event.payload as any;
      return `${who} completed lap ${p.lapNumber} (${p.lapTime?.toFixed?.(3)}s)`;
    }
    case 'PERSONAL_BEST_LAP':
      return `${who} personal best ${(event.payload as any).lapTime?.toFixed?.(3)}s`;
    case 'SESSION_BEST_LAP':
      return `Session best ${(event.payload as any).lapTime?.toFixed?.(3)}s by ${who}`;
    case 'CLASS_BEST_LAP':
      return `Class best ${(event.payload as any).lapTime?.toFixed?.(3)}s by ${who}`;
    case 'LAP_TIME_DEGRADATION':
      return `${who} pace dropping (+${((event.payload as any).deltaPct ?? 0).toFixed?.(1)}%)`;
    case 'STINT_MILESTONE':
      return `Stint ${(event.payload as any).milestonePct}% complete`;
    case 'STINT_BEST_LAP':
      return `Stint best ${(event.payload as any).lapTime?.toFixed?.(3)}s`;

    // §4 Position & battle
    case 'OVERTAKE':
      return `${who} overtake`;
    case 'OVERTAKE_FOR_LEAD':
      return `${who} took the lead`;
    case 'OVERTAKE_FOR_CLASS':
      return `${who} class overtake`;
    case 'POSITION_CHANGE': {
      const p = event.payload as any;
      return `${who} P${p.previousPosition}→P${p.newPosition}`;
    }
    case 'BATTLE_ENGAGED':
      return `Battle engaged ${who}`;
    case 'BATTLE_CLOSING':
      return `Battle closing ${who}`;
    case 'BATTLE_BROKEN':
      return `Battle broken ${who}`;
    case 'LAPPED_TRAFFIC_AHEAD':
      return `Lapped traffic ahead`;
    case 'BEING_LAPPED':
      return `Being lapped`;
    case 'OVERALL_POSITION_LOSS': {
      const p = event.payload as any;
      return `Lost a position (P${p.previousPosition}→P${p.newPosition})`;
    }
    case 'OVERALL_POSITION_GAIN': {
      const p = event.payload as any;
      return `Gained a position (P${p.previousPosition}→P${p.newPosition})`;
    }

    // §5 Pit & strategy
    case 'PIT_ENTRY':       return `${who} pit entry`;
    case 'PIT_STOP_BEGIN':  return `${who} pit stop begin`;
    case 'PIT_STOP_END':    return `${who} pit stop end`;
    case 'PIT_EXIT':        return `${who} pit exit`;
    case 'FUEL_LEVEL_CHANGE':
      return `Refuel to ${(event.payload as any).newFuelLevel?.toFixed?.(1)}L`;
    case 'FUEL_LOW':
      return `Fuel low (${((event.payload as any).fuelLevelPct * 100).toFixed?.(0)}%)`;
    case 'OUT_LAP':
      return `Out lap`;

    // §6 Incidents
    case 'OFF_TRACK':         return `${who} off track`;
    case 'BACK_ON_TRACK':     return `${who} back on track`;
    case 'STOPPED_ON_TRACK':  return `${who} stopped on track`;
    case 'SLOW_CAR_AHEAD':    return `Slow car ahead`;
    case 'INCIDENT_POINT':
      return `Incident +${(event.payload as any).delta ?? 1}x`;
    case 'TEAM_INCIDENT_POINT':
      return `Team incident +${(event.payload as any).delta ?? 1}x`;
    case 'INCIDENT_LIMIT_WARNING':
      return `Incident limit at ${(event.payload as any).thresholdPct}%`;
    case 'BIG_HIT':           return `Big hit`;
    case 'SPIN_DETECTED':     return `Spin`;
    case 'PLAYER_STOPPED': {
      const p = event.payload as any;
      return `Player stopped (${p.stoppedDurationSec?.toFixed?.(1)}s)`;
    }
    case 'CONTACT_DETECTED': {
      const p = event.payload as any;
      const who = p.contactCar?.driverName ? ` with ${p.contactCar.driverName}` : '';
      return `${p.severity ?? 'unknown'} ${p.cause === 'car_contact' ? 'contact' : 'incident'}${who}`;
    }

    // §7 Identity
    case 'IDENTITY_RESOLVED':         return `Identity resolved: ${who}`;
    case 'IDENTITY_OVERRIDE_CHANGED': return `Identity override changed`;
    case 'DRIVER_SWAP_INITIATED':     return `Driver swap initiated → ${(event.payload as any).incomingDriverName}`;
    case 'DRIVER_SWAP_COMPLETED':     return `Driver swap complete → ${(event.payload as any).incomingDriverName}`;
    case 'ROSTER_UPDATED':            return `Roster updated`;

    // §8 Environment
    case 'WEATHER_CHANGE':    return `Weather change`;
    case 'TRACK_TEMP_DRIFT':
      return `Track temp drift Δ${((event.payload as any).deltaFromStartCelsius ?? 0).toFixed?.(1)}°C`;
    case 'WIND_SHIFT':        return `Wind shift`;
    case 'TIME_OF_DAY_PHASE':
      return `Time of day → ${(event.payload as any).phase}`;

    // §9 Race-narrative
    case 'GAP_CLOSING': {
      const p = event.payload as any;
      return `Closing on ${p.targetCar?.driverName ?? ''} (Δ${p.gapSec?.toFixed?.(2)}s)`;
    }
    case 'GAP_OPENING': {
      const p = event.payload as any;
      return `Gap opening to ${p.targetCar?.driverName ?? ''} (Δ${p.gapSec?.toFixed?.(2)}s)`;
    }
    case 'CLASS_POSITION_GAIN': {
      const p = event.payload as any;
      return `Class P${p.previousClassPos}→P${p.newClassPos}`;
    }
    case 'CLASS_POSITION_LOSS': {
      const p = event.payload as any;
      return `Class P${p.previousClassPos}→P${p.newClassPos}`;
    }
    case 'IN_PIT_WINDOW':
      return `In pit window (${(event.payload as any).lapsRemainingInStint} laps left)`;
    case 'FUEL_PROJECTION':
      return `Fuel projection ${(event.payload as any).projectedLaps?.toFixed?.(1)} laps`;
    case 'PACE_DROP':
      return `Pace drop +${((event.payload as any).deltaPct ?? 0).toFixed?.(1)}%`;
    case 'SECTOR_PERSONAL_BEST':
      return `Sector ${(event.payload as any).sector} PB`;
    case 'TYRE_TEMP_DRIFT': {
      const p = event.payload as any;
      return `Tyre ${p.tyre} Δ${p.deltaC?.toFixed?.(1)}°C`;
    }
    case 'ENGINE_WARNING':
      return `Engine warning: ${((event.payload as any).warningNames ?? []).join(', ')}`;

    // §10 AI consumer aids
    case 'DRIVER_STATE_SNAPSHOT': {
      const p = event.payload as any;
      const d = p?.derived;
      if (!d) return `Driver state snapshot`;
      const arc = d.narrativeArc ?? 'cruise';
      const stress =
        d.raceStress >= 0.7 ? 'stressed' :
        d.raceStress >= 0.4 ? 'engaged'  :
        'composed';
      const battle =
        d.competitiveFocus >= 0.66 ? ', battling' :
        d.competitiveFocus >= 0.33 ? ', in traffic' :
        '';
      const pace =
        d.paceTrend >  0.05 ? ', slowing' :
        d.paceTrend < -0.05 ? ', improving' :
        '';
      return `Snapshot[${arc}]: ${stress}${battle}${pace}`;
    }

    // §11 Composite events (#181)
    case 'BEING_PASSED_WHILE_STOPPED': {
      const p = event.payload as any;
      const who = p.overtakingCar?.driverName ? ` by ${p.overtakingCar.driverName}` : '';
      return `Passed while stopped${who} (#${p.positionsLostThisStop} this stop)`;
    }
    case 'RECOVERY_DRIVE': {
      const p = event.payload as any;
      return `Recovery drive: +${p.positionsRecovered} after ${p.triggerEvent}`;
    }
    case 'SAFETY_CAR_IMMINENT': {
      const p = event.payload as any;
      return `Safety car imminent (${p.stoppedCarCount} stopped in ${p.windowSec}s)`;
    }
  }

  // Forward-compatibility — exhaustive switch above; this is unreachable
  // unless a new event type is added without a case here.
  return `${(event as PublisherEvent).type}`;
}
