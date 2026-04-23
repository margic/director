import type { TelemetryFrame } from './publisher/session-state';

// ---------------------------------------------------------------------------
// RawTelemetryReads — raw output from koffi variable reads, all nullable.
// The arrays mirror the iRacing variable layout: scalars come as length-1
// arrays, per-car fields come as length-64 arrays.
// ---------------------------------------------------------------------------

export interface RawTelemetryReads {
  // Session scalars
  sessionTick:      number[] | null;
  sessionTime:      number[] | null;
  sessionState:     number[] | null;
  sessionFlags:     number[] | null;
  sessionUniqueId:  number[] | null;

  // Per-car arrays
  carIdxPosition:      number[] | null;
  carIdxClassPosition: number[] | null;
  carIdxOnPitRoad:     boolean[] | null;
  carIdxTrackSurface:  number[] | null;
  carIdxLastLapTime:   number[] | null;
  carIdxBestLapTime:   number[] | null;
  carIdxLapCompleted:  number[] | null;
  carIdxLapDistPct:    number[] | null;
  carIdxF2Time:        number[] | null;
  carIdxSessionFlags:  number[] | null;

  // Player car scalars
  fuelLevel:           number[] | null;
  fuelLevelPct:        number[] | null;
  playerIncidentCount: number[] | null;
  teamIncidentCount:   number[] | null;
  incidentLimit:       number[] | null;

  // Environmental scalars
  skies:           number[] | null;
  trackTemp:       number[] | null;
  windDir:         number[] | null;
  windVel:         number[] | null;
  /** iRacing variable: AirHumidity */
  airHumidity:     number[] | null;
  fogLevel:        number[] | null;
}

// ---------------------------------------------------------------------------
// assembleTelemetryFrame — pure function, no koffi dependency.
// Converts raw read results into a typed TelemetryFrame.
// All null reads fall back to 0 / empty typed arrays.
// ---------------------------------------------------------------------------

export function assembleTelemetryFrame(r: RawTelemetryReads): TelemetryFrame {
  return {
    sessionTick:     r.sessionTick?.[0]  ?? 0,
    sessionTime:     r.sessionTime?.[0]  ?? 0,
    sessionState:    r.sessionState?.[0] ?? 0,
    sessionFlags:    r.sessionFlags?.[0] ?? 0,
    sessionUniqueId: r.sessionUniqueId?.[0] ?? 0,

    carIdxPosition:      Int32Array.from(r.carIdxPosition      ?? []),
    carIdxClassPosition: Int32Array.from(r.carIdxClassPosition  ?? []),
    carIdxOnPitRoad:     Uint8Array.from((r.carIdxOnPitRoad ?? []).map(b => b ? 1 : 0)),
    carIdxTrackSurface:  Int32Array.from(r.carIdxTrackSurface   ?? []),
    carIdxLastLapTime:   Float32Array.from(r.carIdxLastLapTime  ?? []),
    carIdxBestLapTime:   Float32Array.from(r.carIdxBestLapTime  ?? []),
    carIdxLapCompleted:  Int32Array.from(r.carIdxLapCompleted   ?? []),
    carIdxLapDistPct:    Float32Array.from(r.carIdxLapDistPct   ?? []),
    carIdxF2Time:        Float32Array.from(r.carIdxF2Time        ?? []),
    carIdxSessionFlags:  Int32Array.from(r.carIdxSessionFlags   ?? []),

    fuelLevel:           r.fuelLevel?.[0]            ?? 0,
    fuelLevelPct:        r.fuelLevelPct?.[0]         ?? 0,
    playerIncidentCount: r.playerIncidentCount?.[0]  ?? 0,
    teamIncidentCount:   r.teamIncidentCount?.[0]    ?? 0,
    incidentLimit:       r.incidentLimit?.[0]        ?? 0,

    skies:             r.skies?.[0]         ?? 0,
    trackTemp:         r.trackTemp?.[0]     ?? 0,
    windDir:           r.windDir?.[0]       ?? 0,
    windVel:           r.windVel?.[0]       ?? 0,
    relativeHumidity:  r.airHumidity?.[0]   ?? 0,
    fogLevel:          r.fogLevel?.[0]      ?? 0,
  };
}

// ---------------------------------------------------------------------------
// getTelemetryIntervalMs — returns the poll interval for the telemetry loop.
// 5 Hz (200ms) when publisher is active; 4 Hz (250ms) otherwise.
// ---------------------------------------------------------------------------

export function getTelemetryIntervalMs(publisherEnabled: boolean): number {
  return publisherEnabled ? 200 : 250;
}
