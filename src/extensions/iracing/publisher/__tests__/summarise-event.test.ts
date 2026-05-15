/**
 * summarise-event.test.ts — Issue #179
 *
 * Validates that summariseEvent returns a non-empty 1-line string for every
 * declared PublisherEventType. Guards against new event types being added
 * without a corresponding case in the switch.
 */
import { describe, it, expect } from 'vitest';
import { summariseEvent } from '../driver-publisher/summarise-event';
import { buildEvent } from '../session-state';
import type { PublisherEventType, PublisherEvent } from '../event-types';
import { makeFrame } from './frame-fixtures';

const ALL_EVENT_TYPES: PublisherEventType[] = [
  'PUBLISHER_HELLO', 'PUBLISHER_HEARTBEAT', 'PUBLISHER_GOODBYE',
  'IRACING_CONNECTED', 'IRACING_DISCONNECTED',
  'SESSION_LOADED', 'SESSION_STATE_CHANGE', 'SESSION_TYPE_CHANGE',
  'RACE_GREEN', 'RACE_CHECKERED', 'SESSION_ENDED',
  'FLAG_GREEN', 'FLAG_YELLOW_LOCAL', 'FLAG_YELLOW_FULL_COURSE',
  'FLAG_RED', 'FLAG_WHITE', 'FLAG_BLUE_DRIVER', 'FLAG_BLACK_DRIVER',
  'FLAG_MEATBALL_DRIVER', 'FLAG_DEBRIS', 'FLAG_DISQUALIFY',
  'LAP_COMPLETED', 'PERSONAL_BEST_LAP', 'SESSION_BEST_LAP', 'CLASS_BEST_LAP',
  'LAP_TIME_DEGRADATION', 'STINT_MILESTONE', 'STINT_BEST_LAP',
  'OVERTAKE', 'OVERTAKE_FOR_LEAD', 'OVERTAKE_FOR_CLASS', 'POSITION_CHANGE',
  'BATTLE_ENGAGED', 'BATTLE_CLOSING', 'BATTLE_BROKEN',
  'LAPPED_TRAFFIC_AHEAD', 'BEING_LAPPED',
  'OVERALL_POSITION_LOSS', 'OVERALL_POSITION_GAIN',
  'PIT_ENTRY', 'PIT_STOP_BEGIN', 'PIT_STOP_END', 'PIT_EXIT',
  'FUEL_LEVEL_CHANGE', 'FUEL_LOW', 'OUT_LAP',
  'OFF_TRACK', 'BACK_ON_TRACK', 'STOPPED_ON_TRACK', 'SLOW_CAR_AHEAD',
  'INCIDENT_POINT', 'TEAM_INCIDENT_POINT', 'INCIDENT_LIMIT_WARNING',
  'BIG_HIT', 'SPIN_DETECTED', 'PLAYER_STOPPED', 'CONTACT_DETECTED',
  'IDENTITY_RESOLVED', 'IDENTITY_OVERRIDE_CHANGED',
  'DRIVER_SWAP_INITIATED', 'DRIVER_SWAP_COMPLETED', 'ROSTER_UPDATED',
  'WEATHER_CHANGE', 'TRACK_TEMP_DRIFT', 'WIND_SHIFT', 'TIME_OF_DAY_PHASE',
  'GAP_CLOSING', 'GAP_OPENING',
  'CLASS_POSITION_GAIN', 'CLASS_POSITION_LOSS',
  'IN_PIT_WINDOW', 'FUEL_PROJECTION', 'PACE_DROP',
  'SECTOR_PERSONAL_BEST', 'TYRE_TEMP_DRIFT', 'ENGINE_WARNING',
  'DRIVER_STATE_SNAPSHOT',
];

function fakeEvent(type: PublisherEventType): PublisherEvent {
  const frame = makeFrame({ sessionTime: 1 });
  return buildEvent(
    type as any,
    { carIdx: 0, carNumber: '7', driverName: 'Test Driver' },
    {} as any,
    { raceSessionId: 's1', rigId: 'r1', frame },
  );
}

describe('summariseEvent', () => {
  it.each(ALL_EVENT_TYPES)('returns a non-empty string for %s', (type) => {
    const summary = summariseEvent(fakeEvent(type));
    expect(typeof summary).toBe('string');
    expect(summary.length).toBeGreaterThan(0);
  });

  it('includes lap time in LAP_COMPLETED summary', () => {
    const frame = makeFrame({ sessionTime: 1 });
    const ev = buildEvent(
      'LAP_COMPLETED',
      { carIdx: 0, carNumber: '7', driverName: 'Test' },
      { lapNumber: 5, lapTime: 92.345, fuelUsed: 2.1, position: 4, classPosition: 2 } as any,
      { raceSessionId: 's1', rigId: 'r1', frame },
    );
    expect(summariseEvent(ev)).toContain('92.345');
    expect(summariseEvent(ev)).toContain('lap 5');
  });

  it('handles missing car gracefully', () => {
    const frame = makeFrame({ sessionTime: 1 });
    const ev = buildEvent(
      'RACE_GREEN',
      { carIdx: 0 }, // minimal CarRef
      { lapNumber: 1 } as any,
      { raceSessionId: 's1', rigId: 'r1', frame },
    );
    expect(summariseEvent(ev)).toBe('Race green flag');
  });
});
