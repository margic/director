/**
 * identity-event-builder.test.ts — Issue #95
 */

import { describe, it, expect, beforeEach } from 'vitest';

import { buildIdentityEvents, type IdentityEventContext } from '../identity-event-builder';
import { IdentityOverrideService } from '../identity-override';
import { createSessionState, type SessionState } from '../session-state';
import { makeFrame } from './frame-fixtures';

const ctx: IdentityEventContext = {
  publisherCode: 'TEST',
  raceSessionId: 'rs-1',
  playerCarIdx:  0,
};

let state: SessionState;
let svc: IdentityOverrideService;

beforeEach(() => {
  state = createSessionState('rs-1', 1);
  svc   = new IdentityOverrideService();
});

describe('buildIdentityEvents', () => {
  it('emits IDENTITY_RESOLVED on first resolution', () => {
    const result = svc.resolve('iracing_user_42', '');
    const events = buildIdentityEvents(result, makeFrame(), state, ctx);

    expect(events).toHaveLength(1);
    expect(events[0].type).toBe('IDENTITY_RESOLVED');
    expect(events[0].payload).toMatchObject({
      iracingUserName: 'iracing_user_42',
      displayName:     'iracing_user_42',
    });
    expect(state.identityResolved).toBe(true);
  });

  it('honours an override on first resolution', () => {
    const result = svc.resolve('iracing_user_42', 'Alice Driver');
    const events = buildIdentityEvents(result, makeFrame(), state, ctx);

    expect(events[0].payload).toMatchObject({ displayName: 'Alice Driver' });
  });

  it('does NOT re-emit IDENTITY_RESOLVED on subsequent unchanged calls', () => {
    buildIdentityEvents(svc.resolve('user', ''), makeFrame(), state, ctx);
    const events = buildIdentityEvents(svc.resolve('user', ''), makeFrame(), state, ctx);
    expect(events).toEqual([]);
  });

  it('emits IDENTITY_OVERRIDE_CHANGED when the override is edited mid-session', () => {
    buildIdentityEvents(svc.resolve('iracing_user_42', ''), makeFrame(), state, ctx);
    const result = svc.resolve('iracing_user_42', 'Alice Driver');
    const events = buildIdentityEvents(result, makeFrame(), state, ctx);

    expect(events).toHaveLength(1);
    expect(events[0].type).toBe('IDENTITY_OVERRIDE_CHANGED');
    expect(events[0].payload).toMatchObject({
      previousDisplayName: 'iracing_user_42',
      newDisplayName:      'Alice Driver',
    });
  });

  it('emits IDENTITY_OVERRIDE_CHANGED when the override is cleared', () => {
    buildIdentityEvents(svc.resolve('iracing_user_42', 'Alice Driver'), makeFrame(), state, ctx);
    const result = svc.resolve('iracing_user_42', '');
    const events = buildIdentityEvents(result, makeFrame(), state, ctx);

    expect(events[0].type).toBe('IDENTITY_OVERRIDE_CHANGED');
    expect(events[0].payload).toMatchObject({
      previousDisplayName: 'Alice Driver',
      newDisplayName:      'iracing_user_42',
    });
  });

  it('includes racecenterDriverId once injected', () => {
    svc.setRacecenterDriverId('driver-abc');
    const result = svc.resolve('iracing_user_42', '');
    const events = buildIdentityEvents(result, makeFrame(), state, ctx);
    expect(events[0].payload).toMatchObject({ racecenterDriverId: 'driver-abc' });
  });
});
