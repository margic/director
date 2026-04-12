import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';

const AVAILABLE_VOICES = ['Puck', 'Charon', 'Kore', 'Fenrir', 'Aoede', 'Achird'] as const;

export const DiscordSettings = () => {
    const [discordConfig, setDiscordConfig] = useState({ tokenSet: false, channelId: '', autoConnect: false, voicePreference: '' });
    const [discordTokenInput, setDiscordTokenInput] = useState('');
    const [voiceSaving, setVoiceSaving] = useState(false);

    useEffect(() => {
        const loadConfig = async () => {
            if (window.electronAPI?.config) {
                try {
                    const discord = await window.electronAPI.config.get('discord');
                    const tokenSet = await window.electronAPI.config.isSecureSet('discord.token');
                    setDiscordConfig({
                        tokenSet,
                        channelId: discord?.channelId || '',
                        autoConnect: discord?.autoConnect ?? false,
                        voicePreference: discord?.voicePreference || ''
                    });
                } catch (e) {
                    console.error("Failed to load Discord config", e);
                }
            }
        };
        loadConfig();
    }, []);

    const handleSaveDiscord = async () => {
        try {
            if (window.electronAPI?.config) {
                await window.electronAPI.config.set('discord.channelId', discordConfig.channelId);
                await window.electronAPI.config.set('discord.autoConnect', discordConfig.autoConnect);
                await window.electronAPI.config.set('discord.voicePreference', discordConfig.voicePreference);
                if (discordTokenInput) {
                    await window.electronAPI.config.saveSecure('discord.token', discordTokenInput);
                    setDiscordConfig(prev => ({ ...prev, tokenSet: true }));
                    setDiscordTokenInput('');
                }
                alert('Discord settings saved');
            }
        } catch (error) {
            console.error(error);
            alert('Failed to save Discord settings');
        }
    };

    const handleVoiceChange = async (voice: string) => {
        setDiscordConfig(prev => ({ ...prev, voicePreference: voice }));

        // Persist to Race Control API
        if (window.electronAPI?.discordUpdateVoicePreference) {
            setVoiceSaving(true);
            try {
                await window.electronAPI.discordUpdateVoicePreference(voice);
            } catch (e) {
                console.warn('Failed to persist voice preference to Race Control:', e);
                // Still saved locally via config on next handleSaveDiscord
            } finally {
                setVoiceSaving(false);
            }
        }
    };

    return (
        <Card className="bg-card border-border">
            <CardHeader>
                <CardTitle className="text-muted-foreground text-sm uppercase font-rajdhani tracking-widest">
                    Discord Configuration
                </CardTitle>
            </CardHeader>
            <CardContent className="space-y-6">
                <div className="space-y-2">
                    <label className="text-sm font-medium uppercase text-muted-foreground">Bot Token</label>
                    <Input 
                        type="password"
                        placeholder={discordConfig.tokenSet ? "Token is set (enter to update)" : "Enter Bot Token"}
                        className="bg-background border-border font-mono"
                        value={discordTokenInput}
                        onChange={(e) => setDiscordTokenInput(e.target.value)}
                    />
                    <p className="text-xs text-muted-foreground">Required for bot connection.</p>
                </div>

                <div className="space-y-2">
                    <label className="text-sm font-medium uppercase text-muted-foreground">Default Voice Channel ID</label>
                        <Input 
                        placeholder="123456789..." 
                        className="bg-background border-border font-mono"
                        value={discordConfig.channelId}
                        onChange={(e) => setDiscordConfig({...discordConfig, channelId: e.target.value})}
                    />
                    <p className="text-xs text-muted-foreground">The ID of the voice channel to join.</p>
                </div>

                <div className="space-y-2">
                    <label className="text-sm font-medium uppercase text-muted-foreground">TTS Voice Preference</label>
                    <select
                        className="w-full rounded-md bg-background border border-border px-3 py-2 text-sm text-foreground"
                        value={discordConfig.voicePreference}
                        onChange={(e) => handleVoiceChange(e.target.value)}
                        disabled={voiceSaving}
                    >
                        <option value="">Default (server-selected)</option>
                        {AVAILABLE_VOICES.map((v) => (
                            <option key={v} value={v}>{v}</option>
                        ))}
                    </select>
                    <p className="text-xs text-muted-foreground">
                        {voiceSaving ? 'Saving...' : 'Select the TTS voice used for announcements.'}
                    </p>
                </div>

                <div className="flex items-center justify-between rounded-lg border border-border p-4">
                    <div className="space-y-0.5">
                        <label className="text-sm font-medium uppercase text-muted-foreground">Auto-Connect</label>
                        <p className="text-xs text-muted-foreground">Automatically connect to Discord when Director starts.</p>
                    </div>
                    <Switch
                        checked={discordConfig.autoConnect}
                        onCheckedChange={(checked) => setDiscordConfig({...discordConfig, autoConnect: checked})}
                    />
                </div>

                <Button onClick={handleSaveDiscord} className="w-full">Save Discord Settings</Button>
            </CardContent>
        </Card>
    );
};
