/**
 * Director Loop Feature - Type Definitions
 * Based on documents/feature_director_loop.md
 */

export type CommandType = 'WAIT' | 'LOG';

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

export type DirectorCommand = WaitCommand | LogCommand;

// --- Sequences ---

export interface DirectorSequence {
  id: string;
  commands: DirectorCommand[];
  metadata?: Record<string, unknown>;
}

// --- API Responses ---

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
  status: 'PLANNED' | 'ACTIVE' | 'COMPLETED' | 'CANCELED';
  centerId: string;
  createdAt?: string;
  scheduledStartTime?: string;
}

export interface ActiveSessionResponse {
  raceSessionId: string;
  name: string;
  status: 'PLANNED' | 'ACTIVE' | 'COMPLETED' | 'CANCELED';
}

export type SequencePriority = 'LOW' | 'NORMAL' | 'HIGH' | 'URGENT';

export interface GetNextSequenceResponse {
  sequenceId: string;
  createdAt: string;
  priority?: SequencePriority;
  commands: DirectorCommand[];
  totalDurationMs?: number;
}
