import React, { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { YouTubeSettings } from './Settings';

export const YouTubePanel = () => {
    const [activeTab, setActiveTab] = useState<'status' | 'settings'>('status');

    return (
        <div className="h-full flex flex-col space-y-6">
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
                {activeTab === 'status' ? (
                    <Card className="bg-card border-border">
                        <CardHeader>
                            <CardTitle className="text-muted-foreground text-sm uppercase font-rajdhani tracking-widest">
                                Live Connection
                            </CardTitle>
                        </CardHeader>
                        <CardContent>
                             <div className="flex items-center gap-4">
                                <div className="p-3 bg-red-900/50 rounded-full text-red-400">
                                    <svg className="w-8 h-8" fill="currentColor" viewBox="0 0 24 24"><path d="M19.615 3.184c-3.604-.246-11.631-.245-15.23 0-3.897.266-4.356 2.62-4.385 8.816.029 6.185.484 8.549 4.385 8.816 3.6.245 11.626.246 15.23 0 3.897-.266 4.356-2.62 4.385-8.816-.029-6.185-.484-8.549-4.385-8.816zm-10.615 12.816v-8l8 3.993-8 4.007z"/></svg>
                                </div>
                                <div>
                                    <h3 className="font-bold text-lg">Monitoring</h3>
                                    <p className="text-sm text-muted-foreground">Listening for chat commands on connected stream.</p>
                                </div>
                            </div>
                        </CardContent>
                    </Card>
                ) : (
                    <YouTubeSettings />
                )}
            </div>
        </div>
    );
};
