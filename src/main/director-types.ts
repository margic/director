/**
 * Director Loop Feature - Type Definitions
 * Based on documents/feature_director_loop.md
 */

export type CommandType = 'WAIT' | 'LOG' | 'SWITCH_CAMERA' | 'SWITCH_OBS_SCENE' | 'DRIVER_TTS' | 'VIEWER_CHAT';

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
  currentSequence?: DirectorSequence | null;
  sequenceStartedAt?: number | null;
  currentCommand?: DirectorCommand | null;
  lastCommand?: DirectorCommand | null;
  recentSequences?: DirectorSequence[];
  totalSequencesProcessed?: number;
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

export interface ViewerChatCommandPayload {
  platform: 'YOUTUBE' | 'TWITCH';
  message: string;
}

// --- Commands ---

export interface BaseCommand {
  id: string;
  type: CommandType;
  offsetMs?: number;
  durationMs?: number;
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

export type DirectorCommand = 
  | WaitCommand 
  | LogCommand 
  | SwitchCameraCommand 
  | SwitchObsSceneCommand 
  | DriverTtsCommand 
  | ViewerChatCommand;

// --- Sequences ---

export interface DirectorSequence {
  id: string;
  commands: DirectorCommand[];
  durationMs?: number;
  metadata?: Record<string, unknown>;
  raceSessionId?: string;
  generatedAt?: string;
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
