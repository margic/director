/**
 * SessionSelector — UI component for session selection with state machine integration.
 *
 * Displays available sessions in a dropdown and allows explicit selection.
 * Shows session state (none, searching, discovered, selected) and handles push events
 * from SessionManager instead of polling.
 */

import React, { useState, useEffect } from 'react';
import { Radio, Search, CheckCircle2, AlertCircle, Loader2, ChevronDown } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { clientTelemetry } from '@/telemetry';

interface RaceSession {
  raceSessionId: string;
  name: string;
  centerId: string;
  status?: string;
  scheduledStart?: string;
}

interface SessionManagerState {
  state: 'none' | 'searching' | 'discovered' | 'selected';
  sessions: RaceSession[];
  selectedSession: RaceSession | null;
  lastError?: string;
}

export const SessionSelector: React.FC = () => {
  const [sessionState, setSessionState] = useState<SessionManagerState>({
    state: 'none',
    sessions: [],
    selectedSession: null,
  });
  const [dropdownOpen, setDropdownOpen] = useState(false);

  // Subscribe to session state changes (push events)
  useEffect(() => {
    if (!window.electronAPI?.session?.onStateChanged) return;

    const unsubscribe = window.electronAPI.session.onStateChanged((state: SessionManagerState) => {
      console.log('[SessionSelector] State changed:', state);
      setSessionState(state);
      clientTelemetry.trackEvent('UI.SessionStateChanged', {
        state: state.state,
        sessionsCount: String(state.sessions.length),
        hasSelected: String(!!state.selectedSession),
      });
    });

    // Load initial state
    const loadInitialState = async () => {
      if (!window.electronAPI?.session?.getState) return;
      try {
        const state = await window.electronAPI.session.getState();
        setSessionState(state);
      } catch (error) {
        console.error('[SessionSelector] Failed to load initial state:', error);
      }
    };

    loadInitialState();

    return unsubscribe;
  }, []);

  const handleDiscover = async () => {
    if (!window.electronAPI?.session?.discover) return;
    try {
      clientTelemetry.trackEvent('UI.SessionDiscoverClicked');
      await window.electronAPI.session.discover();
    } catch (error) {
      console.error('[SessionSelector] Failed to discover sessions:', error);
      clientTelemetry.trackException(error as Error, { context: 'discoverSessions' });
    }
  };

  const handleSelectSession = async (raceSessionId: string) => {
    if (!window.electronAPI?.session?.select) return;
    try {
      clientTelemetry.trackEvent('UI.SessionSelectClicked', { sessionId: raceSessionId });
      await window.electronAPI.session.select(raceSessionId);
      setDropdownOpen(false);
    } catch (error) {
      console.error('[SessionSelector] Failed to select session:', error);
      clientTelemetry.trackException(error as Error, { context: 'selectSession' });
    }
  };

  const handleClearSession = async () => {
    if (!window.electronAPI?.session?.clear) return;
    try {
      clientTelemetry.trackEvent('UI.SessionClearClicked');
      await window.electronAPI.session.clear();
    } catch (error) {
      console.error('[SessionSelector] Failed to clear session:', error);
      clientTelemetry.trackException(error as Error, { context: 'clearSession' });
    }
  };

  const getStateIcon = () => {
    switch (sessionState.state) {
      case 'none':
        return <Radio className="w-4 h-4 text-muted-foreground" />;
      case 'searching':
        return <Loader2 className="w-4 h-4 text-secondary animate-spin" />;
      case 'discovered':
        return <Search className="w-4 h-4 text-primary" />;
      case 'selected':
        return <CheckCircle2 className="w-4 h-4 text-green-500" />;
    }
  };

  const getStateLabel = () => {
    switch (sessionState.state) {
      case 'none':
        return 'No Sessions';
      case 'searching':
        return 'Searching...';
      case 'discovered':
        return `${sessionState.sessions.length} Available`;
      case 'selected':
        return 'Selected';
    }
  };

  return (
    <Card className="bg-card border-border">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-muted-foreground text-xs uppercase font-rajdhani tracking-widest flex items-center gap-2">
            {getStateIcon()}
            Session Control
          </CardTitle>
          <span className="text-xs text-muted-foreground font-jetbrains">
            {getStateLabel()}
          </span>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {/* Selected Session Display */}
        {sessionState.selectedSession ? (
          <div className="p-3 bg-background border border-border rounded-lg">
            <div className="flex items-start justify-between gap-2">
              <div className="flex-1 min-w-0">
                <div className="text-sm font-semibold text-foreground truncate">
                  {sessionState.selectedSession.name}
                </div>
                <div className="text-xs text-muted-foreground font-jetbrains mt-1">
                  {sessionState.selectedSession.raceSessionId}
                </div>
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={handleClearSession}
                className="shrink-0 text-xs text-muted-foreground hover:text-destructive"
              >
                Clear
              </Button>
            </div>
          </div>
        ) : (
          /* Session Dropdown */
          <div className="relative">
            <button
              onClick={() => {
                if (sessionState.state === 'discovered' || sessionState.state === 'selected') {
                  setDropdownOpen(!dropdownOpen);
                }
              }}
              disabled={sessionState.state !== 'discovered' && sessionState.state !== 'selected'}
              className={`w-full p-3 bg-background border border-border rounded-lg text-left flex items-center justify-between transition-colors ${
                sessionState.state === 'discovered' || sessionState.state === 'selected'
                  ? 'hover:border-primary cursor-pointer'
                  : 'opacity-60 cursor-not-allowed'
              }`}
            >
              <span className="text-sm text-muted-foreground">
                {sessionState.state === 'discovered'
                  ? 'Select a session...'
                  : sessionState.state === 'searching'
                    ? 'Searching...'
                    : 'No sessions available'}
              </span>
              {(sessionState.state === 'discovered' || sessionState.state === 'selected') && (
                <ChevronDown className="w-4 h-4 text-muted-foreground" />
              )}
            </button>

            {/* Dropdown Menu */}
            {dropdownOpen && sessionState.sessions.length > 0 && (
              <div className="absolute top-full left-0 right-0 mt-1 bg-card border border-border rounded-lg shadow-lg z-50 max-h-60 overflow-y-auto">
                {sessionState.sessions.map((session) => (
                  <button
                    key={session.raceSessionId}
                    onClick={() => handleSelectSession(session.raceSessionId)}
                    className="w-full p-3 text-left hover:bg-background transition-colors border-b border-border last:border-b-0"
                  >
                    <div className="text-sm font-semibold text-foreground truncate">
                      {session.name}
                    </div>
                    <div className="text-xs text-muted-foreground font-jetbrains mt-1">
                      {session.raceSessionId}
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Error Display */}
        {sessionState.lastError && (
          <div className="flex items-start gap-2 p-2 bg-destructive/10 border border-destructive/20 rounded text-xs text-destructive">
            <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
            <span>{sessionState.lastError}</span>
          </div>
        )}

        {/* Discover Button */}
        <Button
          onClick={handleDiscover}
          disabled={sessionState.state === 'searching'}
          className="w-full bg-primary hover:bg-primary/90 text-black font-bold uppercase tracking-wider"
        >
          {sessionState.state === 'searching' ? (
            <>
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              Searching...
            </>
          ) : (
            <>
              <Search className="w-4 h-4 mr-2" />
              Discover Sessions
            </>
          )}
        </Button>
      </CardContent>
    </Card>
  );
};
