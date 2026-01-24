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
  emitEvent(event: string, payload: any): void;
  updateSetting(key: string, value: any): Promise<void>;
  log(level: 'info' | 'warn' | 'error', message: string): void;
}

const SCOPES = ['https://www.googleapis.com/auth/youtube.force-ssl'];
const REDIRECT_URI = 'http://localhost:3000/callback';

let oauth2Client: OAuth2Client | null = null;
let activeScraperId: string | null = null;
let directorAPI: ExtensionAPI | null = null;

export async function activate(director: ExtensionAPI) {
    directorAPI = director;
    director.log('info', 'YouTube Extension Activating...');

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

        // Register Auth Handlers? 
        // We lack a direct "Command" system for extensions to expose backend functions to UI easily
        // besides Intents. 
        // For now, we'll watch for a specific 'system' intent or just assume the 'Command' triggers this?
        // Let's register a synthetic intent for Login
        director.registerIntentHandler('system.extension.login', async (payload: { extensionId: string }) => {
             if (payload.extensionId === 'director-youtube') {
                 await startAuthFlow(director);
             }
        });
    }

    // Register Intent: Talk to Chat
    director.registerIntentHandler('communication.talkToChat', async (payload: { message: string }) => {
        director.log('info', `Sending message to chat: ${payload.message}`);
        await sendMessageToChat(payload.message, director);
    });

    // Determine if we should start scraping?
    // Maybe an intent 'youtube.monitorChat'? Or just startup?
    // Let's check settings.
    const channelId = director.settings['youtube.channelId'];
    if (channelId) {
        // We can try to find live video and open scraper.
        // For now, let's just log. Implementing the full robust Poller here is step 2.
        director.log('info', `Monitoring Channel: ${channelId}`);
    }
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
