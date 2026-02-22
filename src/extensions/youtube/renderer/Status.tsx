import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Play, Square, Activity, MessageSquare, AlertCircle } from 'lucide-react';

interface YouTubeStats {
    messagesReceived: number;
    messagesSent: number;
    monitoring: boolean;
}

export const YouTubeStatus = () => {
    const [stats, setStats] = useState<YouTubeStats>({
        messagesReceived: 0,
        messagesSent: 0,
        monitoring: false
    });
    const [extensionStatus, setExtensionStatus] = useState<'active' | 'inactive'>('inactive');

    useEffect(() => {
        // Listen for extension events
        if (window.electronAPI?.extensions?.onExtensionEvent) {
            const unsubscribe = window.electronAPI.extensions.onExtensionEvent((data: any) => {
                if (data.extensionId === 'youtube') {
                    if (data.eventName === 'youtube.stats') {
                        setStats(prev => ({
                            ...prev,
                            messagesReceived: data.payload.messagesReceived || 0,
                            messagesSent: data.payload.messagesSent || 0
                        }));
                    }
                    if (data.eventName === 'youtube.status') {
                        setStats(prev => ({
                            ...prev,
                            monitoring: data.payload.monitoring || false
                        }));
                    }
                }
            });

            return () => unsubscribe();
        }
    }, []);

    useEffect(() => {
        // Check extension status
        const checkStatus = async () => {
            if (window.electronAPI?.extensions?.getStatus) {
                const statuses = await window.electronAPI.extensions.getStatus();
                setExtensionStatus(statuses['youtube']?.active ? 'active' : 'inactive');
            }
        };

        checkStatus();
        const interval = setInterval(checkStatus, 5000);
        return () => clearInterval(interval);
    }, []);

    const handleStartMonitoring = async () => {
        try {
            await window.electronAPI.extensions.executeIntent('youtube.startMonitoring', {});
        } catch (error) {
            console.error('Failed to start monitoring:', error);
            alert('Failed to start monitoring. Check your authentication.');
        }
    };

    const handleStopMonitoring = async () => {
        try {
            await window.electronAPI.extensions.executeIntent('youtube.stopMonitoring', {});
        } catch (error) {
            console.error('Failed to stop monitoring:', error);
        }
    };

    return (
        <div className="space-y-6">
            {/* Extension Status */}
            <Card className="bg-card border-border">
                <CardHeader>
                    <CardTitle className="text-muted-foreground text-sm uppercase font-rajdhani tracking-widest flex items-center gap-2">
                        <Activity className="w-4 h-4" />
                        Extension Status
                    </CardTitle>
                </CardHeader>
                <CardContent>
                    <div className="flex items-center justify-between">
                        <div className="flex items-center gap-4">
                            <div className={`p-3 rounded-full ${extensionStatus === 'active' ? 'bg-green-900/50 text-green-400' : 'bg-red-900/50 text-red-400'}`}>
                                <svg className="w-8 h-8" fill="currentColor" viewBox="0 0 24 24">
                                    <path d="M19.615 3.184c-3.604-.246-11.631-.245-15.23 0-3.897.266-4.356 2.62-4.385 8.816.029 6.185.484 8.549 4.385 8.816 3.6.245 11.626.246 15.23 0 3.897-.266 4.356-2.62 4.385-8.816-.029-6.185-.484-8.549-4.385-8.816zm-10.615 12.816v-8l8 3.993-8 4.007z"/>
                                </svg>
                            </div>
                            <div>
                                <h3 className="font-bold text-lg">{extensionStatus === 'active' ? 'Connected' : 'Disconnected'}</h3>
                                <p className="text-sm text-muted-foreground">
                                    {extensionStatus === 'active' ? 'Extension is running' : 'Extension is not active'}
                                </p>
                            </div>
                        </div>
                        <div className={`w-3 h-3 rounded-full ${extensionStatus === 'active' ? 'bg-green-500 animate-pulse' : 'bg-red-500'}`} />
                    </div>
                </CardContent>
            </Card>

            {/* Monitoring Control */}
            <Card className="bg-card border-border">
                <CardHeader>
                    <CardTitle className="text-muted-foreground text-sm uppercase font-rajdhani tracking-widest flex items-center gap-2">
                        <MessageSquare className="w-4 h-4" />
                        Broadcast Monitor
                    </CardTitle>
                    <CardDescription>
                        Control telemetry polling and check live status
                    </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                    <div className="flex items-center justify-between p-4 border border-border/50 rounded-lg bg-background/50">
                        <div>
                            <h3 className="text-sm font-bold">Monitor Status</h3>
                            <p className="text-xs text-muted-foreground">
                                {stats.monitoring ? 'Active - Listening for chat messages' : 'Idle - Not monitoring'}
                            </p>
                        </div>
                        {stats.monitoring ? (
                            <Button 
                                onClick={handleStopMonitoring}
                                className="bg-destructive hover:bg-destructive/90"
                            >
                                <Square className="w-4 h-4 mr-2" />
                                Stop Monitoring
                            </Button>
                        ) : (
                            <Button 
                                onClick={handleStartMonitoring}
                                className="bg-primary hover:bg-primary/90"
                            >
                                <Play className="w-4 h-4 mr-2" />
                                Start Monitoring
                            </Button>
                        )}
                    </div>
                </CardContent>
            </Card>

            {/* Statistics */}
            <div className="grid grid-cols-2 gap-6">
                <Card className="bg-card border-border">
                    <CardHeader>
                        <CardTitle className="text-muted-foreground text-xs uppercase font-rajdhani tracking-widest">
                            Messages Received
                        </CardTitle>
                    </CardHeader>
                    <CardContent>
                        <div className="text-4xl font-jetbrains font-bold text-secondary">
                            {stats.messagesReceived}
                        </div>
                        <p className="text-xs text-muted-foreground mt-2">From YouTube Live Chat</p>
                    </CardContent>
                </Card>

                <Card className="bg-card border-border">
                    <CardHeader>
                        <CardTitle className="text-muted-foreground text-xs uppercase font-rajdhani tracking-widest">
                            Messages Sent
                        </CardTitle>
                    </CardHeader>
                    <CardContent>
                        <div className="text-4xl font-jetbrains font-bold text-primary">
                            {stats.messagesSent}
                        </div>
                        <p className="text-xs text-muted-foreground mt-2">To YouTube Live Chat</p>
                    </CardContent>
                </Card>
            </div>

            {/* Info Notice */}
            {!stats.monitoring && extensionStatus === 'active' && (
                <Card className="bg-card border-border border-l-4 border-l-yellow-500">
                    <CardContent className="pt-6">
                        <div className="flex gap-3">
                            <AlertCircle className="w-5 h-5 text-yellow-500 flex-shrink-0 mt-0.5" />
                            <div>
                                <h4 className="font-bold text-sm">Monitoring Not Started</h4>
                                <p className="text-xs text-muted-foreground mt-1">
                                    Click "Start Monitoring" to begin listening for chat messages on your active broadcast.
                                    Make sure you have authenticated via Settings first.
                                </p>
                            </div>
                        </div>
                    </CardContent>
                </Card>
            )}
        </div>
    );
};
