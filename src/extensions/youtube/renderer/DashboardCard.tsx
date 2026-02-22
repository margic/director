import React, { useState, useEffect } from 'react';
import { Play } from 'lucide-react';

interface YouTubeDashboardCardProps {
    onClick: () => void;
}

export const YouTubeDashboardCard = ({ onClick }: YouTubeDashboardCardProps) => {
    const [extensionActive, setExtensionActive] = useState(false);
    const [monitoring, setMonitoring] = useState(false);
    const [messagesReceived, setMessagesReceived] = useState(0);

    useEffect(() => {
        const checkStatus = async () => {
            if (window.electronAPI?.extensions?.getStatus) {
                const statuses = await window.electronAPI.extensions.getStatus();
                setExtensionActive(statuses['director-youtube']?.active || false);
            }
        };

        checkStatus();
        const interval = setInterval(checkStatus, 5000);
        return () => clearInterval(interval);
    }, []);

    useEffect(() => {
        if (window.electronAPI?.extensions?.onExtensionEvent) {
            const unsubscribe = window.electronAPI.extensions.onExtensionEvent((data: any) => {
                if (data.extensionId === 'youtube') {
                    if (data.eventName === 'youtube.stats') {
                        setMessagesReceived(data.payload.messagesReceived || 0);
                    }
                    if (data.eventName === 'youtube.status') {
                        setMonitoring(data.payload.monitoring || false);
                    }
                }
            });
            return () => unsubscribe();
        }
    }, []);

    return (
        <div
            onClick={onClick}
            className="bg-card border border-border rounded-xl p-6 h-64 flex flex-col justify-between hover:border-primary/50 transition-colors cursor-pointer group"
        >
            <div className="flex justify-between items-center">
                <div className="flex items-center gap-2">
                    <Play className="w-5 h-5 text-muted-foreground group-hover:text-primary transition-colors" />
                    <h3 className="text-muted-foreground text-sm font-bold uppercase tracking-wider">YouTube</h3>
                </div>
                <div className={`w-3 h-3 rounded-full ${extensionActive ? (monitoring ? 'bg-green-500 animate-pulse' : 'bg-green-500') : 'bg-red-500'}`} />
            </div>

            <div>
                <div className="text-2xl font-jetbrains font-bold mb-1 text-white">
                    {extensionActive ? (monitoring ? 'MONITORING' : 'IDLE') : 'OFFLINE'}
                </div>
                <div className="text-xs text-muted-foreground font-rajdhani">
                    {extensionActive
                        ? (messagesReceived > 0 ? `${messagesReceived} messages received` : 'No chat activity yet')
                        : 'Extension not active'}
                </div>
            </div>

            <div className="w-full py-3 rounded-lg bg-secondary text-white font-bold flex items-center justify-center gap-2 hover:bg-secondary/90 transition-colors shadow-[0_0_15px_rgba(0,163,224,0.3)]">
                <span>OPEN CONTROLS</span>
            </div>
        </div>
    );
};
