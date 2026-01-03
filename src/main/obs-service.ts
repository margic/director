import OBSWebSocket from 'obs-websocket-js';
import { telemetryService } from './telemetry-service';

export class ObsService {
    private obs: OBSWebSocket;
    private connected: boolean = false;
    private checkInterval: NodeJS.Timeout | null = null;
    private reconnectInterval: NodeJS.Timeout | null = null;
    private missingScenes: string[] = [];
    private availableScenes: string[] = [];
    private currentHost: string | undefined;
    private currentPassword: string | undefined;

    constructor() {
        this.obs = new OBSWebSocket();
        
        this.obs.on('ConnectionOpened', () => {
            this.connected = true;
            console.log('ObsService: Connected to OBS');
            telemetryService.trackEvent('OBS.Connected');
        });

        this.obs.on('ConnectionClosed', (error) => {
            this.connected = false;
            console.log('ObsService: Disconnected from OBS', error);
            telemetryService.trackEvent('OBS.Disconnected', { error: error?.message });
            this.startReconnect();
        });

        this.obs.on('Identified', () => {
            console.log('ObsService: Identified');
            this.fetchScenes();
        });
    }

    public start(host?: string, password?: string) {
        this.connect(host, password);
    }

    public stop() {
        if (this.reconnectInterval) {
            clearInterval(this.reconnectInterval);
            this.reconnectInterval = null;
        }
        this.obs.disconnect();
    }

    public async connect(host?: string, password?: string) {
        // If already connected to the same host, do nothing
        // For now, we just check if connected. 
        // TODO: Handle switching hosts if already connected to a different one.
        if (this.connected) {
             // If a new host is provided and it's different, we might want to reconnect.
             // For simplicity, if we are connected, we assume it's fine unless explicitly stopped.
             // But if the session changes, we might need to force reconnect.
             // Let's assume for now we disconnect if we want to change hosts.
             return;
        }

        if (host) this.currentHost = host;
        if (password) this.currentPassword = password;

        const url = this.currentHost;
        const pass = this.currentPassword || process.env.OBS_WS_PASSWORD || '';

        if (!url) {
            console.log('ObsService: No host provided. Waiting for configuration.');
            return;
        }

        try {
            console.log(`ObsService: Connecting to ${url}...`);
            await this.obs.connect(url, pass);
        } catch (error) {
            console.error('ObsService: Failed to connect', error);
            this.startReconnect(url, pass);
        }
    }

    private startReconnect(url?: string, password?: string) {
        if (this.reconnectInterval) return;

        console.log('ObsService: Starting reconnect loop');
        this.reconnectInterval = setInterval(() => {
            if (!this.connected) {
                // Pass the same credentials to reconnect
                this.connect(url, password);
            } else {
                if (this.reconnectInterval) {
                    clearInterval(this.reconnectInterval);
                    this.reconnectInterval = null;
                }
            }
        }, 5000); // Retry every 5 seconds
    }

    private async fetchScenes() {
        if (!this.connected) return;

        try {
            const response = await this.obs.call('GetSceneList');
            // @ts-ignore - obs-websocket-js types might be slightly off or need specific version
            this.availableScenes = response.scenes.map((s: any) => s.sceneName) as string[];
            console.log('ObsService: Fetched scenes', this.availableScenes);
        } catch (error) {
            console.error('ObsService: Failed to fetch scenes', error);
        }
    }

    public async switchScene(sceneName: string) {
        if (!this.connected) {
            throw new Error('OBS not connected');
        }

        try {
            await this.obs.call('SetCurrentProgramScene', { sceneName });
            telemetryService.trackEvent('OBS.SwitchScene', { sceneName });
        } catch (error) {
            console.error(`ObsService: Failed to switch to scene ${sceneName}`, error);
            throw error;
        }
    }

    public getStatus() {
        return {
            connected: this.connected,
            missingScenes: this.missingScenes,
            availableScenes: this.availableScenes
        };
    }

    public validateScenes(requiredScenes: string[]) {
        this.missingScenes = requiredScenes.filter(scene => !this.availableScenes.includes(scene));
        return this.missingScenes;
    }
    
    public async getScenes(): Promise<string[]> {
        if (!this.connected) return [];
        if (this.availableScenes.length === 0) {
             await this.fetchScenes();
        }
        return this.availableScenes;
    }
}
