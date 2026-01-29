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

export interface IElectronAPI {
  login: () => Promise<any>;
  getAccount: () => Promise<any>;
  getUserProfile: () => Promise<UserProfile | null>;
  logout: () => Promise<void>;
  directorStart: () => Promise<any>;
  directorStop: () => Promise<any>;
  directorStatus: () => Promise<any>;
  directorListSessions: (centerId?: string) => Promise<RaceSession[]>;
  obsGetStatus: () => Promise<{ connected: boolean; missingScenes: string[]; availableScenes: string[] }>;
  obsGetScenes: () => Promise<string[]>;
  obsSetScene: (sceneName: string) => Promise<void>;
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
      getViews: (type?: 'panel' | 'dialog' | 'overlay' | 'widget') => Promise<any[]>;
      executeIntent: (intent: string, data: any) => Promise<any>;
      executeCommand: (command: string, args?: any) => Promise<any>;
      onExtensionEvent: (callback: (data: { extensionId: string; eventName: string; payload: any }) => void) => () => void;
  };
}

declare global {
  interface Window {
    electronAPI: IElectronAPI;
  }
}

