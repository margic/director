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
 * Runtime variable definition for parameterised sequences.
 * Variables use $var(name) substitution-only syntax in step payloads.
 */
export interface SequenceVariable {
  name: string;              // Variable identifier (alphanumeric, camelCase)
  label: string;             // Human-readable label for UI
  type: 'text' | 'number' | 'boolean' | 'select' | 'sessionTime' | 'sessionTick';
  required: boolean;
  default?: unknown;         // Default value (used if not provided)
  description?: string;      // Help text shown in UI
  constraints?: {
    min?: number;            // For number type
    max?: number;            // For number type
    options?: Array<{        // For select type
      label: string;
      value: string;
    }>;
    pattern?: string;        // Regex for string type
  };
  source?: 'user' | 'context' | 'cloud';  // Where the value comes from
  contextKey?: string;       // Dot-path for auto-population from telemetry/session data
}

/**
 * The portable, headless sequence format. The executor does not care
 * how this was created (Visual Editor, AI, API, manual JSON).
 */
export interface PortableSequence {
  id: string;
  name?: string;
  version?: string;
  description?: string;                              // Human-readable description
  category?: 'builtin' | 'cloud' | 'custom';         // Library category
  priority?: boolean;                                 // If true, executes immediately even during Director Loop
  variables?: SequenceVariable[];                     // Runtime variable definitions
  steps: SequenceStep[];
  metadata?: Record<string, unknown>;
}

// ============================================================================
// Sequence Execution Types
// ============================================================================

export interface StepResult {
  stepId: string;
  intent: string;
  status: 'success' | 'skipped' | 'failed';
  durationMs: number;
  message?: string;  // Error message or skip reason
}

export interface ExecutionResult {
  executionId: string;
  sequenceId: string;
  sequenceName: string;
  status: 'completed' | 'partial' | 'failed' | 'cancelled';
  source: 'manual' | 'director-loop' | 'ai-agent' | 'stream-deck' | 'webhook' | 'event-mapper';
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
  log: string;       // Formatted log line
}

export interface QueuedSequence {
  executionId: string;
  sequence: PortableSequence;
  variables: Record<string, unknown>;
  queuedAt: string;
  position: number;
  source: string;
}

export interface ExecutionHistoryConfig {
  maxEntries: number;  // Default: 25
}

export interface SequenceFilter {
  category?: string;
  search?: string;
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
  // Session Check-In lifecycle
  checkinStatus: CheckinStatus;
  checkinId?: string | null;
  sessionConfig?: SessionOperationalConfig | null;
  checkinWarnings?: string[];
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

/**
 * @deprecated The /sequences/next endpoint now returns PortableSequence directly.
 * Kept for backward compatibility with any remaining code paths.
 */
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

// ============================================================================
// Session Check-In Types
// Based on documents/feature_session_claim.md (Session Check-In RFC)
// ============================================================================

export type CheckinStatus = 'unchecked' | 'checking-in' | 'standby' | 'directing' | 'wrapping' | 'error';

export interface ConnectionHealth {
  connected: boolean;
  connectedSince?: string;   // ISO8601
  metadata?: Record<string, unknown>;
}

export interface IntentCapability {
  intent: string;
  extensionId: string;
  active: boolean;
  schema?: Record<string, unknown>;
}

export interface DirectorCapabilities {
  intents: IntentCapability[];
  connections: Record<string, ConnectionHealth>;
}

export interface SessionCheckinRequest {
  directorId: string;
  version: string;
  capabilities: DirectorCapabilities;
  /** Optional: local sequence library for Planner training (max 50, 100KB) */
  sequences?: PortableSequence[];
}

export interface SessionCheckinResponse {
  status: 'standby';
  checkinId: string;
  checkinTtlSeconds: number;
  sessionConfig: SessionOperationalConfig;
  warnings?: string[];
}

export interface SessionOperationalConfig {
  raceSessionId: string;
  name: string;
  status: string;
  simulator: string;
  drivers: SessionDriverMapping[];
  obsScenes: string[];
  obsHost?: string;
  timingConfig?: {
    idleRetryIntervalMs: number;
    retryBackoffMs: number;
  };
}

export interface SessionDriverMapping {
  driverId: string;
  carNumber: string;
  rigId: string;
  obsSceneId: string;
  displayName?: string;
}

export interface SessionCheckinConflict {
  error: string;
  existingCheckin: {
    directorId: string;
    checkedInAt: string;
    expiresAt: string;
    displayName?: string;
  };
}

export interface SessionWrapRequest {
  reason?: string;
}

/**
 * A parameterized sequence blueprint generated by the Planner model at check-in.
 * Contains steps with variable placeholders (e.g., ${targetDriver}) that the
 * Executor model fills with concrete values from live telemetry at runtime.
 */
export interface SequenceTemplate {
  id: string;
  raceSessionId: string;
  name: string;
  description?: string;
  applicability: string;
  priority: 'normal' | 'incident' | 'caution';
  durationRange: {
    min: number;
    max: number;
  };
  steps: SequenceStep[];
  variables: SequenceVariable[];
  source: 'ai-planner' | 'operator-library' | 'hybrid';
  ttl?: number;
}

/** Tunable generation parameters for the AI Director pipeline. */
export interface GenerationParams {
  minSequenceDurationMs?: number;
  maxSequenceDurationMs?: number;
  battleDurationRangeMs?: [number, number];
  soloDurationRangeMs?: [number, number];
  incidentDurationRangeMs?: [number, number];
  leaderDurationRangeMs?: [number, number];
  maxTemplatesPerSession?: number;
  cameraVariety?: 'low' | 'medium' | 'high';
  narrativePriority?: 'battles' | 'leader' | 'balanced';
  plannerModel?: string;
  executorModel?: string;
}

