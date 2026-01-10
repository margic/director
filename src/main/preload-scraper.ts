import { contextBridge, ipcRenderer } from 'electron';

// This preload script is specifically for the YouTube Scraper Hidden Window
// It exposes a secure bridge to send chat messages back to the main process

contextBridge.exposeInMainWorld('scraperApi', {
    sendChatMessage: (message: any) => ipcRenderer.send('youtube-scraper:message', message),
    log: (msg: string) => console.log('[Scraper Preload]', msg) // For debugging in the hidden window console
});
