import koffi from 'koffi';

// Define Extension API
interface ExtensionAPI {
  settings: Record<string, any>;
  registerIntentHandler(intent: string, handler: (payload: any) => Promise<void>): void;
  emitEvent(event: string, payload: any): void;
  log(level: 'info' | 'warn' | 'error', message: string): void;
}

// Constants
const IRSDK_BROADCASTMSG_NAME = 'IRSDK_BROADCASTMSG';
const HWND_BROADCAST = 0xffff; 

// Command Constants
const IRSDK_CAM_SWITCHPOS = 0;
const IRSDK_CAM_SWITCHNUM = 1;
const IRSDK_REPLAY_SETSPEED = 3;
const IRSDK_REPLAY_SETPOS = 4;
const IRSDK_REPLAY_SEARCH = 5;
const IRSDK_REPLAY_SETSTATE = 6;

let directorAPI: ExtensionAPI | null = null;
let isWindows = false;
let msgId = 0;

// Native functions
let RegisterWindowMessageA: any = null;
let PostMessageA: any = null;
let FindWindowA: any = null;

let checkInterval: NodeJS.Timeout | null = null;
let isConnected = false;

export async function activate(director: ExtensionAPI) {
    directorAPI = director;
    director.log('info', 'iRacing Extension Activating...');

    const enabled = director.settings['iracing.enabled'] !== false;
    if (!enabled) {
        director.log('info', 'iRacing Extension Disabled via settings.');
        return;
    }

    isWindows = process.platform === 'win32';
    
    // Initialize Native Functions
    initNativeFunctions(director);

    // Register Intents
    director.registerIntentHandler('broadcast.showLiveCam', async (payload: { carNum: string, camGroup?: string, camNum?: string }) => {
        handleShowLiveCam(payload);
    });

    director.registerIntentHandler('broadcast.replayFromTo', async (payload: { startFrame: number, endFrame: number, speed?: number }) => {
        handleReplayFromTo(payload);
    });

    director.registerIntentHandler('broadcast.setReplaySpeed', async (payload: { speed: number }) => {
        broadcastMessage(IRSDK_REPLAY_SETSPEED, payload.speed, 0, 0);
    });

    director.registerIntentHandler('broadcast.setReplayPosition', async (payload: { frame: number }) => {
        broadcastMessage(IRSDK_REPLAY_SETPOS, payload.frame, 0, 0);
    });
    
    director.registerIntentHandler('broadcast.setReplayState', async (payload: { state: number }) => {
        broadcastMessage(IRSDK_REPLAY_SETSTATE, payload.state, 0, 0);
    });

    // Start Polling (if on Windows)
    startPolling(director);
}

function initNativeFunctions(director: ExtensionAPI) {
    if (!isWindows) {
        director.log('warn', 'Not running on Windows. iRacing Native functions mocked.');
        return;
    }

    try {
        const user32 = koffi.load('user32.dll');
        
        RegisterWindowMessageA = user32.func('RegisterWindowMessageA', 'uint', ['str']);
        PostMessageA = user32.func('PostMessageA', 'bool', ['void *', 'uint', 'uint', 'long']);
        FindWindowA = user32.func('FindWindowA', 'void *', ['str', 'str']);
        
        // Register the message immediately
        msgId = RegisterWindowMessageA(IRSDK_BROADCASTMSG_NAME);
        director.log('info', `Registered ${IRSDK_BROADCASTMSG_NAME} with ID: ${msgId}`);
    } catch (error: any) {
        director.log('error', `Failed to load user32.dll: ${error.message}`);
        isWindows = false; 
    }
}

function startPolling(director: ExtensionAPI) {
     if (checkInterval) return;
     checkConnection(director);
     checkInterval = setInterval(() => {
         checkConnection(director);
     }, 2000);
}

function checkConnection(director: ExtensionAPI) {
    if (!isWindows) return;
    try {
        const handle = FindWindowA(null, 'iRacing.com Simulator');
        const running = handle !== null && handle !== 0;
        if (running !== isConnected) {
            isConnected = running;
            director.log('info', `Sim Connection Status: ${isConnected ? 'Connected' : 'Disconnected'}`);
            director.emitEvent('iracing.connectionStateChanged', { connected: isConnected });
        }
    } catch (error: any) {
        director.log('error', `Error checking connection: ${error.message}`);
    }
}

function handleShowLiveCam(payload: { carNum: string, camGroup?: string, camNum?: string }) {
    if (!directorAPI) return;
    const group = payload.camGroup ? parseInt(payload.camGroup) : 0; 
    const carVal = parseInt(payload.carNum);
    directorAPI.log('info', `Switching Cam: Car ${carVal}, Group ${group}`);
    // Legacy: sendCommand(1, car, group) => cmd=1, var1=car, var2=group
    broadcastMessage(IRSDK_CAM_SWITCHNUM, carVal, group, 0);
}

function handleReplayFromTo(payload: { startFrame: number, endFrame: number, speed?: number }) {
    const speed = payload.speed || 1;
    broadcastMessage(IRSDK_REPLAY_SETSPEED, speed, 0, 0); 
    broadcastMessage(IRSDK_REPLAY_SEARCH, payload.startFrame, 0, 0);
}

function broadcastMessage(cmd: number, var1: number, var2: number, var3: number = 0) {
    if (!isWindows) return;
    if (!msgId) {
        directorAPI?.log('warn', 'Message ID not registered');
        return;
    }
    try {
        const wParam = (cmd & 0xFFFF) | ((var1 & 0xFFFF) << 16);
        let lParam = var2;
        if (var3 && var3 !== 0) {
                lParam = (var3 & 0xFFFF) | ((var2 & 0xFFFF) << 16);
        }
        PostMessageA(HWND_BROADCAST, msgId, wParam, lParam);
    } catch (error: any) {
        directorAPI?.log('error', `Broadcast failed: ${error.message}`);
    }
}
