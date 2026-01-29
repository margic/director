import { utilityProcess, MessageChannelMain, UtilityProcess, ipcMain, BrowserWindow, shell } from 'electron';
import * as path from 'path';
import { randomUUID } from 'crypto';
import { ExtensionScanner, ScannedExtension } from './extension-scanner';
import { IntentRegistry } from './intent-registry';
import { ViewRegistry } from './view-registry';
import { ExtensionEventBus } from './event-bus';
import { IpcMessage, ExecuteIntentPayload, LoadExtensionPayload, InvokePayload } from './extension-types';
import { configService } from '../config-service';
import { AuthService } from '../auth-service';

class ScraperManager {
  private scrapers: Map<string, { window: BrowserWindow, extensionId: string }> = new Map();
  // We need a way to send messages to child process
  private onMessageReceived?: (extensionId: string, data: any) => void;

  constructor(private eventBus: ExtensionEventBus) {
    // Listen for scraper messages
    // We listen to the specific channel the YouTube preload uses
    ipcMain.on('youtube-scraper:message', (event, data) => {
        this.handleScraperMessage(event.sender.id, data);
    });
  }

  public setMessageHandler(handler: (extensionId: string, data: any) => void) {
      this.onMessageReceived = handler;
  }

  private handleScraperMessage(senderId: number, data: any) {
    // Find the scraper belonging to this sender
    for (const [id, info] of this.scrapers.entries()) {
        if (info.window.webContents.id === senderId) {
            // 1. Notify the backend extension process
            if (this.onMessageReceived) {
                this.onMessageReceived(info.extensionId, data);
            }
            
            // 2. Also emit the public event for the UI/Other extensions
            this.eventBus.emitExtensionEvent(info.extensionId, 'chat.messageReceived', data);
            
            console.log(`[ScraperManager] Routed message from scraper ${id} to extension ${info.extensionId}`);
            return;
        }
    }
  }

  async createScraper(extensionId: string, url: string, script?: string): Promise<string> {
    const id = Date.now().toString(); // simple ID
    
    console.log(`[ScraperManager] Creating scraper for ${extensionId} at ${url}`);

    const win = new BrowserWindow({
      show: false, // Hidden
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        preload: path.join(__dirname, '../preload-scraper.js') // Reuse existing scraper preload
      }
    });

    this.scrapers.set(id, { window: win, extensionId });
    
    await win.loadURL(url);
    
    // Inject custom script if provided?
    // win.webContents.executeJavaScript(script);
    
    return id;
  }
}

export class ExtensionHostService {
  private child: UtilityProcess | null = null;
  private scanner: ExtensionScanner;
  private intentRegistry: IntentRegistry;
  private viewRegistry: ViewRegistry;
  private eventBus: ExtensionEventBus;
  private authService: AuthService;
  private scraperManager: ScraperManager;
  private loadedExtensions: Set<string> = new Set();
  // commandId -> extensionId
  private commandHandlers: Map<string, string> = new Map();
  private pendingCommandExecutions: Map<string, { resolve: (res: any) => void; reject: (err: Error) => void }> = new Map();
  
  // Track if we are ready
  private isReady: boolean = false;

  constructor(
    extensionsPath: string, 
    intentRegistry: IntentRegistry,
    eventBus: ExtensionEventBus,
    viewRegistry: ViewRegistry,
    authService: AuthService
  ) {
    this.scanner = new ExtensionScanner(extensionsPath);
    this.intentRegistry = intentRegistry;
    this.eventBus = eventBus;
    this.viewRegistry = viewRegistry;
    this.authService = authService;
    this.scraperManager = new ScraperManager(eventBus);
    
    // Wire up scraper manager to child process
    this.scraperManager.setMessageHandler((extensionId, data) => {
        if (this.child) {
            this.child.postMessage({
                type: 'SCRAPER_MESSAGE',
                payload: { extensionId, data }
            });
        }
    });
  }

  public async start() {
    console.log('[ExtensionHost] Starting Extension Host Process...');
    
    // Resolve path to the compiled extension-process.js
    // Assuming this file is compiled to the same directory
    const entryPoint = path.join(__dirname, 'extension-process.js');
    
    try {
      this.child = utilityProcess.fork(entryPoint, [], {
        serviceName: 'DirectorExtensionHost',
        stdio: 'inherit' // Pipe logs to main process console
      });

      this.child.on('spawn', () => {
        console.log('[ExtensionHost] Child process spawned with PID:', this.child?.pid);
        this.isReady = true;
      });

      this.child.on('exit', (code) => {
        console.warn(`[ExtensionHost] Child process exited with code ${code}.`);
        this.isReady = false;
        this.child = null;
        // TODO: Restart logic?
      });

      this.child.on('message', (msg: IpcMessage) => {
        this.handleMessage(msg);
      });

      // Start scanning and loading
      await this.scanAndLoad();

    } catch (err) {
      console.error('[ExtensionHost] Failed to start child process:', err);
    }
  }

  public async stop() {
    if (this.child) {
      this.child.kill();
      this.child = null;
    }
  }

  public async executeIntent(intent: string, data: any) {
    if (!this.isReady || !this.child) {
      console.warn('[ExtensionHost] Cannot execute intent: Host not ready.');
      return;
    }

    // Check if intent is valid
    const reg = this.intentRegistry.getIntent(intent);
    if (!reg) {
      console.warn(`[ExtensionHost] Unknown intent '${intent}'`);
      return;
    }

    const payload: ExecuteIntentPayload = {
      requestId: randomUUID(), 
      intent,
      data
    };

    const msg: IpcMessage = {
      type: 'EXECUTE_INTENT',
      payload
    };

    this.child.postMessage(msg);
  }

  // executeCommand removed in favor of Intents

  public getViews(type?: 'panel' | 'dialog' | 'overlay' | 'widget') {
      if (type) {
          return this.viewRegistry.getByType(type);
      }
      return this.viewRegistry.getAll();
  }

  public getStatus(): Record<string, { active: boolean; version?: string }> {
    // Return simple status for now. 
    // In future, utility process could send heartbeats.
    const status: Record<string, { active: boolean; version?: string }> = {};
    for (const id of this.loadedExtensions) {
        status[id] = { active: this.isReady, version: '1.0.0' }; // TODO: Read real version
    }
    return status;
  }

  private async scanAndLoad() {
    const extensions = await this.scanner.scan();
    
    for (const ext of extensions) {
      await this.loadExtension(ext);
    }
  }

  private async loadExtension(ext: ScannedExtension) {
    if (this.loadedExtensions.has(ext.id)) return;

    console.log(`[ExtensionHost] Loading extension: ${ext.id}`);

    // Register Intents first
    if (ext.manifest.contributes?.intents) {
      this.intentRegistry.registerIntents(ext.id, ext.manifest.contributes.intents);
    }

    // Register Views
    if (ext.manifest.contributes?.views) {
        if (Array.isArray(ext.manifest.contributes.views)) {
            for (const view of ext.manifest.contributes.views) {
                this.viewRegistry.register(ext.id, ext.path, view);
            }
        } else {
             // Legacy Object support (temporary)
             const views = ext.manifest.contributes.views as any;
             for (const key of Object.keys(views)) {
                 this.viewRegistry.register(ext.id, ext.path, { 
                     id: key, 
                     type: key as any, 
                     path: views[key], 
                     name: key 
                 });
             }
        }
    }

    // Collect Settings
    const settings: Record<string, any> = {};
    if (ext.manifest.contributes?.settings) {
      for (const key of Object.keys(ext.manifest.contributes.settings)) {
        // Try standard config
        let val: any = configService.getAny(key);
        // If simple get fails or we suspect it is secure (convention)
        if (key.toLowerCase().includes('token') || key.toLowerCase().includes('password') || key.toLowerCase().includes('secret')) {
           const secureVal = await configService.getSecure(key);
           if (secureVal) val = secureVal;
        }
        settings[key] = val;
      }
    }

    // Send load command to child
    if (this.isReady && this.child) {
      const payload: LoadExtensionPayload = {
        extensionId: ext.id,
        entryPoint: ext.manifest.main ? path.resolve(ext.path, ext.manifest.main) : ext.path,
        settings
      };

      this.child.postMessage({
        type: 'LOAD_EXTENSION',
        payload
      });

      this.loadedExtensions.add(ext.id);
    }
  }

  private handleMessage(msg: IpcMessage) {
    switch (msg.type) {
      case 'EMIT_EVENT':
        const { extensionId, event, data } = msg.payload;
        this.eventBus.emitExtensionEvent(extensionId, event, data);
        break;
      case 'LOG':
        console.log(`[Ext:${msg.payload.extensionId}] [${msg.payload.level.toUpperCase()}] ${msg.payload.message}`);
        break;
      case 'REGISTER_INTENT':
        // Optional verification
        break;
      case 'REGISTER_COMMAND':
        const cmdPayload = msg.payload;
        this.commandHandlers.set(cmdPayload.command, cmdPayload.extensionId);
        console.log(`[ExtensionHost] Registered command handler for '${cmdPayload.command}' from ${cmdPayload.extensionId}`);
        break;
      case 'COMMAND_RESULT':
        const resultPayload = msg.payload;
        const pending = this.pendingCommandExecutions.get(resultPayload.requestId);
        if (pending) {
            if (resultPayload.error) {
                pending.reject(new Error(resultPayload.error));
            } else {
                pending.resolve(resultPayload.result);
            }
            this.pendingCommandExecutions.delete(resultPayload.requestId);
        }
        break;
      case 'INVOKE':
        this.handleInvoke(msg.payload);
        break;
    }
  }

  private async handleInvoke(payload: InvokePayload) {
    try {
        let result;
        if (payload.method === 'getAuthToken') {
            result = await this.authService.getAccessToken();
        } else if (payload.method === 'openScraper') {
            const [url, script] = payload.args || [];
            // payload.extensionId should be populated
            if (payload.extensionId) {
                result = await this.scraperManager.createScraper(payload.extensionId, url, script);
            } else {
                throw new Error('Extension ID required for openScraper');
            }
        } else if (payload.method === 'openExternal') {
            const [url] = payload.args || [];
            if (url) await shell.openExternal(url);
        } else if (payload.method === 'updateSetting') {
            const [key, value] = payload.args || [];
            if (key) {
                 // Determine if secure by key convention or just save all as secure?
                 // Or just save to standard config.
                 // Legacy service executed configService.setSecure(...) for tokens.
                 if (key.toLowerCase().includes('token') || key.toLowerCase().includes('secret') || key.toLowerCase().includes('password')) {
                     await configService.saveSecure(key, value);
                 } else {
                     configService.set(key, value);
                 }
            }
        } else {
            throw new Error(`Unknown method: ${payload.method}`);
        }
        
        this.child?.postMessage({
            type: 'INVOKE_RESULT',
            payload: { id: payload.id, result }
        });
    } catch (err: any) {
        this.child?.postMessage({
            type: 'INVOKE_RESULT',
            payload: { id: payload.id, error: err.message }
        });
    }
  }
}
