import OBSWebSocket from 'obs-websocket-js';
import { telemetryService } from './telemetry-service';

export class ObsService {
    private obs: OBSWebSocket;
    private connected: boolean = false;
    private checkInterval: NodeJS.Timeout | null = null;
    private reconnectInterval: NodeJS.Timeout | null = null;
    private missingScenes: string[] = [];
    private availableScenes: string[] = [];

    constructor() {
        this.obs = new OBSWebSocket();
        
        this.obs.on('ConnectionOpened', () => {
            this.connected = true;
            console.log('ObsService: Connected to OBS');
            telemetryService.trackEvent('OBS.Connected');
            this.fetchScenes();
        });

        this.obs.on('ConnectionClosed', (error) => {
            this.connected = false;
            console.log('ObsService: Disconnected from OBS', error);
            telemetryService.trackEvent('OBS.Disconnected', { error: error?.message });
            this.startReconnect();
        });

        this.obs.on('Identified', () => {
            console.log('ObsService: Identified');
        });
    }

    public start() {
        this.connect();
    }

    public stop() {
        if (this.reconnectInterval) {
            clearInterval(this.reconnectInterval);
            this.reconnectInterval = null;
        }
        this.obs.disconnect();
    }

    private async connect() {
        if (this.connected) return;

        const url = process.env.OBS_WS_URL || 'ws://localhost:4455';
        const password = process.env.OBS_WS_PASSWORD || '';

        try {
            await this.obs.connect(url, password);
        } catch (error) {
            console.error('ObsService: Failed to connect', error);
            this.startReconnect();
        }
    }

    private startReconnect() {
        if (this.reconnectInterval) return;

        console.log('ObsService: Starting reconnect loop');
        this.reconnectInterval = setInterval(() => {
            if (!this.connected) {
                this.connect();
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
