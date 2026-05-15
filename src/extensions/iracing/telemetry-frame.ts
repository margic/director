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

  // Player-car physics
  speed:                  number[] | null;
  steeringWheelAngle:     number[] | null;
  steeringWheelPctTorque: number[] | null;
  solarAltitude:          number[] | null;
  carIdxSpeed:            number[] | null;

  // Race-narrative additions (#151–#156). All optional — koffi reads are
  // added incrementally; missing values default to 0/-1 in assembleTelemetryFrame.
  sessionLapsRemain?:   number[] | null;
  sessionLapsTotal?:    number[] | null;
  sessionTimeRemain?:   number[] | null;
  lapDeltaToBestLap?:   number[] | null;
  lapDeltaToBestLapOk?: number[] | null;
  engineWarnings?:      number[] | null;
  fuelUsePerHour?:      number[] | null;
  lfTempCM?:            number[] | null;
  rfTempCM?:            number[] | null;
  lrTempCM?:            number[] | null;
  rrTempCM?:            number[] | null;

  // Group A: Driver inputs (player car only) — #178
  throttle?:              number[] | null;
  brake?:                 number[] | null;
  clutch?:                number[] | null;
  gear?:                  number[] | null;
  rpm?:                   number[] | null;
  brakeABSactive?:        boolean[] | null;
  dcBrakeBias?:           number[] | null;
  steeringWheelTorque?:   number[] | null;
  handbrakeRaw?:          number[] | null;

  // Group B: Vehicle dynamics (player car only) — #178
  lat?:       number[] | null;
  lon?:       number[] | null;
  alt?:       number[] | null;
  pitch?:     number[] | null;
  roll?:      number[] | null;
  yaw?:       number[] | null;
  latAccel?:  number[] | null;
  longAccel?: number[] | null;
  vertAccel?: number[] | null;
  yawRate?:   number[] | null;
  velocityX?: number[] | null;
  velocityY?: number[] | null;
  velocityZ?: number[] | null;
  waterTemp?: number[] | null;
  oilTemp?:   number[] | null;
  oilPressure?: number[] | null;
  voltage?:   number[] | null;

  // Group C: Per-tyre wear and pressure (player car only) — #178
  lfWearL?: number[] | null;
  lfWearM?: number[] | null;
  lfWearR?: number[] | null;
  rfWearL?: number[] | null;
  rfWearM?: number[] | null;
  rfWearR?: number[] | null;
  lrWearL?: number[] | null;
  lrWearM?: number[] | null;
  lrWearR?: number[] | null;
  rrWearL?: number[] | null;
  rrWearM?: number[] | null;
  rrWearR?: number[] | null;
  lfPressure?: number[] | null;
  rfPressure?: number[] | null;
  lrPressure?: number[] | null;
  rrPressure?: number[] | null;

  // Group D: Per-car spatial awareness — #178
  carIdxEstTime?:          number[] | null;
  carIdxSteer?:            number[] | null;
  carIdxRPM?:              number[] | null;
  carIdxPaceLine?:         number[] | null;
  carIdxPaceRow?:          number[] | null;
  carIdxQualTireCompound?: number[] | null;
  carIdxTireCompound?:     number[] | null;
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

    speed:                  r.speed?.[0]                  ?? 0,
    steeringWheelAngle:     r.steeringWheelAngle?.[0]     ?? 0,
    steeringWheelPctTorque: r.steeringWheelPctTorque?.[0] ?? 0,
    solarAltitude:          r.solarAltitude?.[0]          ?? 0,
    carIdxSpeed:            Float32Array.from(r.carIdxSpeed ?? []),

    sessionLapsRemain:   r.sessionLapsRemain?.[0]   ?? -1,
    sessionLapsTotal:    r.sessionLapsTotal?.[0]    ?? -1,
    sessionTimeRemain:   r.sessionTimeRemain?.[0]   ?? -1,
    lapDeltaToBestLap:   r.lapDeltaToBestLap?.[0]   ?? 0,
    lapDeltaToBestLapOk: r.lapDeltaToBestLapOk?.[0] ?? 0,
    engineWarnings:      r.engineWarnings?.[0]      ?? 0,
    fuelUsePerHour:      r.fuelUsePerHour?.[0]      ?? 0,
    lfTempCM:            r.lfTempCM?.[0]            ?? 0,
    rfTempCM:            r.rfTempCM?.[0]            ?? 0,
    lrTempCM:            r.lrTempCM?.[0]            ?? 0,
    rrTempCM:            r.rrTempCM?.[0]            ?? 0,

    // Group A: Driver inputs — #178
    throttle:            r.throttle?.[0]            ?? 0,
    brake:               r.brake?.[0]               ?? 0,
    clutch:              r.clutch?.[0]              ?? 0,
    gear:                r.gear?.[0]                ?? 0,
    rpm:                 r.rpm?.[0]                 ?? 0,
    brakeABSactive:      r.brakeABSactive?.[0] ? 1 : 0,
    dcBrakeBias:         r.dcBrakeBias?.[0]         ?? 0,
    steeringWheelTorque: r.steeringWheelTorque?.[0] ?? 0,
    handbrakeRaw:        r.handbrakeRaw?.[0]        ?? 0,

    // Group B: Vehicle dynamics — #178
    lat:        r.lat?.[0]        ?? 0,
    lon:        r.lon?.[0]        ?? 0,
    alt:        r.alt?.[0]        ?? 0,
    pitch:      r.pitch?.[0]      ?? 0,
    roll:       r.roll?.[0]       ?? 0,
    yaw:        r.yaw?.[0]        ?? 0,
    latAccel:   r.latAccel?.[0]   ?? 0,
    longAccel:  r.longAccel?.[0]  ?? 0,
    vertAccel:  r.vertAccel?.[0]  ?? 0,
    yawRate:    r.yawRate?.[0]    ?? 0,
    velocityX:  r.velocityX?.[0]  ?? 0,
    velocityY:  r.velocityY?.[0]  ?? 0,
    velocityZ:  r.velocityZ?.[0]  ?? 0,
    waterTemp:  r.waterTemp?.[0]  ?? 0,
    oilTemp:    r.oilTemp?.[0]    ?? 0,
    oilPressure: r.oilPressure?.[0] ?? 0,
    voltage:    r.voltage?.[0]    ?? 0,

    // Group C: Per-tyre wear and pressure — #178
    lfWearL: r.lfWearL?.[0] ?? 0,
    lfWearM: r.lfWearM?.[0] ?? 0,
    lfWearR: r.lfWearR?.[0] ?? 0,
    rfWearL: r.rfWearL?.[0] ?? 0,
    rfWearM: r.rfWearM?.[0] ?? 0,
    rfWearR: r.rfWearR?.[0] ?? 0,
    lrWearL: r.lrWearL?.[0] ?? 0,
    lrWearM: r.lrWearM?.[0] ?? 0,
    lrWearR: r.lrWearR?.[0] ?? 0,
    rrWearL: r.rrWearL?.[0] ?? 0,
    rrWearM: r.rrWearM?.[0] ?? 0,
    rrWearR: r.rrWearR?.[0] ?? 0,
    lfPressure: r.lfPressure?.[0] ?? 0,
    rfPressure: r.rfPressure?.[0] ?? 0,
    lrPressure: r.lrPressure?.[0] ?? 0,
    rrPressure: r.rrPressure?.[0] ?? 0,

    // Group D: Per-car spatial awareness — #178
    carIdxEstTime:          Float32Array.from(r.carIdxEstTime          ?? []),
    carIdxSteer:            Float32Array.from(r.carIdxSteer            ?? []),
    carIdxRPM:              Float32Array.from(r.carIdxRPM              ?? []),
    carIdxPaceLine:         Int32Array.from(r.carIdxPaceLine           ?? []),
    carIdxPaceRow:          Int32Array.from(r.carIdxPaceRow            ?? []),
    carIdxQualTireCompound: Int32Array.from(r.carIdxQualTireCompound   ?? []),
    carIdxTireCompound:     Int32Array.from(r.carIdxTireCompound       ?? []),
  };
}

// ---------------------------------------------------------------------------
// getTelemetryIntervalMs — returns the poll interval for the telemetry loop.
// 5 Hz (200ms) when publisher is active; 4 Hz (250ms) otherwise.
// ---------------------------------------------------------------------------

export function getTelemetryIntervalMs(publisherEnabled: boolean): number {
  return publisherEnabled ? 200 : 250;
}
