import React, { useState, useEffect } from 'react';
import { Car, Radio } from 'lucide-react';

interface IracingDashboardCardProps {
    onClick: () => void;
}

interface PublisherBadgeState {
    enabled: boolean;
    active: boolean;
    eventsPublishedTotal: number;
}

export const IracingDashboardCard = ({ onClick }: IracingDashboardCardProps) => {
    const [connected, setConnected] = useState(false);
    const [publisher, setPublisher] = useState<PublisherBadgeState>({
        enabled: false,
        active: false,
        eventsPublishedTotal: 0,
    });

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
                try {
                    const lastPub = await window.electronAPI.extensions.getLastEvent('iracing.publisherStateChanged');
                    if (lastPub?.payload) {
                        setPublisher((prev) => ({
                            ...prev,
                            active: lastPub.payload.status === 'active',
                            eventsPublishedTotal: lastPub.payload.eventsQueuedTotal ?? 0,
                        }));
                    }
                } catch (e) {
                    console.error('Failed to get publisher state', e);
                }
            }
            // Read the persisted enabled flag once
            if (window.electronAPI?.config) {
                try {
                    const enabled = await window.electronAPI.config.get('publisher.enabled');
                    setPublisher((prev) => ({ ...prev, enabled: !!enabled }));
                } catch (e) {
                    console.error('Failed to get publisher.enabled', e);
                }
            }
        };
        init();

        // Subscribe to live connection state and publisher state changes
        let unsub: (() => void) | undefined;
        if (window.electronAPI?.extensions) {
            unsub = window.electronAPI.extensions.onExtensionEvent((data) => {
                if (data.eventName === 'iracing.connectionStateChanged') {
                    setConnected(!!data.payload?.connected);
                } else if (data.eventName === 'iracing.publisherStateChanged') {
                    setPublisher((prev) => ({
                        ...prev,
                        active: data.payload?.status === 'active',
                        eventsPublishedTotal:
                            data.payload?.eventsQueuedTotal ?? prev.eventsPublishedTotal,
                    }));
                }
            });
        }
        return () => unsub?.();
    }, []);

    const showPublisherBadge = publisher.enabled && publisher.active;

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
                {showPublisherBadge && (
                    <div className="mt-2 inline-flex items-center gap-1.5 text-secondary">
                        <Radio className="w-3 h-3" />
                        <span className="text-[10px] font-rajdhani uppercase tracking-widest font-bold">PUB</span>
                        <span className="text-xs font-jetbrains tabular-nums">
                            ▲ {publisher.eventsPublishedTotal.toLocaleString()} events
                        </span>
                    </div>
                )}
            </div>

            <div className="w-full py-3 rounded-lg bg-secondary text-white font-bold flex items-center justify-center gap-2 hover:bg-secondary/90 transition-colors shadow-[0_0_15px_rgba(0,163,224,0.3)]">
                <span>OPEN CONTROLS</span>
            </div>
        </div>
    );
};
