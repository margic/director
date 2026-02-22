import React, { useState } from 'react';
import { Mic } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { DiscordSettings } from './Settings';
import { DiscordStatus } from './Status';
import { useSetPageHeader } from '../../../renderer/contexts/PageHeaderContext';

export const DiscordPanel = () => {
    const [activeTab, setActiveTab] = useState<'status' | 'settings'>('status');

    // Push header into the global app bar
    useSetPageHeader({ title: 'Discord / Voice', icon: Mic });

    return (
        <div className="h-full flex flex-col space-y-6">
            <div className="flex items-center justify-end">
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
                {activeTab === 'status' ? (
                    <DiscordStatus />
                ) : (
                    <DiscordSettings />
                )}
            </div>
        </div>
    );
};
