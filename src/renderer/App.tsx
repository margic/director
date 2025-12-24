import { useState } from 'react'

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
    <div className="flex h-screen w-full flex-col items-center justify-center bg-background text-foreground font-rajdhani">
      <h1 className="text-4xl font-bold uppercase tracking-widest mb-8">Sim RaceCenter Director</h1>
      <div className="p-8 bg-card border border-border rounded-lg shadow-lg text-center">
        {user ? (
          <div>
            <p className="mb-4 text-xl">Welcome, <span className="text-primary font-bold">{user.name}</span></p>
            <p className="text-sm text-muted-foreground">{user.username}</p>
          </div>
        ) : (
          <>
            <p className="mb-4 text-muted-foreground">Welcome to the control room.</p>
            <button 
              className="bg-primary hover:opacity-90 text-primary-foreground px-6 py-3 rounded font-bold uppercase tracking-wider transition-all"
              onClick={handleLogin}
            >
              Login with Microsoft
            </button>
          </>
        )}
      </div>
    </div>
  )
}

export default App
