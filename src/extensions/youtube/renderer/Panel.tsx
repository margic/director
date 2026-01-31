import React, { useState } from 'react';
import { YouTubeStatus } from './Status';
import { YouTubeSettings } from './Settings';

export const YouTubePanel = () => {
    const [activeTab, setActiveTab] = useState<'status' | 'settings'>('status');

    return (
        <div className="h-full flex flex-col space-y-6 p-8">
            <div className="flex items-center justify-between">
                <h1 className="text-4xl font-bold uppercase tracking-widest text-primary">YouTube Integration</h1>
                <div className="flex space-x-2 bg-card border border-border rounded-lg p-1">
                    <button
                        onClick={() => setActiveTab('status')}
                        className={`px-4 py-2 text-sm font-medium rounded-md transition-colors ${
                            activeTab === 'status' 
                            ? 'bg-primary text-primary-foreground shadow-sm' 
                            : 'text-muted-foreground hover:bg-white/10'
                        }`}
                    >
                        Status
                    </button>
                    <button
                        onClick={() => setActiveTab('settings')}
                        className={`px-4 py-2 text-sm font-medium rounded-md transition-colors ${
                            activeTab === 'settings' 
                            ? 'bg-primary text-primary-foreground shadow-sm' 
                            : 'text-muted-foreground hover:bg-white/10'
                        }`}
                    >
                        Settings
                    </button>
                </div>
            </div>

            <div className="flex-1">
                {activeTab === 'status' ? <YouTubeStatus /> : <YouTubeSettings />}
            </div>
        </div>
    );
};
