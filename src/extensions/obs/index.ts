import OBSWebSocket from 'obs-websocket-js';

// The API interface available in the extension host
interface ExtensionAPI {
  settings: Record<string, any>;
  registerIntentHandler(intent: string, handler: (payload: any) => Promise<void>): void;
  emitEvent(event: string, payload: any): void;
  log(level: 'info' | 'warn' | 'error', message: string): void;
}

let obs: OBSWebSocket | null = null;
let connected = false;
let availableScenes: string[] = [];
let reconnectInterval: NodeJS.Timeout | null = null;
let fetchRetryTimeout: NodeJS.Timeout | null = null;
const MAX_FETCH_RETRIES = 3;
const FETCH_RETRY_DELAY_MS = 3000;

export async function activate(director: ExtensionAPI) {
    director.log('info', 'OBS Extension Activating...');

    obs = new OBSWebSocket();

    obs.on('ConnectionOpened', () => {
        connected = true;
        director.log('info', 'Connected to OBS');
        director.emitEvent('obs.connectionStateChanged', { connected: true });
        fetchScenes(director, 0);
    });

    obs.on('ConnectionClosed', () => {
        connected = false;
        availableScenes = [];
        if (fetchRetryTimeout) {
            clearTimeout(fetchRetryTimeout);
            fetchRetryTimeout = null;
        }
        director.log('info', 'Disconnected from OBS');
        director.emitEvent('obs.connectionStateChanged', { connected: false });
        startReconnect(director);
    });

    // Keep scene cache live — OBS fires this when scenes are added/removed/renamed.
    (obs as any).on('SceneListChanged', () => {
        fetchScenes(director, 0);
    });

    // Register Intent: Switch Scene
    director.registerIntentHandler('obs.switchScene', async (payload: { sceneName: string; transition?: string; duration?: number }) => {
        if (!connected || !obs) {
            director.log('warn', `Cannot switch scene: OBS not connected.`);
            return;
        }
        try {
            await obs.call('SetCurrentProgramScene', { sceneName: payload.sceneName });
            director.log('info', `Switched OBS scene to '${payload.sceneName}'`);
            director.emitEvent('obs.scenes', { scenes: availableScenes, connected: true, currentScene: payload.sceneName });
        } catch (err: any) {
            director.log('error', `Failed to switch scene: ${err.message}`);
            throw err;
        }
    });

    // Register Intent: Get Scenes — re-fetches from OBS rather than re-emitting cache.
    director.registerIntentHandler('obs.getScenes', async () => {
        if (connected) {
            await fetchScenes(director, 0);
        } else {
            director.emitEvent('obs.scenes', { scenes: availableScenes, connected });
        }
    });

    // Connect if configured
    const host = director.settings['obs.host'];
    const password = director.settings['obs.password'];

    if (host) {
        connectToObs(host, password, director);
    } else {
        director.log('warn', 'OBS host not configured. Waiting for configuration.');
    }
}

export async function deactivate() {
    if (reconnectInterval) {
        clearInterval(reconnectInterval);
        reconnectInterval = null;
    }
    if (fetchRetryTimeout) {
        clearTimeout(fetchRetryTimeout);
        fetchRetryTimeout = null;
    }
    if (obs) {
        await obs.disconnect();
        obs = null;
    }
    connected = false;
    availableScenes = [];
}

async function connectToObs(host: string, password: string | undefined, director: ExtensionAPI) {
    if (!obs) return;
    try {
        director.log('info', `Connecting to OBS at ${host}...`);
        await obs.connect(host, password || undefined);
    } catch (err: any) {
        director.log('error', `Failed to connect to OBS: ${err.message}`);
        startReconnect(director);
    }
}

function startReconnect(director: ExtensionAPI) {
    if (reconnectInterval) return;
    reconnectInterval = setInterval(() => {
        if (!connected) {
            const host = director.settings['obs.host'];
            const password = director.settings['obs.password'];
            if (host) connectToObs(host, password, director);
        } else {
            if (reconnectInterval) {
                clearInterval(reconnectInterval);
                reconnectInterval = null;
            }
        }
    }, 5000);
}

async function fetchScenes(director: ExtensionAPI, attempt: number): Promise<void> {
    if (!connected || !obs) return;
    try {
        const response = await obs.call('GetSceneList');
        availableScenes = (response.scenes as any[]).map((s: any) => s.sceneName) as string[];
        const currentScene = (response as any).currentProgramSceneName || '';
        director.log('info', `Fetched ${availableScenes.length} scenes, current: ${currentScene}`);
        director.emitEvent('obs.scenes', { scenes: availableScenes, connected: true, currentScene });
        if (fetchRetryTimeout) {
            clearTimeout(fetchRetryTimeout);
            fetchRetryTimeout = null;
        }
    } catch (err: any) {
        director.log('error', `Failed to fetch scenes (attempt ${attempt + 1}/${MAX_FETCH_RETRIES}): ${err.message}`);
        if (attempt + 1 < MAX_FETCH_RETRIES && connected) {
            fetchRetryTimeout = setTimeout(() => {
                fetchRetryTimeout = null;
                fetchScenes(director, attempt + 1);
            }, FETCH_RETRY_DELAY_MS);
        } else {
            director.log('warn', 'Scene fetch failed after all retries; capabilities.scenes will be empty at next check-in.');
        }
    }
}
