export interface UserProfile {
  userId: string;
  displayName: string;
  username?: string;
  centerId?: string;
  roles?: string[];
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
}

declare global {
  interface Window {
    electronAPI: IElectronAPI;
  }
}
