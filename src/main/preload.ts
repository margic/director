import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('electronAPI', {
  // Config API
  config: {
      get: (key: string) => ipcRenderer.invoke('config:get', key),
      set: (key: string, value: any) => ipcRenderer.invoke('config:set', key, value),
      saveSecure: (key: string, value: string) => ipcRenderer.invoke('config:save-secure', key, value),
      isSecureSet: (key: string) => ipcRenderer.invoke('config:is-secure-set', key),
  },

  login: () => ipcRenderer.invoke('auth:login'),
  getAccount: () => ipcRenderer.invoke('auth:get-account'),
  getUserProfile: () => ipcRenderer.invoke('auth:get-user-profile'),
  logout: () => ipcRenderer.invoke('auth:logout'),
  
  // Director API
  directorStart: () => ipcRenderer.invoke('director:start'),
  directorStop: () => ipcRenderer.invoke('director:stop'),
  directorStatus: () => ipcRenderer.invoke('director:status'),
  directorListSessions: (centerId?: string) => 
    ipcRenderer.invoke('director:list-sessions', centerId),
  
  // iRacing API
  iracingGetStatus: () => ipcRenderer.invoke('iracing:get-status'),
  iracingSendCommand: (cmd: number, var1: number, var2: number, var3?: number) => 
    ipcRenderer.invoke('iracing:send-command', cmd, var1, var2, var3),
  
  // OBS API
  obsGetStatus: () => ipcRenderer.invoke('obs:get-status'),
  obsGetScenes: () => ipcRenderer.invoke('obs:get-scenes'),
  obsSetScene: (sceneName: string) => ipcRenderer.invoke('obs:set-scene', sceneName),
  
  // Discord API
  discordGetStatus: () => ipcRenderer.invoke('discord:get-status'),
  discordConnect: (token: string, channelId: string) => ipcRenderer.invoke('discord:connect', token, channelId),
  discordDisconnect: () => ipcRenderer.invoke('discord:disconnect'),
  discordSendTest: (text: string) => ipcRenderer.invoke('discord:send-test', text),
  
  // Telemetry API
  telemetry: {
    trackEvent: (name: string, properties?: { [key: string]: string }, measurements?: { [key: string]: number }) =>
      ipcRenderer.invoke('telemetry:track-event', name, properties, measurements),
    trackException: (error: { message: string; stack?: string; name: string }, properties?: { [key: string]: string }) =>
      ipcRenderer.invoke('telemetry:track-exception', error, properties),
    trackTrace: (message: string, severity?: string, properties?: { [key: string]: string }) =>
      ipcRenderer.invoke('telemetry:track-trace', message, severity, properties),
  },

  // YouTube API
  youtube: {
    getStatus: () => ipcRenderer.invoke('youtube:get-status'),
    startAuth: () => ipcRenderer.invoke('youtube:auth-start'),
    signOut: () => ipcRenderer.invoke('youtube:auth-signout'),
    searchVideos: (channelId: string) => ipcRenderer.invoke('youtube:search-videos', channelId),
    setVideo: (videoId: string) => ipcRenderer.invoke('youtube:set-video', videoId),
    onStatusChange: (callback: (status: any) => void) => {
        const subscription = (_: any, status: any) => callback(status);
        ipcRenderer.on('youtube:status-change', subscription);
        return () => ipcRenderer.removeListener('youtube:status-change', subscription);
    }
  }
});
