// src/renderer/pages/SettingsPage.tsx
import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';

export const SettingsPage = () => {
    const [extensions, setExtensions] = useState({
        'director-iracing': { enabled: true },
        obs: { enabled: true },
        'director-youtube': { enabled: true },
        'director-discord': { enabled: true }
    });

    useEffect(() => {
        const loadConfig = async () => {
            if (window.electronAPI?.config) {
                try {
                    const iracing = await window.electronAPI.config.get('director-iracing');
                    const obs = await window.electronAPI.config.get('obs');
                    const youtube = await window.electronAPI.config.get('director-youtube');
                    const discord = await window.electronAPI.config.get('director-discord');
                    
                    setExtensions({
                        'director-iracing': iracing || { enabled: true },
                        obs: obs || { enabled: true },
                        'director-youtube': youtube || { enabled: true },
                        'director-discord': discord || { enabled: true }
                    });

                } catch (e) {
                    console.error("Failed to load config", e);
                }
            }
        };
        loadConfig();
    }, []);

    const toggleExtension = async (id: 'director-iracing' | 'obs' | 'director-youtube' | 'director-discord', enabled: boolean) => {
        setExtensions(prev => ({
            ...prev,
            [id]: { ...prev[id], enabled }
        }));
        
        if (window.electronAPI) {
            if (id === 'obs') {
                 // Legacy module handling
                 await window.electronAPI.config.set(`${id}.enabled`, enabled);
            } else {
                 // Extension system handling
                 await window.electronAPI.extensions.setEnabled(id, enabled);
                 
                 // Reload extension status to reflect changes
                 setTimeout(async () => {
                     try {
                         const status = await window.electronAPI.extensions.getStatus();
                         setExtensions(prev => ({
                             ...prev,
                             [id]: { enabled: status[id]?.active || false }
                         }));
                     } catch (e) {
                         console.error('Failed to reload extension status', e);
                     }
                 }, 500); // Small delay to allow extension to load/unload
            }
        }
    };

    return (
        <div className="p-8 space-y-8 animate-in fade-in duration-500">
            <h1 className="text-4xl font-bold uppercase tracking-widest mb-8">System Configuration</h1>

            {/* Extensions Toggle Section */}
             <Card className="bg-card border-border">
                <CardHeader>
                    <CardTitle className="text-muted-foreground text-sm uppercase font-rajdhani tracking-widest">
                        Extension Management
                    </CardTitle>
                </CardHeader>
                <CardContent className="space-y-6">
                     <p className="text-sm text-muted-foreground">
                        Master switch for extension contribution. When disabled, the extension is fully unloaded and removed from the system.
                     </p>
                     
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
                        <Switch id="ext-iracing" checked={extensions['director-iracing'].enabled} onCheckedChange={(c) => toggleExtension('director-iracing', c)} />
                     </div>

                     {/* OBS Toggle */}
                     <div className="flex items-center justify-between p-4 border border-border/50 rounded-lg bg-background/50">
                        <div className="flex items-center gap-4">
                             <div className="p-2 bg-blue-900/50 rounded text-blue-400">
                                <svg className="w-6 h-6" fill="currentColor" viewBox="0 0 24 24"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8z"/><circle cx="12" cy="12" r="5"/></svg>
                             </div>
                             <div>
                                <h3 className="font-bold">OBS Studio</h3>
                                <p className="text-xs text-muted-foreground">Scene switching & status (Legacy Module)</p>
                             </div>
                        </div>
                        <Switch id="module-obs" checked={extensions.obs.enabled} onCheckedChange={(c) => toggleExtension('obs', c)} />
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
                        <Switch id="ext-youtube" checked={extensions['director-youtube'].enabled} onCheckedChange={(c) => toggleExtension('director-youtube', c)} />
                     </div>

                     {/* Discord Toggle */}
                     <div className="flex items-center justify-between p-4 border border-border/50 rounded-lg bg-background/50">
                        <div className="flex items-center gap-4">
                             <div className="p-2 bg-indigo-900/50 rounded text-indigo-400">
                                <svg className="w-6 h-6" fill="currentColor" viewBox="0 0 24 24"><path d="M20.317 4.3698a19.7913 19.7913 0 00-4.8851-1.5152.0741.0741 0 00-.0785.0371c-.211.3753-.4447.8648-.6083 1.2495-1.8447-.2762-3.68-.2762-5.4868 0-.1636-.3933-.4058-.8742-.6177-1.2495a.077.077 0 00-.0785-.037 19.7363 19.7363 0 00-4.8852 1.515.0699.0699 0 00-.0321.0277C.5334 9.0458-1.5584 15.6565 1.5833 21.0373a.081.081 0 00.041.035c2.31 1.6966 4.757 2.6568 6.9407 2.6568a.0762.0762 0 00.0783-.0466c.2774-.3808.5316-.7823.7663-1.199a.076.076 0 00-.0415-.1066 12.8716 12.8716 0 01-1.9545-.9372.077.077 0 01-.0076-.1277c.1258-.0943.2517-.1923.3718-.2914a.0743.0743 0 01.0776-.0105c3.9278 1.7933 8.18 1.7933 12.0614 0a.0739.0739 0 01.0785.0095c.1202.099.246.1981.3728.2924a.077.077 0 01-.0066.1276 12.2986 12.2986 0 01-1.873.9314.0766.0766 0 00-.0407.1067c.2379.4124.502.8125.787 1.1893a.0764.0764 0 00.0775.0451c2.197 0 4.671-.9704 6.974-2.651a.0805.0805 0 00.04-.0355c3.553-5.8504 1.761-12.0673-1.617-16.6393a.0754.0754 0 00-.0317-.0273zM8.02 15.3312c-1.1825 0-2.1569-1.0857-2.1569-2.419 0-1.3332.9555-2.4189 2.157-2.4189 1.2108 0 2.1757 1.0952 2.1568 2.419 0 1.3332-.9555 2.4189-2.1569 2.4189zm7.9748 0c-1.1825 0-2.1569-1.0857-2.1569-2.419 0-1.3332.9554-2.4189 2.1569-2.4189 1.2108 0 2.1757 1.0952 2.1568 2.419 0 1.3332-.946 2.4189-2.1568 2.4189Z"/></svg>
                             </div>
                             <div>
                                <h3 className="font-bold">Discord Bot</h3>
                                <p className="text-xs text-muted-foreground">Voice chat & TTS announcements</p>
                             </div>
                        </div>
                        <Switch id="module-discord" checked={extensions['director-discord'].enabled} onCheckedChange={(c) => toggleExtension('director-discord', c)} />
                     </div>

                </CardContent>
            </Card>
        </div>
    );
};
