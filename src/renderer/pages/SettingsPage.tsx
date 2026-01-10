// src/renderer/pages/SettingsPage.tsx
import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Input } from '@/components/ui/input';
import { YouTubeConnectionStatus } from '../youtube-types';

export const SettingsPage = () => {
    const [ytStatus, setYtStatus] = useState<{ connected: boolean, channelId: string }>({ connected: false, channelId: '' });
    const [loading, setLoading] = useState(false);
    const [modules, setModules] = useState({
        iracing: { enabled: true },
        obs: { enabled: true },
        youtube: { enabled: true }
    });

    useEffect(() => {
        const loadConfig = async () => {
            if (window.electronAPI?.config) {
                try {
                    const iracing = await window.electronAPI.config.get('iracing');
                    const obs = await window.electronAPI.config.get('obs');
                    const youtube = await window.electronAPI.config.get('youtube');
                    
                    setModules({
                        iracing: iracing || { enabled: true },
                        obs: obs || { enabled: true },
                        youtube: youtube || { enabled: true }
                    });
                } catch (e) {
                    console.error("Failed to load config", e);
                }
            }
        };
        loadConfig();

        // Poll status or listen to events
        const fetchStatus = async () => {
            if (window.electronAPI?.youtube) {
                const status = await window.electronAPI.youtube.getStatus();
                setYtStatus({ connected: status.connected, channelId: status.channelId });
            }
        };

        fetchStatus();
        
        // Subscribe to updates
        if (window.electronAPI?.youtube) {
             const cleanup = window.electronAPI.youtube.onStatusChange((status: any) => {
                  setYtStatus({ connected: status.connected, channelId: status.channelId });
             });
             return () => { cleanup(); }
        }
    }, []);

    const handleConnect = async () => {
        setLoading(true);
        await window.electronAPI.youtube.startAuth();
        setLoading(false);
    };

    const handleSignOut = async () => {
        await window.electronAPI.youtube.signOut();
    };

    const toggleModule = async (module: 'iracing' | 'obs' | 'youtube', enabled: boolean) => {
        setModules(prev => ({
            ...prev,
            [module]: { ...prev[module], enabled }
        }));
        
        if (window.electronAPI?.config) {
            await window.electronAPI.config.set(`${module}.enabled`, enabled);
        }
    };

    return (
        <div className="p-8 space-y-8 animate-in fade-in duration-500 overflow-y-auto max-h-screen">
            <h1 className="text-4xl font-bold uppercase tracking-widest mb-8">System Configuration</h1>

            {/* Modules Toggle Section */}
             <Card className="bg-card border-border">
                <CardHeader>
                    <CardTitle className="text-muted-foreground text-sm uppercase font-rajdhani tracking-widest">
                        Module Management
                    </CardTitle>
                </CardHeader>
                <CardContent className="space-y-6">
                     <p className="text-sm text-muted-foreground">Enable or disable core system modules. Disabled modules will stop background processing.</p>
                     
                     {/* iRacing Toggle */}
                     <div className="flex items-center justify-between p-4 border border-border/50 rounded-lg bg-background/50">
                        <div className="flex items-center gap-4">
                             <div className="p-2 bg-green-900/50 rounded text-green-400">
                                <svg className="w-6 h-6" fill="currentColor" viewBox="0 0 24 24"><path d="M18.92 6.01C18.72 5.42 18.16 5 17.5 5h-11c-.66 0-1.21.42-1.42 1.01L3 12v8c0 .55.45 1 1 1h1c.55 0 1-.45 1-1v-1h12v1c0 .55.45 1 1 1h1c.55 0 1-.45 1-1v-8l-2.08-5.99zM6.5 16c-.83 0-1.5-.67-1.5-1.5S5.67 13 6.5 13s1.5.67 1.5 1.5S7.33 16 6.5 16zm11 0c-.83 0-1.5-.67-1.5-1.5s.67-1.5 1.5-1.5 1.5.67 1.5 1.5-.67 1.5-1.5 1.5zM5 11l1.5-4.5h11L19 11H5z"/></svg>
                             </div>
                             <div>
                                <h3 className="font-bold">iRacing Integration</h3>
                                <p className="text-xs text-muted-foreground">Telemetry & Command control</p>
                             </div>
                        </div>
                        <Switch id="module-iracing" checked={modules.iracing.enabled} onCheckedChange={(c) => toggleModule('iracing', c)} />
                     </div>

                     {/* OBS Toggle */}
                     <div className="flex items-center justify-between p-4 border border-border/50 rounded-lg bg-background/50">
                        <div className="flex items-center gap-4">
                             <div className="p-2 bg-blue-900/50 rounded text-blue-400">
                                <svg className="w-6 h-6" fill="currentColor" viewBox="0 0 24 24"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8z"/><circle cx="12" cy="12" r="5"/></svg>
                             </div>
                             <div>
                                <h3 className="font-bold">OBS Studio</h3>
                                <p className="text-xs text-muted-foreground">Scene switching & status</p>
                             </div>
                        </div>
                        <Switch id="module-obs" checked={modules.obs.enabled} onCheckedChange={(c) => toggleModule('obs', c)} />
                     </div>

                     {/* YouTube Toggle */}
                     <div className="flex items-center justify-between p-4 border border-border/50 rounded-lg bg-background/50">
                        <div className="flex items-center gap-4">
                             <div className="p-2 bg-red-900/50 rounded text-red-400">
                                <svg className="w-6 h-6" fill="currentColor" viewBox="0 0 24 24"><path d="M19.615 3.184c-3.604-.246-11.631-.245-15.23 0-3.897.266-4.356 2.62-4.385 8.816.029 6.185.484 8.549 4.385 8.816 3.6.245 11.626.246 15.23 0 3.897-.266 4.356-2.62 4.385-8.816-.029-6.185-.484-8.549-4.385-8.816zm-10.615 12.816v-8l8 3.993-8 4.007z"/></svg>
                             </div>
                             <div>
                                <h3 className="font-bold">YouTube</h3>
                                <p className="text-xs text-muted-foreground">Chat monitoring & responses</p>
                             </div>
                        </div>
                        <Switch id="module-youtube" checked={modules.youtube.enabled} onCheckedChange={(c) => toggleModule('youtube', c)} />
                     </div>

                </CardContent>
            </Card>

            {/* Application Settings Section */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                
                {/* Linked Accounts */}
                <Card className="bg-card border-border">
                    <CardHeader>
                        <CardTitle className="text-muted-foreground text-sm uppercase font-rajdhani tracking-widest">
                            Linked Accounts
                        </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-6">
                        
                        {/* YouTube Item */}
                        <div className="flex items-center justify-between p-4 border border-border/50 rounded-lg bg-background/50">
                            <div className="flex items-center gap-4">
                                <div className="p-2 bg-red-600 rounded text-white">
                                    <svg className="w-6 h-6" fill="currentColor" viewBox="0 0 24 24"><path d="M19.615 3.184c-3.604-.246-11.631-.245-15.23 0-3.897.266-4.356 2.62-4.385 8.816.029 6.185.484 8.549 4.385 8.816 3.6.245 11.626.246 15.23 0 3.897-.266 4.356-2.62 4.385-8.816-.029-6.185-.484-8.549-4.385-8.816zm-10.615 12.816v-8l8 3.993-8 4.007z"/></svg>
                                </div>
                                <div>
                                    <h3 className="font-bold">YouTube</h3>
                                    <p className="text-sm text-muted-foreground">
                                        {ytStatus.connected ? 'Connected' : 'Disconnected'}
                                    </p>
                                </div>
                            </div>
                            
                            <div>
                                {ytStatus.connected ? (
                                    <Button variant="destructive" onClick={handleSignOut} size="sm">
                                        Disconnect
                                    </Button>
                                ) : (
                                    <Button onClick={handleConnect} disabled={loading} className="bg-primary text-primary-foreground hover:opacity-90">
                                        {loading ? 'Connecting...' : 'Connect Account'}
                                    </Button>
                                )}
                            </div>
                        </div>

                    </CardContent>
                </Card>

                 {/* General Config */}
                 <Card className="bg-card border-border">
                    <CardHeader>
                        <CardTitle className="text-muted-foreground text-sm uppercase font-rajdhani tracking-widest">
                            YouTube Preferences
                        </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-6">
                       <div className="space-y-2">
                            <label className="text-sm font-medium uppercase text-muted-foreground">Target Channel ID</label>
                            <Input 
                                placeholder="UCxxxxxxxxxxxx" 
                                className="bg-background border-border font-mono"
                                defaultValue={ytStatus.channelId}
                            />
                            <p className="text-xs text-muted-foreground">The channel ID to monitor for live streams.</p>
                       </div>

                       <div className="flex items-center justify-between">
                            <div className="space-y-0.5">
                                <label className="text-sm font-medium uppercase text-muted-foreground">Auto-Connect</label>
                                <p className="text-xs text-muted-foreground">Automatically reconnect on startup</p>
                            </div>
                            <Switch />
                       </div>
                    </CardContent>
                </Card>

            </div>
        </div>
    );
};
