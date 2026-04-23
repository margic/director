import { describe, it, expect, beforeEach } from 'vitest';
import { IdentityOverrideService } from '../identity-override';

describe('IdentityOverrideService', () => {
  let svc: IdentityOverrideService;

  beforeEach(() => {
    svc = new IdentityOverrideService();
  });

  // ---------------------------------------------------------------------------
  // getCurrent before first resolve
  // ---------------------------------------------------------------------------

  it('returns null before the first resolve()', () => {
    expect(svc.getCurrent()).toBeNull();
  });

  // ---------------------------------------------------------------------------
  // First resolution
  // ---------------------------------------------------------------------------

  it('returns first_resolution on the initial call', () => {
    const result = svc.resolve('JohnDoe', '');
    expect(result.kind).toBe('first_resolution');
  });

  it('uses iRacing username as display name when no override is set', () => {
    const result = svc.resolve('JohnDoe', '');
    expect(result.identity.displayName).toBe('JohnDoe');
    expect(result.identity.iracingUserName).toBe('JohnDoe');
  });

  it('uses override display name when non-empty', () => {
    const result = svc.resolve('JohnDoe', 'Johnny D');
    expect(result.identity.displayName).toBe('Johnny D');
    expect(result.identity.iracingUserName).toBe('JohnDoe');
  });

  it('trims whitespace from the override display name', () => {
    const result = svc.resolve('JohnDoe', '  Johnny D  ');
    expect(result.identity.displayName).toBe('Johnny D');
  });

  it('falls back to iRacing username when override is whitespace-only', () => {
    const result = svc.resolve('JohnDoe', '   ');
    expect(result.identity.displayName).toBe('JohnDoe');
  });

  // ---------------------------------------------------------------------------
  // Unchanged
  // ---------------------------------------------------------------------------

  it('returns unchanged when called again with the same display name', () => {
    svc.resolve('JohnDoe', '');
    const result = svc.resolve('JohnDoe', '');
    expect(result.kind).toBe('unchanged');
  });

  it('returns unchanged when override resolves to the same display name', () => {
    svc.resolve('JohnDoe', 'Johnny D');
    const result = svc.resolve('JohnDoe', 'Johnny D');
    expect(result.kind).toBe('unchanged');
  });

  // ---------------------------------------------------------------------------
  // Override changed
  // ---------------------------------------------------------------------------

  it('returns override_changed when display name changes', () => {
    svc.resolve('JohnDoe', '');
    const result = svc.resolve('JohnDoe', 'Johnny D');
    expect(result.kind).toBe('override_changed');
  });

  it('includes previousDisplayName in override_changed result', () => {
    svc.resolve('JohnDoe', '');
    const result = svc.resolve('JohnDoe', 'Johnny D');
    if (result.kind !== 'override_changed') throw new Error('Expected override_changed');
    expect(result.previousDisplayName).toBe('JohnDoe');
    expect(result.identity.displayName).toBe('Johnny D');
  });

  it('returns override_changed when override is cleared (reverts to iRacing name)', () => {
    svc.resolve('JohnDoe', 'Johnny D');
    const result = svc.resolve('JohnDoe', '');
    expect(result.kind).toBe('override_changed');
    if (result.kind !== 'override_changed') throw new Error('Expected override_changed');
    expect(result.previousDisplayName).toBe('Johnny D');
    expect(result.identity.displayName).toBe('JohnDoe');
  });

  // ---------------------------------------------------------------------------
  // getCurrent
  // ---------------------------------------------------------------------------

  it('getCurrent reflects the most recent resolve', () => {
    svc.resolve('JohnDoe', 'Johnny D');
    expect(svc.getCurrent()?.displayName).toBe('Johnny D');
    svc.resolve('JohnDoe', '');
    expect(svc.getCurrent()?.displayName).toBe('JohnDoe');
  });

  // ---------------------------------------------------------------------------
  // Race Control driver ID injection
  // ---------------------------------------------------------------------------

  it('includes racecenterDriverId in resolved identity after setRacecenterDriverId', () => {
    svc.setRacecenterDriverId('rc-driver-007');
    const result = svc.resolve('JohnDoe', '');
    expect(result.identity.racecenterDriverId).toBe('rc-driver-007');
  });

  it('driver ID is preserved across subsequent resolves', () => {
    svc.resolve('JohnDoe', '');
    svc.setRacecenterDriverId('rc-driver-007');
    const result = svc.resolve('JohnDoe', '');
    expect(result.identity.racecenterDriverId).toBe('rc-driver-007');
  });

  it('does not include racecenterDriverId when not set', () => {
    const result = svc.resolve('JohnDoe', '');
    expect(result.identity.racecenterDriverId).toBeUndefined();
  });

  // ---------------------------------------------------------------------------
  // Reset
  // ---------------------------------------------------------------------------

  it('reset() causes the next resolve to be a first_resolution', () => {
    svc.resolve('JohnDoe', '');
    svc.reset();
    const result = svc.resolve('JohnDoe', '');
    expect(result.kind).toBe('first_resolution');
  });

  it('reset() preserves the racecenterDriverId', () => {
    svc.setRacecenterDriverId('rc-driver-007');
    svc.resolve('JohnDoe', '');
    svc.reset();
    const result = svc.resolve('JohnDoe', '');
    if (result.kind !== 'first_resolution') throw new Error('Expected first_resolution');
    expect(result.identity.racecenterDriverId).toBe('rc-driver-007');
  });

  it('getCurrent() returns null after reset', () => {
    svc.resolve('JohnDoe', '');
    svc.reset();
    expect(svc.getCurrent()).toBeNull();
  });
});
