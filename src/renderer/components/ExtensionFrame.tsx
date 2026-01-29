import React, {  useRef, useEffect, useState } from 'react';

interface ExtensionFrameProps {
    extensionId: string;
    viewName: string; 
}

export const ExtensionFrame: React.FC<ExtensionFrameProps> = ({ extensionId, viewName }) => {
    const iframeRef = useRef<HTMLIFrameElement>(null);
    const [iframeReady, setIframeReady] = useState(false);

    // Initial load and event forwarding mechanism
    useEffect(() => {
        // Handle messages FROM the iframe
        const handleMessage = async (event: MessageEvent) => {
            // Filter messages only from our iframe if possible, but the source check 
            // is the most reliable way.
            if (iframeRef.current && event.source === iframeRef.current.contentWindow) {
                const { type, intent, payload } = event.data;

                // Log for debugging
                // console.log(`[ExtensionFrame:${extensionId}] Received:`, event.data);

                if (type === 'EXTENSION_INTENT') {
                     try {
                        await window.electronAPI.extensions.executeIntent(intent, payload);
                    } catch (e) {
                        console.error(`[ExtensionFrame] Intent ${intent} failed`, e);
                    }
                }
            }
        };

        window.addEventListener('message', handleMessage);
        return () => window.removeEventListener('message', handleMessage);
    }, [extensionId]);

    // Forwarding events FROM Electron TO Iframe
    useEffect(() => {
        let unsubscribe: (() => void) | undefined;

        if (window.electronAPI?.extensions?.onExtensionEvent) {
             unsubscribe = window.electronAPI.extensions.onExtensionEvent((data: any) => {
                 if (iframeRef.current && iframeRef.current.contentWindow) {
                     // We forward everything and let the iframe filter by extensionId or event name
                     // The Youtube panel checks `eventName` directly.
                     iframeRef.current.contentWindow.postMessage({
                         type: 'EXTENSION_EVENT',
                         data: data
                     }, '*');
                 }
             });
        }

        return () => {
            if (unsubscribe) unsubscribe();
        };
    }, []);

    // Initial Status Push
    const handleIframeLoad = async () => {
        setIframeReady(true);
        if (window.electronAPI?.extensions?.getStatus) {
            const status = await window.electronAPI.extensions.getStatus();
            if (iframeRef.current && iframeRef.current.contentWindow) {
                 iframeRef.current.contentWindow.postMessage({
                     type: 'EXTENSION_STATUS',
                     data: status
                 }, '*');
            }
        }
    };

    const src = `extension://${extensionId}/${viewName}.html`;

    return (
        <div className="w-full h-full flex flex-col bg-background animate-in fade-in duration-500">
             <div className="p-4 border-b border-border flex justify-between items-center bg-card">
                 <div className="flex items-center gap-2">
                    <div className="w-2 h-2 rounded-full bg-secondary animate-pulse" />
                    <h2 className="text-lg font-rajdhani uppercase tracking-widest font-bold text-foreground">
                        {extensionId.replace('director-', '')} <span className="text-muted-foreground text-sm">EXTENSION</span>
                    </h2>
                 </div>
                 <div className="text-xs font-mono text-muted-foreground uppercase">
                    Protocol: Secure Extension Host
                 </div>
             </div>
             
             <div className="flex-1 relative w-full h-full overflow-hidden bg-background">
                 <iframe 
                    ref={iframeRef}
                    src={src}
                    onLoad={handleIframeLoad}
                    className="w-full h-full border-0"
                    sandbox="allow-scripts allow-forms allow-same-origin"
                    // allow-same-origin needed? 
                    // If we use postMessage, NO. 
                    // If we use allow-same-origin, the iframe runs in same origin as parent? 
                    // No, extension:// is different from file:// or http://localhost
                    // However, for fetch() inside iframe working correctly with CORS if needed?
                    // Actually, 'allow-same-origin' allows the content to be treated as being from its normal origin. 
                    // Without it, it is treated as being from a unique origin.
                    // For postMessage unique origin is fine ('*').
                    // But let's leave allow-same-origin just in case the iframe needs to store localstorage or something unique to its origin.
                 />
             </div>
        </div>
    );
};
