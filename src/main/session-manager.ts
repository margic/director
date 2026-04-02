/**
 * session-manager.ts
 *
 * Extracted session management from DirectorService.
 * Manages session lifecycle with a state machine: none → searching → discovered → selected.
 * Pushes state changes to renderer via IPC instead of polling.
 */

import { EventEmitter } from 'events';
import { AuthService } from './auth-service';
import { RaceSession } from './director-types';
import { apiConfig } from './auth-config';
import { telemetryService } from './telemetry-service';

export type SessionState = 'none' | 'searching' | 'discovered' | 'selected';

export interface SessionManagerState {
  state: SessionState;
  sessions: RaceSession[];
  selectedSession: RaceSession | null;
  lastError?: string;
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

  constructor(private authService: AuthService) {
    super();
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
   * Transitions: selected → discovered (if sessions exist) or none
   */
  clearSession(): void {
    console.log('[SessionManager] Clearing selected session');

    if (!this.selectedSession) {
      console.warn('[SessionManager] No session selected to clear');
      return;
    }

    const previousSessionId = this.selectedSession.raceSessionId;
    this.selectedSession = null;
    this.lastError = undefined;

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
}
