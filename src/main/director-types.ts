/**
 * Director Loop Feature - Type Definitions
 * Based on documents/feature_director_loop.md
 * Updated for Intent-based Extension System (feature_sequence_executor.md)
 */

// ============================================================================
// NEW: Portable Sequence Format (Intent-Driven)
// The canonical format for sequence execution. All legacy API responses
// are normalized to this format before execution.
// ============================================================================

/**
 * A single step in a sequence. The executor dispatches based on the `intent`
 * string, not a hardcoded enum. Built-in intents use the `system.` prefix.
 */
export interface SequenceStep {
  id: string;
  intent: string;       // Namespace-scoped Intent ID (e.g. "system.wait", "broadcast.showLiveCam")
  payload: Record<string, unknown>;
  metadata?: {
    label?: string;     // Human-readable label for UI / logging
    timeout?: number;   // Max execution time in ms
  };
}

/**
 * The portable, headless sequence format. The executor does not care
 * how this was created (Visual Editor, AI, API, manual JSON).
 */
export interface PortableSequence {
  id: string;
  name?: string;
  version?: string;
  steps: SequenceStep[];
  metadata?: Record<string, unknown>;
}

// ============================================================================
// LEGACY: API-Compatible Types
// Kept for backward compatibility with the Race Control OpenAPI spec.
// The normalizeApiSequence() function converts these to PortableSequence.
// ============================================================================

export type CommandType = 'WAIT' | 'LOG' | 'SWITCH_CAMERA' | 'SWITCH_OBS_SCENE' | 'DRIVER_TTS' | 'VIEWER_CHAT' | 'EXECUTE_INTENT';

export type LogLevel = 'INFO' | 'WARN' | 'ERROR';

export type DirectorStatus = 'IDLE' | 'BUSY' | 'ERROR';

export interface DirectorState {
  isRunning: boolean;
  status: DirectorStatus;
  sessionId: string | null;
  currentSequenceId?: string | null;
  totalCommands?: number;
  processedCommands?: number;
  lastError?: string;
}

// --- Command Payloads ---

export interface WaitCommandPayload {
  durationMs: number;
}

export interface LogCommandPayload {
  message: string;
  level: LogLevel;
}

export interface SwitchCameraCommandPayload {
  carNumber: string;
  cameraGroupNumber: number;
  cameraGroupName?: string;
}

export interface SwitchObsSceneCommandPayload {
  sceneName: string;
  transition?: string;
  duration?: number;
}

export interface DriverTtsCommandPayload {
  text: string;
  voiceId?: string;
  channelId?: string;
}

export interface ExecuteIntentCommandPayload {
  intent: string;
  payload: any;
}

export interface ViewerChatCommandPayload {
  platform: 'YOUTUBE' | 'TWITCH';
  message: string;
}

// --- Commands ---

export interface BaseCommand {
  id: string;
  type: CommandType;
}

export interface WaitCommand extends BaseCommand {
  type: 'WAIT';
  payload: WaitCommandPayload;
}

export interface LogCommand extends BaseCommand {
  type: 'LOG';
  payload: LogCommandPayload;
}

export interface SwitchCameraCommand extends BaseCommand {
  type: 'SWITCH_CAMERA';
  payload: SwitchCameraCommandPayload;
}

export interface SwitchObsSceneCommand extends BaseCommand {
  type: 'SWITCH_OBS_SCENE';
  payload: SwitchObsSceneCommandPayload;
}

export interface DriverTtsCommand extends BaseCommand {
  type: 'DRIVER_TTS';
  payload: DriverTtsCommandPayload;
}

export interface ViewerChatCommand extends BaseCommand {
  type: 'VIEWER_CHAT';
  payload: ViewerChatCommandPayload;
}

export interface ExecuteIntentCommand extends BaseCommand {
  type: 'EXECUTE_INTENT';
  payload: ExecuteIntentCommandPayload;
}

export type DirectorCommand = 
  | WaitCommand 
  | LogCommand 
  | SwitchCameraCommand 
  | SwitchObsSceneCommand 
  | DriverTtsCommand 
  | ViewerChatCommand
  | ExecuteIntentCommand;

// --- Sequences ---

export interface DirectorSequence {
  id: string;
  commands: DirectorCommand[];
  metadata?: Record<string, unknown>;
}

// --- API Responses ---

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
  simulator?: string;
  directorSceneId?: string;
  drivers?: any[];
  iracing?: any;
  [key: string]: any;
}

export interface ActiveSessionResponse {
  raceSessionId: string;
  name: string;
}

export type SequencePriority = 'LOW' | 'NORMAL' | 'HIGH' | 'URGENT';

export interface GetNextSequenceResponse {
  sequenceId: string;
  createdAt: string;
  priority?: SequencePriority;
  commands: DirectorCommand[];
  totalDurationMs?: number;
}

// --- Extension Protocol ---

export type ExtensionMessageType = 'EXTENSION_INTENT' | 'EXTENSION_EVENT' | 'EXTENSION_STATUS';

export interface ExtensionMessage {
  type: ExtensionMessageType;
}

export interface ExtensionIntentMessage extends ExtensionMessage {
  type: 'EXTENSION_INTENT';
  intent: string; // The intent ID (e.g., 'communication.message')
  payload?: any;  // The intent payload
}

export interface ExtensionEventMessage extends ExtensionMessage {
  type: 'EXTENSION_EVENT';
  data: {
    eventName: string;
    payload: any;
  };
}

export interface ExtensionStatusMessage extends ExtensionMessage {
  type: 'EXTENSION_STATUS';
  data: Record<string, { active: boolean; [key: string]: any }>;
}

// ============================================================================
// API Normalizer
// Converts legacy DirectorCommand[] (from Race Control API) into the
// PortableSequence format consumed by the Sequence Executor.
// ============================================================================

/**
 * Intent mappings for legacy CommandType values.
 * Maps the old enum-based command types to the semantic intent names
 * registered by extensions in their package.json manifests.
 */
const LEGACY_INTENT_MAP: Record<string, string> = {
  'SWITCH_CAMERA': 'broadcast.showLiveCam',
  'SWITCH_OBS_SCENE': 'obs.switchScene',
  'DRIVER_TTS': 'communication.announce',
  'VIEWER_CHAT': 'communication.talkToChat',
};

/**
 * Normalizes a single legacy DirectorCommand into a SequenceStep.
 */
function normalizeCommand(cmd: DirectorCommand, index: number): SequenceStep {
  const id = cmd.id || `step_${index}`;

  switch (cmd.type) {
    case 'WAIT':
      return { id, intent: 'system.wait', payload: { ...cmd.payload } };
    case 'LOG':
      return { id, intent: 'system.log', payload: { ...cmd.payload } };
    case 'EXECUTE_INTENT': {
      // Already intent-based, unwrap
      const intentPayload = cmd.payload as ExecuteIntentCommandPayload;
      return {
        id,
        intent: intentPayload.intent,
        payload: (intentPayload.payload ?? {}) as Record<string, unknown>,
      };
    }
    default: {
      // Map legacy command type to a semantic intent
      const intent = LEGACY_INTENT_MAP[cmd.type];
      if (intent) {
        return { id, intent, payload: { ...cmd.payload } };
      }
      // Unknown command — log a warning step
      return {
        id,
        intent: 'system.log',
        payload: { message: `Unknown legacy command type: ${cmd.type}`, level: 'WARN' },
      };
    }
  }
}

/**
 * Normalizes a legacy DirectorSequence (from API) into a PortableSequence.
 */
export function normalizeApiSequence(legacy: DirectorSequence): PortableSequence {
  return {
    id: legacy.id,
    steps: legacy.commands.map((cmd, i) => normalizeCommand(cmd, i)),
    metadata: legacy.metadata,
  };
}

/**
 * Normalizes a GetNextSequenceResponse (from polling API) into a PortableSequence.
 */
export function normalizeNextSequenceResponse(response: GetNextSequenceResponse): PortableSequence {
  return {
    id: response.sequenceId,
    steps: response.commands.map((cmd, i) => normalizeCommand(cmd, i)),
    metadata: { priority: response.priority },
  };
}

