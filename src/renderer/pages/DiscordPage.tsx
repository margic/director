import React from 'react';
import { DiscordPanel } from '../../extensions/discord/renderer/Panel';

export const DiscordPage = () => {
    return (
        <div className="p-8 animate-in fade-in duration-500 h-full">
            <DiscordPanel />
        </div>
    );
};
