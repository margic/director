import React, { useState, useEffect } from 'react';
import { Mic } from 'lucide-react';

interface DiscordStatus {
    connected: boolean;
    lastCommand?: {
        type: string;
    };
}

interface DiscordDashboardCardProps {
    onClick: () => void;
}

export const DiscordDashboardCard = ({ onClick }: DiscordDashboardCardProps) => {
    const [status, setStatus] = useState<DiscordStatus>({ connected: false });

    useEffect(() => {
        const pollStatus = async () => {
            if (window.electronAPI?.discordGetStatus) {
                try {
                    const s = await window.electronAPI.discordGetStatus();
                    setStatus(s);
                } catch (e) {
                    console.error('Failed to get discord status', e);
                }
            }
        };

        pollStatus();
        const interval = setInterval(pollStatus, 2000);
        return () => clearInterval(interval);
    }, []);

    return (
        <div 
            onClick={onClick}
            className="bg-card border border-border rounded-xl p-6 h-64 flex flex-col justify-between hover:border-primary/50 transition-colors cursor-pointer group"
        >
            <div className="flex justify-between items-center">
                <div className="flex items-center gap-2">
                    <Mic className="w-5 h-5 text-muted-foreground group-hover:text-primary transition-colors" />
                    <h3 className="text-muted-foreground text-sm font-bold uppercase tracking-wider">Talk to Driver</h3>
                </div>
                <div className={`w-3 h-3 rounded-full ${status.connected ? 'bg-green-500' : 'bg-red-500'}`} />
            </div>
          
            <div>
                <div className="text-2xl font-jetbrains font-bold mb-1 text-white">
                    {status.connected ? 'ONLINE' : 'OFFLINE'}
                </div>
                <div className="text-xs text-muted-foreground font-rajdhani">
                    {status.lastCommand 
                        ? `Last: ${status.lastCommand.type}` 
                        : 'No commands received'}
                </div>
            </div>
          
            <div className="w-full py-3 rounded-lg bg-secondary text-white font-bold flex items-center justify-center gap-2 hover:bg-secondary/90 transition-colors shadow-[0_0_15px_rgba(0,163,224,0.3)]">
                <span>OPEN CONTROLS</span>
            </div>
        </div>
    );
};
