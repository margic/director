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

export interface IElectronAPI {
  login: () => Promise<any>;
  getAccount: () => Promise<any>;
  getUserProfile: () => Promise<UserProfile | null>;
  logout: () => Promise<void>;
  directorStart: () => Promise<any>;
  directorStop: () => Promise<any>;
  directorStatus: () => Promise<any>;
  directorListSessions: (centerId?: string, status?: string) => Promise<RaceSession[]>;
  telemetry: {
    trackEvent: (name: string, properties?: { [key: string]: string }, measurements?: { [key: string]: number }) => Promise<boolean>;
    trackException: (error: { message: string; stack?: string; name: string }, properties?: { [key: string]: string }) => Promise<boolean>;
    trackTrace: (message: string, severity?: string, properties?: { [key: string]: string }) => Promise<boolean>;
  };
}

declare global {
  interface Window {
    electronAPI: IElectronAPI;
  }
}
