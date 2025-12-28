export interface IElectronAPI {
  login: () => Promise<any>;
  getAccount: () => Promise<any>;
  logout: () => Promise<void>;
  directorStart: () => Promise<any>;
  directorStop: () => Promise<any>;
  directorStatus: () => Promise<any>;
}

declare global {
  interface Window {
    electronAPI: IElectronAPI;
  }
}
