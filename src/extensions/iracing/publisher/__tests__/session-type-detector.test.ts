/**
 * session-type-detector.test.ts — Issue #95
 */

import { describe, it, expect, beforeEach } from 'vitest';

import { detectSessionTypeChange, type SessionTypeContext } from '../session-publisher/session-type-detector';
import { createSessionState, type SessionState } from '../session-state';
import { makeFrame } from './frame-fixtures';

const baseCtx: Omit<SessionTypeContext, 'sessionType'> = {
  rigId: 'TEST',
  raceSessionId: 'rs-1',
};

let state: SessionState;

beforeEach(() => { state = createSessionState('rs-1', 1); });

describe('detectSessionTypeChange', () => {
  it('seeds without emitting on the first observation', () => {
    const events = detectSessionTypeChange(makeFrame(), state, { ...baseCtx, sessionType: 'Practice' });
    expect(events).toEqual([]);
    expect(state.lastSessionType).toBe('Practice');
  });

  it('returns no events when sessionType is unchanged', () => {
    state.lastSessionType = 'Practice';
    const events = detectSessionTypeChange(makeFrame(), state, { ...baseCtx, sessionType: 'Practice' });
    expect(events).toEqual([]);
  });

  it('emits SESSION_TYPE_CHANGE when sessionType changes', () => {
    state.lastSessionType = 'Practice';
    const events = detectSessionTypeChange(makeFrame(), state, { ...baseCtx, sessionType: 'Qualify' });
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe('SESSION_TYPE_CHANGE');
    expect(events[0].payload).toMatchObject({ previousType: 'Practice', newType: 'Qualify' });
    expect(state.lastSessionType).toBe('Qualify');
  });

  it('chains transitions Practice → Qualify → Race', () => {
    detectSessionTypeChange(makeFrame(), state, { ...baseCtx, sessionType: 'Practice' });
    const e1 = detectSessionTypeChange(makeFrame(), state, { ...baseCtx, sessionType: 'Qualify' });
    const e2 = detectSessionTypeChange(makeFrame(), state, { ...baseCtx, sessionType: 'Race' });
    expect(e1[0].payload).toMatchObject({ previousType: 'Practice', newType: 'Qualify' });
    expect(e2[0].payload).toMatchObject({ previousType: 'Qualify', newType: 'Race' });
  });

  it('ignores empty sessionType (treated as missing data)', () => {
    state.lastSessionType = 'Practice';
    const events = detectSessionTypeChange(makeFrame(), state, { ...baseCtx, sessionType: '' });
    expect(events).toEqual([]);
    expect(state.lastSessionType).toBe('Practice');
  });
});
