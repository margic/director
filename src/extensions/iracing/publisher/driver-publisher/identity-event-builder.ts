/**
 * identity-event-builder.ts — Issue #95
 *
 * Translates IdentityOverrideService.resolve() results into PublisherEvents.
 * Keeps the service itself free of event/transport dependencies and gives
 * the orchestrator a single call site to emit IDENTITY_RESOLVED and
 * IDENTITY_OVERRIDE_CHANGED.
 *
 *   IDENTITY_RESOLVED         — fired the first time the player's identity
 *                               is established for the session.
 *   IDENTITY_OVERRIDE_CHANGED — fired when the operator edits the
 *                               `publisher.identityDisplayName` setting
 *                               mid-session and the new value differs.
 */

import type { TelemetryFrame, SessionState } from '../session-state';
import { buildEvent } from '../session-state';
import type { PublisherEvent } from '../event-types';
import type { IdentityResolutionResult } from './identity-override';

export interface IdentityEventContext {
  publisherCode: string;
  raceSessionId: string;
  /** Player car index — used as the `car` ref on the emitted events. */
  playerCarIdx: number;
}

export function buildIdentityEvents(
  result: IdentityResolutionResult,
  curr: TelemetryFrame,
  state: SessionState,
  ctx: IdentityEventContext,
): PublisherEvent[] {
  const opts = { raceSessionId: ctx.raceSessionId, publisherCode: ctx.publisherCode, frame: curr };
  const car = { carIdx: ctx.playerCarIdx, carNumber: '', driverName: result.identity.displayName };

  if (result.kind === 'first_resolution') {
    if (state.identityResolved) return [];
    state.identityResolved = true;
    return [
      buildEvent(
        'IDENTITY_RESOLVED',
        car,
        {
          iracingUserName:    result.identity.iracingUserName,
          displayName:        result.identity.displayName,
          racecenterDriverId: result.identity.racecenterDriverId,
        },
        opts,
      ),
    ];
  }

  if (result.kind === 'override_changed') {
    return [
      buildEvent(
        'IDENTITY_OVERRIDE_CHANGED',
        car,
        {
          previousDisplayName: result.previousDisplayName,
          newDisplayName:      result.identity.displayName,
          racecenterDriverId:  result.identity.racecenterDriverId,
        },
        opts,
      ),
    ];
  }

  return [];
}
