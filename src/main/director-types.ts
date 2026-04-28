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

export type LogLevel = 'INFO' | 'WARN' | 'ERROR';

export type DirectorStatus = 'IDLE' | 'BUSY' | 'ERROR';

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
  /** Human-readable description passed verbatim to the Planner LLM (issue #112). */
  description?: string;
}

/** iRacing camera group — maps a human-readable name to its numeric SDK ID. */
export interface CameraGroup {
  groupNum: number;
  groupName: string;
}

/** Driver discovered at runtime from the simulator session. */
export interface CapabilityDriver {
  carNumber: string;
  userName: string;
  carName: string;
}

export interface DirectorCapabilities {
  intents: IntentCapability[];
  connections: Record<string, ConnectionHealth>;
  /** iRacing camera groups cached from the SDK at check-in time. */
  cameraGroups?: CameraGroup[];
  /** Available OBS scenes discovered via GetSceneList at check-in time. */
  scenes?: string[];
  /** Drivers in the current simulator session at check-in time. */
  drivers?: CapabilityDriver[];
  /**
   * Per-extension AI context prose blocks (issue #113).
   * Race Control injects these verbatim into the Planner prompt
   * under a dedicated EXTENSION CONTEXT section.
   */
  extensionContexts?: Array<{ extensionId: string; aiContext: string }>;
}

export interface SessionCheckinRequest {
  directorId: string;
  version: string;
  capabilities: DirectorCapabilities;
  /** Optional: local sequence library for Planner training (max 50, 100KB) */
  sequences?: PortableSequence[];
  /** Optional: live simulator snapshot at check-in time (issue #114). Enables Planner phase-weighting. */
  raceContext?: RaceContext;
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
  checkinId?: string;
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

/**
 * Live race context sent with every POST .../sequences/next request.
 * Mirrors the RC API's RaceContext schema (OpenAPI spec).
 */
export interface RaceContext {
  /** Current session type, e.g. "Race", "Practice", "Qualify". Required. */
  sessionType: string;
  /** Current flag state as a string, e.g. "green", "caution", "red", "disconnected". Required. */
  sessionFlags: string;
  /** Remaining laps; -1 if unlimited. Required. */
  lapsRemain: number;
  /** Number of cars currently on track. Required. */
  carCount: number;
  /** ISO-8601 timestamp when this context snapshot was taken. */
  contextTimestamp: string;
  /** Caution scope when in caution state. */
  cautionType?: 'local' | 'fullCourse' | 'none';
  /** Seconds remaining in the session; omit if lap-count session. */
  timeRemainSec?: number;
  /** Lap number of the race leader. */
  leaderLap?: number;
  /** Total laps for this session; omit if unlimited. */
  totalLaps?: number;
  /** Car number of the currently focused/spectated car. */
  focusedCarNumber?: string;
  /** Name of the current OBS scene. */
  currentObsScene?: string;
  /** Active battles: pairs of car numbers within a gap threshold. */
  battles?: Array<{ cars: string[]; gapSec: number }>;
  /** Car numbers currently in pit road. */
  pitting?: string[];
  /** Track display name. */
  trackName?: string;
  /** Type of track layout, e.g. "oval", "road". */
  trackType?: string;
  /** Series name. */
  seriesName?: string;
  /** Per-driver context for AI decision making. */
  drivers?: Array<{
    carNumber: string;
    gapToAhead: number;
    lapsCompleted: number;
    bestLap: number;
    classPosition: number;
    /** Overall track position (1-indexed). From CarIdxPosition[carIdx]. */
    pos?: number;
    /** Driver display name. From DriverInfo.Drivers[carIdx].UserName. */
    driverName?: string;
    /** Car class short name (e.g. "MX5", "GT3"). From CarClassShortName. */
    carClass?: string;
    /** Whether the car is on the racing surface (not pitting/off-world). */
    isOnTrack?: boolean;
    /** Last completed lap time in seconds. From CarIdxLastLapTime[carIdx]. */
    lastLap?: number;
  }>;
  /**
   * Higher-order narrative events synthesized by the Director Agent since the
   * previous sequences/next request. Derived entirely from local shared memory
   * — no cloud round-trip required.
   */
  recentEvents?: Array<{
    /** Event classifier. E.g. "LEADER_CHANGE", "LAPS_MILESTONE", "BATTLE_APPROACHING". */
    type: string;
    /** Plain-English description for the AI planner. */
    description: string;
    /** ISO-8601 timestamp when the event was detected. */
    timestamp: string;
    /** Car most directly relevant to this event, if applicable. */
    carNumber?: string;
    /** Structured data for programmatic use by the AI planner. */
    data?: Record<string, unknown>;
  }>;
  /** Laps the focused driver has been on-track since their last pit stop (stint age). */
  stintLaps?: number;
}

/**
 * Request body for POST .../sequences/next.
 */
export interface NextSequenceRequest {
  /** Live race context snapshot. Required. */
  raceContext: RaceContext;
  /** ID of the last completed sequence, for chaining/logging. */
  lastSequenceId?: string;
  /** Comma-separated or array of active intent handlers. */
  intents?: string | string[];
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

