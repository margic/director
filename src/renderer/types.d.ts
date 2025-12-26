export interface IElectronAPI {
  login: () => Promise<any>;
  getAccount: () => Promise<any>;
  logout: () => Promise<void>;
}

declare global {
  interface Window {
    electronAPI: IElectronAPI;
  }
}
