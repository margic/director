import { google } from 'googleapis';
import { OAuth2Client } from 'google-auth-library';
import http from 'http';
import url from 'url';

// Define Interface (mirrors the one in types, but local usage)
interface ExtensionAPI {
  settings: Record<string, any>;
  getAuthToken(): Promise<string | null>;
  openScraper(url: string, script?: string): Promise<string>;
  closeScraper(windowId: string): void;
  openExternal(url: string): Promise<void>;
  registerIntentHandler(intent: string, handler: (payload: any) => Promise<void>): void;
  registerCommandHandler(command: string, handler: (payload: any) => Promise<any>): void;
  registerScraperMessageHandler(handler: (payload: any) => void): void;
  emitEvent(event: string, payload: any): void;
  updateSetting(key: string, value: any): Promise<void>;
  log(level: 'info' | 'warn' | 'error', message: string): void;
}

const SCOPES = ['https://www.googleapis.com/auth/youtube.force-ssl'];
const REDIRECT_URI = 'http://localhost:3000/callback';

let oauth2Client: OAuth2Client | null = null;
let activeScraperId: string | null = null;
let directorAPI: ExtensionAPI | null = null;
let monitorInterval: NodeJS.Timeout | null = null;
let stats = {
    messagesReceived: 0,
    messagesSent: 0
};

export async function activate(director: ExtensionAPI) {
    directorAPI = director;
    director.log('info', 'YouTube Extension Activating...');
    
    // Reset Stats
    stats = { messagesReceived: 0, messagesSent: 0 };

    const clientId = director.settings['youtube.clientId'];
    const clientSecret = director.settings['youtube.clientSecret'];
    const refreshToken = director.settings['youtube.refreshToken'];

    if (!clientId || !clientSecret) {
        director.log('warn', 'YouTube Client ID/Secret missing. Chat capability limited.');
    } else {
        oauth2Client = new google.auth.OAuth2(clientId, clientSecret, REDIRECT_URI);
        
        if (refreshToken) {
            oauth2Client.setCredentials({ refresh_token: refreshToken });
            director.log('info', 'YouTube Extension: Credentials loaded.');
        }

        // Register Command Handlers
        director.registerIntentHandler('director.youtube.login', async () => {
             director.log('info', 'Login command received.');
             await startAuthFlow(director);
             // return { success: true }; // Intents do not return values
        });

        director.registerIntentHandler('director.youtube.logout', async () => {
             // Logic to clear token
             await director.updateSetting('youtube.refreshToken', null);
             oauth2Client = null;
             director.log('info', 'Logged out.');
             // return { success: true };
        });
    }

    // Register Intent: Talk to Chat
    director.registerIntentHandler('communication.talkToChat', async (payload: { message: string }) => {
        director.log('info', `Sending message to chat: ${payload.message}`);
        await sendMessageToChat(payload.message, director);
        stats.messagesSent++;
        broadcastStats(director);
    });

    // Register Scraper Handler
    director.registerScraperMessageHandler((data) => {
        // Assume data is { author, message, timestamp }
        stats.messagesReceived++;
        broadcastStats(director);
        
        // Log sample
        director.log('info', `[Chat] ${data.author}: ${data.message}`);
    });

    director.registerIntentHandler('youtube.startMonitor', async () => {
        if (activeScraperId) return;
        
        director.log('info', 'Starting YouTube Scraper Monitoring...');
        // TODO: This URL should probably be dynamic/configurable
        // For now, we assume user pastes a live studio URL or we have a way to find it.
        // Or we use the authenticated client to find the broadcast ID and construct the URL.
        
        const broadcast = await getActiveBroadcast(director); // Helper to get URL via API?
        if (!broadcast.url) {
            director.log('error', 'No active broadcast found. Cannot start scraper.');
            return;
        }

        activeScraperId = await director.openScraper(broadcast.url);
        director.emitEvent('youtube.status', { monitoring: true });
        broadcastStats(director);
    });

    director.registerIntentHandler('youtube.stopMonitor', async () => {
        if (activeScraperId) {
            director.closeScraper(activeScraperId);
            activeScraperId = null;
        }
        director.log('info', 'Stopped YouTube Monitoring.');
        director.emitEvent('youtube.status', { monitoring: false });
        broadcastStats(director);
    });

    // Auto-start if channel ID is present
    const channelId = director.settings['youtube.channelId'];
    if (channelId) {
        director.log('info', `Monitoring Channel: ${channelId}`);
    }
}

async function getActiveBroadcast(director: ExtensionAPI): Promise<{ url?: string }> {
    if (!oauth2Client) return {};

    try {
        const youtube = google.youtube({ version: 'v3', auth: oauth2Client });
        const response = await youtube.liveBroadcasts.list({
            part: ['snippet', 'id'],
            broadcastStatus: 'active',
            broadcastType: 'all'
        });

        const broadcast = response.data.items?.[0];
        if (broadcast && broadcast.id) {
             // Return the popout chat URL
             return { url: `https://www.youtube.com/live_chat?is_popout=1&v=${broadcast.id}` };
        }
    } catch (err: any) {
        director.log('error', `Failed to find broadcast: ${err.message}`);
    }
    return {};
}

function broadcastStats(director: ExtensionAPI) {
    director.emitEvent('youtube.stats', stats);
}

// Remove old checkBroadcastStatus and replace with generic stats emitter
async function checkBroadcastStatus(director: ExtensionAPI) {
    // Deprecated in favor of scraper + stats
}

async function sendMessageToChat(text: string, director: ExtensionAPI) {
    if (!oauth2Client) {
        director.log('error', 'Cannot send message: Not authenticated.');
        return;
    }

    try {
        // 1. Get Live Chat ID (requires finding active broadcast)
        // For MVP, if we don't have it, we fail.
        // In full impl, 'fetchActiveVideos' logic goes here.
        director.log('warn', 'sendMessageToChat not fully implemented in extension yet (Migration in progress)');

    } catch (err: any) {
        director.log('error', `Failed to send chat: ${err.message}`);
    }
}

async function startAuthFlow(director: ExtensionAPI) {
    if (!oauth2Client) {
        director.log('error', 'OAuth Client not initialized (Missing Client ID?)');
        return;
    }

    const authUrl = oauth2Client.generateAuthUrl({
        access_type: 'offline',
        scope: SCOPES,
    });

    director.log('info', `Opening Auth URL: ${authUrl}`);
    await director.openExternal(authUrl);

    // Create a local server to receive the callback
    const server = http.createServer(async (req, res) => {
        if (!req.url) return;
        const q = url.parse(req.url, true).query;
        if (q.code) {
             director.log('info', 'Auth Code received.');
             res.end('Authentication successful! You can close this window.');
             server.close();

             // Exchange code for token
             try {
                 const { tokens } = await oauth2Client!.getToken(q.code as string);
                 oauth2Client!.setCredentials(tokens);
                 
                 if (tokens.refresh_token) {
                     await director.updateSetting('youtube.refreshToken', tokens.refresh_token);
                     director.log('info', 'Refresh Token saved.');
                 }
                 
                 director.log('info', 'YouTube Authentication Complete.');
             } catch (err) {
                 director.log('error', 'Failed to retrieve tokens');
             }
        }
    });

    server.listen(3000, () => {
         director.log('info', 'Listening for Auth Callback on port 3000');
    });
}
