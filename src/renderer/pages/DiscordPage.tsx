import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Mic, Activity, Volume2, MessageSquare, AlertCircle, Loader2 } from 'lucide-react';

interface CommandLogItem {
  id: string;
  type: string;
  payload: any;
  timestamp: string;
  status: 'SUCCESS' | 'FAILED' | 'PENDING';
}

export const DiscordPage = () => {
    const [status, setStatus] = useState<any>({});
    const [testText, setTestText] = useState('This is a test message from Race Control.');
    const [logs, setLogs] = useState<CommandLogItem[]>([]);
    const [isSending, setIsSending] = useState(false);

    useEffect(() => {
        const fetchStatus = async () => {
            try {
                // Poll for status
                const s = await window.electronAPI.discordGetStatus();
                setStatus(s);
            } catch (error) {
                console.error("Failed to fetch Discord status:", error);
            }
        };

        fetchStatus();
        const interval = setInterval(fetchStatus, 3000);
        return () => clearInterval(interval);
    }, []);

    const handleConnect = async () => {
        try {
            await window.electronAPI.discordConnect();
        } catch (error) {
            console.error("Connection failed:", error);
            alert(`Connection failed: ${(error as Error).message}. Please check Settings.`);
        }
    };

    const handleDisconnect = async () => {
        await window.electronAPI.discordDisconnect();
    };


    const handleSendTest = async () => {
        if (!testText) return;
        setIsSending(true);
        try {
            await window.electronAPI.discordSendTest(testText);
            // Optimistically add to log
            const newLog: CommandLogItem = {
                id: Date.now().toString(),
                type: 'TTS_TEST',
                payload: { text: testText },
                timestamp: new Date().toISOString(),
                status: 'SUCCESS'
            };
            setLogs(prev => [newLog, ...prev]);
        } catch (e) {
            console.error(e);
            // Add failed log item
             const failedLog: CommandLogItem = {
                id: Date.now().toString(),
                type: 'TTS_TEST',
                payload: { text: testText, error: (e as Error).message },
                timestamp: new Date().toISOString(),
                status: 'FAILED'
            };
            setLogs(prev => [failedLog, ...prev]);
            alert(`Failed to send test command: ${(e as Error).message}`);
        } finally {
            setIsSending(false);
        }
    };

    return (
        <div className="p-8 space-y-8 animate-in fade-in duration-500 min-h-screen">
             <header className="flex justify-between items-center mb-8">
                <div>
                     <h1 className="text-4xl font-bold uppercase tracking-widest text-primary flex items-center gap-3">
                        <span className="p-2 bg-primary/10 rounded">
                            <Mic className="w-8 h-8" />
                        </span>
                        Driver Voice
                    </h1>
                     <p className="text-muted-foreground mt-2 font-rajdhani uppercase tracking-wider">
                        Discord Voice Output Integration
                    </p>
                </div>
                <div className="flex items-center gap-4">
                     <div className={`px-4 py-2 rounded-full border ${status.connected ? 'bg-green-500/10 border-green-500/50 text-green-500' : 'bg-red-500/10 border-red-500/50 text-red-500'} flex items-center gap-2`}>
                        <Activity className="w-4 h-4" />
                        <span className="text-sm font-bold uppercase tracking-wider">
                            {status.connected ? 'ONLINE' : 'OFFLINE'}
                        </span>
                    </div>
                </div>
            </header>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                {/* Connection Panel */}
                <Card className="bg-card border-border">
                    <CardHeader>
                        <CardTitle>Connection Status</CardTitle>
                        <CardDescription>
                            {status.connected 
                                ? "Connected to Discord Voice Gateway."
                                : "Disconnected. Configure credentials in Settings."
                            }
                        </CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-4">
                         <div className="p-4 bg-background/50 rounded border border-border">
                            <div className="flex justify-between items-center">
                                <span className="text-xs uppercase text-muted-foreground">Gateway State</span>
                                <span className={`text-sm font-bold ${status.connected ? 'text-green-500' : 'text-muted-foreground'}`}>
                                    {status.connected ? "CONNECTED" : "DISCONNECTED"}
                                </span>
                            </div>
                        </div>

                        <div className="pt-2">
                            {status.connected ? (
                                <Button onClick={handleDisconnect} className="w-full bg-destructive text-white hover:bg-destructive/90">
                                    DISCONNECT
                                </Button>
                            ) : (
                                <Button onClick={handleConnect} className="w-full bg-primary text-primary-foreground hover:bg-primary/90">
                                    CONNECT TO VOICE
                                </Button>
                            )}
                        </div>
                    </CardContent>
                </Card>

                {/* Test Panel */}
                <Card className="bg-card border-border">
                    <CardHeader>
                        <CardTitle className="flex items-center gap-2">
                            <Volume2 className="w-5 h-5 text-secondary" />
                            Output Test
                        </CardTitle>
                        <CardDescription>Synthesize and stream test audio to the channel.</CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-4">
                        <div className="p-4 bg-background/50 rounded border border-border">
                             <div className="flex justify-between items-center mb-2">
                                <span className="text-xs uppercase text-muted-foreground">Current Status</span>
                                <span className="text-xs font-mono text-primary">{status.channelName || 'Not Connected'}</span>
                             </div>
                             <div className="flex justify-between items-center">
                                <span className="text-xs uppercase text-muted-foreground">Messages Sent</span>
                                <span className="text-2xl font-jetbrains text-white">{status.messagesSent || 0}</span>
                             </div>
                        </div>
                        <div className="flex gap-4">
                            <Input 
                                value={testText} 
                                onChange={(e) => setTestText(e.target.value)} 
                                onKeyDown={(e) => e.key === 'Enter' && status.connected && handleSendTest()}
                                className="bg-background border-border font-mono text-sm text-foreground"
                                placeholder="Enter text to speak..."
                            />
                            <Button onClick={handleSendTest} disabled={!status.connected || isSending} className="bg-secondary text-secondary-foreground hover:bg-secondary/90 w-28">
                                {isSending ? (
                                    <>
                                        <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                                    </>
                                ) : (
                                    "SPEAK"
                                )}
                            </Button>
                        </div>
                    </CardContent>
                </Card>
            </div>


            {/* Command Log */}
            <Card className="bg-card border-border">
                <CardHeader>
                    <CardTitle>Command History</CardTitle>
                </CardHeader>
                <CardContent>
                    <div className="space-y-0 divide-y divide-border/20 max-h-[400px] overflow-y-auto">
                        {logs.length === 0 && (
                            <div className="py-4 text-center text-muted-foreground text-sm italic">
                                Local session log is empty.
                            </div>
                        )}
                        {logs.map((log) => (
                            <div key={log.id} className="py-3 flex items-start justify-between">
                                <div className="flex items-start gap-4">
                                    <span className="text-xs font-mono text-muted-foreground w-20 pt-1">
                                        {new Date(log.timestamp).toLocaleTimeString()}
                                    </span>
                                    <div>
                                        <div className="text-sm font-bold text-secondary">{log.type}</div>
                                        <div className="text-sm text-foreground/80">{log.payload?.text}</div>
                                    </div>
                                </div>
                                <div>
                                    <span className={`text-xs px-2 py-1 rounded ${log.status === 'SUCCESS' ? 'bg-green-500/10 text-green-500' : 'bg-red-500/10 text-red-500'}`}>
                                        {log.status}
                                    </span>
                                </div>
                            </div>
                        ))}
                    </div>
                </CardContent>
            </Card>
        </div>
    );
};
