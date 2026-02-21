import { useState, useEffect } from 'react'
import { Activity, User, Play, Square, Loader2 } from 'lucide-react'
import { UserProfile, RaceSession } from '../types'
import { clientTelemetry } from '../telemetry'
import { extensionViews } from '../extension-views'
import { SequencesDashboardCard } from '../components/sequences/SequencesDashboardCard'

interface DashboardProps {
  user: any;
  userProfile: UserProfile | null;
  setCurrentView: (view: string) => void;
  onLogin: () => void;
  onSessionSelect: (session: RaceSession) => void;
}

export const Dashboard = ({ user, userProfile, setCurrentView, onLogin, onSessionSelect }: DashboardProps) => {
  const [sessions, setSessions] = useState<RaceSession[]>([]);
  const [loadingSessions, setLoadingSessions] = useState(false);
  const [directorStatus, setDirectorStatus] = useState<any>({ isRunning: false, status: 'IDLE', sessionId: null });
  const [extensionStatus, setExtensionStatus] = useState<Record<string, { active: boolean }>>({});

  useEffect(() => {
     const loadExtensionStatus = async () => {
       if (window.electronAPI?.extensions?.getStatus) {
         try {
           const status = await window.electronAPI.extensions.getStatus();
           setExtensionStatus(status);
         } catch (e) {
           console.error('Failed to load extension status', e);
         }
       }
     };
     
     loadExtensionStatus();
     const interval = setInterval(loadExtensionStatus, 5000); // Poll every 5s
     return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    const pollStatus = async () => {
      // Guard against electronAPI missing
      if (!window.electronAPI) return;

      if (window.electronAPI.directorStatus) {
        const status = await window.electronAPI.directorStatus();
        setDirectorStatus(status);
      }
    };
    
    if (user) {
      pollStatus();
      const interval = setInterval(pollStatus, 2000);
      return () => clearInterval(interval);
    }
  }, [user]);

  // Poll for available sessions with exponential backoff (5s → 3min)
  useEffect(() => {
    const BASE_INTERVAL = 5_000;   // 5 seconds
    const MAX_INTERVAL  = 180_000; // 3 minutes
    let currentInterval = BASE_INTERVAL;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let lastSessionSignature = '';
    let cancelled = false;

    const fetchSessions = async () => {
      const centerId = userProfile?.centerId || userProfile?.center?.id;
      if (!centerId || !window.electronAPI?.directorListSessions) return;

      setLoadingSessions(true);
      try {
        const sessionList = await window.electronAPI.directorListSessions(centerId);
        if (cancelled) return;

        // Build a signature to detect data changes
        const sig = sessionList.map(s => `${s.raceSessionId}:${s.status ?? ''}`).join('|');
        if (sig !== lastSessionSignature) {
          // Data changed — reset backoff
          currentInterval = BASE_INTERVAL;
          lastSessionSignature = sig;
        } else {
          // No change — increase interval with exponential backoff
          currentInterval = Math.min(currentInterval * 2, MAX_INTERVAL);
        }

        setSessions(sessionList);
      } catch (error) {
        console.error('Failed to fetch sessions:', error);
        // On error, still back off (don't hammer a failing endpoint)
        currentInterval = Math.min(currentInterval * 2, MAX_INTERVAL);
      } finally {
        if (!cancelled) {
          setLoadingSessions(false);
          timer = setTimeout(fetchSessions, currentInterval);
        }
      }
    };

    if (userProfile) {
      fetchSessions();
    }

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [userProfile]);

  const toggleDirector = async () => {
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

  // Login View
  if (!user) {
    return (
      <div className="my-auto max-w-md w-full bg-card border border-border rounded-xl p-8 shadow-2xl relative overflow-hidden group">
        <div className="absolute inset-0 bg-gradient-to-br from-primary/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-500 pointer-events-none" />
        
        <div className="relative z-10 text-center space-y-6">
          <div className="w-16 h-16 bg-primary/10 rounded-full flex items-center justify-center mx-auto mb-6 border border-primary/20 group-hover:border-primary/50 transition-colors">
            <User className="w-8 h-8 text-primary" />
          </div>
          
          <div>
            <h2 className="text-2xl font-bold text-white mb-2">AUTHENTICATION REQUIRED</h2>
            <p className="text-muted-foreground">Please sign in with your Sim RaceCenter credentials to access the telemetry bridge.</p>
          </div>

          <button 
            onClick={onLogin}
            className="w-full bg-primary hover:bg-primary/90 text-black font-bold py-4 px-6 rounded-lg uppercase tracking-wider transition-all hover:shadow-[0_0_20px_rgba(255,95,31,0.3)] flex items-center justify-center gap-2"
          >
            <span>Initialize Session</span>
            <Activity className="w-4 h-4" />
          </button>
        </div>
      </div>
    );
  }

  // Dashboard View
  return (
    <div className="w-full max-w-6xl space-y-6">
      {/* Sessions List */}
      <div className="bg-card border border-border rounded-xl p-6">
        <div className="flex justify-between items-center mb-4">
          <h3 className="text-white text-lg font-bold uppercase tracking-wider">
            Available Sessions
            {(userProfile?.centerId || userProfile?.center?.id) && (
              <span className="text-primary text-sm ml-2">({userProfile.center?.name || userProfile.centerId || userProfile.center?.id})</span>
            )}
          </h3>
          {loadingSessions && (
            <Loader2 className="w-5 h-5 text-primary animate-spin" />
          )}
        </div>
        
        {sessions.length === 0 ? (
          <div className="text-center py-8">
            <p className="text-muted-foreground">
              {loadingSessions ? 'Loading sessions...' : 'No active sessions found. Waiting for session...'}
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {sessions.map((session) => (
              <div 
                key={session.raceSessionId}
                onClick={() => onSessionSelect(session)}
                className="bg-background border border-border rounded-lg p-4 hover:border-primary/50 transition-colors cursor-pointer group"
              >
                <div className="flex justify-between items-start mb-2">
                  <h4 className="text-white font-bold group-hover:text-primary transition-colors">{session.name}</h4>
                  <span className={`px-2 py-0.5 rounded text-xs font-bold ${
                    session.status === 'ACTIVE' 
                      ? 'bg-green-500/10 text-green-500 border border-green-500/20'
                      : 'bg-yellow-500/10 text-yellow-500 border border-yellow-500/20'
                  }`}>
                    {session.status}
                  </span>
                </div>
                <p className="text-xs text-muted-foreground mb-3">
                  ID: {session.raceSessionId}
                </p>
                {session.createdAt && (
                  <p className="text-xs text-muted-foreground">
                    Created: {new Date(session.createdAt).toLocaleString()}
                  </p>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Control Cards Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {/* Director Control Card */}
        <div className="bg-card border border-border rounded-xl p-6 h-64 flex flex-col justify-between hover:border-primary/50 transition-colors group relative overflow-hidden">
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

          {/* Background Pulse Effect */}
          {directorStatus.isRunning && (
            <div className="absolute inset-0 bg-green-500/5 animate-pulse pointer-events-none" />
          )}
        </div>

        {/* Sequence Executor Widget — core, always visible */}
        <SequencesDashboardCard onClick={() => setCurrentView('sequences')} />

        {/* Extension Dashboard Widgets — rendered dynamically from the view registry */}
        {extensionViews.map((view) => {
          if (!extensionStatus[view.extensionId]?.active || !view.widget) return null;
          const WidgetComponent = view.widget;
          return (
            <WidgetComponent
              key={view.extensionId}
              onClick={() => setCurrentView(view.extensionId)}
            />
          );
        })}

      </div>
    </div>
  )
}
