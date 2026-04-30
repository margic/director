/**
 * session-type-detector.ts — Issue #95
 *
 * Emits SESSION_TYPE_CHANGE when the iRacing SessionType string changes
 * (e.g. "Practice" → "Qualify" → "Race"). The session type is sourced from
 * SessionInfo.Sessions[CurrentSession].SessionType in the iRacing YAML and
 * supplied by the orchestrator via context.
 *
 * Pure-ish function — mutates only `state.lastSessionType`.
 */

import type { TelemetryFrame, SessionState } from '../session-state';
import { buildEvent } from '../session-state';
import type { PublisherEvent } from '../event-types';

export interface SessionTypeContext {
  publisherCode: string;
  raceSessionId: string;
  /** Current sessionType from iRacing YAML (e.g. "Practice", "Qualify", "Race"). */
  sessionType: string;
}

export function detectSessionTypeChange(
  curr: TelemetryFrame,
  state: SessionState,
  ctx: SessionTypeContext,
): PublisherEvent[] {
  const incoming = ctx.sessionType ?? '';
  if (incoming === '') return [];

  // First observation — seed only.
  if (state.lastSessionType === '') {
    state.lastSessionType = incoming;
    return [];
  }

  if (incoming === state.lastSessionType) return [];

  const previousType = state.lastSessionType;
  state.lastSessionType = incoming;

  return [
    buildEvent(
      'SESSION_TYPE_CHANGE',
      { carIdx: -1, carNumber: '', driverName: '' },
      { previousType, newType: incoming },
      { raceSessionId: ctx.raceSessionId, publisherCode: ctx.publisherCode, frame: curr },
    ),
  ];
}
