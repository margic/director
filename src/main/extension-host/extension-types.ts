export interface ExtensionManifest {
  name: string;
  version: string;
  main: string;
  description?: string;
  contributes?: {
    intents?: IntentContribution[];
    events?: EventContribution[];
    settings?: Record<string, any>;
    views?: ViewContribution[];
  };
}

export interface ViewContribution {
  id: string;
  name: string;
  type: 'panel' | 'dialog' | 'overlay';
  path?: string;
}

export interface IntentContribution {
  intent: string; // e.g. "communication.announce"
  title: string;
  description?: string;
  schema?: object; // JSON Schema for payload validation
}

export interface EventContribution {
  event: string; // e.g. "streamdeck.buttonPressed"
  title: string;
  description?: string;
  schema?: object; // JSON Schema for event payload
}

// The API exposed globally to the extension code (e.g. `director.api...`)
export interface ExtensionAPI {
  settings: Record<string, any>;
  
  // Get Authentication Token (if available)
  getAuthToken(): Promise<string | null>;

  // Scraper Capability
  openScraper(url: string, script?: string): Promise<string>; // Returns windowId
  closeScraper(windowId: string): void;
  
  // System Capability
  openExternal(url: string): Promise<void>;

  // Register a handler for a specific intent
  registerIntentHandler(intent: string, handler: (payload: any) => Promise<void>): void;
  
  // Emit an event to the Core
  emitEvent(event: string, payload: any): void;

  // Persist a setting
  updateSetting(key: string, value: any): Promise<void>;
  
  // Log to the Director console
  log(level: 'info' | 'warn' | 'error', message: string): void;
}

// IPC Messages
export type IpcMessageType = 'LOAD_EXTENSION' | 'EXECUTE_INTENT' | 'REGISTER_INTENT' | 'EMIT_EVENT' | 'LOG' | 'INVOKE' | 'INVOKE_RESULT';

export interface IpcMessage {
  type: IpcMessageType;
  payload: any;
}

export interface InvokePayload {
  id: string;
  method: string;
  extensionId?: string;
  args?: any[];
}

export interface InvokeResultPayload {
  id: string;
  result?: any;
  error?: string;
}

export interface LoadExtensionPayload {
  extensionId: string;
  entryPoint: string; // Absolute path to main JS file
  settings?: Record<string, any>;
}

export interface ExecuteIntentPayload {
  requestId: string;
  intent: string;
  data: any;
}

export interface RegisterIntentPayload {
  intent: string;
}

export interface EmitEventPayload {
  extensionId: string;
  event: string;
  data: any;
}

export interface LogPayload {
  level: 'info' | 'warn' | 'error';
  message: string;
  extensionId?: string;
}
