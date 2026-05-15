/**
 * player-stopped-detector.test.ts
 */
import { describe, it, expect } from 'vitest';
import { detectPlayerStopped, PLAYER_STOPPED_SPEED_MPS, PLAYER_STOPPED_MIN_DURATION_SEC } from '../driver-publisher/player-stopped-detector';
import { createSessionState } from '../session-state';
import { makeFrame, seedRoster } from './frame-fixtures';
import { createDriverState } from '../driver-state';
import type { TelemetryFrame } from '../session-state';

const PLAYER = 0;
const ctx = { rigId: 'r1', raceSessionId: 's1', playerCarIdx: PLAYER };

/**
 * Build a sequence of frames where the player's speed and sessionTime vary.
 * Each entry is [speed (m/s), sessionTime (s)].
 */
function runFrames(frames: Array<{ speed: number; sessionTime: number; onPitRoad?: boolean }>): any[] {
  const state = createSessionState('s1', 1);
  seedRoster(state, [PLAYER]);
  const driverState = createDriverState(PLAYER);
  let prev: TelemetryFrame | null = null;
  const allEvents: any[] = [];

  for (const { speed, sessionTime, onPitRoad } of frames) {
    const frame = makeFrame({
      sessionTime,
      speed,
      cars: [{ carIdx: PLAYER, position: 5, lapDistPct: 0.3, onPitRoad: onPitRoad ?? false }],
    });
    allEvents.push(...detectPlayerStopped(prev, frame, state, driverState, ctx));
    prev = frame;
  }
  return allEvents;
}

describe('detectPlayerStopped', () => {
  it('fires PLAYER_STOPPED after sustained low speed on track', () => {
    const events = runFrames([
      { speed: 50, sessionTime: 0 },
      { speed: 0.5, sessionTime: 1 },
      { speed: 0.3, sessionTime: 2 },
      { speed: 0.2, sessionTime: 4 },  // 3s elapsed since speed dropped
      { speed: 0.1, sessionTime: 5 },
    ]);
    const stopped = events.filter((e) => e.type === 'PLAYER_STOPPED');
    expect(stopped).toHaveLength(1);
    expect(stopped[0].payload.speed).toBeLessThanOrEqual(PLAYER_STOPPED_SPEED_MPS);
    expect(stopped[0].payload.stoppedDurationSec).toBeGreaterThanOrEqual(PLAYER_STOPPED_MIN_DURATION_SEC);
  });

  it('does not fire before the minimum duration elapses', () => {
    const events = runFrames([
      { speed: 50, sessionTime: 0 },
      { speed: 0.5, sessionTime: 1 },
      { speed: 0.3, sessionTime: 2 },  // only 1s elapsed — too short
    ]);
    expect(events.filter((e) => e.type === 'PLAYER_STOPPED')).toHaveLength(0);
  });

  it('fires only once per stop (does not re-fire while still stopped)', () => {
    const events = runFrames([
      { speed: 50, sessionTime: 0 },
      { speed: 0.5, sessionTime: 1 },
      { speed: 0.3, sessionTime: 2 },
      { speed: 0.2, sessionTime: 4 },
      { speed: 0.1, sessionTime: 6 },
      { speed: 0.1, sessionTime: 8 },
      { speed: 0.1, sessionTime: 10 },
    ]);
    expect(events.filter((e) => e.type === 'PLAYER_STOPPED')).toHaveLength(1);
  });

  it('re-arms and fires again after the player resumes speed', () => {
    const events = runFrames([
      { speed: 50,  sessionTime: 0  },
      { speed: 0.5, sessionTime: 1  },
      { speed: 0.3, sessionTime: 4  },  // fires first stop
      { speed: 50,  sessionTime: 5  },  // resumes — clears state
      { speed: 0.5, sessionTime: 10 },
      { speed: 0.3, sessionTime: 13 },  // fires second stop
    ]);
    expect(events.filter((e) => e.type === 'PLAYER_STOPPED')).toHaveLength(2);
  });

  it('does not fire when on pit road', () => {
    const events = runFrames([
      { speed: 50,  sessionTime: 0, onPitRoad: false },
      { speed: 0.5, sessionTime: 1, onPitRoad: true  },
      { speed: 0.0, sessionTime: 4, onPitRoad: true  },
    ]);
    expect(events.filter((e) => e.type === 'PLAYER_STOPPED')).toHaveLength(0);
  });

  it('fires when player is stopped off-track (speed reliable, lapDistPct may stall)', () => {
    // Off-track stop: speed is 0, position valid — should still detect
    const events = runFrames([
      { speed: 40,  sessionTime: 0 },
      { speed: 0.2, sessionTime: 1 },
      { speed: 0.1, sessionTime: 4 },
    ]);
    const stopped = events.filter((e) => e.type === 'PLAYER_STOPPED');
    expect(stopped).toHaveLength(1);
    expect(stopped[0].payload.position).toBe(5);
  });

  it('returns empty when playerCarIdx < 0', () => {
    const state = createSessionState('s1', 1);
    const driverState = createDriverState(-1);
    const frame = makeFrame({ speed: 0 });
    const events = detectPlayerStopped(null, frame, state, driverState, {
      rigId: 'r1', raceSessionId: 's1', playerCarIdx: -1,
    });
    expect(events).toHaveLength(0);
  });
});
