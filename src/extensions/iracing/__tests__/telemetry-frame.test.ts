import { describe, it, expect } from 'vitest';
import { assembleTelemetryFrame, getTelemetryIntervalMs } from '../telemetry-frame';
import type { RawTelemetryReads } from '../telemetry-frame';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function nullReads(): RawTelemetryReads {
  return {
    sessionTick: null, sessionTime: null, sessionState: null,
    sessionFlags: null, sessionUniqueId: null,
    carIdxPosition: null, carIdxClassPosition: null, carIdxOnPitRoad: null,
    carIdxTrackSurface: null, carIdxLastLapTime: null, carIdxBestLapTime: null,
    carIdxLapCompleted: null, carIdxLapDistPct: null, carIdxF2Time: null,
    carIdxSessionFlags: null,
    fuelLevel: null, fuelLevelPct: null,
    playerIncidentCount: null, teamIncidentCount: null, incidentLimit: null,
    skies: null, trackTemp: null, windDir: null, windVel: null,
    airHumidity: null, fogLevel: null,
    speed: null, steeringWheelAngle: null, steeringWheelPctTorque: null,
    solarAltitude: null, carIdxSpeed: null,
  };
}

// ---------------------------------------------------------------------------
// assembleTelemetryFrame
// ---------------------------------------------------------------------------

describe('assembleTelemetryFrame — null / missing reads', () => {
  it('returns zero scalars when all reads are null', () => {
    const frame = assembleTelemetryFrame(nullReads());
    expect(frame.sessionTick).toBe(0);
    expect(frame.sessionTime).toBe(0);
    expect(frame.sessionState).toBe(0);
    expect(frame.sessionFlags).toBe(0);
    expect(frame.sessionUniqueId).toBe(0);
    expect(frame.fuelLevel).toBe(0);
    expect(frame.fuelLevelPct).toBe(0);
    expect(frame.playerIncidentCount).toBe(0);
    expect(frame.teamIncidentCount).toBe(0);
    expect(frame.incidentLimit).toBe(0);
    expect(frame.skies).toBe(0);
    expect(frame.trackTemp).toBe(0);
    expect(frame.windDir).toBe(0);
    expect(frame.windVel).toBe(0);
    expect(frame.relativeHumidity).toBe(0);
    expect(frame.fogLevel).toBe(0);
  });

  it('returns empty typed arrays for all per-car fields when reads are null', () => {
    const frame = assembleTelemetryFrame(nullReads());
    expect(frame.carIdxPosition).toBeInstanceOf(Int32Array);
    expect(frame.carIdxPosition.length).toBe(0);
    expect(frame.carIdxClassPosition).toBeInstanceOf(Int32Array);
    expect(frame.carIdxOnPitRoad).toBeInstanceOf(Uint8Array);
    expect(frame.carIdxTrackSurface).toBeInstanceOf(Int32Array);
    expect(frame.carIdxLastLapTime).toBeInstanceOf(Float32Array);
    expect(frame.carIdxBestLapTime).toBeInstanceOf(Float32Array);
    expect(frame.carIdxLapCompleted).toBeInstanceOf(Int32Array);
    expect(frame.carIdxLapDistPct).toBeInstanceOf(Float32Array);
    expect(frame.carIdxF2Time).toBeInstanceOf(Float32Array);
    expect(frame.carIdxSessionFlags).toBeInstanceOf(Int32Array);
  });
});

describe('assembleTelemetryFrame — scalar field mapping', () => {
  it('reads scalars from the first element of each array', () => {
    const reads: RawTelemetryReads = {
      ...nullReads(),
      sessionTick:     [12345],
      sessionTime:     [180.5],
      sessionState:    [3],
      sessionFlags:    [0x00000008],
      sessionUniqueId: [999],
      fuelLevel:           [45.2],
      fuelLevelPct:        [0.82],
      playerIncidentCount: [4],
      teamIncidentCount:   [7],
      incidentLimit:       [25],
      skies:       [2],
      trackTemp:   [34.1],
      windDir:     [1.5707963],
      windVel:     [3.5],
      airHumidity: [0.65],
      fogLevel:    [0.1],
    };
    const frame = assembleTelemetryFrame(reads);
    expect(frame.sessionTick).toBe(12345);
    expect(frame.sessionTime).toBe(180.5);
    expect(frame.sessionState).toBe(3);
    expect(frame.sessionFlags).toBe(8);
    expect(frame.sessionUniqueId).toBe(999);
    expect(frame.fuelLevel).toBeCloseTo(45.2, 0);
    expect(frame.fuelLevelPct).toBeCloseTo(0.82, 2);
    expect(frame.playerIncidentCount).toBe(4);
    expect(frame.teamIncidentCount).toBe(7);
    expect(frame.incidentLimit).toBe(25);
    expect(frame.skies).toBe(2);
    expect(frame.trackTemp).toBeCloseTo(34.1, 0);
    expect(frame.windDir).toBeCloseTo(1.5707963, 4);
    expect(frame.windVel).toBeCloseTo(3.5, 1);
    expect(frame.relativeHumidity).toBeCloseTo(0.65, 2);
    expect(frame.fogLevel).toBeCloseTo(0.1, 2);
  });

  it('ignores extra elements beyond the first for scalar fields', () => {
    const reads: RawTelemetryReads = {
      ...nullReads(),
      sessionTick: [100, 200, 300], // only first should be used
    };
    expect(assembleTelemetryFrame(reads).sessionTick).toBe(100);
  });
});

describe('assembleTelemetryFrame — per-car integer arrays', () => {
  it('converts carIdxPosition to Int32Array', () => {
    const reads: RawTelemetryReads = { ...nullReads(), carIdxPosition: [1, 2, 3, 4] };
    const frame = assembleTelemetryFrame(reads);
    expect(frame.carIdxPosition).toBeInstanceOf(Int32Array);
    expect(Array.from(frame.carIdxPosition)).toEqual([1, 2, 3, 4]);
  });

  it('converts carIdxClassPosition to Int32Array', () => {
    const reads: RawTelemetryReads = { ...nullReads(), carIdxClassPosition: [1, 1, 2, 3] };
    expect(Array.from(assembleTelemetryFrame(reads).carIdxClassPosition)).toEqual([1, 1, 2, 3]);
  });

  it('converts carIdxLapCompleted to Int32Array', () => {
    const reads: RawTelemetryReads = { ...nullReads(), carIdxLapCompleted: [5, 6, 7, 8] };
    expect(Array.from(assembleTelemetryFrame(reads).carIdxLapCompleted)).toEqual([5, 6, 7, 8]);
  });

  it('converts carIdxTrackSurface to Int32Array (including -1 off-track)', () => {
    const reads: RawTelemetryReads = { ...nullReads(), carIdxTrackSurface: [-1, 1, 2, 3] };
    expect(Array.from(assembleTelemetryFrame(reads).carIdxTrackSurface)).toEqual([-1, 1, 2, 3]);
  });

  it('converts carIdxSessionFlags to Int32Array', () => {
    const reads: RawTelemetryReads = { ...nullReads(), carIdxSessionFlags: [0, 0x1000, 0, 0x2000] };
    expect(Array.from(assembleTelemetryFrame(reads).carIdxSessionFlags)).toEqual([0, 0x1000, 0, 0x2000]);
  });
});

describe('assembleTelemetryFrame — per-car float arrays', () => {
  it('converts carIdxLastLapTime to Float32Array', () => {
    const reads: RawTelemetryReads = { ...nullReads(), carIdxLastLapTime: [90.1, 91.2] };
    const frame = assembleTelemetryFrame(reads);
    expect(frame.carIdxLastLapTime).toBeInstanceOf(Float32Array);
    expect(frame.carIdxLastLapTime[0]).toBeCloseTo(90.1, 0);
    expect(frame.carIdxLastLapTime[1]).toBeCloseTo(91.2, 0);
  });

  it('converts carIdxBestLapTime to Float32Array', () => {
    const reads: RawTelemetryReads = { ...nullReads(), carIdxBestLapTime: [89.5, 90.1] };
    expect(assembleTelemetryFrame(reads).carIdxBestLapTime).toBeInstanceOf(Float32Array);
  });

  it('converts carIdxLapDistPct to Float32Array with values 0–1', () => {
    const reads: RawTelemetryReads = { ...nullReads(), carIdxLapDistPct: [0.0, 0.5, 0.999] };
    const arr = assembleTelemetryFrame(reads).carIdxLapDistPct;
    expect(arr).toBeInstanceOf(Float32Array);
    expect(arr[1]).toBeCloseTo(0.5, 3);
  });

  it('converts carIdxF2Time to Float32Array', () => {
    const reads: RawTelemetryReads = { ...nullReads(), carIdxF2Time: [0, 1.5, 3.2] };
    const arr = assembleTelemetryFrame(reads).carIdxF2Time;
    expect(arr).toBeInstanceOf(Float32Array);
    expect(arr[1]).toBeCloseTo(1.5, 2);
  });
});

describe('assembleTelemetryFrame — carIdxOnPitRoad boolean→Uint8Array', () => {
  it('converts boolean[] to Uint8Array with 0/1 values', () => {
    const reads: RawTelemetryReads = { ...nullReads(), carIdxOnPitRoad: [false, true, false, true] };
    const arr = assembleTelemetryFrame(reads).carIdxOnPitRoad;
    expect(arr).toBeInstanceOf(Uint8Array);
    expect(Array.from(arr)).toEqual([0, 1, 0, 1]);
  });

  it('all-false maps to all-zero Uint8Array', () => {
    const reads: RawTelemetryReads = { ...nullReads(), carIdxOnPitRoad: [false, false, false] };
    expect(Array.from(assembleTelemetryFrame(reads).carIdxOnPitRoad)).toEqual([0, 0, 0]);
  });
});

// ---------------------------------------------------------------------------
// getTelemetryIntervalMs
// ---------------------------------------------------------------------------

describe('getTelemetryIntervalMs', () => {
  it('returns 200ms (5Hz) when publisher is enabled', () => {
    expect(getTelemetryIntervalMs(true)).toBe(200);
  });

  it('returns 250ms (4Hz) when publisher is disabled', () => {
    expect(getTelemetryIntervalMs(false)).toBe(250);
  });
});
