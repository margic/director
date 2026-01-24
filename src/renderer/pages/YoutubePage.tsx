// src/renderer/pages/YoutubePage.tsx
import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { YouTubeSearchResult } from '../youtube-types';
import { MessageSquare, RefreshCw, Radio, PlayCircle } from 'lucide-react';

export const YoutubePage = () => {
    const [extStatus, setExtStatus] = useState<any>({});

    useEffect(() => {
        const fetchStatus = async () => {
             if (window.electronAPI.extensions) {
                 const s = await window.electronAPI.extensions.getStatus();
                 setExtStatus(s['director-youtube']);
             }
        };
        fetchStatus();
        const interval = setInterval(fetchStatus, 5000);
        return () => clearInterval(interval);
    }, []);

    const handleLogin = async () => {
        // Trigger Login Intent
        await window.electronAPI.extensions.executeIntent('system.extension.login', { extensionId: 'director-youtube' });
    };

    return (
        <div className='p-8 space-y-8 animate-in fade-in duration-500 min-h-screen'>
             <header className='flex justify-between items-center mb-8'>
                <div>
                     <h1 className='text-4xl font-bold uppercase tracking-widest text-primary flex items-center gap-3'>
                        <span className='p-2 bg-primary/10 rounded'>
                            <svg className='w-8 h-8 fill-primary' viewBox='0 0 24 24'><path d='M19.615 3.184c-3.604-.246-11.631-.245-15.23 0-3.897.266-4.356 2.62-4.385 8.816.029 6.185.484 8.549 4.385 8.816 3.6.245 11.626.246 15.23 0 3.897-.266 4.356-2.62 4.385-8.816-.029-6.185-.484-8.549-4.385-8.816zm-10.615 12.816v-8l8 3.993-8 4.007z'/></svg>
                        </span>
                        YouTube Extension
                    </h1>
                    <p className='text-muted-foreground mt-2 font-rajdhani uppercase tracking-wider'>
                        STATUS: <span className={extStatus?.active ? 'text-green-500' : 'text-red-500'}>{extStatus?.active ? 'ACTIVE' : 'INACTIVE'}</span>
                    </p>
                </div>
                 <Button onClick={handleLogin}>
                    Sign In (Browser)
                </Button>
            </header>

            <div className='grid grid-cols-1 gap-8'>
                <Card className='bg-card border-border'>
                    <CardHeader>
                        <CardTitle>Migration Notice</CardTitle>
                    </CardHeader>
                    <CardContent>
                        <p className='text-muted-foreground'>
                            The YouTube module is being migrated to the new Extension Architecture. 
                            Chat features are active via Intents. Monitor controls coming soon.
                        </p>
                    </CardContent>
                </Card>
            </div>
        </div>
    );
};
