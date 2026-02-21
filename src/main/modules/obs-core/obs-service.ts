import OBSWebSocket from 'obs-websocket-js';
import { telemetryService } from '../../telemetry-service';
import { configService } from '../../config-service';

export class ObsService {
    private obs: OBSWebSocket;
    private connected: boolean = false;
    private stopping: boolean = false;
    private reconnectInterval: NodeJS.Timeout | null = null;
    private missingScenes: string[] = [];
    private availableScenes: string[] = [];
    private currentHost: string | undefined;
    private currentPassword: string | undefined;

    constructor() {
        this.obs = new OBSWebSocket();
        
        this.obs.on('ConnectionOpened', () => {
            this.connected = true;
            console.log('[ObsService] Connected to OBS');
            telemetryService.trackEvent('OBS.Connected');
        });

        this.obs.on('ConnectionClosed', (error) => {
            this.connected = false;
            if (this.stopping) {
                console.log('[ObsService] Disconnected (manual stop).');
                return;
            }
            console.log('[ObsService] Disconnected from OBS', error?.message || '');
            telemetryService.trackEvent('OBS.Disconnected', { error: error?.message });
            this.startReconnect();
        });

        this.obs.on('Identified', () => {
            console.log('[ObsService] Identified');
            this.fetchScenes();
        });

        // Load saved host/password from config (do NOT auto-connect here)
        const config = configService.get('obs');
        if (config?.host) this.currentHost = config.host;
        if (config?.password) this.currentPassword = config.password;
    }

    /**
     * Attempt to connect using saved or provided credentials.
     * Does not check enabled state — the caller is responsible for that.
     */
    public async connect(host?: string, password?: string) {
        this.stopping = false;

        if (this.connected) {
            console.log('[ObsService] Already connected.');
            return;
        }

        if (host) this.currentHost = host;
        if (password !== undefined) this.currentPassword = password;

        const url = this.currentHost;
        const pass = this.currentPassword || process.env.OBS_WS_PASSWORD || '';

        if (!url) {
            console.log('[ObsService] No host configured. Waiting for configuration.');
            return;
        }

        try {
            console.log(`[ObsService] Connecting to ${url}...`);
            await this.obs.connect(url, pass);
        } catch (error: any) {
            console.error(`[ObsService] Failed to connect: ${error.message}`);
            this.startReconnect();
        }
    }

    /**
     * Disconnect and stop all reconnect attempts.
     */
    public stop() {
        console.log('[ObsService] Stopping...');
        this.stopping = true;

        if (this.reconnectInterval) {
            clearInterval(this.reconnectInterval);
            this.reconnectInterval = null;
        }

        if (this.connected) {
            this.obs.disconnect();
        }

        this.connected = false;
        this.availableScenes = [];
    }

    /** Alias kept for backward compatibility in main.ts config:set handler */
    public start(host?: string, password?: string) {
        this.connect(host, password);
    }

    private startReconnect() {
        if (this.stopping) return;
        if (this.reconnectInterval) return;

        console.log('[ObsService] Starting reconnect loop (every 5 s)');
        this.reconnectInterval = setInterval(() => {
            if (this.stopping) {
                if (this.reconnectInterval) {
                    clearInterval(this.reconnectInterval);
                    this.reconnectInterval = null;
                }
                return;
            }
            if (!this.connected) {
                this.connect();
            } else {
                if (this.reconnectInterval) {
                    clearInterval(this.reconnectInterval);
                    this.reconnectInterval = null;
                }
            }
        }, 5000);
    }

    private async fetchScenes() {
        if (!this.connected) return;

        try {
            const response = await this.obs.call('GetSceneList');
            this.availableScenes = (response.scenes as any[]).map((s: any) => s.sceneName) as string[];
            console.log('[ObsService] Fetched scenes', this.availableScenes);
        } catch (error) {
            console.error('[ObsService] Failed to fetch scenes', error);
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
            console.error(`[ObsService] Failed to switch to scene ${sceneName}`, error);
            throw error;
        }
    }

    public getStatus() {
        return {
            connected: this.connected,
            missingScenes: this.missingScenes,
            availableScenes: this.availableScenes,
            host: this.currentHost || '',
            autoConnect: !!configService.get('obs')?.autoConnect,
        };
    }

    public getConfig() {
        const config = configService.get('obs') || {} as any;
        return {
            host: config.host || '',
            passwordSet: !!config.password,
            autoConnect: !!config.autoConnect,
        };
    }

    public saveConfig(host: string, password: string | undefined, autoConnect: boolean) {
        const current = configService.get('obs') || {} as any;
        current.host = host;
        if (password !== undefined && password !== '') {
            current.password = password;
        }
        current.autoConnect = autoConnect;
        configService.set('obs', current);

        // Update in-memory values
        this.currentHost = host;
        if (password !== undefined && password !== '') {
            this.currentPassword = password;
        }

        console.log(`[ObsService] Config saved — host=${host}, autoConnect=${autoConnect}`);
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
