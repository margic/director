import { useState, useEffect, useRef } from 'react'
import { LayoutDashboard, Settings, User, LogOut, Car, ArrowLeft, Database, Zap, Layers, Activity } from 'lucide-react'
import RaceCenterIcon from '../../assets/images/icon.png'
import { UserProfile, RaceSession } from './types'
import { clientTelemetry } from './telemetry'
import { extensionViews, getExtensionView } from './extension-views'
import { SettingsPage } from './pages/SettingsPage'
import { Dashboard } from './pages/Dashboard'
import { SequencesPanel } from './pages/SequencesPanel'
import { OverlayPanel } from './pages/OverlayPanel'
import { DirectorPanel } from './pages/DirectorPanel'
import { PageHeaderProvider, usePageHeader, useSetPageHeader } from './contexts/PageHeaderContext'

const JsonViewer = ({ data }: { data: any }) => {
  if (data === null || data === undefined) return <span className="text-muted-foreground italic">null</span>;
  
  if (Array.isArray(data)) {
    if (data.length === 0) return <span className="text-muted-foreground italic">[]</span>;
    return (
      <div className="flex flex-col gap-2 mt-2">
        {data.map((item, index) => (
          <div key={index} className="pl-4 border-l-2 border-border/30">
            <div className="text-xs text-muted-foreground mb-1 font-mono">Item {index}</div>
            <JsonViewer data={item} />
          </div>
        ))}
      </div>
    );
  }

  if (typeof data === 'object') {
    return (
      <div className="space-y-1">
        {Object.entries(data).map(([key, value]) => (
          <div key={key} className="group">
            <div className="flex gap-2 py-1">
              <span className="font-mono text-secondary text-sm min-w-[150px] shrink-0">{key}:</span>
              <div className="flex-1 font-mono text-sm text-foreground/90 break-all">
                {typeof value === 'object' && value !== null ? (
                  <div className="mt-1 pl-2 border-l border-border/30">
                    <JsonViewer data={value} />
                  </div>
                ) : (
                  String(value)
                )}
              </div>
            </div>
            <div className="h-px bg-border/20 group-last:hidden" />
          </div>
        ))}
      </div>
    );
  }

  return <span>{String(data)}</span>;
};

import type { PageHeaderState } from './contexts/PageHeaderContext'

/** Renders nothing — just sets the page header from inline views. */
function SetPageHeader(props: PageHeaderState) {
  useSetPageHeader(props);
  return null;
}

function App() {
  const [user, setUser] = useState<any>(null);
  const [userProfile, setUserProfile] = useState<UserProfile | null>(null);
  const [activeMenu, setActiveMenu] = useState<'sidebar' | 'header' | null>(null);
  const [currentView, setCurrentView] = useState<string>('dashboard');
  const [selectedSession, setSelectedSession] = useState<RaceSession | null>(null);
  const [extensionStatus, setExtensionStatus] = useState<Record<string, { active: boolean; version?: string }>>({});
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

  // Poll extension status
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

  const handleSessionClick = (session: RaceSession) => {
    setSelectedSession(session);
    setCurrentView('session-details');
  };

  return (
    <div className="flex h-screen w-full bg-background text-foreground font-rajdhani overflow-hidden">
      {/* Sidebar */}
      <aside className="w-20 border-r border-border bg-card flex flex-col items-center py-6 gap-8">
        <div className="w-10 h-10 bg-primary rounded-full flex items-center justify-center shadow-[0_0_15px_rgba(255,95,31,0.5)] overflow-hidden">
          <img src={RaceCenterIcon} alt="Race Center" className="w-full h-full object-cover" />
        </div>
        
        <nav className="flex flex-col gap-6 w-full items-center">
          <button 
            onClick={() => setCurrentView('dashboard')}
            className={`p-3 rounded-lg transition-colors ${currentView === 'dashboard' ? 'bg-white/5 text-primary' : 'hover:bg-white/5 text-muted-foreground hover:text-primary'}`}
            title="Dashboard"
          >
            <LayoutDashboard className="w-6 h-6" />
          </button>

          {/* Director — core view, always visible */}
          <button
            onClick={() => setCurrentView('director')}
            className={`p-3 rounded-lg transition-colors ${currentView === 'director' ? 'bg-white/5 text-primary' : 'hover:bg-white/5 text-muted-foreground hover:text-primary'}`}
            title="Agent"
          >
            <Activity className="w-6 h-6" />
          </button>

          {/* Sequences — core view, always visible */}
          <button
            onClick={() => setCurrentView('sequences')}
            className={`p-3 rounded-lg transition-colors ${currentView === 'sequences' ? 'bg-white/5 text-primary' : 'hover:bg-white/5 text-muted-foreground hover:text-primary'}`}
            title="Sequences"
          >
            <Zap className="w-6 h-6" />
          </button>

          {/* Broadcast Overlay — core view, always visible */}
          <button
            onClick={() => setCurrentView('overlay')}
            className={`p-3 rounded-lg transition-colors ${currentView === 'overlay' ? 'bg-white/5 text-primary' : 'hover:bg-white/5 text-muted-foreground hover:text-primary'}`}
            title="Broadcast Overlay"
          >
            <Layers className="w-6 h-6" />
          </button>
          
          {/* Extension navigation — generated from the view registry */}
          {extensionViews.map((view) =>
            extensionStatus[view.extensionId]?.active ? (
              <button
                key={view.extensionId}
                onClick={() => setCurrentView(view.extensionId)}
                className={`p-3 rounded-lg transition-colors ${currentView === view.extensionId ? 'bg-white/5 text-primary' : 'hover:bg-white/5 text-muted-foreground hover:text-primary'}`}
                title={view.label}
              >
                <view.icon className="w-6 h-6" />
              </button>
            ) : null
          )}
          
          <button 
            onClick={() => setCurrentView('settings')}
            className={`p-3 rounded-lg transition-colors ${currentView === 'settings' ? 'bg-white/5 text-primary' : 'hover:bg-white/5 text-muted-foreground hover:text-primary'}`}
            title="Settings"
          >
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
      <PageHeaderProvider>
      <main className="flex-1 flex flex-col relative">
        {/* Header — dynamic title driven by PageHeaderContext */}
        <AppHeader
          user={user}
          userProfile={userProfile}
          activeMenu={activeMenu}
          setActiveMenu={setActiveMenu}
          headerRef={headerRef}
          onLogout={handleLogout}
        />
          


        {/* Dashboard Area */}
        <div className="flex-1 p-6 overflow-y-auto flex flex-col items-center bg-[radial-gradient(ellipse_at_center,_var(--tw-gradient-stops))] from-secondary/5 via-background to-background">
          {currentView === 'dashboard' ? (
            <>
              <SetPageHeader title="" />
              <Dashboard 
                user={user}
                userProfile={userProfile}
                setCurrentView={setCurrentView}
                onLogin={handleLogin}
                onSessionSelect={handleSessionClick}
              />
            </>
          ) : currentView === 'director' ? (
            <div className="w-full h-full">
              <DirectorPanel />
            </div>
          ) : currentView === 'sequences' ? (
            <div className="w-full h-full">
              <SequencesPanel />
            </div>
          ) : currentView === 'overlay' ? (
            <div className="w-full h-full">
              <OverlayPanel />
            </div>
          ) : currentView === 'settings' ? (
            <div className="w-full">
              <SettingsPage />
            </div>
          ) : currentView === 'session-details' && selectedSession ? (
            <div className="w-full space-y-6">
              <SetPageHeader title={`Session: ${selectedSession.name}`} icon={Database} />
              <div className="bg-card border border-border rounded-xl p-6 shadow-lg overflow-hidden">
                <div className="flex items-center justify-between mb-6">
                   <h3 className="text-xl font-bold uppercase tracking-wider text-white flex items-center gap-2">
                    <Database className="w-5 h-5 text-secondary" />
                    Session Data
                  </h3>
                </div>
                <div className="space-y-1 max-h-[60vh] overflow-y-auto pr-2">
                   <JsonViewer data={selectedSession} />
                </div>
              </div>

              <div className="flex justify-end">
                <button 
                  onClick={() => setCurrentView('director-iracing')}
                  className="bg-primary hover:bg-primary/90 text-white font-bold py-3 px-6 rounded-lg uppercase tracking-wider transition-all flex items-center gap-2"
                >
                  <Car className="w-5 h-5" />
                  <span>Open iRacing Controls</span>
                </button>
              </div>
            </div>
          ) : (() => {
            /* Extension views — resolved dynamically from the registry */
            const activeView = getExtensionView(currentView);
            if (activeView && extensionStatus[activeView.extensionId]?.active) {
              const ViewComponent = activeView.component;
              const viewProps: Record<string, unknown> = {};
              if (activeView.extensionId === 'director-iracing') {
                viewProps.cameras = selectedSession?.settings?.cameras;
              }
              return (
                <div className="w-full">
                  <div className="animate-in fade-in duration-500 h-full">
                    <ViewComponent {...viewProps} />
                  </div>
                </div>
              );
            }
            return (
              <div className="w-full text-center text-muted-foreground">
                View not found: {currentView}
              </div>
            );
          })()}
        </div>
      </main>
      </PageHeaderProvider>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/*  AppHeader — Extracted header consuming PageHeaderContext            */
/* ------------------------------------------------------------------ */

interface AppHeaderProps {
  user: any;
  userProfile: UserProfile | null;
  activeMenu: 'sidebar' | 'header' | null;
  setActiveMenu: (menu: 'sidebar' | 'header' | null) => void;
  headerRef: React.RefObject<HTMLDivElement | null>;
  onLogout: () => void;
}

function AppHeader({ user, userProfile, activeMenu, setActiveMenu, headerRef, onLogout }: AppHeaderProps) {
  const { title, icon: Icon, subtitle, subtitleVariant } = usePageHeader();

  // Subtitle pill styling based on variant
  const subtitleClass =
    subtitleVariant === 'success'
      ? 'bg-green-500/10 text-green-500 border border-green-500/20'
      : subtitleVariant === 'danger'
        ? 'bg-red-500/10 text-red-500 border border-red-500/20'
        : 'text-muted-foreground';

  return (
    <header className="h-14 border-b border-border flex items-center justify-between px-6 bg-background/50 backdrop-blur shrink-0">
      <div className="flex items-center gap-3">
        {/* Dynamic icon */}
        {Icon && <Icon className="w-5 h-5 text-primary" />}

        {/* Title — branded fallback when no page has set the header */}
        {title ? (
          <h1 className="text-xl font-rajdhani font-bold uppercase tracking-widest text-white">
            {title}
          </h1>
        ) : (
          <h1 className="text-xl font-bold uppercase tracking-widest text-white">
            Race Control <span className="text-primary">Agent</span>
          </h1>
        )}

        {/* Subtitle pill / metadata */}
        {subtitle && (
          <span className={`px-2 py-0.5 rounded text-xs font-bold font-jetbrains ${subtitleClass}`}>
            {subtitle}
          </span>
        )}

        {/* System status */}
        <span className="px-2 py-0.5 rounded text-xs font-bold bg-green-500/10 text-green-500 border border-green-500/20">
          ONLINE
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
                onClick={onLogout}
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
  );
}

export default App
