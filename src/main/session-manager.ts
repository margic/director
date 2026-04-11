/**
 * session-manager.ts
 *
 * Extracted session management from DirectorService.
 * Manages session lifecycle with a state machine: none → searching → discovered → selected.
 * Pushes state changes to renderer via IPC instead of polling.
 */

import { EventEmitter } from 'events';
import { AuthService } from './auth-service';
import {
  RaceSession,
  DirectorCapabilities,
  SessionCheckinRequest,
  SessionCheckinResponse,
  SessionCheckinConflict,
  SessionOperationalConfig,
  CheckinStatus,
} from './director-types';
import { apiConfig } from './auth-config';
import { telemetryService } from './telemetry-service';
import { configService } from './config-service';
import { app } from 'electron';

export type SessionState = 'none' | 'searching' | 'discovered' | 'selected' | 'checked-in';

export interface SessionManagerState {
  state: SessionState;
  sessions: RaceSession[];
  selectedSession: RaceSession | null;
  lastError?: string;
  // Check-in fields
  checkinStatus: CheckinStatus;
  checkinId?: string | null;
  sessionConfig?: SessionOperationalConfig | null;
  checkinWarnings?: string[];
  checkinTtlSeconds?: number;
}

/**
 * SessionManager manages the lifecycle of race sessions.
 *
 * State transitions:
 * - none → searching (when discover() is called)
 * - searching → discovered (when sessions are found)
 * - discovered → selected (when selectSession() is called)
 * - selected → discovered (when clearSession() is called)
 * - any → none (when sessions list becomes empty or error occurs)
 *
 * Emits 'stateChanged' event with SessionManagerState when state changes.
 */
export class SessionManager extends EventEmitter {
  private state: SessionState = 'none';
  private sessions: RaceSession[] = [];
  private selectedSession: RaceSession | null = null;
  private lastError: string | undefined;

  // Check-in state
  private checkinId: string | null = null;
  private checkinStatus: CheckinStatus = 'unchecked';
  private sessionConfig: SessionOperationalConfig | null = null;
  private checkinWarnings: string[] = [];
  private checkinTtlSeconds: number = 120;

  /** Optional callback to build capabilities from extension host */
  private buildCapabilities?: () => DirectorCapabilities;
  /** Optional callback to get local sequences for Planner training */
  private getLocalSequences?: () => Promise<import('./director-types').PortableSequence[]>;

  constructor(private authService: AuthService) {
    super();
  }

  /**
   * Set the capabilities builder (provided by main.ts after extension host is ready).
   */
  setCapabilitiesBuilder(builder: () => DirectorCapabilities): void {
    this.buildCapabilities = builder;
  }

  /**
   * Set the local sequences getter (provided by main.ts after library is ready).
   */
  setLocalSequencesGetter(getter: () => Promise<import('./director-types').PortableSequence[]>): void {
    this.getLocalSequences = getter;
  }

  /**
   * Get current state snapshot.
   */
  getState(): SessionManagerState {
    return {
      state: this.state,
      sessions: [...this.sessions],
      selectedSession: this.selectedSession,
      lastError: this.lastError,
      checkinStatus: this.checkinStatus,
      checkinId: this.checkinId,
      sessionConfig: this.sessionConfig,
      checkinWarnings: this.checkinWarnings,
      checkinTtlSeconds: this.checkinTtlSeconds,
    };
  }

  /**
   * Discover available sessions from Race Control API.
   * Transitions: none|discovered|selected → searching → discovered
   */
  async discover(centerId?: string): Promise<void> {
    console.log('[SessionManager] Discovering sessions...');
    this.setState('searching');
    this.lastError = undefined;

    const startTime = Date.now();
    const token = await this.authService.getAccessToken();
    if (!token) {
      console.warn('[SessionManager] No access token available for session discovery');
      this.lastError = 'No access token available';
      this.sessions = [];
      this.setState('none');
      return;
    }

    // Get user profile to obtain centerId if not provided
    const profile = await this.authService.getUserProfile();
    const filterCenterId = centerId || profile?.centerId || profile?.center?.id;

    if (!filterCenterId) {
      console.warn('[SessionManager] No centerId available for session discovery');
      this.lastError = 'No centerId available';
      this.sessions = [];
      this.setState('none');
      return;
    }

    try {
      const params = new URLSearchParams({
        centerId: filterCenterId
      });
      const url = `${apiConfig.baseUrl}${apiConfig.endpoints.listSessions}?${params}`;
      console.log('[SessionManager] Fetching sessions from:', url);

      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${token}`,
        },
      });

      const duration = Date.now() - startTime;
      const success = response.ok;

      // Track API dependency
      telemetryService.trackDependency(
        'RaceControl API',
        url,
        duration,
        success,
        response.status,
        'HTTP',
        {
          centerId: filterCenterId
        }
      );

      if (!response.ok) {
        console.error(`[SessionManager] Failed to fetch sessions: ${response.status} ${response.statusText}`);
        this.lastError = `Failed to fetch sessions: ${response.status}`;
        this.sessions = [];
        this.setState('none');
        return;
      }

      const sessions: RaceSession[] = await response.json();
      console.log(`[SessionManager] Found ${sessions.length} sessions`);

      telemetryService.trackMetric('Sessions.Count', sessions.length, {
        centerId: filterCenterId,
      });

      this.sessions = sessions;

      // Validate that selectedSession is still in the list
      if (this.selectedSession) {
        const stillExists = sessions.find(s => s.raceSessionId === this.selectedSession!.raceSessionId);
        if (!stillExists) {
          console.warn('[SessionManager] Previously selected session no longer exists');
          this.selectedSession = null;
        }
      }

      if (sessions.length === 0) {
        this.setState('none');
      } else if (this.selectedSession) {
        this.setState('selected');
      } else {
        this.setState('discovered');
      }

    } catch (error) {
      console.error('[SessionManager] Error fetching sessions:', error);
      const duration = Date.now() - startTime;
      telemetryService.trackDependency(
        'RaceControl API',
        `${apiConfig.baseUrl}${apiConfig.endpoints.listSessions}`,
        duration,
        false,
        0,
        'HTTP',
        {
          error: (error as Error).message,
        }
      );
      telemetryService.trackException(error as Error, { operation: 'discover' });

      this.lastError = (error as Error).message;
      this.sessions = [];
      this.setState('none');
    }
  }

  /**
   * Select a session by ID.
   * Transitions: discovered → selected
   */
  selectSession(raceSessionId: string): void {
    console.log(`[SessionManager] Selecting session: ${raceSessionId}`);

    const session = this.sessions.find(s => s.raceSessionId === raceSessionId);
    if (!session) {
      console.warn(`[SessionManager] Session not found: ${raceSessionId}`);
      this.lastError = `Session not found: ${raceSessionId}`;
      this.emitStateChanged();
      return;
    }

    this.selectedSession = session;
    this.lastError = undefined;
    this.setState('selected');

    telemetryService.trackEvent('Session.Selected', {
      sessionId: raceSessionId,
      sessionName: session.name,
    });
  }

  /**
   * Clear the selected session.
   * If checked in, wraps the session first.
   * Transitions: selected|checked-in → discovered (if sessions exist) or none
   */
  async clearSession(): Promise<void> {
    console.log('[SessionManager] Clearing selected session');

    if (!this.selectedSession) {
      console.warn('[SessionManager] No session selected to clear');
      return;
    }

    // Wrap check-in if active
    if (this.checkinId) {
      await this.wrapSession('session-cleared').catch((err) => {
        console.warn('[SessionManager] Wrap failed during clear:', err);
      });
    }

    const previousSessionId = this.selectedSession.raceSessionId;
    this.selectedSession = null;
    this.lastError = undefined;
    this.resetCheckinState();

    telemetryService.trackEvent('Session.Cleared', {
      sessionId: previousSessionId,
    });

    // Transition to discovered if we have sessions, otherwise none
    if (this.sessions.length > 0) {
      this.setState('discovered');
    } else {
      this.setState('none');
    }
  }

  // ---------------------------------------------------------------------------
  // Check-In Lifecycle
  // ---------------------------------------------------------------------------

  /**
   * Check into the currently selected session with Race Control.
   * Transitions: selected → checked-in (or stays selected on error).
   */
  async checkinSession(options?: { forceCheckin?: boolean }): Promise<SessionManagerState> {
    if (!this.selectedSession) {
      this.lastError = 'No session selected';
      this.emitStateChanged();
      return this.getState();
    }

    if (this.checkinStatus === 'checking-in') {
      console.warn('[SessionManager] Check-in already in progress');
      return this.getState();
    }

    const raceSessionId = this.selectedSession.raceSessionId;
    console.log(`[SessionManager] Checking into session: ${raceSessionId}`);
    this.checkinStatus = 'checking-in';
    this.lastError = undefined;
    this.emitStateChanged();

    const token = await this.authService.getAccessToken();
    if (!token) {
      this.checkinStatus = 'error';
      this.lastError = 'No auth token available';
      this.emitStateChanged();
      return this.getState();
    }

    const capabilities = this.buildCapabilities?.() ?? { intents: [], connections: {} };
    const directorId = configService.getOrCreateDirectorId();

    const body: SessionCheckinRequest = {
      directorId,
      version: app.getVersion(),
      capabilities,
    };

    // Include local sequences for Planner training
    if (this.getLocalSequences) {
      try {
        const sequences = await this.getLocalSequences();
        if (sequences.length > 0) {
          body.sequences = sequences.slice(0, 50);
          console.log(`[SessionManager] Including ${body.sequences.length} local sequences in check-in`);
        }
      } catch (err) {
        console.warn('[SessionManager] Failed to gather local sequences:', err);
      }
    }

    const url = `${apiConfig.baseUrl}${apiConfig.endpoints.checkin(raceSessionId)}`;

    try {
      const startTime = Date.now();
      const headers: Record<string, string> = {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      };
      if (options?.forceCheckin) {
        headers['X-Force-Checkin'] = 'true';
      }

      const response = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
      });

      const duration = Date.now() - startTime;
      telemetryService.trackDependency(
        'RaceControl API', url, duration, response.ok, response.status, 'HTTP',
        { sessionId: raceSessionId, operation: 'checkin' }
      );

      if (response.ok) {
        const data: SessionCheckinResponse = await response.json();
        this.checkinId = data.checkinId;
        this.checkinTtlSeconds = data.checkinTtlSeconds;
        this.sessionConfig = data.sessionConfig;
        this.checkinWarnings = data.warnings ?? [];
        this.checkinStatus = 'standby';

        console.log(`[SessionManager] Checked in: checkinId=${data.checkinId}, TTL=${data.checkinTtlSeconds}s`);
        if (this.checkinWarnings.length > 0) {
          console.warn('[SessionManager] Check-in warnings:', this.checkinWarnings);
        }

        telemetryService.trackEvent('Session.CheckedIn', {
          sessionId: raceSessionId,
          checkinId: data.checkinId,
          warningCount: String(this.checkinWarnings.length),
        });

        this.setState('checked-in');
        return this.getState();
      }

      if (response.status === 409) {
        const conflict: SessionCheckinConflict = await response.json();
        this.checkinStatus = 'error';
        this.lastError = `Session in use by ${conflict.existingCheckin.displayName ?? conflict.existingCheckin.directorId}`;
        console.warn(`[SessionManager] Check-in conflict: ${this.lastError}`);
        this.emitStateChanged();
        return this.getState();
      }

      this.checkinStatus = 'error';
      this.lastError = `Check-in failed: ${response.status} ${response.statusText}`;
      console.error(`[SessionManager] ${this.lastError}`);
      this.emitStateChanged();
      return this.getState();

    } catch (error) {
      this.checkinStatus = 'error';
      this.lastError = `Check-in error: ${(error as Error).message}`;
      console.error(`[SessionManager] ${this.lastError}`);
      telemetryService.trackException(error as Error, { operation: 'checkinSession', sessionId: raceSessionId });
      this.emitStateChanged();
      return this.getState();
    }
  }

  /**
   * Wrap (release) the current session check-in.
   * Transitions: checked-in → selected.
   */
  async wrapSession(reason?: string): Promise<SessionManagerState> {
    if (!this.checkinId || !this.selectedSession) {
      console.log('[SessionManager] No active check-in to wrap');
      this.resetCheckinState();
      this.emitStateChanged();
      return this.getState();
    }

    const raceSessionId = this.selectedSession.raceSessionId;
    console.log(`[SessionManager] Wrapping session: ${raceSessionId}`);
    this.checkinStatus = 'wrapping';
    this.emitStateChanged();

    const token = await this.authService.getAccessToken();
    if (!token) {
      console.warn('[SessionManager] No auth token for wrap — clearing state locally');
      this.resetCheckinState();
      this.setState('selected');
      return this.getState();
    }

    const url = `${apiConfig.baseUrl}${apiConfig.endpoints.wrap(raceSessionId)}`;

    try {
      const startTime = Date.now();
      const response = await fetch(url, {
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${token}`,
          'X-Checkin-Id': this.checkinId,
        },
      });

      const duration = Date.now() - startTime;
      telemetryService.trackDependency(
        'RaceControl API', url, duration, response.ok, response.status, 'HTTP',
        { sessionId: raceSessionId, operation: 'wrap' }
      );

      if (response.ok || response.status === 204 || response.status === 404) {
        console.log('[SessionManager] Session wrapped successfully');
        telemetryService.trackEvent('Session.Wrapped', {
          sessionId: raceSessionId,
          reason: reason ?? 'manual',
        });
      } else if (response.status === 403) {
        this.lastError = 'Another director has taken over this session';
        console.warn(`[SessionManager] Wrap 403: ${this.lastError}`);
      } else {
        console.warn(`[SessionManager] Wrap returned ${response.status} — clearing state anyway`);
      }
    } catch (error) {
      console.error('[SessionManager] Wrap error (clearing state anyway):', error);
      telemetryService.trackException(error as Error, { operation: 'wrapSession' });
    }

    this.resetCheckinState();
    this.setState('selected');
    return this.getState();
  }

  /**
   * Refresh check-in capabilities via PATCH (does not re-trigger Planner).
   */
  async refreshCheckin(): Promise<SessionManagerState> {
    if (!this.checkinId || !this.selectedSession) {
      console.log('[SessionManager] No active check-in to refresh');
      return this.getState();
    }

    const raceSessionId = this.selectedSession.raceSessionId;
    console.log(`[SessionManager] Refreshing check-in capabilities for session: ${raceSessionId}`);

    const token = await this.authService.getAccessToken();
    if (!token) {
      console.warn('[SessionManager] No auth token for refresh');
      return this.getState();
    }

    const capabilities = this.buildCapabilities?.() ?? { intents: [], connections: {} };
    const url = `${apiConfig.baseUrl}${apiConfig.endpoints.refreshCheckin(raceSessionId)}`;

    try {
      const startTime = Date.now();
      const response = await fetch(url, {
        method: 'PATCH',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
          'X-Checkin-Id': this.checkinId,
        },
        body: JSON.stringify({ capabilities }),
      });

      const duration = Date.now() - startTime;
      telemetryService.trackDependency(
        'RaceControl API', url, duration, response.ok, response.status, 'HTTP',
        { sessionId: raceSessionId, operation: 'refreshCheckin' }
      );

      if (response.ok) {
        console.log('[SessionManager] Check-in capabilities refreshed');
        telemetryService.trackEvent('Session.CheckinRefreshed', {
          sessionId: raceSessionId,
          checkinId: this.checkinId,
        });
      } else if (response.status === 404) {
        console.warn('[SessionManager] Check-in expired during refresh');
        this.resetCheckinState();
        this.setState('selected');
      } else {
        console.warn(`[SessionManager] Refresh check-in returned ${response.status}`);
      }
    } catch (error) {
      console.error('[SessionManager] Failed to refresh check-in:', error);
      telemetryService.trackException(error as Error, { operation: 'refreshCheckin' });
    }

    return this.getState();
  }

  /**
   * Get check-in ID (used by CloudPoller and orchestrator).
   */
  getCheckinId(): string | null {
    return this.checkinId;
  }

  /**
   * Get check-in TTL in seconds.
   */
  getCheckinTtlSeconds(): number {
    return this.checkinTtlSeconds;
  }

  /**
   * Get session operational config from last check-in.
   */
  getSessionConfig(): SessionOperationalConfig | null {
    return this.sessionConfig;
  }

  /**
   * Get the currently selected session, or null if none selected.
   */
  getSelectedSession(): RaceSession | null {
    return this.selectedSession;
  }

  /**
   * Get the list of available sessions.
   */
  getSessions(): RaceSession[] {
    return [...this.sessions];
  }

  // ---------------------------------------------------------------------------
  // Private
  // ---------------------------------------------------------------------------

  /**
   * Update state and emit stateChanged event.
   */
  private setState(newState: SessionState): void {
    if (this.state !== newState) {
      console.log(`[SessionManager] State transition: ${this.state} → ${newState}`);
      this.state = newState;
      this.emitStateChanged();
    }
  }

  /**
   * Emit stateChanged event with current state snapshot.
   */
  private emitStateChanged(): void {
    this.emit('stateChanged', this.getState());
  }

  /**
   * Reset all check-in state to initial values.
   */
  private resetCheckinState(): void {
    this.checkinId = null;
    this.checkinStatus = 'unchecked';
    this.sessionConfig = null;
    this.checkinWarnings = [];
    this.checkinTtlSeconds = 120;
  }
}
