import React from 'react';
import { YouTubePanel } from '../../extensions/youtube/renderer/Panel';

export const YoutubePage = () => {
    return (
        <div className="p-8 animate-in fade-in duration-500 h-full">
            <YouTubePanel />
        </div>
    );
};
