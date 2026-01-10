// src/renderer/pages/YoutubePage.tsx
import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { YouTubeSearchResult } from '../youtube-types';
import { MessageSquare, RefreshCw, Radio, PlayCircle } from 'lucide-react';

export const YoutubePage = () => {
    const [status, setStatus] = useState<any>({});
    const [videos, setVideos] = useState<YouTubeSearchResult[]>([]);
    const [searching, setSearching] = useState(false);

    useEffect(() => {
        const fetchStatus = async () => {
            const s = await window.electronAPI.youtube.getStatus();
            setStatus(s);
        };
        fetchStatus();
        
        const cleanup = window.electronAPI.youtube.onStatusChange((s: any) => setStatus(s));
        return () => { cleanup(); }
    }, []);

    const handleSearch = async () => {
        if (!status.channelId) {
            alert('Please configure a Channel ID in Settings first.');
            return;
        }
        setSearching(true);
        try {
            const results = await window.electronAPI.youtube.searchVideos(status.channelId);
            setVideos(results);
        } catch (e) {
            console.error(e);
            alert('Search failed. Check console.');
        } finally {
            setSearching(false);
        }
    };

    const handleSelectVideo = async (videoId: string) => {
        await window.electronAPI.youtube.setVideo(videoId);
    };

    return (
        <div className="p-8 space-y-8 animate-in fade-in duration-500 min-h-screen">
             <header className="flex justify-between items-center mb-8">
                <div>
                     <h1 className="text-4xl font-bold uppercase tracking-widest text-primary flex items-center gap-3">
                        <span className="p-2 bg-primary/10 rounded">
                            <svg className="w-8 h-8 fill-primary" viewBox="0 0 24 24"><path d="M19.615 3.184c-3.604-.246-11.631-.245-15.23 0-3.897.266-4.356 2.62-4.385 8.816.029 6.185.484 8.549 4.385 8.816 3.6.245 11.626.246 15.23 0 3.897-.266 4.356-2.62 4.385-8.816-.029-6.185-.484-8.549-4.385-8.816zm-10.615 12.816v-8l8 3.993-8 4.007z"/></svg>
                        </span>
                        YouTube Monitor
                    </h1>
                    <p className="text-muted-foreground mt-2 font-rajdhani uppercase tracking-wider">
                        STATUS: <span className={status.connected ? "text-green-500" : "text-red-500"}>{status.connected ? 'AUTHENTICATED' : 'DISCONNECTED'}</span>
                    </p>
                </div>
            </header>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                
                {/* 1. Status Module */}
                <Card className="bg-card border-border lg:col-span-1">
                    <CardHeader>
                         <CardTitle className="text-muted-foreground text-xs uppercase font-rajdhani tracking-widest">
                            Chat Ingest
                        </CardTitle>
                    </CardHeader>
                    <CardContent className="flex flex-col items-center justify-center p-8 space-y-4">
                        <div className="text-6xl font-jetbrains font-bold text-foreground">
                            {status.messageCount || 0}
                        </div>
                        <div className="text-sm uppercase text-muted-foreground tracking-widest">Messages Scraped</div>
                        
                        <div className="w-full h-px bg-border my-4"/>
                        
                        <div className="w-full space-y-2">
                             <div className="flex justify-between text-sm">
                                <span className="text-muted-foreground">Active Video ID:</span>
                                <span className="font-mono text-secondary">{status.videoId || 'NONE'}</span>
                             </div>
                        </div>
                    </CardContent>
                </Card>

                {/* 2. Video Selection */}
                <Card className="bg-card border-border lg:col-span-2">
                    <CardHeader className="flex flex-row items-center justify-between pb-2">
                         <CardTitle className="text-muted-foreground text-xs uppercase font-rajdhani tracking-widest">
                            Live Broadcasts
                        </CardTitle>
                        <Button 
                            variant="outline" 
                            size="sm" 
                            onClick={handleSearch} 
                            disabled={!status.connected || searching}
                            className="text-xs uppercase"
                        >
                            {searching ? <RefreshCw className="mr-2 h-4 w-4 animate-spin"/> : <RefreshCw className="mr-2 h-4 w-4"/>}
                            Refresh List
                        </Button>
                    </CardHeader>
                    <CardContent>
                        {videos.length === 0 ? (
                            <div className="flex flex-col items-center justify-center h-48 text-muted-foreground border-2 border-dashed border-border/50 rounded-lg">
                                <Radio className="w-12 h-12 mb-2 opacity-20"/>
                                <span className="text-sm uppercase tracking-wider">No Live broadcasts found</span>
                            </div>
                        ) : (
                            <div className="space-y-4">
                                {videos.map(video => (
                                    <div key={video.id} className={`flex items-center gap-4 p-4 border rounded-lg transition-colors ${status.videoId === video.id ? 'border-primary bg-primary/10' : 'border-border/50 hover:bg-white/5'}`}>
                                        <img src={video.thumbnailUrl} alt="Thumb" className="w-24 h-16 object-cover rounded bg-black"/>
                                        <div className="flex-1">
                                            <h4 className="font-bold text-foreground line-clamp-1">{video.title}</h4>
                                            <p className="text-xs text-muted-foreground font-mono mt-1">ID: {video.id}</p>
                                        </div>
                                        {status.videoId === video.id ? (
                                             <div className="px-3 py-1 bg-green-500/20 text-green-500 text-xs font-bold rounded uppercase flex items-center gap-2">
                                                <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse"/>
                                                Monitoring
                                             </div>
                                        ) : (
                                            <Button size="sm" onClick={() => handleSelectVideo(video.id)} className="gap-2">
                                                <PlayCircle className="w-4 h-4"/> Monitor
                                            </Button>
                                        )}
                                    </div>
                                ))}
                            </div>
                        )}
                    </CardContent>
                </Card>

            </div>
        </div>
    );
}
