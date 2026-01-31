export interface ExtensionManifest {
  name: string;
  version: string;
  main: string;
  description?: string;
  contributes?: {
    intents?: IntentContribution[];
    commands?: CommandContribution[];
    events?: EventContribution[];
    settings?: Record<string, any>;
    views?: ViewContribution[];
  };
}

export interface CommandContribution {
  command: string; // e.g. "director.youtube.login"
  title: string;
  description?: string;
}

export interface ViewContribution {
  id: string; // unique relative id e.g. "status-card"
  name: string;
  type: 'panel' | 'dialog' | 'overlay' | 'widget';
  path?: string; // e.g. "dist/widget.html"
  width?: number; // for widgets (cols)
  height?: number; // for widgets (rows)
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
  
  // Platform Capabilities
  registerScraperMessageHandler(handler: (payload: any) => void): void;

  // System Capability
  openExternal(url: string): Promise<void>;

  // Register a handler for a specific intent
  registerIntentHandler(intent: string, handler: (payload: any) => Promise<void>): void;

  // registerCommandHandler removed
  
  // Emit an event to the Core
  emitEvent(event: string, payload: any): void;

  // Persist a setting
  updateSetting(key: string, value: any): Promise<void>;
  
  // Log to the Director console
  log(level: 'info' | 'warn' | 'error', message: string): void;
}

// IPC Messages
export type IpcMessageType = 
  | 'LOAD_EXTENSION' 
  | 'UNLOAD_EXTENSION'
  | 'EXECUTE_INTENT' 
  | 'REGISTER_INTENT' 
  | 'EXECUTE_COMMAND'
  | 'REGISTER_COMMAND'
  | 'COMMAND_RESULT'
  | 'EMIT_EVENT' 
  | 'LOG' 
  | 'INVOKE' 
  | 'INVOKE_RESULT'
  | 'SCRAPER_MESSAGE';

export interface IpcMessage {
  type: IpcMessageType;
  payload: any;
}

export interface ExecuteCommandPayload {
  requestId: string;
  command: string;
  args: any;
}

export interface RegisterCommandPayload {
    command: string;
    extensionId: string;
}

export interface CommandResultPayload {
    requestId: string;
    result?: any;
    error?: string;
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
