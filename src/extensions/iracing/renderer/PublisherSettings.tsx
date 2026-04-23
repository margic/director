import React, { useState, useEffect, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Radio } from 'lucide-react';

interface PublisherConfig {
  enabled: boolean;
  publisherCode: string;
  raceSessionId: string;
  identityDisplayName: string;
  endpointUrl: string;
  batchIntervalMs: number;
}

interface PublisherStatus {
  status: 'active' | 'idle' | 'error' | 'disabled';
  message?: string;
  eventsQueuedTotal?: number;
  lastFlushAt?: number;
}

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

  const statusColor = {
    active: 'text-green-400',
    idle: 'text-muted-foreground',
    error: 'text-destructive',
    disabled: 'text-muted-foreground',
  };

  return (
    <div className="space-y-4">
      {/* Status bar */}
      {publisherStatus && (
        <div className="flex items-center gap-3 px-4 py-2 bg-card border border-border rounded-lg">
          <Radio className={`w-4 h-4 ${statusColor[publisherStatus.status]}`} />
          <span className={`text-xs font-rajdhani uppercase tracking-widest font-bold ${statusColor[publisherStatus.status]}`}>
            {publisherStatus.status}
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
              onCheckedChange={(checked) => setConfig((c) => ({ ...c, enabled: checked }))}
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
