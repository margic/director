import { useState, useEffect } from 'react'
import { Activity, User } from 'lucide-react'
import { UserProfile, RaceSession } from '../types'
import { extensionViews } from '../extension-views'
import { DirectorDashboardCard } from '../components/director/DirectorDashboardCard'
import { SequencesDashboardCard } from '../components/sequences/SequencesDashboardCard'
import { OverlayDashboardCard } from '../components/overlay/OverlayDashboardCard'
import { SessionSelector } from '../components/session/SessionSelector'

interface DashboardProps {
  user: any;
  userProfile: UserProfile | null;
  setCurrentView: (view: string) => void;
  onLogin: () => void;
  onSessionSelect: (session: RaceSession) => void;
}

export const Dashboard = ({ user, userProfile, setCurrentView, onLogin, onSessionSelect }: DashboardProps) => {
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
      {/* Session Selector — New SessionManager UI */}
      <SessionSelector />

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
