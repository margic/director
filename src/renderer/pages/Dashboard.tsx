import { useState, useEffect } from 'react'
import { Activity, User, Loader2, Radio } from 'lucide-react'
import { UserProfile, RaceSession } from '../types'
import { extensionViews } from '../extension-views'
import { DirectorDashboardCard } from '../components/director/DirectorDashboardCard'
import { SequencesDashboardCard } from '../components/sequences/SequencesDashboardCard'
import { OverlayDashboardCard } from '../components/overlay/OverlayDashboardCard'

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
  const [extensionStatus, setExtensionStatus] = useState<Record<string, { active: boolean }>>({});
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);

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

  // Track the director's active session
  useEffect(() => {
    const pollDirectorSession = async () => {
      if (!window.electronAPI?.directorStatus) return;
      try {
        const status = await window.electronAPI.directorStatus();
        setActiveSessionId(status.sessionId || null);
      } catch (e) {
        console.error('Failed to poll director status', e);
      }
    };

    pollDirectorSession();
    const interval = setInterval(pollDirectorSession, 2000);
    return () => clearInterval(interval);
  }, []);

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

  const handleSetActiveSession = async (session: RaceSession) => {
    if (!window.electronAPI?.directorSetSession) return;
    try {
      const status = await window.electronAPI.directorSetSession(session.raceSessionId);
      setActiveSessionId(status.sessionId || null);
    } catch (error) {
      console.error('Failed to set active session:', error);
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
    <div className="w-full space-y-6">
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
            {sessions.map((session) => {
              const isActive = activeSessionId === session.raceSessionId;
              return (
                <div 
                  key={session.raceSessionId}
                  className={`bg-background border rounded-lg p-4 transition-colors group ${
                    isActive
                      ? 'border-green-500/50 bg-green-500/5'
                      : 'border-border hover:border-primary/50'
                  }`}
                >
                  <div className="flex justify-between items-start mb-2">
                    <h4 className={`font-bold transition-colors ${isActive ? 'text-green-500' : 'text-white group-hover:text-primary'}`}>{session.name}</h4>
                    <div className="flex items-center gap-2">
                      {isActive && (
                        <span className="px-2 py-0.5 rounded text-xs font-bold bg-green-500/10 text-green-500 border border-green-500/20 flex items-center gap-1">
                          <Radio className="w-3 h-3" />
                          ACTIVE
                        </span>
                      )}
                      <span className={`px-2 py-0.5 rounded text-xs font-bold ${
                        session.status === 'ACTIVE' 
                          ? 'bg-green-500/10 text-green-500 border border-green-500/20'
                          : 'bg-yellow-500/10 text-yellow-500 border border-yellow-500/20'
                      }`}>
                        {session.status}
                      </span>
                    </div>
                  </div>
                  <p className="text-xs text-muted-foreground mb-2 font-jetbrains truncate">
                    {session.raceSessionId}
                  </p>
                  {session.createdAt && (
                    <p className="text-xs text-muted-foreground mb-3">
                      Created: {new Date(session.createdAt).toLocaleString()}
                    </p>
                  )}
                  <div className="flex items-center gap-2">
                    {!isActive && (
                      <button
                        onClick={() => handleSetActiveSession(session)}
                        className="px-3 py-1.5 rounded-md text-xs font-bold uppercase tracking-wider bg-primary text-black hover:bg-primary/90 transition-colors"
                      >
                        Set Active
                      </button>
                    )}
                    <button
                      onClick={() => onSessionSelect(session)}
                      className="px-3 py-1.5 rounded-md text-xs font-bold uppercase tracking-wider border border-border text-muted-foreground hover:text-white hover:border-primary/50 transition-colors"
                    >
                      Details
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Control Cards Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {/* Director Control Card */}
        <DirectorDashboardCard onClick={() => setCurrentView('director')} />

        {/* Sequence Executor Widget — core, always visible */}
        <SequencesDashboardCard onClick={() => setCurrentView('sequences')} />

        {/* Broadcast Overlay Widget — core, always visible */}
        <OverlayDashboardCard onClick={() => setCurrentView('overlay')} />

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
