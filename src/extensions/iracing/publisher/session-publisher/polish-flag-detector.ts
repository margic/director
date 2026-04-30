/**
 * polish-flag-detector.ts — Issue #99 (Tier 4 polish)
 *
 * Detects the remaining flag events not handled by flag-detector.ts:
 *
 *   Session-wide (SessionFlags bitmask, rising-edge):
 *     FLAG_RED      — iRacing irsdk_red    (0x0010)
 *     FLAG_DEBRIS   — iRacing irsdk_debris (0x0040)
 *
 *   Per-car (CarIdxSessionFlags bitmask, rising-edge for each car index):
 *     FLAG_BLUE_DRIVER     — iRacing irsdk_blue    (0x00000020)
 *     FLAG_BLACK_DRIVER    — iRacing irsdk_black   (0x00010000)
 *     FLAG_MEATBALL_DRIVER — iRacing irsdk_repair  (0x00100000)
 *     FLAG_DISQUALIFY      — iRacing irsdk_disqualify (0x00020000)
 *
 * Design:
 *   - Pure function — state is NOT mutated here; CarIdxSessionFlags rising-edge
 *     is detected by diffing prev vs curr typed array slots.
 *   - carNumber in per-car payloads is populated from carNumberByCarIdx when
 *     provided; falls back to empty string.
 */

import type { TelemetryFrame, SessionState } from '../session-state';
import type { PublisherEvent } from '../event-types';
import { buildEvent } from '../session-state';

// ---------------------------------------------------------------------------
// iRacing irsdk_Flags bit constants (subset)
// ---------------------------------------------------------------------------

/** irsdk_red — session-level red flag */
export const SESSION_FLAG_RED    = 0x00000010;
/** irsdk_debris — debris on track (session-level) */
export const SESSION_FLAG_DEBRIS = 0x00000040;

/** irsdk_blue — blue flag shown to this driver (per-car) */
export const CAR_FLAG_BLUE       = 0x00000020;
/** irsdk_black — black flag for this driver (per-car) */
export const CAR_FLAG_BLACK      = 0x00010000;
/** irsdk_repair / meatball — mechanical-issue flag (per-car) */
export const CAR_FLAG_MEATBALL   = 0x00100000;
/** irsdk_disqualify — disqualification flag (per-car) */
export const CAR_FLAG_DISQUALIFY = 0x00020000;

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

export interface PolishFlagDetectorContext {
  publisherCode: string;
  raceSessionId: string;
  /** Map from carIdx → car number string (e.g. "42") for payload enrichment. */
  carNumberByCarIdx?: Map<number, string>;
}

// ---------------------------------------------------------------------------
// detectPolishFlags — pure function
// ---------------------------------------------------------------------------

export function detectPolishFlags(
  prev: TelemetryFrame | null,
  curr: TelemetryFrame,
  state: SessionState,
  ctx: PolishFlagDetectorContext,
): PublisherEvent[] {
  if (prev === null) return [];

  const events: PublisherEvent[] = [];
  const opts = { raceSessionId: ctx.raceSessionId, publisherCode: ctx.publisherCode, frame: curr };
  const nocar = { carIdx: -1, carNumber: '', driverName: '' };

  const prevFlags = prev.sessionFlags;
  const currFlags = curr.sessionFlags;

  /** Session-level rising edge */
  const sessionRose = (bit: number) => (currFlags & bit) !== 0 && (prevFlags & bit) === 0;

  // -------------------------------------------------------------------------
  // FLAG_RED
  // -------------------------------------------------------------------------
  if (sessionRose(SESSION_FLAG_RED)) {
    events.push(buildEvent('FLAG_RED', nocar, {}, opts));
  }

  // -------------------------------------------------------------------------
  // FLAG_DEBRIS
  // -------------------------------------------------------------------------
  if (sessionRose(SESSION_FLAG_DEBRIS)) {
    events.push(buildEvent('FLAG_DEBRIS', nocar, {}, opts));
  }

  // -------------------------------------------------------------------------
  // Per-car flags — iterate every slot in the typed array
  // -------------------------------------------------------------------------
  const numCars = Math.min(curr.carIdxSessionFlags.length, prev.carIdxSessionFlags.length);

  for (let i = 0; i < numCars; i++) {
    const prevCar = prev.carIdxSessionFlags[i];
    const currCar = curr.carIdxSessionFlags[i];

    // Skip cars where nothing changed
    if (prevCar === currCar) continue;

    const carNumber = ctx.carNumberByCarIdx?.get(i) ?? '';
    const carRef = { carIdx: i, carNumber, driverName: '' };

    /** Per-car rising edge */
    const carRose = (bit: number) => (currCar & bit) !== 0 && (prevCar & bit) === 0;

    if (carRose(CAR_FLAG_BLUE)) {
      events.push(buildEvent('FLAG_BLUE_DRIVER', carRef, { carIdx: i, carNumber }, opts));
    }
    if (carRose(CAR_FLAG_BLACK)) {
      events.push(buildEvent('FLAG_BLACK_DRIVER', carRef, { carIdx: i, carNumber }, opts));
    }
    if (carRose(CAR_FLAG_MEATBALL)) {
      events.push(buildEvent('FLAG_MEATBALL_DRIVER', carRef, { carIdx: i, carNumber }, opts));
    }
    if (carRose(CAR_FLAG_DISQUALIFY)) {
      events.push(buildEvent('FLAG_DISQUALIFY', carRef, { carIdx: i, carNumber }, opts));
    }
  }

  return events;
}
