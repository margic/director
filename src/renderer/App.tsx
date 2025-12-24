import { useState } from 'react'
import { Activity, Gauge, Radio, Settings, User } from 'lucide-react'

function App() {
  const [user, setUser] = useState<any>(null);

  const handleLogin = async () => {
    try {
      const account = await window.electronAPI.login();
      if (account) {
        setUser(account);
      }
    } catch (error) {
      console.error('Login failed', error);
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

        <div className="mt-auto">
          <button className="p-3 rounded-lg hover:bg-white/5 text-muted-foreground hover:text-primary transition-colors">
            <User className="w-6 h-6" />
          </button>
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
            <div className="flex items-center gap-3">
              <div className="text-right">
                <p className="text-sm font-bold text-white leading-none">{user.name}</p>
                <p className="text-xs text-muted-foreground">{user.username}</p>
              </div>
              <div className="w-8 h-8 rounded bg-secondary/20 border border-secondary/50 flex items-center justify-center text-secondary font-bold">
                {user.name.charAt(0)}
              </div>
            </div>
          )}
        </header>

        {/* Dashboard Area */}
        <div className="flex-1 p-8 flex items-center justify-center bg-[radial-gradient(ellipse_at_center,_var(--tw-gradient-stops))] from-secondary/5 via-background to-background">
          {!user ? (
            <div className="max-w-md w-full bg-card border border-border rounded-xl p-8 shadow-2xl relative overflow-hidden group">
              <div className="absolute inset-0 bg-gradient-to-br from-primary/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-500" />
              
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
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 w-full max-w-6xl">
              {/* Placeholder Cards */}
              {[1, 2, 3].map((i) => (
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
          )}
        </div>
      </main>
    </div>
  )
}

export default App
