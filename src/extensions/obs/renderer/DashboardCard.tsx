import React, { useState, useEffect } from 'react';
import { Aperture } from 'lucide-react';

interface ObsDashboardCardProps {
    onClick: () => void;
}

export const ObsDashboardCard = ({ onClick }: ObsDashboardCardProps) => {
    const [connected, setConnected] = useState(false);
    const [missingScenes, setMissingScenes] = useState<string[]>([]);

    useEffect(() => {
        const pollStatus = async () => {
            if (window.electronAPI?.obsGetStatus) {
                try {
                    const status = await window.electronAPI.obsGetStatus();
                    setConnected(status.connected);
                    setMissingScenes(status.missingScenes || []);
                } catch (e) {
                    console.error('Failed to get OBS status', e);
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
                    <Aperture className="w-5 h-5 text-muted-foreground group-hover:text-primary transition-colors" />
                    <h3 className="text-muted-foreground text-sm font-bold uppercase tracking-wider">OBS Status</h3>
                </div>
                <div className={`w-3 h-3 rounded-full ${connected ? (missingScenes.length > 0 ? 'bg-yellow-500' : 'bg-green-500') : 'bg-red-500'}`} />
            </div>

            <div>
                <div className="text-2xl font-jetbrains font-bold mb-1 text-white">
                    {connected ? 'CONNECTED' : 'DISCONNECTED'}
                </div>
                <div className="text-xs text-muted-foreground font-rajdhani">
                    {connected
                        ? (missingScenes.length > 0 ? `${missingScenes.length} Scenes Missing` : 'Ready to Broadcast')
                        : 'Waiting for OBS...'}
                </div>
            </div>

            <div className="w-full py-3 rounded-lg bg-secondary text-white font-bold flex items-center justify-center gap-2 hover:bg-secondary/90 transition-colors shadow-[0_0_15px_rgba(0,163,224,0.3)]">
                <span>OPEN CONTROLS</span>
            </div>
        </div>
    );
};
