import React, { useState, useEffect } from 'react';
import { Activity, Aperture, AlertTriangle, Plug, PlugZap, Settings, Save } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { useSetPageHeader } from '../../../renderer/contexts/PageHeaderContext';

export const ObsPanel = () => {
  const [activeTab, setActiveTab] = useState<'status' | 'settings'>('status');
  const [connected, setConnected] = useState(false);
  const [missingScenes, setMissingScenes] = useState<string[]>([]);
  const [availableScenes, setAvailableScenes] = useState<string[]>([]);
  const [currentScene, setCurrentScene] = useState('');
  const [isConnecting, setIsConnecting] = useState(false);

  // Settings state
  const [host, setHost] = useState('');
  const [password, setPassword] = useState('');
  const [passwordSet, setPasswordSet] = useState(false);
  const [autoConnect, setAutoConnect] = useState(false);
  const [settingsLoaded, setSettingsLoaded] = useState(false);
  const [saveMessage, setSaveMessage] = useState('');

  // Push header into the global app bar
  useSetPageHeader({
    title: 'OBS Control',
    icon: Aperture,
    subtitle: connected ? 'Connected' : 'Disconnected',
    subtitleVariant: connected ? 'success' : 'danger',
  });

  // Poll status
  useEffect(() => {
    const checkStatus = async () => {
      if (window.electronAPI?.obsGetStatus) {
        try {
          const status = await window.electronAPI.obsGetStatus();
          setConnected(status.connected);
          setMissingScenes(status.missingScenes || []);
          setAvailableScenes(status.availableScenes || []);
          setCurrentScene(status.currentScene || '');
        } catch (e) {
          console.error('Failed to get OBS status', e);
        }
      }
    };

    checkStatus();
    const interval = setInterval(checkStatus, 2000);
    return () => clearInterval(interval);
  }, []);

  // Load config once
  useEffect(() => {
    const loadConfig = async () => {
      if (window.electronAPI?.obsGetConfig) {
        try {
          const config = await window.electronAPI.obsGetConfig();
          setHost(config.host || '');
          setPasswordSet(config.passwordSet);
          setAutoConnect(config.autoConnect);
          setSettingsLoaded(true);
        } catch (e) {
          console.error('Failed to load OBS config', e);
        }
      }
    };
    loadConfig();
  }, []);

  const handleConnect = async () => {
    setIsConnecting(true);
    try {
      await window.electronAPI.obsConnect();
    } catch (error) {
      console.error('OBS connection failed:', error);
    } finally {
      setIsConnecting(false);
    }
  };

  const handleDisconnect = async () => {
    try {
      await window.electronAPI.obsDisconnect();
      setConnected(false);
      setAvailableScenes([]);
    } catch (error) {
      console.error('OBS disconnect failed:', error);
    }
  };

  const handleSwitchScene = async (sceneName: string) => {
    if (window.electronAPI?.obsSetScene) {
      setCurrentScene(sceneName);
      await window.electronAPI.obsSetScene(sceneName);
    }
  };

  const handleSaveSettings = async () => {
    try {
      await window.electronAPI.obsSaveSettings({
        host,
        password: password || undefined,
        autoConnect,
      });
      if (password) {
        setPasswordSet(true);
        setPassword('');
      }
      setSaveMessage('Settings saved.');
      setTimeout(() => setSaveMessage(''), 3000);
    } catch (error) {
      console.error('Failed to save OBS settings', error);
      setSaveMessage('Failed to save.');
      setTimeout(() => setSaveMessage(''), 3000);
    }
  };

  return (
    <div className="h-full flex flex-col space-y-6">
      {/* Tab bar */}
      <div className="flex items-center justify-end">
        <div className="flex space-x-2 bg-card border border-border rounded-lg p-1">
          <button
            onClick={() => setActiveTab('status')}
            className={`px-4 py-2 text-sm font-medium rounded-md transition-colors ${
              activeTab === 'status'
                ? 'bg-primary text-primary-foreground shadow-sm'
                : 'text-muted-foreground hover:bg-white/10'
            }`}
          >
            Status
          </button>
          <button
            onClick={() => setActiveTab('settings')}
            className={`px-4 py-2 text-sm font-medium rounded-md transition-colors ${
              activeTab === 'settings'
                ? 'bg-primary text-primary-foreground shadow-sm'
                : 'text-muted-foreground hover:bg-white/10'
            }`}
          >
            Settings
          </button>
        </div>
      </div>

      <div className="flex-1">
        {activeTab === 'status' ? (
          <div className="space-y-6">
            {/* Connection banner */}
            <div className="flex justify-between items-center bg-card p-4 rounded-lg border border-border">
              <div>
                <h3 className="text-xl font-bold uppercase tracking-widest text-primary flex items-center gap-3">
                  OBS WebSocket
                </h3>
                <p className="text-muted-foreground text-xs font-rajdhani uppercase tracking-wider">
                  {connected ? `Connected to ${host || 'OBS'}` : (host ? `Target: ${host}` : 'Not configured')}
                </p>
              </div>
              <div className="flex items-center gap-4">
                <div className={`px-4 py-2 rounded-full border ${
                  connected
                    ? 'bg-green-500/10 border-green-500/50 text-green-500'
                    : 'bg-red-500/10 border-red-500/50 text-red-500'
                } flex items-center gap-2`}>
                  <Activity className="w-4 h-4" />
                  <span className="text-sm font-bold uppercase tracking-wider">
                    {connected ? 'ONLINE' : 'OFFLINE'}
                  </span>
                </div>

                {connected ? (
                  <Button variant="destructive" size="sm" onClick={handleDisconnect}>
                    <Plug className="w-4 h-4 mr-2" />
                    Disconnect
                  </Button>
                ) : (
                  <Button
                    className="bg-primary text-primary-foreground"
                    size="sm"
                    onClick={handleConnect}
                    disabled={isConnecting || !host}
                  >
                    <PlugZap className="w-4 h-4 mr-2" />
                    {isConnecting ? 'Connecting...' : 'Connect'}
                  </Button>
                )}
              </div>
            </div>

            {/* No host warning */}
            {!host && (
              <div className="bg-yellow-900/20 border border-yellow-500/50 rounded-lg p-4 flex items-start gap-3">
                <Settings className="w-5 h-5 text-yellow-500 mt-0.5" />
                <div>
                  <h3 className="text-yellow-500 font-bold uppercase font-rajdhani tracking-wider mb-1">Configuration Required</h3>
                  <p className="text-sm text-yellow-200/80">
                    Go to the <strong>Settings</strong> tab to configure the OBS WebSocket host and password.
                  </p>
                </div>
              </div>
            )}

            {/* Missing Scenes Warning */}
            {missingScenes.length > 0 && (
              <div className="bg-yellow-900/20 border border-yellow-500/50 rounded-lg p-4 flex items-start gap-3">
                <AlertTriangle className="w-5 h-5 text-yellow-500 mt-0.5" />
                <div>
                  <h3 className="text-yellow-500 font-bold uppercase font-rajdhani tracking-wider mb-1">Missing Scenes</h3>
                  <p className="text-sm text-yellow-200/80 mb-2">Required by the session but not found in OBS:</p>
                  <ul className="list-disc list-inside text-sm text-yellow-200/80 font-jetbrains">
                    {missingScenes.map(scene => (
                      <li key={scene}>{scene}</li>
                    ))}
                  </ul>
                </div>
              </div>
            )}

            {/* Scene Control Card */}
            <Card className="bg-card border-border">
              <CardHeader>
                <CardTitle className="text-muted-foreground text-sm uppercase font-rajdhani tracking-widest flex items-center gap-2">
                  <Aperture className="w-4 h-4 text-primary" />
                  Scene Control
                </CardTitle>
              </CardHeader>
              <CardContent>
                {availableScenes.length > 0 ? (
                  <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
                    {availableScenes.map((scene) => (
                      <button
                        key={scene}
                        onClick={() => handleSwitchScene(scene)}
                        className={`p-3 rounded transition-colors text-sm font-bold uppercase font-rajdhani tracking-wider truncate ${
                          currentScene === scene
                            ? 'bg-primary text-white ring-1 ring-primary/50 shadow-[0_0_12px_rgba(255,95,31,0.3)]'
                            : 'bg-[#282A30] hover:bg-primary hover:text-white text-muted-foreground'
                        }`}
                        title={scene}
                      >
                        {scene}
                      </button>
                    ))}
                  </div>
                ) : (
                  <div className="text-muted-foreground text-sm italic">
                    {connected ? 'No scenes available' : 'Connect to OBS to see scenes'}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        ) : (
          /* Settings tab */
          <Card className="bg-card border-border">
            <CardHeader>
              <CardTitle className="text-muted-foreground text-sm uppercase font-rajdhani tracking-widest">
                OBS WebSocket Configuration
              </CardTitle>
              <CardDescription>
                Configure the connection to your OBS Studio WebSocket server.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="space-y-2">
                <Label className="text-sm font-medium uppercase text-muted-foreground">WebSocket Host</Label>
                <Input
                  placeholder="ws://localhost:4455"
                  className="bg-background border-border font-mono"
                  value={host}
                  onChange={(e) => setHost(e.target.value)}
                />
                <p className="text-xs text-muted-foreground">
                  The WebSocket URL for OBS Studio (e.g. ws://localhost:4455).
                </p>
              </div>

              <div className="space-y-2">
                <Label className="text-sm font-medium uppercase text-muted-foreground">Password</Label>
                <Input
                  type="password"
                  placeholder={passwordSet ? 'Password is set (enter to update)' : 'Enter OBS WebSocket password'}
                  className="bg-background border-border font-mono"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
                <p className="text-xs text-muted-foreground">
                  Optional. Set in OBS under Tools &gt; WebSocket Server Settings.
                </p>
              </div>

              <div className="flex items-center justify-between rounded-lg border border-border p-4 bg-background">
                <div className="space-y-0.5">
                  <Label className="text-sm font-medium">Auto-Connect on Startup</Label>
                  <p className="text-xs text-muted-foreground">
                    Automatically connect to OBS when the Director starts.
                  </p>
                </div>
                <Switch
                  checked={autoConnect}
                  onCheckedChange={setAutoConnect}
                />
              </div>

              <Button onClick={handleSaveSettings} className="w-full">
                <Save className="w-4 h-4 mr-2" />
                Save OBS Settings
              </Button>

              {saveMessage && (
                <p className="text-sm text-center text-green-400">{saveMessage}</p>
              )}
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
};
