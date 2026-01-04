
export type CommandType = 'WAIT' | 'LOG' | 'SWITCH_CAMERA' | 'SWITCH_OBS_SCENE' | 'DRIVER_TTS' | 'VIEWER_CHAT';

export type LogLevel = 'INFO' | 'WARN' | 'ERROR';

export type DirectorStatus = 'IDLE' | 'BUSY' | 'ERROR';

export interface DirectorCommand {
  id: string;
  type: CommandType;
  payload: any;
}

export interface DirectorSequence {
  id: string;
  commands: DirectorCommand[];
  durationMs?: number;
  metadata?: Record<string, unknown>;
}

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
}
