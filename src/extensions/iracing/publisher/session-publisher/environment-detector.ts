/**
 * environment-detector.ts — Issue #99 (Tier 4 polish)
 *
 * Detects ambient condition changes and time-of-day phase transitions:
 *
 *   WEATHER_CHANGE      — Skies integer changes or humidity/fog changes ≥ 5%
 *   TRACK_TEMP_DRIFT    — TrackTemp drifts ≥ 5°C from session start (one-shot)
 *   WIND_SHIFT          — WindDir changes ≥ 45° (angular shortest-path)
 *   TIME_OF_DAY_PHASE   — SolarAltitude crosses phase boundary
 *
 * Design:
 *   - Pure-ish: seeds lastWeather*, lastTimeOfDayPhase in SessionState so
 *     repeated frames do not re-fire the same event.
 *   - WEATHER_CHANGE seeds silently on first call (when lastWeatherSkies == -1).
 *   - TIME_OF_DAY_PHASE seeds silently on first call (when lastTimeOfDayPhase == '').
 */

import type { TelemetryFrame, SessionState } from '../session-state';
import { buildEvent } from '../session-state';
import type { PublisherEvent, TimeOfDayPhase } from '../event-types';

export interface EnvironmentDetectorContext {
  publisherCode: string;
  raceSessionId: string;
  playerCarIdx?: number;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** WEATHER_CHANGE threshold for humidity / fog (absolute change, 0.0–1.0 scale). */
export const WEATHER_HUMIDITY_THRESHOLD = 0.05;
export const WEATHER_FOG_THRESHOLD      = 0.05;

/** WIND_SHIFT minimum angular change (degrees) to emit. */
export const WIND_SHIFT_MIN_DEG = 45;

/** TRACK_TEMP_DRIFT minimum absolute delta (°C) from session start. */
export const TRACK_TEMP_DRIFT_MIN_DEG = 5;

/**
 * TIME_OF_DAY_PHASE boundaries (radians).
 * dawn  : solar altitude crosses 0 upward
 * day   : solar altitude crosses DAY_THRESHOLD upward
 * dusk  : solar altitude crosses 0 downward
 * night : solar altitude crosses NIGHT_THRESHOLD downward (civil twilight)
 */
export const SUN_DAY_THRESHOLD   =  0.0873; // 5 degrees above horizon
export const SUN_NIGHT_THRESHOLD = -0.1047; // ~-6 degrees (civil twilight end)

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Angular difference between two bearings in degrees (shortest path, ≥ 0). */
function angularDiffDeg(a: number, b: number): number {
  const rToDeg = (r: number) => r * (180 / Math.PI);
  let diff = Math.abs(rToDeg(a) - rToDeg(b)) % 360;
  if (diff > 180) diff = 360 - diff;
  return diff;
}

function classifyPhase(alt: number): TimeOfDayPhase {
  if (alt >= SUN_DAY_THRESHOLD)   return 'day';
  if (alt >= 0)                   return 'dawn'; // between 0 and day threshold
  if (alt >= SUN_NIGHT_THRESHOLD) return 'dusk'; // between 0 and civil twilight
  return 'night';
}

// ---------------------------------------------------------------------------
// detectEnvironment
// ---------------------------------------------------------------------------

export function detectEnvironment(
  prev: TelemetryFrame | null,
  curr: TelemetryFrame,
  state: SessionState,
  ctx: EnvironmentDetectorContext,
): PublisherEvent[] {
  const events: PublisherEvent[] = [];
  const opts = { raceSessionId: ctx.raceSessionId, publisherCode: ctx.publisherCode, frame: curr };
  const nocar = { carIdx: ctx.playerCarIdx ?? -1, carNumber: '', driverName: '' };

  // -------------------------------------------------------------------------
  // Seed on first call (no prev frame) — establish baseline without emitting
  // -------------------------------------------------------------------------
  if (prev === null) {
    state.lastWeatherSkies             = curr.skies;
    state.lastWeatherRelativeHumidity  = curr.relativeHumidity;
    state.lastWeatherFogLevel          = curr.fogLevel;
    state.lastTimeOfDayPhase           = classifyPhase(curr.solarAltitude);
    return events;
  }

  // -------------------------------------------------------------------------
  // WEATHER_CHANGE
  // -------------------------------------------------------------------------
  const skiesChanged     = curr.skies !== state.lastWeatherSkies;
  const humidityChanged  = Math.abs(curr.relativeHumidity - state.lastWeatherRelativeHumidity) >= WEATHER_HUMIDITY_THRESHOLD;
  const fogChanged       = Math.abs(curr.fogLevel - state.lastWeatherFogLevel) >= WEATHER_FOG_THRESHOLD;

  if (skiesChanged || humidityChanged || fogChanged) {
    events.push(buildEvent(
      'WEATHER_CHANGE',
      nocar,
      {
        previousSkies:    state.lastWeatherSkies,
        newSkies:         curr.skies,
        relativeHumidity: curr.relativeHumidity,
        fogLevel:         curr.fogLevel,
      },
      opts,
    ));
    state.lastWeatherSkies            = curr.skies;
    state.lastWeatherRelativeHumidity = curr.relativeHumidity;
    state.lastWeatherFogLevel         = curr.fogLevel;
  }

  // -------------------------------------------------------------------------
  // TRACK_TEMP_DRIFT — one-shot per session when > TRACK_TEMP_DRIFT_MIN_DEG
  // -------------------------------------------------------------------------
  if (
    !state.firedTrackTempDrift &&
    state.sessionStartTrackTemp !== 0 &&
    Math.abs(curr.trackTemp - state.sessionStartTrackTemp) >= TRACK_TEMP_DRIFT_MIN_DEG
  ) {
    state.firedTrackTempDrift = true;
    events.push(buildEvent(
      'TRACK_TEMP_DRIFT',
      nocar,
      {
        trackTempCelsius:        curr.trackTemp,
        deltaFromStartCelsius:   curr.trackTemp - state.sessionStartTrackTemp,
        sessionStartTempCelsius: state.sessionStartTrackTemp,
      },
      opts,
    ));
  }

  // -------------------------------------------------------------------------
  // WIND_SHIFT — angular delta ≥ WIND_SHIFT_MIN_DEG
  // -------------------------------------------------------------------------
  const windDelta = angularDiffDeg(prev.windDir, curr.windDir);
  if (windDelta >= WIND_SHIFT_MIN_DEG) {
    events.push(buildEvent(
      'WIND_SHIFT',
      nocar,
      {
        windDirRad: curr.windDir,
        windVelMps: curr.windVel,
        deltaDeg:   Math.round(windDelta),
      },
      opts,
    ));
  }

  // -------------------------------------------------------------------------
  // TIME_OF_DAY_PHASE — phase change
  // -------------------------------------------------------------------------
  const currPhase = classifyPhase(curr.solarAltitude);
  if (currPhase !== state.lastTimeOfDayPhase) {
    state.lastTimeOfDayPhase = currPhase;
    events.push(buildEvent(
      'TIME_OF_DAY_PHASE',
      nocar,
      {
        phase:            currPhase,
        solarAltitudeRad: curr.solarAltitude,
      },
      opts,
    ));
  }

  return events;
}
