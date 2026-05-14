import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Radio, ArrowLeftRight, RefreshCw, AlertCircle, CheckCircle2, ChevronDown, AlertTriangle, Info } from 'lucide-react';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type PublisherStatusKind = 'active' | 'idle' | 'connecting' | 'error';
type PublisherScope = 'session' | 'driver' | 'both';

interface PipelineStatus {
  active: boolean;
  eventsEnqueued: number;
}

interface PublisherStatus {
  status: PublisherStatusKind;
  message?: string;
  eventsQueuedTotal: number;
  lastFlushAt?: number;
  lastError?: string;
  raceSessionId?: string;
  rigId?: string;
  pipelines?: {
    session: PipelineStatus;
    driver: PipelineStatus;
  };
}

interface RegisterResult {
  success: boolean;
  errorCode?: number;
  message?: string;
}

interface RecentEvent {
  id: string;
  type: string;
  carIdx?: number;
  timestamp: number;
  pipeline?: string;
}

interface OperatorState {
  playerOnPitRoad: boolean;
  driverSwapPending: boolean;
}

interface SessionOption {
  raceSessionId: string;
  name: string;
  status?: string;
}

interface DriverOption {
  driverId: string;
  displayName: string;
  nickname?: string;
}

const MAX_RECENT_EVENTS = 5;

// ---------------------------------------------------------------------------
// PublisherSettings
// ---------------------------------------------------------------------------

export const PublisherSettings = () => {
  // Settings loaded from config
  const [scope, setScope]                           = useState<PublisherScope>('session');
  const [rigId, setRigId]                           = useState('');
  const [driverSessionId, setDriverSessionId]       = useState('');
  const [registeredDriverName, setRegisteredDriverName] = useState('');

  // UI-only — "Two-rig setup?" expander
  const [showHelp, setShowHelp]                     = useState(false);
  const [scopeChanging, setScopeChanging]           = useState(false);

  // Live status
  const [publisherStatus, setPublisherStatus]       = useState<PublisherStatus | null>(null);
  const [recentEvents, setRecentEvents]             = useState<RecentEvent[]>([]);
  const [sessionEventCount, setSessionEventCount]   = useState(0);
  const [driverEventCount, setDriverEventCount]     = useState(0);

  // Driver swap
  const [operatorState, setOperatorState]           = useState<OperatorState>({ playerOnPitRoad: false, driverSwapPending: false });
  const [incomingDriverName, setIncomingDriverName] = useState('');
  const [incomingDriverId, setIncomingDriverId]     = useState('');
  const [outgoingDriverId, setOutgoingDriverId]     = useState('');
  const [swapInitiating, setSwapInitiating]         = useState(false);

  // Registration flow
  const [sessions, setSessions]                     = useState<SessionOption[]>([]);
  const [selectedSessionId, setSelectedSessionId]   = useState('');
  const [drivers, setDrivers]                       = useState<DriverOption[]>([]);
  const [selectedDriverId, setSelectedDriverId]     = useState('');
  const [selectedDriverName, setSelectedDriverName] = useState('');
  const [loadingSessions, setLoadingSessions]       = useState(false);
  const [loadingDrivers, setLoadingDrivers]         = useState(false);
  const [registering, setRegistering]               = useState(false);
  const [registerResult, setRegisterResult]         = useState<RegisterResult | null>(null);

  // Regenerate confirmation
  const [confirmRegenerate, setConfirmRegenerate]   = useState(false);

  const eventIdSeq = useRef(0);

  // ---------------------------------------------------------------------------
  // Load config on mount
  // ---------------------------------------------------------------------------
  useEffect(() => {
    const load = async () => {
      if (!window.electronAPI?.config) return;
      try {
        const [publisherScope, id, sessId, driverDisplayName] = await Promise.all([
          window.electronAPI.config.get('publisher.scope'),
          window.electronAPI.config.get('publisher.rigId'),
          window.electronAPI.config.get('publisher.driver.sessionId'),
          window.electronAPI.config.get('publisher.driver.displayName'),
        ]);
        setScope((publisherScope as PublisherScope | undefined) ?? 'session');
        setRigId(id ?? '');
        setDriverSessionId(sessId ?? '');
        if (driverDisplayName) setRegisteredDriverName(driverDisplayName);
      } catch (e) {
        console.error('Failed to load publisher config', e);
      }
    };
    load();

    const restoreStatus = async () => {
      if (!window.electronAPI?.extensions) return;
      try {
        const last = await window.electronAPI.extensions.getLastEvent('iracing.publisherStateChanged');
        if (last?.payload) setPublisherStatus(last.payload as PublisherStatus);
      } catch { /* ignore */ }
    };
    restoreStatus();

    // Pre-populate session dropdown from current app state (no network call)
    const preloadSession = async () => {
      if (!window.electronAPI?.session) return;
      try {
        const state = await window.electronAPI.session.getState();
        const list: SessionOption[] = (state?.sessions ?? []).map((s: any) => ({
          raceSessionId: s.raceSessionId,
          name: s.name ?? s.raceSessionId,
          status: s.status,
        }));
        if (list.length > 0) setSessions(list);
        if (state?.selectedSession?.raceSessionId) {
          setSelectedSessionId(state.selectedSession.raceSessionId);
        }
      } catch { /* ignore */ }
    };
    preloadSession();
  }, []);

  // ---------------------------------------------------------------------------
  // Subscribe to live events
  // ---------------------------------------------------------------------------
  useEffect(() => {
    let unsub: (() => void) | undefined;
    if (window.electronAPI?.extensions) {
      unsub = window.electronAPI.extensions.onExtensionEvent((data) => {
        if (data.eventName === 'iracing.publisherStateChanged') {
          setPublisherStatus(data.payload as PublisherStatus);
        } else if (data.eventName === 'iracing.publisherOperatorState') {
          setOperatorState(data.payload as OperatorState);
        } else if (data.eventName === 'iracing.publisherEventEmitted') {
          const p = data.payload as { type: string; carIdx?: number; timestamp: number; pipeline?: string };
          if (p.pipeline === 'session') {
            setSessionEventCount((c) => c + 1);
          } else if (p.pipeline === 'driver') {
            setDriverEventCount((c) => c + 1);
          }
          setRecentEvents((prev) => {
            const next: RecentEvent = {
              id: `${p.timestamp}-${eventIdSeq.current++}`,
              type: p.type,
              carIdx: p.carIdx,
              timestamp: p.timestamp,
              pipeline: p.pipeline,
            };
            return [next, ...prev].slice(0, MAX_RECENT_EVENTS);
          });
        } else if (data.eventName === 'iracing.publisher.registerDriverResult') {
          const r = data.payload as RegisterResult;
          setRegistering(false);
          setRegisterResult(r);
          if (r.success) {
            setRegisteredDriverName(selectedDriverName);
            window.electronAPI?.config?.get('publisher.driver.sessionId').then((v) => {
              if (v) setDriverSessionId(v);
            }).catch(() => {});
          }
        }
      });
    }
    return () => unsub?.();
  }, []);

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  const formatTime = (ms?: number): string => {
    if (!ms) return '—';
    return new Date(ms).toLocaleTimeString(undefined, { hour12: false });
  };

  // ---------------------------------------------------------------------------
  // Handlers
  // ---------------------------------------------------------------------------

  const handleSelectScope = useCallback(async (next: PublisherScope) => {
    if (next === scope) return;
    setScope(next);
    setScopeChanging(true);
    try {
      // Persist to config so the orchestrator picks it up if no session is bound.
      await window.electronAPI?.config?.set('publisher.scope', next);
      // Dispatch the intent — the orchestrator restarts pipelines if a session
      // is bound and iRacing is connected.
      await window.electronAPI?.extensions?.executeIntent('iracing.publisher.setScope', { scope: next });
    } catch (e) {
      console.error('Failed to set Rig Mode', e);
    } finally {
      setScopeChanging(false);
    }
  }, [scope]);

  const handleRegenerate = useCallback(async () => {
    if (!confirmRegenerate) {
      setConfirmRegenerate(true);
      return;
    }
    setConfirmRegenerate(false);
    try {
      await window.electronAPI?.extensions?.executeIntent('iracing.publisher.regenerateRigId', {});
      const newId = await window.electronAPI?.config?.get('publisher.rigId');
      if (newId) setRigId(newId);
    } catch (e) {
      console.error('Failed to regenerate Rig ID', e);
    }
  }, [confirmRegenerate]);

  const loadSessions = useCallback(async () => {
    setLoadingSessions(true);
    try {
      // Always run discover to get a fresh list from the API
      const state = await window.electronAPI?.session?.discover();
      const list: SessionOption[] = (state?.sessions ?? []).map((s: any) => ({
        raceSessionId: s.raceSessionId,
        name: s.name ?? s.raceSessionId,
        status: s.status,
      }));
      setSessions(list);

      // Pre-select whichever session the app currently has selected
      const currentId = state?.selectedSession?.raceSessionId;
      if (currentId) {
        setSelectedSessionId(currentId);
        setRegisterResult(null);
      }
    } catch (e) {
      console.error('Failed to load sessions', e);
    } finally {
      setLoadingSessions(false);
    }
  }, []);

  const loadDrivers = useCallback(async () => {
    setLoadingDrivers(true);
    try {
      const list = await window.electronAPI?.publisher?.listDrivers();
      if (!list) return;
      const mapped = list.map((d) => ({ driverId: d.driverId, displayName: d.displayName, nickname: d.nickname }));
      setDrivers(mapped);
      // Restore previously selected driver if config has one
      const savedId = await window.electronAPI?.config?.get('publisher.driver.driverId').catch(() => null);
      if (savedId) {
        const found = mapped.find((d) => d.driverId === savedId);
        if (found) {
          setSelectedDriverId(found.driverId);
          setSelectedDriverName(found.displayName);
        }
      }
    } catch (e) {
      console.error('Failed to load drivers', e);
    } finally {
      setLoadingDrivers(false);
    }
  }, []);

  // Auto-load driver list on mount so the previously selected driver is restored
  useEffect(() => { void loadDrivers(); }, [loadDrivers]);

  const handleSelectDriver = useCallback((driverId: string) => {
    setSelectedDriverId(driverId);
    const found = drivers.find((d) => d.driverId === driverId);
    setSelectedDriverName(found?.displayName ?? '');
    window.electronAPI?.config?.set('publisher.driver.driverId', driverId).catch(() => {});
  }, [drivers]);

  const handleRegister = useCallback(async () => {
    if (!selectedSessionId || !selectedDriverName) return;
    setRegistering(true);
    setRegisterResult(null);
    try {
      await window.electronAPI?.config?.set('publisher.driver.displayName', selectedDriverName);
      await window.electronAPI?.extensions?.executeIntent('iracing.publisher.registerDriver', {
        raceSessionId: selectedSessionId,
        driverName: selectedDriverName,
      });
      // Result arrives via iracing.publisher.registerDriverResult event
    } catch (e: any) {
      setRegistering(false);
      setRegisterResult({ success: false, message: e?.message ?? 'Intent failed' });
    }
  }, [selectedSessionId, selectedDriverName]);

  const handleInitiateSwap = useCallback(async () => {
    setSwapInitiating(true);
    try {
      await window.electronAPI?.extensions?.executeIntent('iracing.publisher.initiateDriverSwap', {
        outgoingDriverId,
        incomingDriverId,
        incomingDriverName,
      });
    } catch (e) {
      console.error('Failed to initiate driver swap', e);
    } finally {
      setSwapInitiating(false);
    }
  }, [outgoingDriverId, incomingDriverId, incomingDriverName]);

  const registerErrorMessage = (r: RegisterResult): string => {
    if (r.message) return r.message;
    switch (r.errorCode) {
      case 401: return 'Sign in required — please authenticate and retry.';
      case 404: return 'Session ID not found — check the ID and try again.';
      case 409: return 'Session not accepting registrations.';
      default:  return 'Registration failed. Please retry.';
    }
  };

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------
  return (
    <div className="space-y-4">

      {/* ── Stats ─────────────────────────────────────────────────────────── */}
      <Card className="bg-card border-border">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-muted-foreground text-xs uppercase font-rajdhani tracking-widest">
              Publisher Stats
            </CardTitle>
            {/* Scope badge — read-only, reflects publisher.scope config value */}
            <span className={`inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-[10px] font-rajdhani uppercase tracking-wider font-bold
              ${scope === 'driver'  ? 'border-[color:var(--color-primary)]/40 bg-[color:var(--color-primary)]/10 text-[color:var(--color-primary)]'
              : scope === 'both'   ? 'border-[color:var(--color-yellow-flag)]/40 bg-[color:var(--color-yellow-flag)]/10 text-[color:var(--color-yellow-flag)]'
              : 'border-[color:var(--color-secondary)]/40 bg-[color:var(--color-secondary)]/10 text-[color:var(--color-secondary)]'}`}>
              Scope: {scope}
            </span>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Counters row */}
          <div className="grid grid-cols-4 gap-3">
            <div className="rounded-md border border-border bg-background/40 p-3">
              <div className="text-[10px] uppercase font-rajdhani tracking-widest text-muted-foreground">Session Events</div>
              <div className="text-2xl font-jetbrains font-bold text-foreground tabular-nums">
                {sessionEventCount}
              </div>
            </div>
            <div className="rounded-md border border-border bg-background/40 p-3">
              <div className="text-[10px] uppercase font-rajdhani tracking-widest text-muted-foreground">Driver Events</div>
              <div className="text-2xl font-jetbrains font-bold text-foreground tabular-nums">
                {driverEventCount}
              </div>
            </div>
            <div className="rounded-md border border-border bg-background/40 p-3">
              <div className="text-[10px] uppercase font-rajdhani tracking-widest text-muted-foreground">Last Flush</div>
              <div className="text-xl font-jetbrains text-foreground tabular-nums">
                {formatTime(publisherStatus?.lastFlushAt)}
              </div>
            </div>
            <div className="rounded-md border border-border bg-background/40 p-3">
              <div className="text-[10px] uppercase font-rajdhani tracking-widest text-muted-foreground">Last Error</div>
              <div className={`text-xs font-jetbrains truncate ${publisherStatus?.lastError ? 'text-[color:var(--color-red-flag)]' : 'text-muted-foreground'}`}
                   title={publisherStatus?.lastError ?? ''}>
                {publisherStatus?.lastError ?? '—'}
              </div>
            </div>
          </div>

          {/* Recent events feed */}
          <div>
            <div className="text-[10px] uppercase font-rajdhani tracking-widest text-muted-foreground mb-2">Recent Events</div>
            <div className="rounded-md border border-border bg-background/40 max-h-40 overflow-y-auto">
              {recentEvents.length === 0 ? (
                <div className="px-3 py-4 text-xs text-muted-foreground font-jetbrains text-center">
                  Waiting for telemetry events…
                </div>
              ) : (
                <ul className="divide-y divide-border">
                  {recentEvents.map((ev) => (
                    <li key={ev.id} className="flex items-center justify-between px-3 py-1.5 font-jetbrains text-xs">
                      <span className="flex items-center gap-2">
                        <span className="text-foreground">{ev.type}</span>
                        {ev.pipeline && (
                          <span className={`text-[10px] uppercase font-rajdhani tracking-wider px-1 rounded ${
                            ev.pipeline === 'session' ? 'text-[color:var(--color-secondary)] bg-[color:var(--color-secondary)]/10'
                            : ev.pipeline === 'driver' ? 'text-[color:var(--color-primary)] bg-[color:var(--color-primary)]/10'
                            : 'text-muted-foreground bg-muted/20'
                          }`}>{ev.pipeline}</span>
                        )}
                      </span>
                      <span className="text-muted-foreground tabular-nums">
                        {ev.carIdx !== undefined ? `car ${ev.carIdx}` : ''}
                        <span className="ml-3">{formatTime(ev.timestamp)}</span>
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* ── Rig Mode (primary control) ─────────────────────────────────────── */}
      <Card className="bg-card border-border">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-muted-foreground text-xs uppercase font-rajdhani tracking-widest">
              Rig Mode
            </CardTitle>
            <button
              type="button"
              onClick={() => setShowHelp((v) => !v)}
              className="inline-flex items-center gap-1.5 text-[10px] font-rajdhani uppercase tracking-wider text-muted-foreground hover:text-foreground"
            >
              <Info className="w-3 h-3" />
              Two-rig setup?
            </button>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Three-option Rig Mode selector */}
          <div role="radiogroup" aria-label="Rig Mode" className="grid grid-cols-1 md:grid-cols-3 gap-3">
            {([
              {
                value: 'session' as PublisherScope,
                label: 'Director',
                tagline: 'Broadcast / spectator rig',
                blurb: "Publishes flags, overtakes, all cars' laps, and roster. One per session — additional Director rigs duplicate every broadcast event.",
              },
              {
                value: 'driver' as PublisherScope,
                label: 'Driver',
                tagline: 'Player car telemetry',
                blurb: 'Publishes pit, fuel, stint best, incidents, and physics for the local player car.',
              },
              {
                value: 'both' as PublisherScope,
                label: 'Combined',
                tagline: 'Single-rig dev/demo',
                blurb: 'Publishes both — not for production multi-rig setups.',
              },
            ]).map((opt) => {
              const selected = scope === opt.value;
              return (
                <button
                  key={opt.value}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  disabled={scopeChanging}
                  onClick={() => handleSelectScope(opt.value)}
                  className={`text-left rounded-md border p-3 transition-colors disabled:opacity-60
                    ${selected
                      ? 'border-[color:var(--color-primary)] bg-[color:var(--color-primary)]/10'
                      : 'border-border bg-background/40 hover:border-muted-foreground/40'}`}
                >
                  <div className="flex items-center justify-between">
                    <span className={`text-sm font-rajdhani uppercase tracking-widest font-bold
                      ${selected ? 'text-[color:var(--color-primary)]' : 'text-foreground'}`}>
                      {opt.label}
                    </span>
                    <span className={`w-2.5 h-2.5 rounded-full border
                      ${selected ? 'bg-[color:var(--color-primary)] border-[color:var(--color-primary)]'
                                 : 'bg-transparent border-muted-foreground/60'}`} />
                  </div>
                  <div className="mt-1 text-[10px] uppercase font-rajdhani tracking-wider text-muted-foreground">
                    {opt.tagline}
                  </div>
                  <p className="mt-2 text-xs text-muted-foreground leading-snug">
                    {opt.blurb}
                  </p>
                </button>
              );
            })}
          </div>

          {/* Combined-mode warning */}
          {scope === 'both' && (
            <div className="flex items-start gap-2 rounded-md border border-[color:var(--color-yellow-flag)] bg-[color:var(--color-yellow-flag)]/10 px-3 py-2">
              <AlertTriangle className="w-4 h-4 text-[color:var(--color-yellow-flag)] shrink-0 mt-0.5" />
              <div>
                <p className="text-xs font-rajdhani uppercase tracking-widest font-bold text-[color:var(--color-yellow-flag)]">
                  Combined Mode — dev/demo only
                </p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Both pipelines run on this rig. In a multi-rig setup this duplicates broadcast events.
                  Use Director or Driver in production.
                </p>
              </div>
            </div>
          )}

          {/* Driver-mode-needs-registration callout */}
          {(scope === 'driver' || scope === 'both') && !driverSessionId && (
            <div className="flex items-start gap-2 rounded-md border border-[color:var(--color-yellow-flag)] bg-[color:var(--color-yellow-flag)]/10 px-3 py-2">
              <AlertCircle className="w-4 h-4 text-[color:var(--color-yellow-flag)] shrink-0 mt-0.5" />
              <div>
                <p className="text-xs font-rajdhani uppercase tracking-widest font-bold text-[color:var(--color-yellow-flag)]">
                  Driver Mode requires registration
                </p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Select a session and your driver profile below, then click <strong>Register</strong> to activate the Driver Publisher.
                </p>
              </div>
            </div>
          )}

          {/* "Two-rig setup?" expander */}
          {showHelp && (
            <div className="rounded-md border border-border bg-background/40 p-3 space-y-2">
              <p className="text-[10px] uppercase font-rajdhani tracking-widest text-muted-foreground">
                Choosing a Rig Mode
              </p>
              <p className="text-xs text-muted-foreground leading-snug">
                <strong className="text-foreground">Director</strong> — the broadcast / spectator rig. Publishes field-wide
                events (flags, overtakes, all cars' laps, roster, environment). One per race session.
              </p>
              <p className="text-xs text-muted-foreground leading-snug">
                <strong className="text-foreground">Driver</strong> — a rig where a driver is racing. Publishes player-car-only
                events (stint best laps, pit stops, fuel, incidents, physics). One per driver. Requires registration.
              </p>
              <p className="text-xs text-muted-foreground leading-snug">
                <strong className="text-foreground">Combined</strong> — runs both pipelines on a single rig. Intended only for
                development or single-machine demos.
              </p>
              <p className="text-xs text-muted-foreground leading-snug">
                See <code className="font-jetbrains text-[10px]">documents/feature_iracing_publisher.md</code> for full details.
              </p>
            </div>
          )}

          {/* Pipeline status rows (read-only) */}
          <div className="space-y-2">
            <div className="text-[10px] uppercase font-rajdhani tracking-widest text-muted-foreground">
              Pipeline Status
            </div>
            <div className="rounded-md border border-border divide-y divide-border">
              {/* Session Publisher row */}
              {(() => {
                const enabledByMode = scope === 'session' || scope === 'both';
                const active = !!publisherStatus?.pipelines?.session?.active;
                const label =
                  !enabledByMode ? 'Disabled by mode'
                  : active        ? 'Active'
                                  : 'Idle';
                const dotClass =
                  !enabledByMode ? 'bg-muted-foreground/40'
                  : active        ? 'bg-[color:var(--color-green-flag)]'
                                  : 'bg-muted-foreground';
                const textClass =
                  !enabledByMode ? 'text-muted-foreground'
                  : active        ? 'text-[color:var(--color-green-flag)]'
                                  : 'text-muted-foreground';
                return (
                  <div className="flex items-center justify-between px-3 py-2">
                    <span className="flex items-center gap-2 text-xs font-rajdhani uppercase tracking-widest text-foreground">
                      <Radio className={`w-3.5 h-3.5 ${active ? 'text-[color:var(--color-green-flag)]' : 'text-muted-foreground'}`} />
                      Session Publisher
                    </span>
                    <span className={`inline-flex items-center gap-1.5 text-xs font-rajdhani uppercase tracking-wider font-bold ${textClass}`}>
                      <span className={`w-2 h-2 rounded-full inline-block ${dotClass}`} />
                      {label}
                    </span>
                  </div>
                );
              })()}
              {/* Driver Publisher row */}
              {(() => {
                const enabledByMode = scope === 'driver' || scope === 'both';
                const active = !!publisherStatus?.pipelines?.driver?.active;
                const awaitingReg = enabledByMode && !active && !driverSessionId;
                const label =
                  !enabledByMode ? 'Disabled by mode'
                  : active        ? 'Active'
                  : awaitingReg   ? 'Awaiting registration'
                                  : 'Idle';
                const dotClass =
                  !enabledByMode ? 'bg-muted-foreground/40'
                  : active        ? 'bg-[color:var(--color-green-flag)]'
                  : awaitingReg   ? 'bg-[color:var(--color-yellow-flag)]'
                                  : 'bg-muted-foreground';
                const textClass =
                  !enabledByMode ? 'text-muted-foreground'
                  : active        ? 'text-[color:var(--color-green-flag)]'
                  : awaitingReg   ? 'text-[color:var(--color-yellow-flag)]'
                                  : 'text-muted-foreground';
                return (
                  <div className="flex items-center justify-between px-3 py-2">
                    <span className="flex items-center gap-2 text-xs font-rajdhani uppercase tracking-widest text-foreground">
                      <Radio className={`w-3.5 h-3.5 ${active ? 'text-[color:var(--color-green-flag)]' : 'text-muted-foreground'}`} />
                      Driver Publisher
                    </span>
                    <span className={`inline-flex items-center gap-1.5 text-xs font-rajdhani uppercase tracking-wider font-bold ${textClass}`}>
                      <span className={`w-2 h-2 rounded-full inline-block ${dotClass}`} />
                      {label}
                    </span>
                  </div>
                );
              })()}
            </div>
            {publisherStatus?.raceSessionId && (
              <div className="text-xs font-jetbrains text-muted-foreground truncate" title={publisherStatus.raceSessionId}>
                Bound session: {publisherStatus.raceSessionId.slice(0, 24)}{publisherStatus.raceSessionId.length > 24 ? '…' : ''}
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* ── Rig Identity ───────────────────────────────────────────────────── */}
      <Card className="bg-card border-border">
        <CardHeader className="pb-3">
          <CardTitle className="text-muted-foreground text-xs uppercase font-rajdhani tracking-widest">
            Rig Identity
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="space-y-1.5">
            <label className="text-[10px] uppercase font-rajdhani tracking-widest text-muted-foreground">Rig ID</label>
            <div className="flex gap-2 items-center">
              <input
                readOnly
                className="bg-background border border-border font-jetbrains text-xs flex-1 text-muted-foreground cursor-default select-all rounded-md px-3 py-2"
                value={rigId || publisherStatus?.rigId || '—'}
              />
              {!confirmRegenerate ? (
                <Button
                  onClick={handleRegenerate}
                  variant="outline"
                  size="sm"
                  className="shrink-0 border-border font-rajdhani uppercase tracking-wider text-xs"
                >
                  <RefreshCw className="w-3.5 h-3.5 mr-1.5" />
                  Regenerate
                </Button>
              ) : (
                <div className="flex gap-2 shrink-0">
                  <Button
                    onClick={handleRegenerate}
                    size="sm"
                    className="bg-destructive hover:bg-destructive/90 text-white font-rajdhani uppercase tracking-wider text-xs"
                  >
                    Confirm
                  </Button>
                  <Button
                    onClick={() => setConfirmRegenerate(false)}
                    variant="outline"
                    size="sm"
                    className="border-border font-rajdhani uppercase tracking-wider text-xs"
                  >
                    Cancel
                  </Button>
                </div>
              )}
            </div>
            <p className="text-xs text-muted-foreground">
              Auto-generated unique ID for this rig. Only regenerate if advised by Race Control support.
            </p>
          </div>
        </CardContent>
      </Card>

      {/* ── Driver Registration (only in Driver / Combined modes) ──────────── */}
      {(scope === 'driver' || scope === 'both') && (
      <Card className="bg-card border-border">
        <CardHeader className="pb-3">
          <CardTitle className="text-muted-foreground text-xs uppercase font-rajdhani tracking-widest flex items-center gap-2">
            <Radio className={`w-3.5 h-3.5 ${publisherStatus?.pipelines?.driver?.active ? 'text-[color:var(--color-green-flag)]' : 'text-muted-foreground'}`} />
            Register this rig
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-5">
          <p className="text-xs text-muted-foreground">
            Choose a session and your driver profile, then click <strong>Register</strong> to start the Driver Publisher.
          </p>

          {/* Driver registration */}
          <div className="rounded-md border border-border bg-background/30 p-4 space-y-3">
              {/* Session selector */}
              <div className="space-y-1.5">
                <label className="text-[10px] uppercase font-rajdhani tracking-widest text-muted-foreground">Session</label>
                <div className="flex gap-2">
                  <div className="relative flex-1">
                    <select
                      className="w-full appearance-none bg-background border border-border font-jetbrains text-xs text-foreground rounded-md px-3 py-2 pr-8 focus:outline-none focus:ring-1 focus:ring-primary"
                      value={selectedSessionId}
                      onChange={(e) => { setSelectedSessionId(e.target.value); setRegisterResult(null); }}
                    >
                      <option value="">— Select session —</option>
                      {sessions.map((s) => (
                        <option key={s.raceSessionId} value={s.raceSessionId}>
                          {s.name}{s.status ? ` (${s.status})` : ''}
                        </option>
                      ))}
                    </select>
                    <ChevronDown className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
                  </div>
                  <Button
                    onClick={loadSessions}
                    disabled={loadingSessions}
                    variant="outline"
                    size="sm"
                    className="shrink-0 border-border font-rajdhani uppercase tracking-wider text-xs"
                  >
                    <RefreshCw className={`w-3.5 h-3.5 mr-1.5 ${loadingSessions ? 'animate-spin' : ''}`} />
                    {sessions.length === 0 ? 'Load' : 'Refresh'}
                  </Button>
                </div>
              </div>

              {/* Driver selector */}
              <div className="space-y-1.5">
                <label className="text-[10px] uppercase font-rajdhani tracking-widest text-muted-foreground">Driver</label>
                <div className="flex gap-2">
                  <div className="relative flex-1">
                    <select
                      className="w-full appearance-none bg-background border border-border font-jetbrains text-xs text-foreground rounded-md px-3 py-2 pr-8 focus:outline-none focus:ring-1 focus:ring-primary"
                      value={selectedDriverId}
                      onChange={(e) => { handleSelectDriver(e.target.value); setRegisterResult(null); }}
                    >
                      <option value="">— Select driver —</option>
                      {drivers.map((d) => (
                        <option key={d.driverId} value={d.driverId}>
                          {d.displayName}{d.nickname ? ` (${d.nickname})` : ''}
                        </option>
                      ))}
                    </select>
                    <ChevronDown className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
                  </div>
                  <Button
                    onClick={loadDrivers}
                    disabled={loadingDrivers}
                    variant="outline"
                    size="sm"
                    className="shrink-0 border-border font-rajdhani uppercase tracking-wider text-xs"
                  >
                    <RefreshCw className={`w-3.5 h-3.5 mr-1.5 ${loadingDrivers ? 'animate-spin' : ''}`} />
                    {drivers.length === 0 ? 'Load' : 'Refresh'}
                  </Button>
                </div>
              </div>

              {/* Register button */}
              <Button
                onClick={handleRegister}
                disabled={!selectedSessionId || !selectedDriverId || registering}
                className="w-full bg-secondary hover:bg-secondary/90 text-white font-rajdhani uppercase tracking-wider font-bold text-xs"
              >
                {registering ? 'Registering…' : 'Register'}
              </Button>

              {/* Current registration */}
              {driverSessionId && !registerResult?.success && (
                <p className="text-xs text-muted-foreground font-jetbrains">
                  Registered:{' '}
                  {registeredDriverName && (
                    <span className="text-foreground">{registeredDriverName}</span>
                  )}
                  {registeredDriverName && ' — '}
                  <span className="text-foreground">{driverSessionId}</span>
                </p>
              )}

              {/* Register result */}
              {registerResult?.success && (
                <div className="flex items-center gap-2 rounded-md border border-[color:var(--color-green-flag)] bg-[color:var(--color-green-flag)]/10 px-3 py-2">
                  <CheckCircle2 className="w-4 h-4 text-[color:var(--color-green-flag)] shrink-0" />
                  <span className="text-xs font-rajdhani uppercase tracking-widest font-bold text-[color:var(--color-green-flag)]">
                    Registered — Driver Publisher starting
                  </span>
                </div>
              )}
              {registerResult && !registerResult.success && (
                <div className="flex items-start gap-2 rounded-md border border-destructive bg-destructive/10 px-3 py-2">
                  <AlertCircle className="w-4 h-4 text-destructive shrink-0 mt-0.5" />
                  <div>
                    <p className="text-xs font-rajdhani uppercase tracking-widest font-bold text-destructive">Registration Failed</p>
                    <p className="text-xs text-muted-foreground mt-0.5">{registerErrorMessage(registerResult)}</p>
                  </div>
                </div>
              )}
            </div>
        </CardContent>
      </Card>
      )}

      {/* ── Driver Swap Controls ───────────────────────────────────────────── */}
      {publisherStatus && (publisherStatus.pipelines?.session?.active || publisherStatus.pipelines?.driver?.active) && (
        <Card className="bg-card border-border">
          <CardHeader>
            <CardTitle className="text-muted-foreground text-xs uppercase font-rajdhani tracking-widest flex items-center gap-2">
              <ArrowLeftRight className="w-3.5 h-3.5" />
              Driver Swap Controls
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {operatorState.driverSwapPending && (
              <div className="flex items-center gap-2 rounded-md border border-[color:var(--color-yellow-flag)] bg-[color:var(--color-yellow-flag)]/10 px-3 py-2">
                <span className="text-xs font-rajdhani uppercase tracking-widest font-bold text-[color:var(--color-yellow-flag)]">
                  Swap Pending — Waiting for pit exit
                </span>
              </div>
            )}
            <div className="grid grid-cols-3 gap-3">
              <div className="space-y-1.5">
                <label className="text-[10px] uppercase font-rajdhani tracking-widest text-muted-foreground">Outgoing Driver ID</label>
                <input
                  placeholder="current driver id"
                  className="w-full bg-background border border-border font-mono text-xs rounded-md px-3 py-2 text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                  value={outgoingDriverId}
                  onChange={(e) => setOutgoingDriverId(e.target.value)}
                  disabled={operatorState.driverSwapPending}
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-[10px] uppercase font-rajdhani tracking-widest text-muted-foreground">Incoming Driver ID</label>
                <input
                  placeholder="new driver id"
                  className="w-full bg-background border border-border font-mono text-xs rounded-md px-3 py-2 text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                  value={incomingDriverId}
                  onChange={(e) => setIncomingDriverId(e.target.value)}
                  disabled={operatorState.driverSwapPending}
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-[10px] uppercase font-rajdhani tracking-widest text-muted-foreground">Incoming Driver Name</label>
                <input
                  placeholder="display name"
                  className="w-full bg-background border border-border font-mono text-xs rounded-md px-3 py-2 text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                  value={incomingDriverName}
                  onChange={(e) => setIncomingDriverName(e.target.value)}
                  disabled={operatorState.driverSwapPending}
                />
              </div>
            </div>
            <Button
              onClick={handleInitiateSwap}
              disabled={!outgoingDriverId || !incomingDriverId || !incomingDriverName || swapInitiating || operatorState.driverSwapPending}
              className="bg-primary hover:bg-primary/90 text-white font-rajdhani uppercase tracking-wider font-bold"
            >
              <ArrowLeftRight className="w-4 h-4 mr-2" />
              {swapInitiating ? 'Initiating…' : 'Initiate Swap'}
            </Button>
            <p className="text-xs text-muted-foreground">
              Swap will be queued and executed when the outgoing driver next pits.
            </p>
          </CardContent>
        </Card>
      )}

    </div>
  );
};
