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

    useEffect(() => {
        // Poll status or listen to events
        const fetchStatus = async () => {
            const status = await window.electronAPI.youtube.getStatus();
            setYtStatus({ connected: status.connected, channelId: status.channelId });
        };

        fetchStatus();
        
        // Subscribe to updates
        const cleanup = window.electronAPI.youtube.onStatusChange((status: any) => {
             setYtStatus({ connected: status.connected, channelId: status.channelId });
        });
        
         return () => { cleanup(); }
    }, []);

    const handleConnect = async () => {
        setLoading(true);
        await window.electronAPI.youtube.startAuth();
        setLoading(false);
    };

    const handleSignOut = async () => {
        await window.electronAPI.youtube.signOut();
    };

    return (
        <div className="p-8 space-y-8 animate-in fade-in duration-500">
            <h1 className="text-4xl font-bold uppercase tracking-widest mb-8">System Configuration</h1>

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
