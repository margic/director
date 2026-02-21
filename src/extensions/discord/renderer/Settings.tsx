import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';

export const DiscordSettings = () => {
    const [discordConfig, setDiscordConfig] = useState({ tokenSet: false, channelId: '', autoConnect: false });
    const [discordTokenInput, setDiscordTokenInput] = useState('');

    useEffect(() => {
        const loadConfig = async () => {
            if (window.electronAPI?.config) {
                try {
                    const discord = await window.electronAPI.config.get('discord');
                    const tokenSet = await window.electronAPI.config.isSecureSet('discord.token');
                    setDiscordConfig({
                        tokenSet,
                        channelId: discord?.channelId || '',
                        autoConnect: discord?.autoConnect ?? false
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
