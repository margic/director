/**
 * Identity Override Service — issue #82
 *
 * Resolves the canonical display name for the player's car on this rig.
 * Priority:
 *   1. `publisher.identityDisplayName` setting (if non-empty)
 *   2. iRacing YAML `UserName` for the player car
 *
 * The service is purely stateful — callers are responsible for emitting
 * IDENTITY_RESOLVED / IDENTITY_OVERRIDE_CHANGED events based on the
 * resolution result returned by `resolve()`.
 *
 * NOTE: The Race Control check-in response does not yet include a
 * `bookedDriverName` / `carIdx` mapping (tracked as racecontrol#265).
 * When that lands, `racecenterDriverId` can be populated from the check-in
 * response and injected here via `setRacecenterDriverId()`.
 */

export interface ResolvedIdentity {
  /** The raw iRacing username from session YAML */
  iracingUserName: string;
  /** The display name after applying any override — use this in events */
  displayName: string;
  /** Race Control driver ID — populated once the API provides it */
  racecenterDriverId?: string;
}

export type IdentityResolutionResult =
  | { kind: 'first_resolution'; identity: ResolvedIdentity }
  | { kind: 'override_changed'; identity: ResolvedIdentity; previousDisplayName: string }
  | { kind: 'unchanged'; identity: ResolvedIdentity };

/**
 * Stateful identity resolver for a single rig session.
 *
 * Create one instance per session (or per publisher activation).
 * Call `resolve()` each time the iRacing session YAML is parsed —
 * it returns a discriminated result so the caller can decide whether
 * to emit an identity event.
 */
export class IdentityOverrideService {
  private current: ResolvedIdentity | null = null;
  private racecenterDriverId: string | undefined;

  /**
   * Resolve the player identity for the current frame.
   *
   * @param iracingUserName - The `UserName` string for the player car from iRacing session YAML.
   * @param overrideDisplayName - Value of the `publisher.identityDisplayName` setting (empty string = no override).
   */
  resolve(
    iracingUserName: string,
    overrideDisplayName: string,
  ): IdentityResolutionResult {
    const displayName =
      overrideDisplayName.trim().length > 0 ? overrideDisplayName.trim() : iracingUserName;

    const identity: ResolvedIdentity = {
      iracingUserName,
      displayName,
      racecenterDriverId: this.racecenterDriverId,
    };

    if (this.current === null) {
      this.current = identity;
      return { kind: 'first_resolution', identity };
    }

    const previousDisplayName = this.current.displayName;

    if (displayName !== previousDisplayName) {
      this.current = identity;
      return { kind: 'override_changed', identity, previousDisplayName };
    }

    // Update in case racecenterDriverId was set after first resolution
    this.current = identity;
    return { kind: 'unchanged', identity };
  }

  /**
   * Returns the most recently resolved identity, or null before the first call to resolve().
   */
  getCurrent(): ResolvedIdentity | null {
    return this.current;
  }

  /**
   * Inject the Race Control driver ID once the check-in response provides it.
   * The next call to resolve() will include it in the returned identity.
   */
  setRacecenterDriverId(driverId: string): void {
    this.racecenterDriverId = driverId;
  }

  /**
   * Reset state on session change (SESSION_LOADED with new SessionUniqueID).
   * The next call to resolve() will be treated as a first resolution.
   */
  reset(): void {
    this.current = null;
    // racecenterDriverId is intentionally preserved — it comes from the check-in
    // which persists across sub-sessions within the same Race Control session.
  }
}
