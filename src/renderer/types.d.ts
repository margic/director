export interface CameraConfig {
  id: string;
  name: string;
  groupNumber: number;
  cameraNumber?: number;
}

export interface CenterSettings {
  theme?: string;
  locale?: string;
  timezone?: string;
  features?: {
    autoDirector?: boolean;
    replayEnabled?: boolean;
    [key: string]: any;
  };
  branding?: {
    logoUrl?: string;
    primaryColor?: string;
    [key: string]: any;
  };
  cameras?: CameraConfig[];
  [key: string]: any;
}

export interface Center {
  id: string;
  name: string;
  settings?: CenterSettings;
}

export interface UserProfile {
  userId: string;
  displayName: string;
  username?: string;
  centerId?: string;
  roles?: string[];
  center?: Center;
}

export interface RaceSession {
  raceSessionId: string;
  name: string;
  centerId: string;
  createdAt?: string;
  scheduledStart?: string;
  settings?: CenterSettings;
  obsHost?: string;
  obsPassword?: string;
  [key: string]: any;
}

// ============================================================================
// Sequence Types (mirrors director-types.ts for renderer consumption)
// ============================================================================

export interface SequenceVariable {
  name: string;
  label: string;
  type: 'string' | 'number' | 'boolean' | 'select' | 'sessionTime' | 'sessionTick';
  required: boolean;
  default?: unknown;
  description?: string;
  constraints?: {
    min?: number;
    max?: number;
    options?: Array<{ label: string; value: string }>;
    pattern?: string;
  };
  source?: 'user' | 'context';
  contextKey?: string;
}

export interface SequenceStep {
  id: string;
  intent: string;
  payload: Record<string, unknown>;
  metadata?: {
    label?: string;
    timeout?: number;
  };
}

export interface PortableSequence {
  id: string;
  name?: string;
  version?: string;
  description?: string;
  category?: 'builtin' | 'cloud' | 'custom';
  priority?: boolean;
  variables?: SequenceVariable[];
  steps: SequenceStep[];
  metadata?: Record<string, unknown>;
}

export interface SequenceFilter {
  category?: string;
  search?: string;
}

export interface StepResult {
  stepId: string;
  intent: string;
  status: 'success' | 'skipped' | 'failed';
  durationMs: number;
  message?: string;
}

export interface ExecutionResult {
  executionId: string;
  sequenceId: string;
  sequenceName: string;
  status: 'completed' | 'partial' | 'failed' | 'cancelled';
  source: string;
  priority: boolean;
  startedAt: string;
  completedAt: string;
  totalDurationMs: number;
  resolvedVariables: Record<string, unknown>;
  steps: StepResult[];
}

export interface SequenceProgress {
  executionId: string;
  sequenceId: string;
  sequenceName: string;
  currentStep: number;
  totalSteps: number;
  stepIntent: string;
  stepStatus: 'running' | 'success' | 'skipped' | 'failed';
  log: string;
}

export interface QueuedSequence {
  executionId: string;
  sequence: PortableSequence;
  variables: Record<string, unknown>;
  queuedAt: string;
  position: number;
  source: string;
}

export interface IntentCatalogEntry {
  intentId: string;
  label?: string;
  extensionId: string;
  extensionLabel?: string;
  inputSchema?: Record<string, unknown>;
  active: boolean;
}

export interface EventCatalogEntry {
  eventId: string;
  label?: string;
  extensionId: string;
  extensionLabel?: string;
  payloadSchema?: Record<string, unknown>;
}

export interface IElectronAPI {
  login: () => Promise<any>;
  getAccount: () => Promise<any>;
  getUserProfile: () => Promise<UserProfile | null>;
  logout: () => Promise<void>;
  directorSetMode: (mode: 'stopped' | 'manual' | 'auto') => Promise<any>;
  directorState: () => Promise<any>;
  directorStart: () => Promise<any>;
  directorStop: () => Promise<any>;
  directorStatus: () => Promise<any>;
  directorListSessions: (centerId?: string) => Promise<RaceSession[]>;
  directorCheckinSession: (raceSessionId: string, options?: { forceCheckin?: boolean }) => Promise<any>;
  directorWrapSession: (reason?: string) => Promise<any>;
  obsGetStatus: () => Promise<{ connected: boolean; missingScenes: string[]; availableScenes: string[]; currentScene: string; host: string; autoConnect: boolean }>;
  obsGetScenes: () => Promise<string[]>;
  obsSetScene: (sceneName: string) => Promise<void>;
  obsConnect: () => Promise<void>;
  obsDisconnect: () => Promise<void>;
  obsGetConfig: () => Promise<{ host: string; passwordSet: boolean; autoConnect: boolean }>;
  obsSaveSettings: (settings: { host: string; password?: string; autoConnect: boolean }) => Promise<boolean>;
  discordGetStatus: () => Promise<{ connected: boolean; channelName?: string; lastMessage?: string; messagesSent: number }>;
  discordConnect: (token?: string, channelId?: string) => Promise<void>;
  discordDisconnect: () => Promise<void>;
  discordSendTest: (text: string) => Promise<void>;
  config: {
    get: (key: string) => Promise<any>;
    set: (key: string, value: any) => Promise<void>;
    saveSecure: (key: string, value: string) => Promise<boolean>;
    isSecureSet: (key: string) => Promise<boolean>;
  };
  extensions: {
      getStatus: () => Promise<Record<string, { active: boolean; version?: string }>>;
      setEnabled: (id: string, enabled: boolean) => Promise<void>;
      getViews: (type?: 'panel' | 'dialog' | 'overlay' | 'widget') => Promise<any[]>;
      executeIntent: (intent: string, data: any) => Promise<any>;
      getLastEvent: (eventName: string) => Promise<{ extensionId: string; eventName: string; payload: any } | null>;
      onExtensionEvent: (callback: (data: { extensionId: string; eventName: string; payload: any }) => void) => () => void;
  };
  sequences: {
      list: (filter?: SequenceFilter) => Promise<PortableSequence[]>;
      get: (id: string) => Promise<PortableSequence | null>;
      save: (sequence: PortableSequence) => Promise<void>;
      delete: (id: string) => Promise<void>;
      export: (id: string) => Promise<string>;
      import: (json: string) => Promise<PortableSequence>;
      execute: (id: string, variables?: Record<string, unknown>, options?: { priority?: boolean; source?: string }) => Promise<string>;
      cancel: () => Promise<void>;
      cancelQueued: (executionId: string) => Promise<void>;
      queue: () => Promise<QueuedSequence[]>;
      history: () => Promise<ExecutionResult[]>;
      onProgress: (callback: (progress: SequenceProgress) => void) => () => void;
  };
  catalog: {
      intents: () => Promise<IntentCatalogEntry[]>;
      events: () => Promise<EventCatalogEntry[]>;
  };
  overlay: {
      getUrl: () => Promise<string>;
      getOverlays: () => Promise<any[]>;
      getRegionAssignments: () => Promise<Record<string, string>>;
      setRegionOwner: (region: string, extensionId: string) => Promise<boolean>;
  };
}

declare global {
  interface Window {
    electronAPI: IElectronAPI;
  }
}

