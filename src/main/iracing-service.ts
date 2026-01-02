import koffi from 'koffi';

// Constants
const IRSDK_BROADCASTMSG_NAME = 'IRSDK_BROADCASTMSG';
const HWND_BROADCAST = 0xffff;

// Command Constants
export const IRSDK_CAM_SWITCHPOS = 0;
export const IRSDK_CAM_SWITCHNUM = 1;
export const IRSDK_REPLAY_SETSPEED = 3;
export const IRSDK_REPLAY_SETPOS = 4;
export const IRSDK_REPLAY_SEARCH = 5;
export const IRSDK_REPLAY_SETSTATE = 6;

export class IracingService {
    private connected: boolean = false;
    private checkInterval: NodeJS.Timeout | null = null;
    private msgId: number = 0;
    
    // Native functions
    private RegisterWindowMessageA: any;
    private PostMessageA: any;
    private FindWindowA: any;
    private isWindows: boolean;

    constructor() {
        this.isWindows = process.platform === 'win32';
        this.initNativeFunctions();
    }

    private initNativeFunctions() {
        if (!this.isWindows) {
            console.warn('IracingService: Not running on Windows. Native functions disabled.');
            return;
        }

        try {
            const user32 = koffi.load('user32.dll');
            
            this.RegisterWindowMessageA = user32.func('RegisterWindowMessageA', 'uint', ['str']);
            // Using types from spec: ['void *', 'uint', 'uint', 'long']
            this.PostMessageA = user32.func('PostMessageA', 'bool', ['void *', 'uint', 'uint', 'long']);
            this.FindWindowA = user32.func('FindWindowA', 'void *', ['str', 'str']);
            
            // Register the message immediately
            this.msgId = this.RegisterWindowMessageA(IRSDK_BROADCASTMSG_NAME);
            console.log(`IracingService: Registered ${IRSDK_BROADCASTMSG_NAME} with ID: ${this.msgId}`);
        } catch (error) {
            console.error('IracingService: Failed to load user32.dll or register functions', error);
            this.isWindows = false; // Disable if loading fails
        }
    }

    public start() {
        if (this.checkInterval) return;
        
        // Check immediately
        this.checkConnection();
        
        // Poll every 2 seconds
        this.checkInterval = setInterval(() => {
            this.checkConnection();
        }, 2000);
    }

    public stop() {
        if (this.checkInterval) {
            clearInterval(this.checkInterval);
            this.checkInterval = null;
        }
    }

    private checkConnection() {
        if (!this.isWindows) {
            // Mock connection for dev/linux
            // this.connected = true; // Uncomment to test UI in dev
            return;
        }

        try {
            // Try to find by window title "iRacing.com Simulator"
            const handle = this.FindWindowA(null, "iRacing.com Simulator");
            const isRunning = handle !== null && handle !== 0;
            
            if (isRunning !== this.connected) {
                this.connected = isRunning;
                console.log(`IracingService: Connection status changed: ${this.connected}`);
            }
        } catch (error) {
            console.error('IracingService: Error checking connection', error);
        }
    }

    public isConnected(): boolean {
        return this.connected;
    }

    public broadcastMessage(cmd: number, var1: number, var2: number, var3: number = 0) {
        if (!this.isWindows) {
            console.log(`IracingService [MOCK]: Broadcast cmd=${cmd}, var1=${var1}, var2=${var2}, var3=${var3}`);
            return;
        }

        if (!this.msgId) {
            console.error('IracingService: Message ID not registered');
            return;
        }

        try {
            // Packing logic
            // wParam = MAKELONG(cmd, var1) -> Low 16: cmd, High 16: var1
            const wParam = (cmd & 0xFFFF) | ((var1 & 0xFFFF) << 16);
            
            // lParam = var2 (unless var3 is present, then MAKELONG(var3, var2))
            let lParam = var2;
            if (var3 && var3 !== 0) {
                 // MAKELONG(var3, var2) -> Low 16: var3, High 16: var2
                 lParam = (var3 & 0xFFFF) | ((var2 & 0xFFFF) << 16);
            }
            
            this.PostMessageA(HWND_BROADCAST, this.msgId, wParam, lParam);
            console.log(`IracingService: Sent cmd=${cmd}, var1=${var1}, var2=${var2}, var3=${var3}`);
        } catch (error) {
            console.error('IracingService: Error broadcasting message', error);
        }
    }
}
