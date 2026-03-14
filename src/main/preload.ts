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
  directorListSessions: (centerId?: string) => ipcRenderer.invoke('director:list-sessions', centerId),
  directorSetSession: (raceSessionId: string) => ipcRenderer.invoke('director:set-session', raceSessionId),
  
  // OBS API
  obsGetStatus: () => ipcRenderer.invoke('obs:get-status'),
  obsGetScenes: () => ipcRenderer.invoke('obs:get-scenes'),
  obsSetScene: (sceneName: string) => ipcRenderer.invoke('obs:set-scene', sceneName),
  obsConnect: () => ipcRenderer.invoke('obs:connect'),
  obsDisconnect: () => ipcRenderer.invoke('obs:disconnect'),
  obsGetConfig: () => ipcRenderer.invoke('obs:get-config'),
  obsSaveSettings: (settings: { host: string; password?: string; autoConnect: boolean }) => ipcRenderer.invoke('obs:save-settings', settings),
  
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

  // Extension API (Unified)
  extensions: {
      getStatus: () => ipcRenderer.invoke('extensions:get-status'),
      setEnabled: (id: string, enabled: boolean) => ipcRenderer.invoke('extensions:set-enabled', id, enabled),
      getViews: (type?: string) => ipcRenderer.invoke('extensions:get-views', type),
      executeIntent: (intent: string, data: any) => ipcRenderer.invoke('extensions:execute-intent', intent, data),
      getLastEvent: (eventName: string) => ipcRenderer.invoke('extensions:get-last-event', eventName),
      onExtensionEvent: (callback: (data: any) => void) => {
        const subscription = (_: any, data: any) => callback(data);
        ipcRenderer.on('extension:event', subscription);
        // Return unsubscribe function
        return () => ipcRenderer.removeListener('extension:event', subscription);
      }
  },

  // Sequence Library & Execution API
  sequences: {
      list: (filter?: any) => ipcRenderer.invoke('sequence:list', filter),
      get: (id: string) => ipcRenderer.invoke('sequence:get', id),
      save: (sequence: any) => ipcRenderer.invoke('sequence:save', sequence),
      delete: (id: string) => ipcRenderer.invoke('sequence:delete', id),
      export: (id: string) => ipcRenderer.invoke('sequence:export', id),
      import: (json: string) => ipcRenderer.invoke('sequence:import', json),
      execute: (id: string, variables?: Record<string, unknown>, options?: any) =>
        ipcRenderer.invoke('sequence:execute', id, variables, options),
      cancel: () => ipcRenderer.invoke('sequence:cancel'),
      cancelQueued: (executionId: string) => ipcRenderer.invoke('sequence:cancel-queued', executionId),
      queue: () => ipcRenderer.invoke('sequence:queue'),
      history: () => ipcRenderer.invoke('sequence:history'),
      onProgress: (callback: (progress: any) => void) => {
        const subscription = (_: any, progress: any) => callback(progress);
        ipcRenderer.on('sequence:progress', subscription);
        return () => ipcRenderer.removeListener('sequence:progress', subscription);
      },
  },

  // Capability Catalog API
  catalog: {
      intents: () => ipcRenderer.invoke('catalog:intents'),
      events: () => ipcRenderer.invoke('catalog:events'),
  },

  // Overlay API
  overlay: {
      getUrl: () => ipcRenderer.invoke('overlay:getUrl'),
      getOverlays: () => ipcRenderer.invoke('overlay:getOverlays'),
      getRegionAssignments: () => ipcRenderer.invoke('overlay:getRegionAssignments'),
      setRegionOwner: (region: string, extensionId: string) =>
        ipcRenderer.invoke('overlay:setRegionOwner', region, extensionId),
  },
});
