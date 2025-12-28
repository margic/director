/**
 * Director Loop Feature - Type Definitions
 * Based on documents/feature_director_loop.md
 */

export type CommandType = 'WAIT' | 'LOG';

export type LogLevel = 'INFO' | 'WARN' | 'ERROR';

export type DirectorStatus = 'IDLE' | 'BUSY' | 'ERROR';

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

export interface ActiveSessionResponse {
  raceSessionId: string;
  name: string;
  status: 'PLANNED' | 'ACTIVE' | 'COMPLETED' | 'CANCELED';
}

export interface GetNextSequenceResponse {
  sequenceId: string;
  createdAt: string;
  commands: DirectorCommand[];
}
