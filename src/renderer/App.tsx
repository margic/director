import { useState, useEffect, useRef } from 'react'
import { Activity, Gauge, Radio, Settings, User, LogOut, Play, Square, Loader2 } from 'lucide-react'
import { UserProfile, RaceSession } from './types'
import { clientTelemetry } from './telemetry'

function App() {
  const [user, setUser] = useState<any>(null);
  const [userProfile, setUserProfile] = useState<UserProfile | null>(null);
  const [sessions, setSessions] = useState<RaceSession[]>([]);
  const [loadingSessions, setLoadingSessions] = useState(false);
  const [activeMenu, setActiveMenu] = useState<'sidebar' | 'header' | null>(null);
  const [directorStatus, setDirectorStatus] = useState<any>({ isRunning: false, status: 'IDLE', sessionId: null });
  const sidebarRef = useRef<HTMLDivElement>(null);
  const headerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (activeMenu === 'sidebar' && sidebarRef.current && !sidebarRef.current.contains(event.target as Node)) {
        setActiveMenu(null);
      }
      if (activeMenu === 'header' && headerRef.current && !headerRef.current.contains(event.target as Node)) {
        setActiveMenu(null);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [activeMenu]);

  useEffect(() => {
    const checkLogin = async () => {
      if (window.electronAPI) {
        const account = await window.electronAPI.getAccount();
        if (account) {
          setUser(account);
          // Fetch user profile with centerId
          const profile = await window.electronAPI.getUserProfile();
          setUserProfile(profile);
          
          // Track user session (only anonymous userId for privacy - homeAccountId is not PII)
          clientTelemetry.trackEvent('UserSession.Authenticated', {
            userId: account.homeAccountId,
          });
        }
      }
    };
    checkLogin();

    // Track page view on mount
    clientTelemetry.trackPageView('MainDashboard');
  }, []);

  useEffect(() => {
    const pollStatus = async () => {
      if (user && window.electronAPI?.directorStatus) {
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

  // Poll for available sessions
  useEffect(() => {
    const fetchSessions = async () => {
      const centerId = userProfile?.centerId || userProfile?.center?.id;
      if (centerId && window.electronAPI?.directorListSessions) {
        setLoadingSessions(true);
        try {
          const sessionList = await window.electronAPI.directorListSessions(centerId, 'ACTIVE');
          setSessions(sessionList);
        } catch (error) {
          console.error('Failed to fetch sessions:', error);
        } finally {
          setLoadingSessions(false);
        }
      }
    };

    if (userProfile) {
      fetchSessions();
      // Poll every 10 seconds for session updates
      const interval = setInterval(fetchSessions, 10000);
      return () => clearInterval(interval);
    }
  }, [userProfile]);

  const handleLogin = async () => {
    console.log('Login button clicked');
    try {
      if (!window.electronAPI) {
        console.error('Electron API not found');
        return;
      }
      clientTelemetry.trackEvent('UI.LoginButtonClicked');
      const account = await window.electronAPI.login();
      if (account) {
        setUser(account);
      }
    } catch (error) {
      console.error('Login failed', error);
      clientTelemetry.trackException(error as Error, { context: 'login' });
    }
  };

  const toggleDirector = async () => {
    try {
      clientTelemetry.trackEvent('UI.DirectorToggleClicked', {
        currentState: directorStatus.isRunning ? 'running' : 'stopped',
      });
      
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

  const handleLogout = async () => {
    try {
      if (window.electronAPI) {
        clientTelemetry.trackEvent('UI.LogoutClicked');
        await window.electronAPI.logout();
        setUser(null);
        setActiveMenu(null);
      }
    } catch (error) {
      console.error('Logout failed', error);
      clientTelemetry.trackException(error as Error, { context: 'logout' });
    }
  };

  return (
    <div className="flex h-screen w-full bg-background text-foreground font-rajdhani overflow-hidden">
      {/* Sidebar */}
      <aside className="w-20 border-r border-border bg-card flex flex-col items-center py-6 gap-8">
        <div className="w-10 h-10 bg-primary rounded-full flex items-center justify-center shadow-[0_0_15px_rgba(255,95,31,0.5)]">
          <Activity className="text-white w-6 h-6" />
        </div>
        
        <nav className="flex flex-col gap-6 w-full items-center">
          <button className="p-3 rounded-lg hover:bg-white/5 text-muted-foreground hover:text-primary transition-colors">
            <Gauge className="w-6 h-6" />
          </button>
          <button className="p-3 rounded-lg hover:bg-white/5 text-muted-foreground hover:text-primary transition-colors">
            <Radio className="w-6 h-6" />
          </button>
          <button className="p-3 rounded-lg hover:bg-white/5 text-muted-foreground hover:text-primary transition-colors">
            <Settings className="w-6 h-6" />
          </button>
        </nav>

        <div className="mt-auto relative" ref={sidebarRef}>
          <button 
            onClick={() => user && setActiveMenu(activeMenu === 'sidebar' ? null : 'sidebar')}
            className={`p-3 rounded-lg hover:bg-white/5 transition-colors ${activeMenu === 'sidebar' ? 'text-primary bg-white/5' : 'text-muted-foreground hover:text-primary'}`}
          >
            <User className="w-6 h-6" />
          </button>
          
          {activeMenu === 'sidebar' && (
            <div className="absolute left-full bottom-0 ml-2 w-48 bg-card border border-border rounded-lg shadow-xl overflow-hidden z-50">
              <button
                onClick={handleLogout}
                className="w-full px-4 py-3 flex items-center gap-3 hover:bg-white/5 text-muted-foreground hover:text-destructive transition-colors"
              >
                <LogOut className="w-4 h-4" />
                <span className="font-medium">Log Out</span>
              </button>
            </div>
          )}
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 flex flex-col relative">
        {/* Header */}
        <header className="h-16 border-b border-border flex items-center justify-between px-8 bg-background/50 backdrop-blur">
          <div className="flex items-center gap-4">
            <h1 className="text-2xl font-bold uppercase tracking-widest text-white">
              Race Control <span className="text-primary">Director</span>
            </h1>
            <span className="px-2 py-0.5 rounded text-xs font-bold bg-green-500/10 text-green-500 border border-green-500/20">
              SYSTEM ONLINE
            </span>
          </div>
          
          {user && (
            <div className="relative" ref={headerRef}>
              <button 
                onClick={() => setActiveMenu(activeMenu === 'header' ? null : 'header')}
                className="flex items-center gap-3 hover:bg-white/5 p-2 rounded-lg transition-colors"
              >
                <div className="text-right">
                  <p className="text-sm font-bold text-white leading-none">{user.name}</p>
                  <p className="text-xs text-muted-foreground">{user.username}</p>
                  {(userProfile?.centerId || userProfile?.center?.id) && (
                    <p className="text-xs text-primary">Center: {userProfile.center?.name || userProfile.centerId || userProfile.center?.id}</p>
                  )}
                </div>
                <div className="w-8 h-8 rounded bg-secondary/20 border border-secondary/50 flex items-center justify-center text-secondary font-bold">
                  {user.name.charAt(0)}
                </div>
              </button>

              {activeMenu === 'header' && (
                <div className="absolute right-0 top-full mt-2 w-48 bg-card border border-border rounded-lg shadow-xl overflow-hidden z-50">
                  <button
                    onClick={handleLogout}
                    className="w-full px-4 py-3 flex items-center gap-3 hover:bg-white/5 text-muted-foreground hover:text-destructive transition-colors"
                  >
                    <LogOut className="w-4 h-4" />
                    <span className="font-medium">Log Out</span>
                  </button>
                </div>
              )}
            </div>
          )}
        </header>

        {/* Dashboard Area */}
        <div className="flex-1 p-8 flex items-center justify-center bg-[radial-gradient(ellipse_at_center,_var(--tw-gradient-stops))] from-secondary/5 via-background to-background">
          {!user ? (
            <div className="max-w-md w-full bg-card border border-border rounded-xl p-8 shadow-2xl relative overflow-hidden group">
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
                  onClick={handleLogin}
                  className="w-full bg-primary hover:bg-primary/90 text-white font-bold py-4 px-6 rounded-lg uppercase tracking-wider transition-all hover:shadow-[0_0_20px_rgba(255,95,31,0.3)] flex items-center justify-center gap-2"
                >
                  <span>Initialize Session</span>
                  <Activity className="w-4 h-4" />
                </button>
              </div>
            </div>
          ) : (
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
                        className="bg-background border border-border rounded-lg p-4 hover:border-primary/50 transition-colors"
                      >
                        <div className="flex justify-between items-start mb-2">
                          <h4 className="text-white font-bold">{session.name}</h4>
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
                  <div className="flex justify-between items-start z-10">
                    <h3 className="text-muted-foreground text-sm font-bold uppercase tracking-wider">Director Loop</h3>
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
                        ? 'bg-destructive/20 text-destructive hover:bg-destructive/30' 
                        : 'bg-primary/20 text-primary hover:bg-primary/30'
                    }`}
                  >
                    {directorStatus.isRunning ? (
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

                {/* Background Pulse Effect */}
                {directorStatus.isRunning && (
                  <div className="absolute inset-0 bg-green-500/5 animate-pulse pointer-events-none" />
                )}
              </div>

              {/* Placeholder Cards */}
              {[2, 3].map((i) => (
                <div key={i} className="bg-card border border-border rounded-xl p-6 h-64 flex flex-col justify-between hover:border-primary/50 transition-colors group">
                  <div className="flex justify-between items-start">
                    <h3 className="text-muted-foreground text-sm font-bold uppercase tracking-wider">Telemetry Module {i}</h3>
                    <Activity className="w-5 h-5 text-muted-foreground group-hover:text-primary transition-colors" />
                  </div>
                  <div className="text-4xl font-jetbrains font-bold text-white">
                    --.-- <span className="text-sm text-muted-foreground font-rajdhani">UNIT</span>
                  </div>
                  <div className="w-full bg-secondary/10 h-1 rounded-full overflow-hidden">
                    <div className="w-0 h-full bg-secondary group-hover:w-2/3 transition-all duration-1000" />
                  </div>
                </div>
              ))}
            </div>
            </div>
          )}
        </div>
      </main>
    </div>
  )
}

export default App
