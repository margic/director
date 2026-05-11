/**
 * driver-publisher-scope.test.ts
 *
 * Integration test for the driver-rig scope contract (Issue: scope
 * driver-rig detectors to playerCarIdx only).
 *
 * Builds a multi-car telemetry fixture where every carIdx changes pit
 * state and lap state on the same tick. Asserts that each driver-pipeline
 * detector emits exactly one event of each affected type, and that the
 * event carries `car.carIdx === playerCarIdx`.
 */

import { describe, it, expect } from 'vitest';

import {
  detectPitAndIncidents,
  type PitIncidentDetectorContext,
} from '../driver-publisher/pit-incident-detector';
import {
  detectPitStopDetail,
  type PitStopDetailContext,
} from '../driver-publisher/pit-stop-detail-detector';
import {
  detectDriverLapPerformance,
  type DriverLapPerformanceContext,
} from '../driver-publisher/lap-performance-driver';
import { createSessionState } from '../session-state';
import { makeFrame, cloneFrame, CAR_COUNT, TrackSurface } from './frame-fixtures';

const PLAYER_CAR_IDX = 7;

function makeState() {
  return createSessionState('rs-multi', 1);
}

/** Build a frame where every car has identical baseline state. */
function multiCarBaseline() {
  const cars = [];
  for (let i = 0; i < CAR_COUNT; i++) {
    cars.push({
      carIdx:        i,
      position:      i + 1,
      lapsCompleted: 5,
      lastLapTime:   95,
      bestLapTime:   95,
      trackSurface:  TrackSurface.OnTrack,
      onPitRoad:     false,
    });
  }
  return makeFrame({ cars, sessionTime: 100, playerIncidentCount: 0 });
}

describe('driver-rig scope: every car changes state on the same tick', () => {
  it('detectPitAndIncidents emits exactly one PIT_ENTRY for the player car', () => {
    const state = makeState();
    const ctx: PitIncidentDetectorContext = {
      rigId: 'rig-01',
      raceSessionId: 'rs-multi',
      playerCarIdx: PLAYER_CAR_IDX,
    };

    const prev = multiCarBaseline();
    // Prime per-car state so cs.onPitRoad === false for every car.
    detectPitAndIncidents(null, prev, state, ctx);

    // Every car enters pit road on the same tick.
    const curr = cloneFrame(prev);
    for (let i = 0; i < CAR_COUNT; i++) curr.carIdxOnPitRoad[i] = 1;

    const events = detectPitAndIncidents(prev, curr, state, ctx);

    const entries = events.filter(e => e.type === 'PIT_ENTRY');
    expect(entries).toHaveLength(1);
    expect(entries[0].car?.carIdx).toBe(PLAYER_CAR_IDX);
  });

  it('detectPitAndIncidents emits exactly one PIT_EXIT/POSITION_CHANGE for the player car', () => {
    const state = makeState();
    const ctx: PitIncidentDetectorContext = {
      rigId: 'rig-01',
      raceSessionId: 'rs-multi',
      playerCarIdx: PLAYER_CAR_IDX,
    };

    // Prime: every car already on pit road.
    const prime = multiCarBaseline();
    for (let i = 0; i < CAR_COUNT; i++) prime.carIdxOnPitRoad[i] = 1;
    detectPitAndIncidents(null, prime, state, ctx);

    // Every car exits and gains/loses positions in the same tick.
    const curr = cloneFrame(prime);
    for (let i = 0; i < CAR_COUNT; i++) {
      curr.carIdxOnPitRoad[i] = 0;
      curr.carIdxPosition[i]  = (i + 5) % CAR_COUNT + 1; // shuffle positions
    }

    const events = detectPitAndIncidents(prime, curr, state, ctx);

    const exits = events.filter(e => e.type === 'PIT_EXIT');
    expect(exits).toHaveLength(1);
    expect(exits[0].car?.carIdx).toBe(PLAYER_CAR_IDX);

    const posChanges = events.filter(e => e.type === 'POSITION_CHANGE');
    expect(posChanges).toHaveLength(1);
    expect(posChanges[0].car?.carIdx).toBe(PLAYER_CAR_IDX);
  });

  it('detectPitStopDetail emits exactly one PIT_STOP_BEGIN for the player car', () => {
    const state = makeState();
    const ctx: PitStopDetailContext = {
      rigId: 'rig-01',
      raceSessionId: 'rs-multi',
      playerCarIdx: PLAYER_CAR_IDX,
    };

    const prev = multiCarBaseline();
    detectPitStopDetail(null, prev, state, ctx); // seed

    // Every car arrives in PitStall on the same tick.
    const curr = cloneFrame(prev);
    for (let i = 0; i < CAR_COUNT; i++) curr.carIdxTrackSurface[i] = TrackSurface.PitStall;

    const events = detectPitStopDetail(prev, curr, state, ctx);

    const begins = events.filter(e => e.type === 'PIT_STOP_BEGIN');
    expect(begins).toHaveLength(1);
    expect(begins[0].car?.carIdx).toBe(PLAYER_CAR_IDX);
  });

  it('detectDriverLapPerformance emits exactly one STINT_BEST_LAP for the player car', () => {
    const state = makeState();
    const ctx: DriverLapPerformanceContext = {
      rigId: 'rig-01',
      raceSessionId: 'rs-multi',
      playerCarIdx: PLAYER_CAR_IDX,
    };

    const prev = multiCarBaseline();
    detectDriverLapPerformance(null, prev, state, ctx); // seed

    // Every car completes a lap with a faster (improved) time on the same tick.
    const curr = cloneFrame(prev);
    for (let i = 0; i < CAR_COUNT; i++) {
      curr.carIdxLapCompleted[i] = 6;
      curr.carIdxLastLapTime[i]  = 89;
      curr.carIdxBestLapTime[i]  = 89;
    }

    const events = detectDriverLapPerformance(prev, curr, state, ctx);

    const stintBests = events.filter(e => e.type === 'STINT_BEST_LAP');
    expect(stintBests).toHaveLength(1);
    expect(stintBests[0].car?.carIdx).toBe(PLAYER_CAR_IDX);

    const personalBests = events.filter(e => e.type === 'PERSONAL_BEST_LAP');
    expect(personalBests).toHaveLength(1);
    expect(personalBests[0].car?.carIdx).toBe(PLAYER_CAR_IDX);
  });
});
