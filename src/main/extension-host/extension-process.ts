import { ExtensionAPI, IpcMessage, LoadExtensionPayload, ExecuteIntentPayload } from './extension-types';
import { randomUUID } from 'crypto';

// Wrapper for the API exposed to extensions
class ExtensionApiImpl implements ExtensionAPI {
  private extensionId: string;
  public settings: Record<string, any>;

  constructor(extensionId: string, settings: Record<string, any> = {}) {
    this.extensionId = extensionId;
    this.settings = settings;
  }

  getAuthToken(): Promise<string | null> {
    return ExtensionProcess.invoke('getAuthToken', [], this.extensionId);
  }

  openScraper(url: string, script?: string): Promise<string> {
    return ExtensionProcess.invoke('openScraper', [url, script], this.extensionId);
  }

  closeScraper(windowId: string): void {
    ExtensionProcess.invoke('closeScraper', [windowId], this.extensionId); // Fire and forget or await?
  }

  openExternal(url: string): Promise<void> {
    return ExtensionProcess.invoke('openExternal', [url], this.extensionId);
  }

  registerIntentHandler(intent: string, handler: (payload: any) => Promise<void>): void {
    // We store the handler locally in the process map
    ExtensionProcess.registerIntentHandler(this.extensionId, intent, handler);
    
    // Notify main process that we support this intent (optional, mainly for verification)
    // Note: The main process already knows from the manifest, this just confirms the code is ready.
    ExtensionProcess.send({
      type: 'REGISTER_INTENT',
      payload: { intent }
    });
  }

  // COMMAND Handlers removed


  registerScraperMessageHandler(handler: (payload: any) => void): void {
      ExtensionProcess.registerScraperHandler(this.extensionId, handler);
  }

  emitEvent(event: string, payload: any): void {
    ExtensionProcess.send({
      type: 'EMIT_EVENT',
      payload: { extensionId: this.extensionId, event, data: payload }
    });
  }

  updateSetting(key: string, value: any): Promise<void> {
    return ExtensionProcess.invoke('updateSetting', [key, value], this.extensionId);
  }

  log(level: 'info' | 'warn' | 'error', message: string): void {
    ExtensionProcess.send({
      type: 'LOG',
      payload: { level, message, extensionId: this.extensionId }
    });
  }
}

// Global state for the process
class ExtensionProcess {
  // intent -> handler
  private static intentHandlers = new Map<string, (payload: any) => Promise<void>>();
  // command -> handler
  private static commandHandlers = new Map<string, (payload: any) => Promise<any>>();
  // scraper listener
  private static scraperHandlers = new Map<string, (payload: any) => void>();
  
  private static pendingInvokes = new Map<string, {resolve: (val: any) => void, reject: (err: Error) => void}>();
  
  public static registerIntentHandler(extensionId: string, intent: string, handler: (payload: any) => Promise<void>) {
    this.intentHandlers.set(intent, handler);
  }

  public static registerCommandHandler(extensionId: string, command: string, handler: (payload: any) => Promise<any>) {
    this.commandHandlers.set(command, handler);
  }

  public static registerScraperHandler(extensionId: string, handler: (payload: any) => void) {
      this.scraperHandlers.set(extensionId, handler);
  }

  public static async invoke(method: string, args: any[] = [], extensionId?: string): Promise<any> {
    const id = randomUUID();
    return new Promise((resolve, reject) => {
        this.pendingInvokes.set(id, { resolve, reject });
        this.send({
            type: 'INVOKE',
            payload: { id, method, args, extensionId }
        });
    });
  }

  public static send(msg: IpcMessage) {
    if (process.parentPort) {
      process.parentPort.postMessage(msg);
    }
  }

  public static async handleMessage(msg: IpcMessage) {
    if (msg.type === 'INVOKE_RESULT') {
        const { id, result, error } = msg.payload;
        const pending = this.pendingInvokes.get(id);
        if (pending) {
            if (error) pending.reject(new Error(error));
            else pending.resolve(result);
            this.pendingInvokes.delete(id);
        }
        return;
    }

    switch (msg.type) {
      case 'LOAD_EXTENSION':
        await this.loadExtension(msg.payload as LoadExtensionPayload);
        break;
      case 'EXECUTE_INTENT':
        await this.executeIntent(msg.payload as ExecuteIntentPayload);
        break;
      // EXECUTE_COMMAND case removed
      case 'SCRAPER_MESSAGE':
        const handler = this.scraperHandlers.get(msg.payload.extensionId);
        if (handler) {
            handler(msg.payload.data);
        }
        break;
    }
  }

  private static async loadExtension(payload: LoadExtensionPayload) {
    try {
      console.log(`[ExtProcess] Loading extension ${payload.extensionId} from ${payload.entryPoint}`);
      // Dynamic require
      // Note: In a bundled Electron app, this path must exist on disk.
      const extensionModule = require(payload.entryPoint);
      
      if (typeof extensionModule.activate !== 'function') {
         throw new Error(`Extension ${payload.extensionId} does not export an 'activate' function.`);
      }

      const api = new ExtensionApiImpl(payload.extensionId, payload.settings);
      await extensionModule.activate(api);
      
      console.log(`[ExtProcess] Extension ${payload.extensionId} activated.`);
    } catch (err: any) {
      console.error(`[ExtProcess] Failed to load extension ${payload.extensionId}`, err);
      this.send({
        type: 'LOG',
        payload: { level: 'error', message: `Failed to load ${payload.extensionId}: ${err.message}` }
      });
    }
  }

  private static async executeIntent(payload: ExecuteIntentPayload) {
    const handler = this.intentHandlers.get(payload.intent);
    if (!handler) {
      console.warn(`[ExtProcess] No handler found for intent ${payload.intent}`);
      return;
    }
    
    try {
      await handler(payload.data);
      // We could send a success acknowledgement if needed
    } catch (err: any) {
      console.error(`[ExtProcess] Error executing intent ${payload.intent}`, err);
      this.send({
        type: 'LOG',
        payload: { level: 'error', message: `Error executing intent ${payload.intent}: ${err.message}` }
      });
    }
  }

  // executeCommand removed in favor of Intents
}

// Setup Listener
if (process.parentPort) {
  process.parentPort.on('message', (e) => {
    const msg = e.data as IpcMessage;
    ExtensionProcess.handleMessage(msg);
  });
} else {
  console.error("Extension Process started without parent port!");
}
