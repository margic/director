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

export const DiscordStatus = () => {
    const [status, setStatus] = useState<any>({});
    const [testText, setTestText] = useState('This is a test message from Race Control.');
    const [logs, setLogs] = useState<CommandLogItem[]>([]);
    const [isSending, setIsSending] = useState(false);

    useEffect(() => {
        const fetchStatus = async () => {
             if (window.electronAPI?.discordGetStatus) {
                try {
                    // Poll for status
                    const s = await window.electronAPI.discordGetStatus();
                    setStatus(s);
                } catch (error) {
                    console.error("Failed to fetch Discord status:", error);
                }
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
        <div className="space-y-6">
             <div className="flex justify-between items-center bg-card p-4 rounded-lg border border-border">
                <div>
                     <h3 className="text-xl font-bold uppercase tracking-widest text-primary flex items-center gap-3">
                        Driver Voice
                    </h3>
                     <p className="text-muted-foreground text-xs font-rajdhani uppercase tracking-wider">
                        Status & Control
                    </p>
                </div>
                <div className="flex items-center gap-4">
                     <div className={`px-4 py-2 rounded-full border ${status.connected ? 'bg-green-500/10 border-green-500/50 text-green-500' : 'bg-red-500/10 border-red-500/50 text-red-500'} flex items-center gap-2`}>
                        <Activity className="w-4 h-4" />
                        <span className="text-sm font-bold uppercase tracking-wider">
                            {status.connected ? 'ONLINE' : 'OFFLINE'}
                        </span>
                     </div>
                     
                     {status.connected ? (
                        <Button variant="destructive" size="sm" onClick={handleDisconnect}>
                            Disconnect
                        </Button>
                     ) : (
                        <Button className="bg-primary text-primary-foreground" size="sm" onClick={handleConnect}>
                            Connect Bot
                        </Button>
                     )}
                </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {/* Control Panel */}
                <Card className="bg-card border-border">
                    <CardHeader>
                        <CardTitle className="text-muted-foreground text-sm uppercase font-rajdhani tracking-widest flex items-center gap-2">
                           <Mic className="w-4 h-4" /> Manual Override
                        </CardTitle>
                        <CardDescription>Send immediate voice messages</CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-4">
                        <div className="space-y-2">
                             <Input 
                                placeholder="Type message to broadcast..." 
                                value={testText}
                                onChange={(e) => setTestText(e.target.value)}
                                className="bg-background border-border"
                             />
                             <Button 
                                className="w-full bg-secondary text-secondary-foreground hover:bg-secondary/90"
                                onClick={handleSendTest}
                                disabled={isSending || !status.connected}
                            >
                                {isSending ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Volume2 className="w-4 h-4 mr-2" />}
                                Broadcast TTS
                             </Button>
                        </div>
                    </CardContent>
                </Card>

                 {/* Logs */}
                 <Card className="bg-card border-border h-[300px] flex flex-col">
                    <CardHeader>
                        <CardTitle className="text-muted-foreground text-sm uppercase font-rajdhani tracking-widest flex items-center gap-2">
                           <MessageSquare className="w-4 h-4" /> Event Log
                        </CardTitle>
                    </CardHeader>
                    <CardContent className="flex-1 overflow-y-auto space-y-2 pr-2">
                         {logs.length === 0 ? (
                            <div className="text-center text-muted-foreground text-sm py-8">
                                No events recorded.
                            </div>
                         ) : (
                             logs.map((log) => (
                                 <div key={log.id} className="flex gap-3 text-sm p-2 rounded bg-background/50 border border-border/50">
                                     <div className={`mt-0.5 ${log.status === 'FAILED' ? 'text-destructive' : 'text-green-500'}`}>
                                        {log.status === 'FAILED' ? <AlertCircle className="w-4 h-4" /> : <Activity className="w-4 h-4" />}
                                     </div>
                                     <div className="flex-1 min-w-0">
                                         <p className="font-mono text-xs text-muted-foreground mb-1">{log.timestamp.split('T')[1].split('.')[0]}</p>
                                         <p className="font-medium truncate">{log.payload.text || JSON.stringify(log.payload)}</p>
                                         {log.type === 'TTS_TEST' && <span className="text-xs px-1.5 py-0.5 bg-secondary/10 text-secondary rounded">TTS</span>}
                                     </div>
                                 </div>
                             ))
                         )}
                    </CardContent>
                </Card>
            </div>
        </div>
    );
};
