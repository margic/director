import { app, BrowserWindow, ipcMain } from 'electron';
import path from 'path';
import { AuthService } from './auth-service';
import { DirectorService } from './director-service';
import { telemetryService, SEVERITY_MAP } from './telemetry-service';
import { IracingService } from './iracing-service';
import { ObsService } from './obs-service';

// Handle creating/removing shortcuts on Windows when installing/uninstalling.
if (require('electron-squirrel-startup')) {
  app.quit();
}

let mainWindow: BrowserWindow | null = null;
let authService: AuthService;
let directorService: DirectorService;
let iracingService: IracingService;
let obsService: ObsService;

const createWindow = () => {
  // Create the browser window.
  mainWindow = new BrowserWindow({
    width: 800,
    height: 600,
    backgroundColor: '#090B10', // Brand background
    icon: path.join(__dirname, '../icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  // In production, load the index.html of the app.
  if (app.isPackaged) {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
  } else {
    // In development, load the vite dev server
    mainWindow.loadURL('http://localhost:5173');
    mainWindow.webContents.openDevTools();
  }
};

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.on('ready', () => {
  // Initialize telemetry first
  telemetryService.initialize();
  telemetryService.trackEvent('Application.Started', {
    platform: process.platform,
    version: app.getVersion(),
  });

  authService = new AuthService();
  iracingService = new IracingService();
  iracingService.start();
  obsService = new ObsService();
  // obsService.start(); // Don't start OBS until we have session info
  directorService = new DirectorService(authService, iracingService, obsService);
  createWindow();

  ipcMain.handle('auth:login', async () => {
    if (mainWindow) {
      try {
        telemetryService.trackEvent('Auth.LoginAttempt');
        const result = await authService.login(mainWindow);
        if (result) {
          telemetryService.trackEvent('Auth.LoginSuccess', {
            userId: result.homeAccountId,
          });
        }
        return result;
      } catch (error) {
        telemetryService.trackException(error as Error, { operation: 'login' });
        throw error;
      }
    }
    return null;
  });

  ipcMain.handle('auth:get-account', async () => {
    return await authService.getAccount();
  });

  ipcMain.handle('auth:get-user-profile', async () => {
    return await authService.getUserProfile();
  });

  ipcMain.handle('auth:logout', async () => {
    try {
      telemetryService.trackEvent('Auth.Logout');
      await authService.logout();
      return true;
    } catch (error) {
      telemetryService.trackException(error as Error, { operation: 'logout' });
      throw error;
    }
  });

  // iRacing IPC Handlers
  ipcMain.handle('iracing:get-status', () => {
    return { connected: iracingService.isConnected() };
  });

  ipcMain.handle('iracing:send-command', (event, cmd, var1, var2, var3) => {
    iracingService.broadcastMessage(cmd, var1, var2, var3);
  });

  // OBS IPC Handlers
  ipcMain.handle('obs:get-status', () => {
    return obsService.getStatus();
  });

  ipcMain.handle('obs:get-scenes', async () => {
    return await obsService.getScenes();
  });

  ipcMain.handle('obs:set-scene', async (event, sceneName) => {
    return await obsService.switchScene(sceneName);
  });

  // Director IPC Handlers
  ipcMain.handle('director:start', async () => {
    try {
      telemetryService.trackEvent('Director.StartRequested');
      await directorService.start();
      const status = directorService.getStatus();
      telemetryService.trackEvent('Director.Started', {
        sessionId: status.sessionId || 'none',
        status: status.status,
      });
      return status;
    } catch (error) {
      telemetryService.trackException(error as Error, { operation: 'director.start' });
      throw error;
    }
  });

  ipcMain.handle('director:stop', async () => {
    try {
      telemetryService.trackEvent('Director.StopRequested');
      directorService.stop();
      const status = directorService.getStatus();
      telemetryService.trackEvent('Director.Stopped', {
        status: status.status,
      });
      return status;
    } catch (error) {
      telemetryService.trackException(error as Error, { operation: 'director.stop' });
      throw error;
    }
  });

  ipcMain.handle('director:status', async () => {
    return directorService.getStatus();
  });

  ipcMain.handle('director:list-sessions', async (_, centerId?: string) => {
    return await directorService.listSessions(centerId);
  });

  // Telemetry IPC Handlers
  ipcMain.handle('telemetry:track-event', async (_, name: string, properties?: { [key: string]: string }, measurements?: { [key: string]: number }) => {
    telemetryService.trackEvent(name, properties, measurements);
    return true;
  });

  ipcMain.handle('telemetry:track-exception', async (_, error: { message: string; stack?: string; name: string }, properties?: { [key: string]: string }) => {
    const err = new Error(error.message);
    err.name = error.name;
    err.stack = error.stack;
    telemetryService.trackException(err, properties);
    return true;
  });

  ipcMain.handle('telemetry:track-trace', async (_, message: string, severity?: string, properties?: { [key: string]: string }) => {
    // Map severity string to KnownSeverityLevel using shared constant
    const severityLevel = severity ? SEVERITY_MAP[severity] : undefined;
    telemetryService.trackTrace(message, severityLevel, properties);
    return true;
  });
});

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on('window-all-closed', async () => {
  if (process.platform !== 'darwin') {
    telemetryService.trackEvent('Application.Quit');
    await telemetryService.flush();
    app.quit();
  }
});

app.on('activate', () => {
  // On OS X it's common to re-create a window in the app when the
  // dock icon is clicked and there are no other windows open.
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

// In this file you can include the rest of your app's specific main process
// code. You can also put them in separate files and import them here.
