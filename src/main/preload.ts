import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('electronAPI', {
  login: () => ipcRenderer.invoke('auth:login'),
  getAccount: () => ipcRenderer.invoke('auth:get-account'),
  getUserProfile: () => ipcRenderer.invoke('auth:get-user-profile'),
  logout: () => ipcRenderer.invoke('auth:logout'),
  
  // Director API
  directorStart: () => ipcRenderer.invoke('director:start'),
  directorStop: () => ipcRenderer.invoke('director:stop'),
  directorStatus: () => ipcRenderer.invoke('director:status'),
  directorListSessions: (centerId?: string, status?: string) => 
    ipcRenderer.invoke('director:list-sessions', centerId, status),
  
  // iRacing API
  iracingGetStatus: () => ipcRenderer.invoke('iracing:get-status'),
  iracingSendCommand: (cmd: number, var1: number, var2: number, var3?: number) => 
    ipcRenderer.invoke('iracing:send-command', cmd, var1, var2, var3),
  
  // OBS API
  obsGetStatus: () => ipcRenderer.invoke('obs:get-status'),
  obsGetScenes: () => ipcRenderer.invoke('obs:get-scenes'),
  obsSetScene: (sceneName: string) => ipcRenderer.invoke('obs:set-scene', sceneName),
  
  // Telemetry API
  telemetry: {
    trackEvent: (name: string, properties?: { [key: string]: string }, measurements?: { [key: string]: number }) =>
      ipcRenderer.invoke('telemetry:track-event', name, properties, measurements),
    trackException: (error: { message: string; stack?: string; name: string }, properties?: { [key: string]: string }) =>
      ipcRenderer.invoke('telemetry:track-exception', error, properties),
    trackTrace: (message: string, severity?: string, properties?: { [key: string]: string }) =>
      ipcRenderer.invoke('telemetry:track-trace', message, severity, properties),
  },
});
