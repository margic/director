import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Input } from '@/components/ui/input';

export const YouTubeSettings = () => {
    const [ytStatus, setYtStatus] = useState<{ connected: boolean, channelId: string }>({ connected: false, channelId: '' });
    const [loading, setLoading] = useState(false);
    const [clientId, setClientId] = useState('');
    const [clientSecret, setClientSecret] = useState('');
    const [secretAlreadySaved, setSecretAlreadySaved] = useState(false);
    const [savingCreds, setSavingCreds] = useState(false);
    const [channelId, setChannelId] = useState('');
    const [autoConnect, setAutoConnect] = useState(false);
    const [savingPrefs, setSavingPrefs] = useState(false);

    useEffect(() => {
        // Load saved OAuth credentials
        const loadCreds = async () => {
            if (window.electronAPI?.config) {
                const [id, secretSet] = await Promise.all([
                    window.electronAPI.config.get('youtube.clientId'),
                    window.electronAPI.config.isSecureSet('youtube.clientSecret'),
                ]);
                if (id) setClientId(id);
                if (secretSet) setSecretAlreadySaved(true);
            }
        };
        loadCreds();
    }, []);

    useEffect(() => {
        // Load saved preferences
        const loadPrefs = async () => {
            if (window.electronAPI?.config?.get) {
                const [ch, auto] = await Promise.all([
                    window.electronAPI.config.get('youtube.channelId'),
                    window.electronAPI.config.get('youtube.autoConnect'),
                ]);
                if (ch) setChannelId(ch);
                if (auto !== undefined && auto !== null) setAutoConnect(!!auto);
            }
        };
        loadPrefs();
    }, []);

    const handleSaveCreds = async () => {
        setSavingCreds(true);
        try {
            const trimmedId = clientId.trim();
            const trimmedSecret = clientSecret.trim();
            await Promise.all([
                window.electronAPI.config.set('youtube.clientId', trimmedId),
                ...(trimmedSecret ? [window.electronAPI.config.saveSecure('youtube.clientSecret', trimmedSecret)] : []),
            ]);
            if (trimmedSecret) setSecretAlreadySaved(true);
            setClientSecret('');
        } finally {
            setSavingCreds(false);
        }
    };

    const handleSavePrefs = async () => {
        setSavingPrefs(true);
        try {
            await Promise.all([
                window.electronAPI.config.set('youtube.channelId', channelId.trim()),
                window.electronAPI.config.set('youtube.autoConnect', autoConnect),
            ]);
        } finally {
            setSavingPrefs(false);
        }
    };

    useEffect(() => {
        // Get initial auth status from last emitted event
        const fetchStatus = async () => {
            if (window.electronAPI?.extensions?.getLastEvent) {
                const last = await window.electronAPI.extensions.getLastEvent('youtube.auth');
                if (last) {
                    setYtStatus(prev => ({ ...prev, connected: last.payload?.connected ?? false }));
                }
            }
        };

        fetchStatus();

        // Subscribe to live auth status updates
        if (window.electronAPI?.extensions?.onExtensionEvent) {
            const cleanup = window.electronAPI.extensions.onExtensionEvent((data: any) => {
                if (data.extensionId === 'director-youtube' && data.eventName === 'youtube.auth') {
                    setYtStatus(prev => ({ ...prev, connected: data.payload.connected ?? false }));
                }
            });
            return () => { cleanup(); }
        }
    }, []);

    const handleConnect = async () => {
        setLoading(true);
        try {
            await window.electronAPI.extensions.executeIntent('director.youtube.login', {
                clientId: clientId.trim() || undefined,
                clientSecret: clientSecret.trim() || undefined,
            });
        } catch (error) {
            console.error('YouTube login intent failed:', error);
        } finally {
            setLoading(false);
        }
    };

    const handleSignOut = async () => {
        try {
            await window.electronAPI.extensions.executeIntent('director.youtube.logout', {});
        } catch (error) {
            console.error('YouTube logout intent failed:', error);
        }
    };

    return (
        <div className="space-y-6">
            <Card className="bg-card border-border">
                <CardHeader>
                    <CardTitle className="text-muted-foreground text-sm uppercase font-rajdhani tracking-widest">
                        YouTube Account
                    </CardTitle>
                </CardHeader>
                <CardContent className="space-y-6">
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

            <Card className="bg-card border-border">
                <CardHeader>
                    <CardTitle className="text-muted-foreground text-sm uppercase font-rajdhani tracking-widest">
                        OAuth Credentials
                    </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                    <p className="text-xs text-muted-foreground">Create a project in Google Cloud Console, enable the YouTube Data API v3, and create OAuth 2.0 credentials.</p>
                    <div className="space-y-2">
                        <label className="text-sm font-medium uppercase text-muted-foreground">Client ID</label>
                        <Input
                            placeholder="xxxxxxxxxxxx.apps.googleusercontent.com"
                            className="bg-background border-border font-mono"
                            value={clientId}
                            onChange={e => setClientId(e.target.value)}
                        />
                    </div>
                    <div className="space-y-2">
                        <label className="text-sm font-medium uppercase text-muted-foreground">Client Secret</label>
                        <Input
                            type="password"
                            placeholder={secretAlreadySaved ? '••••••••  (saved — enter new value to replace)' : 'GOCSPX-…'}
                            className="bg-background border-border font-mono"
                            value={clientSecret}
                            onChange={e => setClientSecret(e.target.value)}
                        />
                    </div>
                    <Button
                        onClick={handleSaveCreds}
                        disabled={savingCreds || !clientId.trim() || (!clientSecret.trim() && !secretAlreadySaved)}
                        className="bg-secondary text-secondary-foreground hover:opacity-90"
                    >
                        {savingCreds ? 'Saving…' : 'Save Credentials'}
                    </Button>
                </CardContent>
            </Card>

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
                            value={channelId}
                            onChange={e => setChannelId(e.target.value)}
                        />
                        <p className="text-xs text-muted-foreground">Used to identify your channel. The active broadcast is detected automatically via the API.</p>
                    </div>

                    <div className="flex items-center justify-between">
                        <div className="space-y-0.5">
                            <label className="text-sm font-medium uppercase text-muted-foreground">Auto-Start Monitor</label>
                            <p className="text-xs text-muted-foreground">Automatically start chat monitoring on launch when connected</p>
                        </div>
                        <Switch checked={autoConnect} onCheckedChange={setAutoConnect} />
                    </div>

                    <Button
                        onClick={handleSavePrefs}
                        disabled={savingPrefs}
                        className="bg-secondary text-secondary-foreground hover:opacity-90"
                    >
                        {savingPrefs ? 'Saving…' : 'Save Preferences'}
                    </Button>
                </CardContent>
            </Card>
        </div>
    );
};
