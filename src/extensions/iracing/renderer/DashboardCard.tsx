import React, { useState, useEffect } from 'react';
import { Car } from 'lucide-react';

interface IracingDashboardCardProps {
    onClick: () => void;
}

export const IracingDashboardCard = ({ onClick }: IracingDashboardCardProps) => {
    const [connected, setConnected] = useState(false);

    useEffect(() => {
        // Query the cached connection state on mount
        const init = async () => {
            if (window.electronAPI?.extensions) {
                try {
                    const lastEvent = await window.electronAPI.extensions.getLastEvent('iracing.connectionStateChanged');
                    if (lastEvent?.payload?.connected !== undefined) {
                        setConnected(lastEvent.payload.connected);
                    }
                } catch (e) {
                    console.error('Failed to get iracing connection state', e);
                }
            }
        };
        init();

        // Subscribe to live connection state changes
        let unsub: (() => void) | undefined;
        if (window.electronAPI?.extensions) {
            unsub = window.electronAPI.extensions.onExtensionEvent((data) => {
                if (data.eventName === 'iracing.connectionStateChanged') {
                    setConnected(!!data.payload?.connected);
                }
            });
        }
        return () => unsub?.();
    }, []);

    return (
        <div
            onClick={onClick}
            className="bg-card border border-border rounded-xl p-6 h-64 flex flex-col justify-between hover:border-primary/50 transition-colors cursor-pointer group"
        >
            <div className="flex justify-between items-center">
                <div className="flex items-center gap-2">
                    <Car className="w-5 h-5 text-muted-foreground group-hover:text-primary transition-colors" />
                    <h3 className="text-muted-foreground text-sm font-bold uppercase tracking-wider">iRacing Status</h3>
                </div>
                <div className={`w-3 h-3 rounded-full ${connected ? 'bg-green-500' : 'bg-red-500'}`} />
            </div>

            <div>
                <div className="text-2xl font-jetbrains font-bold mb-1 text-white">
                    {connected ? 'CONNECTED' : 'NOT FOUND'}
                </div>
                <div className="text-xs text-muted-foreground font-rajdhani">
                    {connected ? 'Simulator Running' : 'Waiting for Simulator...'}
                </div>
            </div>

            <div className="w-full py-3 rounded-lg bg-secondary text-white font-bold flex items-center justify-center gap-2 hover:bg-secondary/90 transition-colors shadow-[0_0_15px_rgba(0,163,224,0.3)]">
                <span>OPEN CONTROLS</span>
            </div>
        </div>
    );
};
