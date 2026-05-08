import { google } from 'googleapis';
import { OAuth2Client } from 'google-auth-library';
import http from 'http';
import net from 'net';
import url from 'url';

// Define Interface (mirrors the one in types, but local usage)
interface ExtensionAPI {
  settings: Record<string, any>;
  getAuthToken(): Promise<string | null>;
  openScraper(url: string, script?: string): Promise<string>;
  closeScraper(windowId: string): void;
  openExternal(url: string): Promise<void>;
  registerIntentHandler(intent: string, handler: (payload: any) => Promise<void>): void;
  registerScraperMessageHandler(handler: (payload: any) => void): void;
  emitEvent(event: string, payload: any): void;
  updateSetting(key: string, value: any): Promise<void>;
  log(level: 'info' | 'warn' | 'error', message: string): void;
}

const SCOPES = ['https://www.googleapis.com/auth/youtube.force-ssl'];

/** Finds a free TCP port on localhost */
function getFreePort(): Promise<number> {
    return new Promise((resolve, reject) => {
        const srv = net.createServer();
        srv.listen(0, '127.0.0.1', () => {
            const port = (srv.address() as net.AddressInfo).port;
            srv.close(() => resolve(port));
        });
        srv.on('error', reject);
    });
}

let oauth2Client: OAuth2Client | null = null;
let activeScraperId: string | null = null;
let activeLiveChatId: string | null = null;
let directorAPI: ExtensionAPI | null = null;
let monitorInterval: NodeJS.Timeout | null = null;
let stats = {
    messagesReceived: 0,
    messagesSent: 0
};

// Injected into the hidden scraper window to observe new chat messages
const CHAT_OBSERVER_SCRIPT = `
(function() {
    const seen = new Set();
    function extractMessages() {
        const items = document.querySelectorAll('yt-live-chat-text-message-renderer, yt-live-chat-paid-message-renderer');
        items.forEach(el => {
            const id = el.getAttribute('id');
            if (!id || seen.has(id)) return;
            seen.add(id);
            const author = el.querySelector('#author-name')?.textContent?.trim() || 'Unknown';
            const msgEl = el.querySelector('#message');
            const message = msgEl?.textContent?.trim() || '';
            if (message) {
                window.scraperApi.sendChatMessage({ author, message, timestamp: Date.now() });
            }
        });
    }
    const container = document.querySelector('#item-scroller, #items, yt-live-chat-item-list-renderer');
    if (container) {
        const observer = new MutationObserver(extractMessages);
        observer.observe(container, { childList: true, subtree: true });
        extractMessages(); // capture any already-rendered messages
    } else {
        // Fallback: poll until chat container appears
        const poll = setInterval(() => {
            const c = document.querySelector('#item-scroller, #items, yt-live-chat-item-list-renderer');
            if (c) {
                clearInterval(poll);
                const observer = new MutationObserver(extractMessages);
                observer.observe(c, { childList: true, subtree: true });
                extractMessages();
            }
        }, 1000);
    }
})();
`;

export async function activate(director: ExtensionAPI) {
    directorAPI = director;
    director.log('info', 'YouTube Extension Activating...');
    
    // Reset Stats
    stats = { messagesReceived: 0, messagesSent: 0 };

    const clientId = director.settings['youtube.clientId'];
    const clientSecret = director.settings['youtube.clientSecret'];
    const refreshToken = director.settings['youtube.refreshToken'];

    if (clientId && clientSecret) {
        oauth2Client = new google.auth.OAuth2(clientId, clientSecret);
        
        if (refreshToken) {
            oauth2Client.setCredentials({ refresh_token: refreshToken });
            director.log('info', 'YouTube Extension: Credentials loaded.');
            setImmediate(() => director.emitEvent('youtube.auth', { connected: true }));
        } else {
            setImmediate(() => director.emitEvent('youtube.auth', { connected: false }));
        }
    } else {
        director.log('warn', 'YouTube Client ID/Secret missing. Chat capability limited.');
        setImmediate(() => director.emitEvent('youtube.auth', { connected: false }));
    }

    // Register Command Handlers — always registered so the UI can trigger them
    director.registerIntentHandler('director.youtube.login', async (payload: { clientId?: string; clientSecret?: string } = {}) => {
        director.log('info', 'Login command received.');

        // Allow the UI to supply credentials at connect-time (they may have just been saved)
        const resolvedClientId = payload.clientId || director.settings['youtube.clientId'];
        const resolvedClientSecret = payload.clientSecret || director.settings['youtube.clientSecret'];

        if (!resolvedClientId || !resolvedClientSecret) {
            director.log('error', 'Cannot login: YouTube Client ID/Secret not configured in Settings.');
            return;
        }

        // (Re)initialize oauth2Client with the resolved credentials
        oauth2Client = new google.auth.OAuth2(resolvedClientId, resolvedClientSecret);

        await startAuthFlow(director);
    });

    director.registerIntentHandler('director.youtube.logout', async () => {
        await director.updateSetting('youtube.refreshToken', null);
        oauth2Client = null;
        director.log('info', 'Logged out.');
        director.emitEvent('youtube.auth', { connected: false });
    });

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
        
        const broadcast = await getActiveBroadcast(director);
        if (!broadcast.url) {
            const msg = 'No active broadcast found. Start or go live on YouTube first.';
            director.log('error', msg);
            director.emitEvent('youtube.error', { message: msg });
            return;
        }

        activeLiveChatId = broadcast.liveChatId || null;
        activeScraperId = await director.openScraper(broadcast.url, CHAT_OBSERVER_SCRIPT);
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

    // Auto-start monitor if autoConnect is enabled and we have valid credentials
    const autoConnect = director.settings['youtube.autoConnect'];
    if (autoConnect && oauth2Client) {
        director.log('info', 'Auto-start enabled — starting chat monitor...');
        // Defer so all intent handlers are registered first
        setImmediate(async () => {
            const broadcast = await getActiveBroadcast(director);
            if (!broadcast.url) {
                director.log('warn', 'Auto-start: No active broadcast found. Monitor not started.');
                return;
            }
            activeLiveChatId = broadcast.liveChatId || null;
            activeScraperId = await director.openScraper(broadcast.url, CHAT_OBSERVER_SCRIPT);
            director.emitEvent('youtube.status', { monitoring: true });
            broadcastStats(director);
            director.log('info', 'Auto-start: Chat monitor started.');
        });
    }
}

async function getActiveBroadcast(director: ExtensionAPI): Promise<{ url?: string; liveChatId?: string }> {
    if (!oauth2Client) return {};

    try {
        const youtube = google.youtube({ version: 'v3', auth: oauth2Client });
        const response = await youtube.liveBroadcasts.list({
            part: ['snippet', 'id', 'status'],
            broadcastStatus: 'active',
            broadcastType: 'all'
        });

        const items = response.data.items || [];
        if (items.length > 1) {
            director.log('info', `Multiple active broadcasts found (${items.length}). Preferring live over testing.`);
        }
        // Prefer lifeCycleStatus === 'live' over 'testing'
        const broadcast = items.find(b => b.status?.lifeCycleStatus === 'live') ?? items[0];
        if (broadcast && broadcast.id) {
            const liveChatId = broadcast.snippet?.liveChatId;
            director.log('info', `Active broadcast found: ${broadcast.id} (status: ${broadcast.status?.lifeCycleStatus}), liveChatId: ${liveChatId}`);
            return {
                url: `https://www.youtube.com/live_chat?is_popout=1&v=${broadcast.id}`,
                liveChatId: liveChatId ?? undefined,
            };
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

    // If we don't have a cached liveChatId, try to fetch it now
    if (!activeLiveChatId) {
        director.log('info', 'No cached liveChatId — fetching active broadcast...');
        const broadcast = await getActiveBroadcast(director);
        if (!broadcast.liveChatId) {
            director.log('error', 'Cannot send message: No active broadcast with a live chat found.');
            return;
        }
        activeLiveChatId = broadcast.liveChatId;
    }

    try {
        const youtube = google.youtube({ version: 'v3', auth: oauth2Client });
        await youtube.liveChatMessages.insert({
            part: ['snippet'],
            requestBody: {
                snippet: {
                    liveChatId: activeLiveChatId,
                    type: 'textMessageEvent',
                    textMessageDetails: {
                        messageText: text,
                    },
                },
            },
        });
        director.log('info', `Sent chat message: ${text}`);
    } catch (err: any) {
        director.log('error', `Failed to send chat: ${err.message}`);
        // If 403/404, the liveChatId may have changed — clear so it refreshes next time
        if (err.code === 403 || err.code === 404) {
            activeLiveChatId = null;
        }
    }
}

async function startAuthFlow(director: ExtensionAPI) {
    if (!oauth2Client) {
        director.log('error', 'OAuth Client not initialized (Missing Client ID?)');
        return;
    }

    let port: number;
    try {
        port = await getFreePort();
    } catch (err: any) {
        director.log('error', `Could not find a free port for OAuth callback: ${err.message}`);
        return;
    }

    const redirectUri = `http://127.0.0.1:${port}/callback`;

    const authUrl = oauth2Client.generateAuthUrl({
        access_type: 'offline',
        scope: SCOPES,
        redirect_uri: redirectUri,
    });

    director.log('info', `Opening Auth URL (callback on port ${port})`);
    await director.openExternal(authUrl);

    // Create a local server to receive the callback
    const server = http.createServer(async (req, res) => {
        if (!req.url) return;
        const q = url.parse(req.url, true).query;
        if (q.code) {
             director.log('info', 'Auth Code received.');
             res.end('<html><body style="font-family:sans-serif;text-align:center;padding:60px"><h2>Authentication successful!</h2><p>You can close this window.</p></body></html>');
             server.close();
             clearTimeout(timeoutHandle);

             // Exchange code for token
             try {
                 const { tokens } = await oauth2Client!.getToken({ code: q.code as string, redirect_uri: redirectUri });
                 oauth2Client!.setCredentials(tokens);
                 
                 if (tokens.refresh_token) {
                     await director.updateSetting('youtube.refreshToken', tokens.refresh_token);
                     director.log('info', 'Refresh Token saved.');
                 }
                 
                 director.log('info', 'YouTube Authentication Complete.');
                 director.emitEvent('youtube.auth', { connected: true });
             } catch (err: any) {
                 director.log('error', `Failed to retrieve tokens: ${err.message}`);
                 director.emitEvent('youtube.auth', { connected: false });
             }
        } else if (q.error) {
            director.log('error', `OAuth error: ${q.error}`);
            res.end('<html><body style="font-family:sans-serif;text-align:center;padding:60px"><h2>Authentication failed.</h2><p>You can close this window.</p></body></html>');
            server.close();
            clearTimeout(timeoutHandle);
            director.emitEvent('youtube.auth', { connected: false });
        }
    });

    server.on('error', (err: any) => {
        director.log('error', `OAuth callback server error: ${err.message}`);
    });

    // 5-minute timeout — close server if user never completes auth
    const timeoutHandle = setTimeout(() => {
        server.close();
        director.log('warn', 'OAuth callback server timed out after 5 minutes.');
    }, 5 * 60 * 1000);

    server.listen(port, '127.0.0.1', () => {
         director.log('info', `Listening for OAuth callback on port ${port}`);
    });
}
