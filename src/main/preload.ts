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
});
