// The API interface available in the extension host
interface ExtensionAPI {
  settings: Record<string, any>;
  getAuthToken(): Promise<string | null>;
  registerIntentHandler(intent: string, handler: (payload: any) => Promise<void>): void;
  emitEvent(event: string, payload: any): void;
  log(level: 'info' | 'warn' | 'error', message: string): void;
  invoke(method: string, ...args: any[]): Promise<any>;
}

export async function activate(director: ExtensionAPI) {
    director.log('info', 'Discord Extension Activating...');

    // Register intent handler — actual Discord connectivity is managed by
    // DiscordService in the main process.  The extension delegates TTS
    // playback via the invoke() bridge so that only a single bot Client
    // exists application-wide.
    director.registerIntentHandler('communication.announce', async (payload: { message: string; context?: { type?: string; urgency?: string }; voice?: string }) => {
        director.log('info', `Received announce request: ${payload.message}`);
        try {
            await director.invoke('discordPlayTts', payload.message, payload.context, payload.voice);
            director.log('info', 'TTS playback delegated to DiscordService.');
        } catch (err: any) {
            director.log('error', `TTS Failed: ${err.message}`);
        }
    });

    director.log('info', 'Discord Extension Activated (intent handler registered).');
}

export async function deactivate() {
    // Nothing to clean up — DiscordService owns the connection.
}
