/**
 * DirectorPanel — Full detail page for the Director Loop.
 *
 * Shows real-time status, active session, polling activity,
 * sequence execution progress, and a live activity log.
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  Activity,
  Play,
  Square,
  Radio,
  Clock,
  AlertTriangle,
  Loader2,
  Zap,
  ShieldCheck,
  ShieldAlert,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { useSetPageHeader } from '@/contexts/PageHeaderContext';
import { clientTelemetry } from '@/telemetry';
import type { DirectorOrchestratorState } from '../../main/director-orchestrator';

interface LogEntry {
  timestamp: Date;
  level: 'info' | 'warn' | 'error' | 'success';
  message: string;
}

interface DirectorPanelProps {
  onNavigate?: (view: string) => void;
}

export const DirectorPanel: React.FC<DirectorPanelProps> = ({ onNavigate }) => {
  const [directorStatus, setDirectorStatus] = useState<DirectorOrchestratorState>({
    mode: 'stopped',
    status: 'IDLE',
    sessionId: null,
    checkinStatus: 'unchecked',
  });
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [sequencesExecuted, setSequencesExecuted] = useState(0);
  const logEndRef = useRef<HTMLDivElement>(null);
  const prevStatusRef = useRef<DirectorOrchestratorState | null>(null);

  const isRunning = directorStatus.mode !== 'stopped';

  useSetPageHeader({
    title: 'Agent',
    icon: Activity,
    subtitle: isRunning ? directorStatus.status : 'Stopped',
    subtitleVariant: isRunning
      ? directorStatus.status === 'ERROR'
        ? 'danger'
        : 'success'
      : 'danger',
  });

  const addLog = useCallback((level: LogEntry['level'], message: string) => {
    setLogs((prev) => {
      const next = [...prev, { timestamp: new Date(), level, message }];
      // Keep last 200 entries
      return next.length > 200 ? next.slice(-200) : next;
    });
  }, []);

  // Poll director status
  useEffect(() => {
    const pollStatus = async () => {
      if (!window.electronAPI?.directorState) return;
      try {
        const status = await window.electronAPI.directorState();
        setDirectorStatus(status);

        // Detect state transitions and log them
        const prev = prevStatusRef.current;
        if (prev) {
          const wasRunning = prev.mode !== 'stopped';
          const nowRunning = status.mode !== 'stopped';
          if (!wasRunning && nowRunning) {
            addLog('success', 'Agent started');
          } else if (wasRunning && !nowRunning) {
            addLog('info', 'Agent stopped');
          }

          if (prev.status !== status.status) {
            if (status.status === 'ERROR') {
              addLog('error', `Status changed to ERROR${status.lastError ? `: ${status.lastError}` : ''}`);
            } else if (status.status === 'BUSY') {
              addLog('info', `Executing sequence: ${status.currentSequenceId || 'unknown'}`);
            } else if (prev.status === 'BUSY' && status.status === 'IDLE') {
              addLog('success', 'Sequence execution completed');
              setSequencesExecuted((c) => c + 1);
            }
          }

          if (prev.sessionId !== status.sessionId && status.sessionId) {
            addLog('info', `Joined session: ${status.sessionId}`);
          }

          if (prev.checkinStatus !== status.checkinStatus) {
            if (status.checkinStatus === 'standby') {
              addLog('success', 'Checked in to session');
            } else if (status.checkinStatus === 'unchecked' && prev.checkinStatus !== 'unchecked') {
              addLog('info', 'Checked out of session');
            }
          }

          if (status.lastError && status.lastError !== prev.lastError) {
            addLog('error', status.lastError);
          }
        }

        prevStatusRef.current = status;
      } catch (e) {
        console.error('Failed to poll director status', e);
      }
    };

    pollStatus();
    const interval = setInterval(pollStatus, 1500);
    return () => clearInterval(interval);
  }, [addLog]);

  // Subscribe to sequence progress events for richer logging
  useEffect(() => {
    if (!window.electronAPI?.sequences?.onProgress) return;
    const unsubscribe = window.electronAPI.sequences.onProgress((progress: any) => {
      if (progress.log) {
        const level = progress.stepStatus === 'failed' ? 'error'
          : progress.stepStatus === 'skipped' ? 'warn'
          : 'info';
        addLog(level, progress.log);
      }
    });
    return unsubscribe;
  }, [addLog]);

  // Auto-scroll log
  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logs]);

  const toggleDirector = async () => {
    try {
      clientTelemetry.trackEvent('UI.DirectorToggleClicked', {
        currentState: isRunning ? 'running' : 'stopped',
      });

      if (!window.electronAPI) return;

      if (isRunning) {
        addLog('info', 'Stopping agent...');
        const status = await window.electronAPI.directorSetMode('stopped');
        setDirectorStatus(status);
      } else {
        addLog('info', 'Starting agent...');
        const status = await window.electronAPI.directorSetMode('auto');
        setDirectorStatus(status);
      }
    } catch (error) {
      console.error('Failed to toggle director', error);
      addLog('error', `Toggle failed: ${(error as Error).message}`);
      clientTelemetry.trackException(error as Error, { context: 'toggleDirector' });
    }
  };

  const clearLogs = () => setLogs([]);

  const statusColor = isRunning
    ? directorStatus.status === 'ERROR'
      ? 'text-destructive'
      : directorStatus.status === 'BUSY'
        ? 'text-primary'
        : 'text-green-500'
    : 'text-muted-foreground';

  const statusDotColor = isRunning
    ? directorStatus.status === 'ERROR'
      ? 'bg-destructive'
      : 'bg-green-500'
    : 'bg-red-500';

  return (
    <div className="w-full space-y-6 animate-in fade-in duration-500">
      {/* Top control bar */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <div className={`w-4 h-4 rounded-full ${statusDotColor} ${isRunning ? 'animate-pulse' : ''}`} />
          <span className={`text-3xl font-jetbrains font-bold ${statusColor}`}>
            {isRunning ? directorStatus.status : 'STOPPED'}
          </span>
        </div>
        <Button
          onClick={toggleDirector}
          className={
            isRunning
              ? 'bg-destructive text-white hover:bg-destructive/90 shadow-[0_0_20px_rgba(239,51,64,0.4)]'
              : 'bg-primary text-black hover:bg-primary/90 shadow-[0_0_20px_rgba(255,95,31,0.4)]'
          }
        >
          {isRunning ? (
            <>
              <Square className="w-4 h-4 mr-2 fill-current" />
              STOP AGENT
            </>
          ) : (
            <>
              <Play className="w-4 h-4 mr-2 fill-current" />
              START AGENT
            </>
          )}
        </Button>
      </div>

      {/* Status Cards Row */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {/* Session Card */}
        <Card className="bg-card border-border">
          <CardHeader className="pb-2">
            <CardTitle className="text-muted-foreground text-xs uppercase font-rajdhani tracking-widest flex items-center gap-2">
              <Radio className="w-3.5 h-3.5" />
              Active Session
            </CardTitle>
          </CardHeader>
          <CardContent>
            {directorStatus.sessionId ? (
              <div className="space-y-2">
                <span className="text-sm font-jetbrains text-foreground break-all">
                  {directorStatus.sessionId}
                </span>
                <div className="flex items-center gap-1.5">
                  {directorStatus.checkinStatus === 'standby' || directorStatus.checkinStatus === 'directing' ? (
                    <ShieldCheck className="w-3.5 h-3.5 text-green-500" />
                  ) : directorStatus.checkinStatus === 'error' ? (
                    <ShieldAlert className="w-3.5 h-3.5 text-destructive" />
                  ) : null}
                  <span className={`text-xs uppercase font-rajdhani tracking-wide ${
                    directorStatus.checkinStatus === 'standby' || directorStatus.checkinStatus === 'directing'
                      ? 'text-green-500'
                      : directorStatus.checkinStatus === 'error'
                        ? 'text-destructive'
                        : 'text-muted-foreground'
                  }`}>
                    {directorStatus.checkinStatus === 'unchecked' ? 'Not checked in'
                      : directorStatus.checkinStatus === 'standby' ? 'Checked in'
                      : directorStatus.checkinStatus === 'directing' ? 'Directing'
                      : directorStatus.checkinStatus === 'error' ? 'Check-in error'
                      : directorStatus.checkinStatus}
                  </span>
                </div>
              </div>
            ) : (
              <span className="text-sm text-muted-foreground italic">No session</span>
            )}
          </CardContent>
        </Card>

        {/* Current Sequence Card */}
        <Card
          className={`bg-card border-border ${onNavigate ? 'cursor-pointer hover:border-primary/50 transition-colors' : ''}`}
          onClick={() => onNavigate?.('sequences-live')}
        >
          <CardHeader className="pb-2">
            <CardTitle className="text-muted-foreground text-xs uppercase font-rajdhani tracking-widest flex items-center gap-2">
              <Zap className="w-3.5 h-3.5" />
              Current Sequence
            </CardTitle>
          </CardHeader>
          <CardContent>
            {directorStatus.currentSequenceId ? (
              <>
                <span className="text-sm font-jetbrains text-primary break-all">
                  {directorStatus.currentSequenceId}
                </span>
                {directorStatus.totalCommands != null && directorStatus.totalCommands > 0 && (
                  <div className="mt-2">
                    <div className="flex justify-between text-xs text-muted-foreground mb-1">
                      <span>Progress</span>
                      <span>{directorStatus.processedCommands}/{directorStatus.totalCommands}</span>
                    </div>
                    <div className="w-full h-1.5 bg-border rounded-full overflow-hidden">
                      <div
                        className="h-full bg-primary rounded-full transition-all duration-300"
                        style={{
                          width: `${((directorStatus.processedCommands || 0) / directorStatus.totalCommands) * 100}%`,
                        }}
                      />
                    </div>
                  </div>
                )}
              </>
            ) : (
              <span className="text-sm text-muted-foreground italic">Idle</span>
            )}
          </CardContent>
        </Card>

        {/* Stats Card */}
        <Card className="bg-card border-border">
          <CardHeader className="pb-2">
            <CardTitle className="text-muted-foreground text-xs uppercase font-rajdhani tracking-widest flex items-center gap-2">
              <Clock className="w-3.5 h-3.5" />
              Session Stats
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-col gap-1">
              <div className="flex justify-between">
                <span className="text-xs text-muted-foreground">Sequences Executed</span>
                <span className="text-sm font-jetbrains font-bold text-foreground">{sequencesExecuted}</span>
              </div>
              {directorStatus.lastError && (
                <div className="flex items-start gap-1.5 mt-2 p-2 bg-destructive/10 border border-destructive/20 rounded">
                  <AlertTriangle className="w-3.5 h-3.5 text-destructive shrink-0 mt-0.5" />
                  <span className="text-xs text-destructive break-all">{directorStatus.lastError}</span>
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Activity Log */}
      <Card className="bg-card border-border">
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <CardTitle className="text-muted-foreground text-xs uppercase font-rajdhani tracking-widest flex items-center gap-2">
              <Activity className="w-3.5 h-3.5" />
              Activity Log
            </CardTitle>
            <Button variant="ghost" size="sm" onClick={clearLogs} className="text-xs text-muted-foreground hover:text-foreground">
              Clear
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <div className="bg-background border border-border rounded-lg p-4 h-80 overflow-y-auto font-jetbrains text-xs">
            {logs.length === 0 ? (
              <div className="flex items-center justify-center h-full text-muted-foreground">
                {isRunning ? (
                  <div className="flex items-center gap-2">
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Waiting for activity...
                  </div>
                ) : (
                  'Start the Agent to see activity'
                )}
              </div>
            ) : (
              <div className="space-y-0.5">
                {logs.map((entry, i) => (
                  <div key={i} className="flex gap-2 py-0.5 hover:bg-white/5 px-1 rounded">
                    <span className="text-muted-foreground shrink-0 tabular-nums">
                      [{entry.timestamp.toLocaleTimeString(undefined, { hour12: false, fractionalSecondDigits: 3 } as any)}]
                    </span>
                    <span className="shrink-0">
                      {entry.level === 'error' ? (
                        <span className="text-destructive">❌</span>
                      ) : entry.level === 'warn' ? (
                        <span className="text-[var(--yellow-flag)]">⚠️</span>
                      ) : entry.level === 'success' ? (
                        <span className="text-green-500">✅</span>
                      ) : (
                        <span className="text-secondary">▶</span>
                      )}
                    </span>
                    <span
                      className={
                        entry.level === 'error'
                          ? 'text-destructive'
                          : entry.level === 'warn'
                            ? 'text-[var(--yellow-flag)]'
                            : entry.level === 'success'
                              ? 'text-green-500'
                              : 'text-foreground/90'
                      }
                    >
                      {entry.message}
                    </span>
                  </div>
                ))}
                <div ref={logEndRef} />
              </div>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
};
