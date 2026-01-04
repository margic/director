import React, { useEffect, useState } from 'react';
import { ArrowLeft, Play, Square, Activity, Terminal, Clock, AlertCircle, CheckCircle2, Camera, Mic, Video, MessageSquare, Timer, X } from 'lucide-react';
import { DirectorState, DirectorSequence } from '../director-types';
import { JsonViewer } from '../components/JsonViewer';
import { clientTelemetry } from '../telemetry';

const TimeProgress = ({ startedAt, durationMs, processed, total }: { startedAt: number, durationMs: number, processed: number, total: number }) => {
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    const interval = setInterval(() => {
      const now = Date.now();
      const diff = now - startedAt;
      setElapsed(Math.min(diff, durationMs));
    }, 50); // Update every 50ms for smooth animation
    return () => clearInterval(interval);
  }, [startedAt, durationMs]);

  const percentage = Math.min((elapsed / durationMs) * 100, 100);
  const remaining = Math.max(0, durationMs - elapsed);

  return (
    <div className="w-full space-y-2">
      <div className="flex justify-between text-xs font-mono text-muted-foreground">
        <span>{(elapsed / 1000).toFixed(1)}s / {(durationMs / 1000).toFixed(1)}s</span>
        <span>{processed} / {total} Steps</span>
      </div>
      <div className="h-2 bg-background rounded-full overflow-hidden relative">
        <div 
          className="h-full bg-primary transition-all duration-75 ease-linear"
          style={{ width: `${percentage}%` }}
        />
      </div>
    </div>
  );
};

interface DirectorPageProps {
  onBack: () => void;
}

export const DirectorPage: React.FC<DirectorPageProps> = ({ onBack }) => {
  const [status, setStatus] = useState<DirectorState | null>(null);
  const [selectedSequence, setSelectedSequence] = useState<DirectorSequence | null>(null);

  useEffect(() => {
    const pollStatus = async () => {
      if (window.electronAPI?.directorStatus) {
        const currentStatus = await window.electronAPI.directorStatus();
        setStatus(currentStatus);
      }
    };

    pollStatus();
    const interval = setInterval(pollStatus, 500); // Poll faster for real-time feel
    return () => clearInterval(interval);
  }, []);

  const toggleDirector = async () => {
    if (!status) return;
    try {
      clientTelemetry.trackEvent('UI.DirectorToggleClicked', {
        currentState: status.isRunning ? 'running' : 'stopped',
        source: 'DirectorPage'
      });
      
      if (status.isRunning) {
        await window.electronAPI.directorStop();
      } else {
        await window.electronAPI.directorStart();
      }
      // Immediate update
      const newStatus = await window.electronAPI.directorStatus();
      setStatus(newStatus);
    } catch (error) {
      console.error('Failed to toggle director', error);
    }
  };

  return (
    <div className="w-full max-w-6xl space-y-6 h-full flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-4">
          <button 
            onClick={onBack}
            className="p-2 rounded-full bg-card border border-border hover:border-primary text-muted-foreground hover:text-primary transition-colors"
          >
            <ArrowLeft className="w-6 h-6" />
          </button>
          <div>
            <h2 className="text-3xl font-bold uppercase tracking-wider text-white">
              Director <span className="text-primary">Control</span>
            </h2>
            <p className="text-muted-foreground text-sm font-mono">
              Session: {status?.sessionId || 'None'}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-4">
          <div className={`px-4 py-2 rounded-lg border ${
            status?.status === 'BUSY' ? 'bg-blue-500/10 border-blue-500/20 text-blue-500' :
            status?.status === 'ERROR' ? 'bg-red-500/10 border-red-500/20 text-red-500' :
            'bg-green-500/10 border-green-500/20 text-green-500'
          }`}>
            <span className="font-bold font-mono uppercase">{status?.status || 'UNKNOWN'}</span>
          </div>
          
          <button 
            onClick={toggleDirector}
            className={`px-6 py-2 rounded-lg font-bold flex items-center gap-2 transition-all ${
              status?.isRunning 
                ? 'bg-destructive text-white hover:bg-destructive/90' 
                : 'bg-primary text-black hover:bg-primary/90'
            }`}
          >
            {status?.isRunning ? (
              <>
                <Square className="w-4 h-4 fill-current" />
                <span>STOP LOOP</span>
              </>
            ) : (
              <>
                <Play className="w-4 h-4 fill-current" />
                <span>START LOOP</span>
              </>
            )}
          </button>
        </div>
      </div>

      {/* Sequence Details Modal */}
      {selectedSequence && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-8">
          <div className="bg-card border border-border rounded-xl shadow-2xl w-full max-w-4xl max-h-full flex flex-col overflow-hidden">
            <div className="flex items-center justify-between p-6 border-b border-border">
              <div className="flex items-center gap-3">
                <Activity className="w-6 h-6 text-primary" />
                <div>
                  <h3 className="text-xl font-bold uppercase tracking-wider text-white">Sequence Details</h3>
                  <p className="text-xs text-muted-foreground font-mono">{selectedSequence.id}</p>
                </div>
              </div>
              <button 
                onClick={() => setSelectedSequence(null)}
                className="p-2 rounded-lg hover:bg-white/10 text-muted-foreground hover:text-white transition-colors"
              >
                <X className="w-6 h-6" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-6 bg-black/30">
              <JsonViewer data={{
                id: selectedSequence.id,
                sequenceId: selectedSequence.id,
                raceSessionId: selectedSequence.raceSessionId,
                totalDurationMs: selectedSequence.durationMs,
                generatedAt: selectedSequence.generatedAt,
                commands: selectedSequence.commands,
                metadata: selectedSequence.metadata
              }} />
            </div>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 flex-1 min-h-0">
        {/* Left Column: Current Execution */}
        <div className="lg:col-span-2 flex flex-col gap-6 min-h-0">
          
          {/* Current Sequence Card */}
          <div className="bg-card border border-border rounded-xl p-6 shadow-lg flex flex-col gap-4">
            <div className="flex items-center justify-between">
              <h3 className="text-xl font-bold uppercase tracking-wider text-white flex items-center gap-2">
                <Activity className="w-5 h-5 text-primary" />
                Current Sequence
              </h3>
              {status?.currentSequenceId && (
                <span className="font-mono text-xs text-muted-foreground bg-background px-2 py-1 rounded border border-border">
                  {status.currentSequenceId}
                </span>
              )}
            </div>

            {status?.currentSequence ? (
              <div className="space-y-4">
                {/* Progress Bar */}
                <div className="space-y-2">
                  <div className="flex justify-between text-xs font-mono text-muted-foreground">
                    <span>Progress</span>
                    {status.currentSequence.durationMs && status.sequenceStartedAt ? (
                      <TimeProgress 
                        startedAt={status.sequenceStartedAt} 
                        durationMs={status.currentSequence.durationMs} 
                        processed={status.processedCommands || 0}
                        total={status.totalCommands || 0}
                      />
                    ) : (
                      <span>{status.processedCommands} / {status.totalCommands} Commands</span>
                    )}
                  </div>
                  {!(status.currentSequence.durationMs && status.sequenceStartedAt) && (
                    <div className="h-2 bg-background rounded-full overflow-hidden">
                      <div 
                        className="h-full bg-primary transition-all duration-300 ease-out"
                        style={{ width: `${status.totalCommands ? (status.processedCommands! / status.totalCommands) * 100 : 0}%` }}
                      />
                    </div>
                  )}
                </div>

                {/* Current/Last Command */}
                <div className="bg-background/50 border border-border rounded-lg p-4">
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2 text-secondary font-bold uppercase text-sm">
                      <Terminal className="w-4 h-4" />
                      {status.currentCommand ? 'Executing Command' : 'Last Command'}
                    </div>
                    {!status.currentCommand && status.lastCommand && (
                      <span className="text-[10px] bg-white/10 px-2 py-0.5 rounded text-muted-foreground">COMPLETED</span>
                    )}
                  </div>
                  
                  {(() => {
                    const cmd = status.currentCommand || status.lastCommand;
                    if (!cmd) {
                       return <div className="text-muted-foreground italic text-sm">Waiting for command...</div>;
                    }
                    
                    const payload = cmd.payload as any;
                    return (
                    <div className={`space-y-2 transition-opacity duration-300 ${status.currentCommand ? 'opacity-100' : 'opacity-60'}`}>
                      <div className="flex items-center gap-2">
                        <span className="px-2 py-0.5 rounded bg-secondary/20 text-secondary text-xs font-bold border border-secondary/30">
                          {cmd.type}
                        </span>
                        <span className="text-xs text-muted-foreground font-mono">{cmd.id}</span>
                      </div>
                      <div className="text-sm bg-black/30 p-3 rounded border border-border/50">
                        {(() => {
                          switch (cmd.type) {
                            case 'SWITCH_CAMERA':
                              return (
                                <div className="flex items-center gap-3">
                                  <Camera className="w-5 h-5 text-secondary" />
                                  <div>
                                    <div className="text-muted-foreground text-xs uppercase tracking-wider">Target Camera</div>
                                    <div className="font-bold text-white">
                                      {payload.cameraGroupName || `Group ${payload.cameraGroupNumber}`} 
                                      <span className="text-muted-foreground font-normal ml-2">
                                        (Car #{payload.carNumber})
                                      </span>
                                    </div>
                                  </div>
                                </div>
                              );
                            case 'SWITCH_OBS_SCENE':
                              return (
                                <div className="flex items-center gap-3">
                                  <Video className="w-5 h-5 text-purple-500" />
                                  <div>
                                    <div className="text-muted-foreground text-xs uppercase tracking-wider">OBS Scene</div>
                                    <div className="font-bold text-white">{payload.sceneName}</div>
                                  </div>
                                </div>
                              );
                            case 'DRIVER_TTS':
                              return (
                                <div className="flex items-center gap-3">
                                  <Mic className="w-5 h-5 text-green-500" />
                                  <div>
                                    <div className="text-muted-foreground text-xs uppercase tracking-wider">TTS Message</div>
                                    <div className="font-bold text-white italic">"{payload.text}"</div>
                                  </div>
                                </div>
                              );
                            case 'WAIT':
                              return (
                                <div className="flex items-center gap-3">
                                  <Timer className="w-5 h-5 text-yellow-500" />
                                  <div>
                                    <div className="text-muted-foreground text-xs uppercase tracking-wider">Duration</div>
                                    <div className="font-bold text-white">{payload.durationMs}ms</div>
                                  </div>
                                </div>
                              );
                            case 'LOG':
                              return (
                                <div className="flex items-center gap-3">
                                  <Terminal className="w-5 h-5 text-blue-500" />
                                  <div>
                                    <div className="text-muted-foreground text-xs uppercase tracking-wider">Log Message</div>
                                    <div className="font-mono text-white">{payload.message}</div>
                                  </div>
                                </div>
                              );
                            case 'VIEWER_CHAT':
                              return (
                                <div className="flex items-center gap-3">
                                  <MessageSquare className="w-5 h-5 text-pink-500" />
                                  <div>
                                    <div className="text-muted-foreground text-xs uppercase tracking-wider">Chat Message</div>
                                    <div className="font-bold text-white">"{payload.message}"</div>
                                  </div>
                                </div>
                              );
                            default:
                              return <JsonViewer data={payload} />;
                          }
                        })()}
                      </div>
                    </div>
                    );
                  })()}
                </div>
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center py-12 text-muted-foreground border-2 border-dashed border-border/50 rounded-lg">
                <Clock className="w-8 h-8 mb-2 opacity-50" />
                <p>Waiting for sequence...</p>
              </div>
            )}
          </div>

          {/* Recent History */}
          <div className="bg-card border border-border rounded-xl p-6 shadow-lg flex-1 flex flex-col min-h-0">
            <h3 className="text-xl font-bold uppercase tracking-wider text-white flex items-center gap-2 mb-4">
              <Clock className="w-5 h-5 text-secondary" />
              Recent Sequences
            </h3>
            
            <div className="flex-1 overflow-y-auto pr-2 space-y-3">
              {status?.recentSequences && status.recentSequences.length > 0 ? (
                status.recentSequences.map((seq) => (
                  <div 
                    key={seq.id} 
                    onClick={() => setSelectedSequence(seq)}
                    className="bg-background/30 border border-border rounded-lg p-3 hover:border-border/80 transition-colors cursor-pointer hover:bg-white/5"
                  >
                    <div className="flex items-center justify-between mb-2">
                      <span className="font-mono text-xs text-muted-foreground">{seq.id}</span>
                      <span className="text-xs font-bold text-green-500 flex items-center gap-1">
                        <CheckCircle2 className="w-3 h-3" />
                        COMPLETED
                      </span>
                    </div>
                    <div className="flex gap-2 flex-wrap">
                      {seq.commands.map((cmd, idx) => (
                        <span key={idx} className="px-1.5 py-0.5 rounded bg-white/5 text-white/70 text-[10px] font-mono border border-white/10">
                          {cmd.type}
                        </span>
                      ))}
                    </div>
                  </div>
                ))
              ) : (
                <div className="text-center py-8 text-muted-foreground text-sm">
                  No recent history available.
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Right Column: Stats & Logs */}
        <div className="flex flex-col gap-6">
          {/* Stats */}
          <div className="bg-card border border-border rounded-xl p-6 shadow-lg">
            <h3 className="text-sm font-bold uppercase tracking-wider text-muted-foreground mb-4">Session Stats</h3>
            <div className="grid grid-cols-2 gap-4">
              <div className="bg-background/50 p-3 rounded-lg border border-border/50">
                <div className="text-2xl font-jetbrains font-bold text-white">
                  {status?.totalSequencesProcessed || 0}
                </div>
                <div className="text-xs text-muted-foreground uppercase">Sequences</div>
              </div>
              <div className="bg-background/50 p-3 rounded-lg border border-border/50">
                <div className="text-2xl font-jetbrains font-bold text-white">
                  {status?.status === 'BUSY' ? 'ACTIVE' : 'IDLE'}
                </div>
                <div className="text-xs text-muted-foreground uppercase">State</div>
              </div>
            </div>
          </div>

          {/* Last Error */}
          {status?.lastError && (
            <div className="bg-destructive/10 border border-destructive/30 rounded-xl p-6 shadow-lg">
              <h3 className="text-sm font-bold uppercase tracking-wider text-destructive mb-2 flex items-center gap-2">
                <AlertCircle className="w-4 h-4" />
                Last Error
              </h3>
              <p className="text-sm text-destructive-foreground font-mono break-words">
                {status.lastError}
              </p>
            </div>
          )}
          
          {/* Debug Info */}
          <div className="bg-card border border-border rounded-xl p-6 shadow-lg flex-1 flex flex-col min-h-0">
             <h3 className="text-sm font-bold uppercase tracking-wider text-muted-foreground mb-4">Debug State</h3>
             <div className="flex-1 overflow-y-auto text-xs font-mono text-muted-foreground bg-black/30 p-2 rounded border border-border/30">
               <pre>{JSON.stringify({
                 isRunning: status?.isRunning,
                 sessionId: status?.sessionId,
                 currentSequenceId: status?.currentSequenceId,
               }, null, 2)}</pre>
             </div>
          </div>
        </div>
      </div>
    </div>
  );
};
