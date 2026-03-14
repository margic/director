/**
 * DirectorDashboardCard — Dashboard widget for the Director Loop.
 *
 * Shows director status (IDLE / BUSY / ERROR), active session,
 * and start/stop controls. Clicking the card navigates to the
 * Director detail panel.
 */

import React, { useState, useEffect } from 'react';
import { Activity, Play, Square } from 'lucide-react';
import { clientTelemetry } from '../../telemetry';

interface DirectorState {
  isRunning: boolean;
  status: string;
  sessionId: string | null;
  currentSequenceId?: string | null;
  totalCommands?: number;
  processedCommands?: number;
  lastError?: string;
}

interface DirectorDashboardCardProps {
  onClick: () => void;
}

export const DirectorDashboardCard: React.FC<DirectorDashboardCardProps> = ({ onClick }) => {
  const [directorStatus, setDirectorStatus] = useState<DirectorState>({
    isRunning: false,
    status: 'IDLE',
    sessionId: null,
  });

  useEffect(() => {
    const pollStatus = async () => {
      if (!window.electronAPI?.directorStatus) return;
      try {
        const status = await window.electronAPI.directorStatus();
        setDirectorStatus(status);
      } catch (e) {
        console.error('Failed to poll director status', e);
      }
    };

    pollStatus();
    const interval = setInterval(pollStatus, 2000);
    return () => clearInterval(interval);
  }, []);

  const toggleDirector = async (e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      clientTelemetry.trackEvent('UI.DirectorToggleClicked', {
        currentState: directorStatus.isRunning ? 'running' : 'stopped',
      });

      if (!window.electronAPI) return;

      if (directorStatus.isRunning) {
        const status = await window.electronAPI.directorStop();
        setDirectorStatus(status);
      } else {
        const status = await window.electronAPI.directorStart();
        setDirectorStatus(status);
      }
    } catch (error) {
      console.error('Failed to toggle director', error);
      clientTelemetry.trackException(error as Error, { context: 'toggleDirector' });
    }
  };

  return (
    <div
      onClick={onClick}
      className="bg-card border border-border rounded-xl p-6 h-64 flex flex-col justify-between hover:border-primary/50 transition-colors group relative overflow-hidden cursor-pointer"
    >
      <div className="flex justify-between items-center z-10">
        <div className="flex items-center gap-2">
          <Activity className="w-5 h-5 text-muted-foreground group-hover:text-primary transition-colors" />
          <h3 className="text-muted-foreground text-sm font-bold uppercase tracking-wider">Director Control</h3>
        </div>
        <div className={`w-3 h-3 rounded-full ${directorStatus.isRunning ? 'bg-green-500 animate-pulse' : 'bg-red-500'}`} />
      </div>

      <div className="z-10">
        <div className="text-2xl font-jetbrains font-bold text-white mb-1">
          {directorStatus.status}
        </div>
        <div className="text-xs text-muted-foreground font-rajdhani truncate">
          {directorStatus.sessionId ? `Session: ${directorStatus.sessionId}` : 'No Active Session'}
        </div>
      </div>

      <button
        onClick={toggleDirector}
        className={`z-10 w-full py-3 rounded-lg font-bold flex items-center justify-center gap-2 transition-all ${
          directorStatus.isRunning
            ? 'bg-destructive text-white hover:bg-destructive/90 shadow-[0_0_20px_rgba(239,51,64,0.4)]'
            : 'bg-primary text-black hover:bg-primary/90 shadow-[0_0_20px_rgba(255,95,31,0.4)]'
        }`}
      >
        {directorStatus.isRunning ? (
          <>
            <Square className="w-4 h-4 fill-current" />
            <span>STOP</span>
          </>
        ) : (
          <>
            <Play className="w-4 h-4 fill-current" />
            <span>START</span>
          </>
        )}
      </button>

      {directorStatus.isRunning && (
        <div className="absolute inset-0 bg-green-500/5 animate-pulse pointer-events-none" />
      )}
    </div>
  );
};
