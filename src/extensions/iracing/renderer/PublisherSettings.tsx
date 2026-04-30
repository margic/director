import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Radio, ArrowLeftRight, RefreshCw, AlertCircle, CheckCircle2 } from 'lucide-react';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type PublisherStatusKind = 'active' | 'idle' | 'connecting' | 'error';

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
}

interface OperatorState {
  playerOnPitRoad: boolean;
  driverSwapPending: boolean;
}

const MAX_RECENT_EVENTS = 5;

// ---------------------------------------------------------------------------
// PublisherSettings
// ---------------------------------------------------------------------------

export const PublisherSettings = () => {
  // Settings loaded from config
  const [driverEnabled, setDriverEnabled]       = useState(false);
  const [displayName, setDisplayName]           = useState('');
  const [rigId, setRigId]                       = useState('');
  const [driverSessionId, setDriverSessionId]   = useState('');

  // Live status
  const [publisherStatus, setPublisherStatus]   = useState<PublisherStatus | null>(null);
  const [recentEvents, setRecentEvents]         = useState<RecentEvent[]>([]);

  // Driver swap
  const [operatorState, setOperatorState]       = useState<OperatorState>({ playerOnPitRoad: false, driverSwapPending: false });
  const [incomingDriverName, setIncomingDriverName] = useState('');
  const [incomingDriverId, setIncomingDriverId]     = useState('');
  const [outgoingDriverId, setOutgoingDriverId]     = useState('');
  const [swapInitiating, setSwapInitiating]     = useState(false);

  // Register flow
  const [manualSessionId, setManualSessionId]   = useState('');
  const [registering, setRegistering]           = useState(false);
  const [registerResult, setRegisterResult]     = useState<RegisterResult | null>(null);

  // Regenerate confirmation
  const [confirmRegenerate, setConfirmRegenerate] = useState(false);

  const eventIdSeq = useRef(0);

  // ---------------------------------------------------------------------------
  // Load config on mount
  // ---------------------------------------------------------------------------
  useEffect(() => {
    const load = async () => {
      if (!window.electronAPI?.config) return;
      try {
        const [enabled, name, id, sessId] = await Promise.all([
          window.electronAPI.config.get('publisher.driver.enabled'),
          window.electronAPI.config.get('publisher.driver.displayName'),
          window.electronAPI.config.get('publisher.rigId'),
          window.electronAPI.config.get('publisher.driver.sessionId'),
        ]);
        setDriverEnabled(enabled ?? false);
        setDisplayName(name ?? '');
        setRigId(id ?? '');
        setDriverSessionId(sessId ?? '');
      } catch (e) {
        console.error('Failed to load publisher config', e);
      }
    };
    load();

    // Restore cached status event
    const restoreStatus = async () => {
      if (!window.electronAPI?.extensions) return;
      try {
        const last = await window.electronAPI.extensions.getLastEvent('iracing.publisherStateChanged');
        if (last?.payload) setPublisherStatus(last.payload as PublisherStatus);
      } catch { /* ignore */ }
    };
    restoreStatus();
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
          const p = data.payload as { type: string; carIdx?: number; timestamp: number };
          setRecentEvents((prev) => {
            const next: RecentEvent = {
              id: `${p.timestamp}-${eventIdSeq.current++}`,
              type: p.type,
              carIdx: p.carIdx,
              timestamp: p.timestamp,
            };
            return [next, ...prev].slice(0, MAX_RECENT_EVENTS);
          });
        } else if (data.eventName === 'iracing.publisher.registerDriverResult') {
          const r = data.payload as RegisterResult;
          setRegistering(false);
          setRegisterResult(r);
          if (r.success) {
            // Sync displayed session id
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

  /** True when the orchestrator has a bound session (Director check-in active). */
  const checkinActive = !!(publisherStatus?.raceSessionId && publisherStatus.pipelines?.session?.active);

  const statusColor: Record<PublisherStatusKind, string> = {
    active:     'text-[color:var(--color-green-flag)]',
    connecting: 'text-[color:var(--color-yellow-flag)]',
    idle:       'text-muted-foreground',
    error:      'text-[color:var(--color-red-flag)]',
  };

  const statusLabel: Record<PublisherStatusKind, string> = {
    active:     'Active',
    connecting: 'Connecting',
    idle:       'Idle',
    error:      'Error',
  };

  // ---------------------------------------------------------------------------
  // Handlers
  // ---------------------------------------------------------------------------

  const handleToggleDriver = useCallback(async (checked: boolean) => {
    setDriverEnabled(checked);
    try {
      await window.electronAPI?.config?.set('publisher.driver.enabled', checked);
      await window.electronAPI?.extensions?.executeIntent('iracing.publisher.setDriverEnabled', { enabled: checked });
    } catch (e) {
      console.error('Failed to toggle Driver Publisher', e);
    }
  }, []);

  const handleSaveDisplayName = useCallback(async () => {
    try {
      await window.electronAPI?.config?.set('publisher.driver.displayName', displayName.trim());
    } catch (e) {
      console.error('Failed to save display name', e);
    }
  }, [displayName]);

  const handleRegenerate = useCallback(async () => {
    if (!confirmRegenerate) {
      setConfirmRegenerate(true);
      return;
    }
    setConfirmRegenerate(false);
    try {
      await window.electronAPI?.extensions?.executeIntent('iracing.publisher.regenerateRigId', {});
      // Read the newly generated rigId
      const newId = await window.electronAPI?.config?.get('publisher.rigId');
      if (newId) setRigId(newId);
    } catch (e) {
      console.error('Failed to regenerate Rig ID', e);
    }
  }, [confirmRegenerate]);

  const handleRegister = useCallback(async () => {
    const sessionId = manualSessionId.trim();
    if (!sessionId) return;
    setRegistering(true);
    setRegisterResult(null);
    try {
      await window.electronAPI?.extensions?.executeIntent('iracing.publisher.registerDriver', {
        raceSessionId: sessionId,
      });
      // Result arrives via iracing.publisher.registerDriverResult event
    } catch (e: any) {
      setRegistering(false);
      setRegisterResult({ success: false, message: e?.message ?? 'Intent failed' });
    }
  }, [manualSessionId]);

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

  // ---------------------------------------------------------------------------
  // Register error messaging
  // ---------------------------------------------------------------------------
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

      {/* ── Session Publisher ──────────────────────────────────────────────── */}
      <Card className="bg-card border-border">
        <CardHeader className="pb-3">
          <CardTitle className="text-muted-foreground text-xs uppercase font-rajdhani tracking-widest flex items-center gap-2">
            <Radio className={`w-3.5 h-3.5 ${publisherStatus?.pipelines?.session?.active ? 'text-[color:var(--color-green-flag)]' : 'text-muted-foreground'}`} />
            Session Publisher
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-xs text-muted-foreground">
            Starts automatically when a Director session is active. Publishes flags, overtakes,
            battles, laps, roster and environment for all cars in the field.
          </p>

          {/* Status row */}
          <div className="flex items-center gap-3">
            <span className={`inline-flex items-center gap-1.5 text-xs font-rajdhani uppercase tracking-wider font-bold
              ${publisherStatus?.pipelines?.session?.active ? 'text-[color:var(--color-green-flag)]' : 'text-muted-foreground'}`}>
              <span className={`w-2 h-2 rounded-full inline-block ${publisherStatus?.pipelines?.session?.active ? 'bg-[color:var(--color-green-flag)]' : 'bg-muted-foreground'}`} />
              {publisherStatus?.pipelines?.session?.active ? 'Active' : 'Idle'}
            </span>
            {publisherStatus?.raceSessionId && (
              <span className="text-xs font-jetbrains text-muted-foreground truncate" title={publisherStatus.raceSessionId}>
                Session: {publisherStatus.raceSessionId.slice(0, 24)}{publisherStatus.raceSessionId.length > 24 ? '…' : ''}
              </span>
            )}
          </div>

          {/* Per-pipeline counters */}
          {publisherStatus?.pipelines && (
            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-md border border-border bg-background/40 p-3">
                <div className="text-[10px] uppercase font-rajdhani tracking-widest text-muted-foreground">Events Sent</div>
                <div className="text-2xl font-jetbrains font-bold text-foreground tabular-nums">
                  {publisherStatus.pipelines.session.eventsEnqueued}
                </div>
              </div>
              <div className="rounded-md border border-border bg-background/40 p-3">
                <div className="text-[10px] uppercase font-rajdhani tracking-widest text-muted-foreground">Last Flush</div>
                <div className="text-xl font-jetbrains text-foreground tabular-nums">
                  {formatTime(publisherStatus.lastFlushAt)}
                </div>
              </div>
            </div>
          )}

          {/* Recent events */}
          <div>
            <div className="text-[10px] uppercase font-rajdhani tracking-widest text-muted-foreground mb-2">Recent Events</div>
            <div className="rounded-md border border-border bg-background/40 max-h-36 overflow-y-auto">
              {recentEvents.length === 0 ? (
                <div className="px-3 py-4 text-xs text-muted-foreground font-jetbrains text-center">
                  Waiting for telemetry events…
                </div>
              ) : (
                <ul className="divide-y divide-border">
                  {recentEvents.map((ev) => (
                    <li key={ev.id} className="flex items-center justify-between px-3 py-1.5 font-jetbrains text-xs">
                      <span className="text-foreground">{ev.type}</span>
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

      {/* ── Driver Publisher ───────────────────────────────────────────────── */}
      <Card className="bg-card border-border">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-muted-foreground text-xs uppercase font-rajdhani tracking-widest flex items-center gap-2">
              <Radio className={`w-3.5 h-3.5 ${publisherStatus?.pipelines?.driver?.active ? 'text-[color:var(--color-green-flag)]' : 'text-muted-foreground'}`} />
              Driver Publisher
            </CardTitle>
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground font-rajdhani uppercase">
                {driverEnabled ? 'Enabled' : 'Disabled'}
              </span>
              <Switch checked={driverEnabled} onCheckedChange={handleToggleDriver} />
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-5">
          <p className="text-xs text-muted-foreground">
            Publishes fuel, incidents, pit stops, personal bests and stint data for the player car on this rig.
          </p>

          {/* Status row */}
          <div className="flex items-center gap-3">
            <span className={`inline-flex items-center gap-1.5 text-xs font-rajdhani uppercase tracking-wider font-bold
              ${publisherStatus?.pipelines?.driver?.active ? 'text-[color:var(--color-green-flag)]' : 'text-muted-foreground'}`}>
              <span className={`w-2 h-2 rounded-full inline-block ${publisherStatus?.pipelines?.driver?.active ? 'bg-[color:var(--color-green-flag)]' : 'bg-muted-foreground'}`} />
              {publisherStatus?.pipelines?.driver?.active ? 'Active' : 'Idle'}
            </span>
            {driverEnabled && !publisherStatus?.pipelines?.driver?.active && !checkinActive && !driverSessionId && (
              <span className="text-xs text-[color:var(--color-yellow-flag)] font-rajdhani">
                No session bound — check in or register to start publishing.
              </span>
            )}
          </div>

          {/* Per-pipeline counter */}
          {publisherStatus?.pipelines && (
            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-md border border-border bg-background/40 p-3">
                <div className="text-[10px] uppercase font-rajdhani tracking-widest text-muted-foreground">Events Sent</div>
                <div className="text-2xl font-jetbrains font-bold text-foreground tabular-nums">
                  {publisherStatus.pipelines.driver.eventsEnqueued}
                </div>
              </div>
              <div className="rounded-md border border-border bg-background/40 p-3">
                <div className="text-[10px] uppercase font-rajdhani tracking-widest text-muted-foreground">Last Error</div>
                <div className={`text-xs font-jetbrains truncate ${publisherStatus.lastError ? 'text-[color:var(--color-red-flag)]' : 'text-muted-foreground'}`}
                     title={publisherStatus.lastError ?? ''}>
                  {publisherStatus.lastError ?? '—'}
                </div>
              </div>
            </div>
          )}

          {/* Display name */}
          <div className="space-y-1.5">
            <label className="text-[10px] uppercase font-rajdhani tracking-widest text-muted-foreground">Display Name</label>
            <div className="flex gap-2">
              <Input
                placeholder="Your driver display name"
                className="bg-background border-border font-mono text-sm flex-1"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                onBlur={handleSaveDisplayName}
                onKeyDown={(e) => { if (e.key === 'Enter') void handleSaveDisplayName(); }}
              />
            </div>
          </div>

          {/* Rig ID */}
          <div className="space-y-1.5">
            <label className="text-[10px] uppercase font-rajdhani tracking-widest text-muted-foreground">Rig ID</label>
            <div className="flex gap-2 items-center">
              <Input
                readOnly
                className="bg-background border-border font-jetbrains text-xs flex-1 text-muted-foreground cursor-default select-all"
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

          {/* Driver-only session registration — hidden when checkin is active */}
          {!checkinActive && (
            <div className="rounded-md border border-border bg-background/30 p-4 space-y-3">
              <p className="text-[10px] uppercase font-rajdhani tracking-widest text-muted-foreground">
                For rigs without a Director session
              </p>
              <p className="text-xs text-muted-foreground">
                Enter the Race Control session ID provided by your event organiser and click{' '}
                <strong>Register</strong>. Leave blank if a Director check-in is active.
              </p>
              <div className="flex gap-2">
                <Input
                  placeholder="Session ID"
                  className="bg-background border-border font-jetbrains text-xs flex-1"
                  value={manualSessionId}
                  onChange={(e) => {
                    setManualSessionId(e.target.value);
                    setRegisterResult(null);
                  }}
                  onKeyDown={(e) => { if (e.key === 'Enter') void handleRegister(); }}
                />
                <Button
                  onClick={handleRegister}
                  disabled={!manualSessionId.trim() || registering}
                  className="shrink-0 bg-secondary hover:bg-secondary/90 text-white font-rajdhani uppercase tracking-wider font-bold text-xs"
                >
                  {registering ? 'Registering…' : 'Register'}
                </Button>
              </div>

              {/* Current bound session */}
              {driverSessionId && !registerResult?.success && (
                <p className="text-xs text-muted-foreground font-jetbrains">
                  Registered: <span className="text-foreground">{driverSessionId}</span>
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
          )}

          {checkinActive && (
            <p className="text-xs text-muted-foreground px-1">
              Director check-in active — session bound automatically. Manual registration is not available.
            </p>
          )}
        </CardContent>
      </Card>

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
                <Input
                  placeholder="current driver id"
                  className="bg-background border-border font-mono text-xs"
                  value={outgoingDriverId}
                  onChange={(e) => setOutgoingDriverId(e.target.value)}
                  disabled={operatorState.driverSwapPending}
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-[10px] uppercase font-rajdhani tracking-widest text-muted-foreground">Incoming Driver ID</label>
                <Input
                  placeholder="incoming driver id"
                  className="bg-background border-border font-mono text-xs"
                  value={incomingDriverId}
                  onChange={(e) => setIncomingDriverId(e.target.value)}
                  disabled={operatorState.driverSwapPending}
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-[10px] uppercase font-rajdhani tracking-widest text-muted-foreground">Incoming Driver Name</label>
                <Input
                  placeholder="display name"
                  className="bg-background border-border font-mono text-xs"
                  value={incomingDriverName}
                  onChange={(e) => setIncomingDriverName(e.target.value)}
                  disabled={operatorState.driverSwapPending}
                />
              </div>
            </div>
            <Button
              onClick={handleInitiateSwap}
              disabled={
                swapInitiating ||
                operatorState.driverSwapPending ||
                !operatorState.playerOnPitRoad ||
                !incomingDriverId.trim() ||
                !incomingDriverName.trim()
              }
              className="w-full bg-secondary hover:bg-secondary/90 text-white font-rajdhani uppercase tracking-wider font-bold"
            >
              {operatorState.driverSwapPending
                ? 'Swap Pending…'
                : swapInitiating
                ? 'Initiating…'
                : operatorState.playerOnPitRoad
                ? 'Initiate Driver Swap'
                : 'Initiate Driver Swap (Car must be in pits)'}
            </Button>
          </CardContent>
        </Card>
      )}

    </div>
  );
};

