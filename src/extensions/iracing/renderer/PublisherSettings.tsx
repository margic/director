import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Radio, ArrowLeftRight } from 'lucide-react';

interface PublisherConfig {
  enabled: boolean;
  publisherCode: string;
  raceSessionId: string;
  identityDisplayName: string;
  endpointUrl: string;
  batchIntervalMs: number;
}

type PublisherStatusKind = 'active' | 'idle' | 'connecting' | 'error' | 'disabled';

interface PublisherStatus {
  status: PublisherStatusKind;
  message?: string;
  eventsQueuedTotal?: number;
  lastFlushAt?: number;
  lastError?: string;
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

const DEFAULT_CONFIG: PublisherConfig = {
  enabled: false,
  publisherCode: '',
  raceSessionId: '',
  identityDisplayName: '',
  endpointUrl: 'https://simracecenter.com/api/telemetry/events',
  batchIntervalMs: 500,
};

export const PublisherSettings = () => {
  const [config, setConfig] = useState<PublisherConfig>(DEFAULT_CONFIG);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [publisherStatus, setPublisherStatus] = useState<PublisherStatus | null>(null);
  const [recentEvents, setRecentEvents] = useState<RecentEvent[]>([]);
  const [operatorState, setOperatorState] = useState<OperatorState>({ playerOnPitRoad: false, driverSwapPending: false });
  const [incomingDriverName, setIncomingDriverName] = useState('');
  const [incomingDriverId, setIncomingDriverId] = useState('');
  const [outgoingDriverId, setOutgoingDriverId] = useState('');
  const [swapInitiating, setSwapInitiating] = useState(false);
  const eventIdSeq = useRef(0);

  useEffect(() => {
    const load = async () => {
      if (!window.electronAPI?.config) return;
      try {
        const [
          enabled,
          publisherCode,
          raceSessionId,
          identityDisplayName,
          endpointUrl,
          batchIntervalMs,
        ] = await Promise.all([
          window.electronAPI.config.get('publisher.enabled'),
          window.electronAPI.config.get('publisher.publisherCode'),
          window.electronAPI.config.get('publisher.raceSessionId'),
          window.electronAPI.config.get('publisher.identityDisplayName'),
          window.electronAPI.config.get('publisher.endpointUrl'),
          window.electronAPI.config.get('publisher.batchIntervalMs'),
        ]);
        setConfig({
          enabled: enabled ?? false,
          publisherCode: publisherCode ?? '',
          raceSessionId: raceSessionId ?? '',
          identityDisplayName: identityDisplayName ?? '',
          endpointUrl: endpointUrl ?? DEFAULT_CONFIG.endpointUrl,
          batchIntervalMs: batchIntervalMs ?? DEFAULT_CONFIG.batchIntervalMs,
        });
      } catch (e) {
        console.error('Failed to load publisher config', e);
      }
    };
    load();
  }, []);

  // Subscribe to live publisher status events
  useEffect(() => {
    let unsub: (() => void) | undefined;
    if (window.electronAPI?.extensions) {
      unsub = window.electronAPI.extensions.onExtensionEvent((data) => {
        if (data.eventName === 'iracing.publisherStateChanged') {
          setPublisherStatus(data.payload as PublisherStatus);
        } else if (data.eventName === 'iracing.publisherOperatorState') {
          setOperatorState(data.payload as OperatorState);
        } else if (data.eventName === 'iracing.publisherEventEmitted') {
          const payload = data.payload as { type: string; carIdx?: number; timestamp: number };
          setRecentEvents((prev) => {
            const next: RecentEvent = {
              id: `${payload.timestamp}-${eventIdSeq.current++}`,
              type: payload.type,
              carIdx: payload.carIdx,
              timestamp: payload.timestamp,
            };
            return [next, ...prev].slice(0, MAX_RECENT_EVENTS);
          });
        }
      });
    }
    return () => unsub?.();
  }, []);

  const handleSave = useCallback(async () => {
    if (!window.electronAPI?.config) return;
    setSaving(true);
    setSaveError(null);
    try {
      await Promise.all([
        window.electronAPI.config.set('publisher.enabled', config.enabled),
        window.electronAPI.config.set('publisher.publisherCode', config.publisherCode),
        window.electronAPI.config.set('publisher.raceSessionId', config.raceSessionId),
        window.electronAPI.config.set('publisher.identityDisplayName', config.identityDisplayName),
        window.electronAPI.config.set('publisher.endpointUrl', config.endpointUrl),
        window.electronAPI.config.set('publisher.batchIntervalMs', config.batchIntervalMs),
      ]);
    } catch (e) {
      console.error('Failed to save publisher config', e);
      setSaveError('Failed to save settings. Check the console for details.');
    } finally {
      setSaving(false);
    }
  }, [config]);

  const statusColor: Record<PublisherStatusKind, string> = {
    active: 'text-[color:var(--color-green-flag)]',
    connecting: 'text-[color:var(--color-yellow-flag)]',
    idle: 'text-muted-foreground',
    error: 'text-[color:var(--color-red-flag)]',
    disabled: 'text-muted-foreground',
  };

  const statusLabel: Record<PublisherStatusKind, string> = {
    active: 'Streaming',
    connecting: 'Connecting',
    idle: 'Idle',
    error: 'Error',
    disabled: 'Disabled',
  };

  const handleToggleEnabled = useCallback(
    async (checked: boolean) => {
      setConfig((c) => ({ ...c, enabled: checked }));
      try {
        // Persist first so the orchestrator reads the correct value on start()
        await window.electronAPI?.config?.set('publisher.enabled', checked);
        // Hot-toggle the orchestrator — no restart required
        await window.electronAPI?.extensions?.executeIntent('iracing.publisher.setEnabled', { enabled: checked });
      } catch (e) {
        console.error('Failed to toggle publisher', e);
      }
    },
    [],
  );

  const handleInitiateSwap = useCallback(async () => {
    if (!window.electronAPI?.extensions) return;
    setSwapInitiating(true);
    try {
      await window.electronAPI.extensions.executeIntent('iracing.publisher.initiateDriverSwap', {
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

  const formatTime = (ms?: number): string => {
    if (!ms) return '—';
    const d = new Date(ms);
    return d.toLocaleTimeString(undefined, { hour12: false });
  };

  return (
    <div className="space-y-4">
      {/* Status bar */}
      {publisherStatus && (
        <div className="flex items-center gap-3 px-4 py-2 bg-card border border-border rounded-lg">
          <Radio className={`w-4 h-4 ${statusColor[publisherStatus.status]}`} />
          <span className={`text-xs font-rajdhani uppercase tracking-widest font-bold ${statusColor[publisherStatus.status]}`}>
            {statusLabel[publisherStatus.status]}
          </span>
          {publisherStatus.message && (
            <span className="text-xs text-muted-foreground ml-1">{publisherStatus.message}</span>
          )}
          {publisherStatus.eventsQueuedTotal !== undefined && (
            <span className="ml-auto text-xs font-jetbrains text-muted-foreground">
              {publisherStatus.eventsQueuedTotal} events sent
            </span>
          )}
        </div>
      )}

      {/* Stats + recent events feed */}
      {publisherStatus && (
        <Card className="bg-card border-border">
          <CardHeader>
            <CardTitle className="text-muted-foreground text-xs uppercase font-rajdhani tracking-widest">
              Telemetry Publisher
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-3 gap-3">
              <div className="rounded-md border border-border bg-background/40 p-3">
                <div className="text-[10px] uppercase font-rajdhani tracking-widest text-muted-foreground">
                  Events Published
                </div>
                <div className="text-2xl font-jetbrains font-bold text-foreground tabular-nums">
                  {publisherStatus.eventsQueuedTotal ?? 0}
                </div>
              </div>
              <div className="rounded-md border border-border bg-background/40 p-3">
                <div className="text-[10px] uppercase font-rajdhani tracking-widest text-muted-foreground">
                  Last Flush
                </div>
                <div className="text-xl font-jetbrains text-foreground tabular-nums">
                  {formatTime(publisherStatus.lastFlushAt)}
                </div>
              </div>
              <div className="rounded-md border border-border bg-background/40 p-3">
                <div className="text-[10px] uppercase font-rajdhani tracking-widest text-muted-foreground">
                  Last Error
                </div>
                <div
                  className={`text-xs font-jetbrains truncate ${
                    publisherStatus.lastError
                      ? 'text-[color:var(--color-red-flag)]'
                      : 'text-muted-foreground'
                  }`}
                  title={publisherStatus.lastError ?? ''}
                >
                  {publisherStatus.lastError ?? '—'}
                </div>
              </div>
            </div>

            <div>
              <div className="text-[10px] uppercase font-rajdhani tracking-widest text-muted-foreground mb-2">
                Recent Events
              </div>
              <div className="rounded-md border border-border bg-background/40 max-h-40 overflow-y-auto">
                {recentEvents.length === 0 ? (
                  <div className="px-3 py-4 text-xs text-muted-foreground font-jetbrains text-center">
                    Waiting for telemetry events…
                  </div>
                ) : (
                  <ul className="divide-y divide-border">
                    {recentEvents.map((ev) => (
                      <li
                        key={ev.id}
                        className="flex items-center justify-between px-3 py-1.5 font-jetbrains text-xs"
                      >
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
      )}

      {/* Driver Swap Controls — visible when publisher is active */}
      {publisherStatus && publisherStatus.status !== 'disabled' && (
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
                <label className="text-[10px] uppercase font-rajdhani tracking-widest text-muted-foreground">
                  Outgoing Driver ID
                </label>
                <Input
                  placeholder="current driver id"
                  className="bg-background border-border font-mono text-xs"
                  value={outgoingDriverId}
                  onChange={(e) => setOutgoingDriverId(e.target.value)}
                  disabled={operatorState.driverSwapPending}
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-[10px] uppercase font-rajdhani tracking-widest text-muted-foreground">
                  Incoming Driver ID
                </label>
                <Input
                  placeholder="incoming driver id"
                  className="bg-background border-border font-mono text-xs"
                  value={incomingDriverId}
                  onChange={(e) => setIncomingDriverId(e.target.value)}
                  disabled={operatorState.driverSwapPending}
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-[10px] uppercase font-rajdhani tracking-widest text-muted-foreground">
                  Incoming Driver Name
                </label>
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

      <Card className="bg-card border-border">
        <CardHeader>
          <CardTitle className="text-muted-foreground text-sm uppercase font-rajdhani tracking-widest">
            Publisher Configuration
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">

          {/* Enable toggle */}
          <div className="flex items-center justify-between rounded-lg border border-border p-4">
            <div className="space-y-0.5">
              <label className="text-sm font-medium uppercase text-muted-foreground">Enable Publisher</label>
              <p className="text-xs text-muted-foreground">
                Publish telemetry events from this rig to Race Control.
              </p>
            </div>
            <Switch
              checked={config.enabled}
              onCheckedChange={handleToggleEnabled}
            />
          </div>

          {/* Publisher Code */}
          <div className="space-y-2">
            <label className="text-sm font-medium uppercase text-muted-foreground">Publisher Code</label>
            <Input
              placeholder="e.g. rig-01"
              className="bg-background border-border font-mono"
              value={config.publisherCode}
              onChange={(e) => setConfig((c) => ({ ...c, publisherCode: e.target.value }))}
            />
            <p className="text-xs text-muted-foreground">
              Unique identifier for this rig. Used to tag all outbound events.
            </p>
          </div>

          {/* Race Session ID */}
          <div className="space-y-2">
            <label className="text-sm font-medium uppercase text-muted-foreground">Race Session ID</label>
            <Input
              placeholder="session-uuid from Race Control"
              className="bg-background border-border font-mono"
              value={config.raceSessionId}
              onChange={(e) => setConfig((c) => ({ ...c, raceSessionId: e.target.value }))}
            />
            <p className="text-xs text-muted-foreground">
              Obtained from Race Control after session check-in.
            </p>
          </div>

          {/* Identity Display Name override */}
          <div className="space-y-2">
            <label className="text-sm font-medium uppercase text-muted-foreground">Driver Display Name Override</label>
            <Input
              placeholder="Leave blank to use iRacing username"
              className="bg-background border-border font-mono"
              value={config.identityDisplayName}
              onChange={(e) => setConfig((c) => ({ ...c, identityDisplayName: e.target.value }))}
            />
            <p className="text-xs text-muted-foreground">
              Override the display name sent with publisher events. Useful when the iRacing name differs from the race entry.
            </p>
          </div>

          {/* Advanced */}
          <details className="group">
            <summary className="cursor-pointer text-xs text-muted-foreground uppercase font-rajdhani tracking-widest hover:text-foreground transition-colors select-none">
              Advanced
            </summary>
            <div className="mt-4 space-y-4 pl-1">
              <div className="space-y-2">
                <label className="text-sm font-medium uppercase text-muted-foreground">Endpoint URL</label>
                <Input
                  className="bg-background border-border font-mono text-xs"
                  value={config.endpointUrl}
                  onChange={(e) => setConfig((c) => ({ ...c, endpointUrl: e.target.value }))}
                />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium uppercase text-muted-foreground">Batch Interval (ms)</label>
                <Input
                  type="number"
                  min={100}
                  max={5000}
                  step={100}
                  className="bg-background border-border font-mono"
                  value={config.batchIntervalMs}
                  onChange={(e) =>
                    setConfig((c) => ({ ...c, batchIntervalMs: parseInt(e.target.value, 10) || 500 }))
                  }
                />
                <p className="text-xs text-muted-foreground">
                  How often normal-priority events are flushed. High-priority events always flush immediately.
                </p>
              </div>
            </div>
          </details>

          {saveError && (
            <p className="text-xs text-destructive">{saveError}</p>
          )}

          <Button
            onClick={handleSave}
            disabled={saving}
            className="w-full bg-primary hover:bg-primary/90 text-white font-rajdhani uppercase tracking-wider font-bold"
          >
            {saving ? 'Saving…' : 'Save Publisher Settings'}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
};
