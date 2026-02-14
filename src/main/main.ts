import { app, BrowserWindow, ipcMain } from 'electron';
import path from 'path';
import { url } from 'inspector';
import { AuthService } from './auth-service';
import { DirectorService } from './director-service';
import { telemetryService, SEVERITY_MAP } from './telemetry-service';
import { ObsService } from './modules/obs-core/obs-service';
import { discordService } from './discord-service';
import { configService } from './config-service';
import { ExtensionHostService } from './extension-host/extension-host';
import { IntentRegistry } from './extension-host/intent-registry';
import { CapabilityCatalog } from './extension-host/capability-catalog';
import { ExtensionEventBus } from './extension-host/event-bus';
import { ViewRegistry } from './extension-host/view-registry';
import { EventMapper } from './event-mapper';
import { SequenceLibraryService } from './sequence-library-service';
import { SequenceScheduler } from './sequence-scheduler';
import { SequenceExecutor } from './sequence-executor';
import { OverlayBus } from './overlay/overlay-bus';


// Handle creating/removing shortcuts on Windows when installing/uninstalling.
if (require('electron-squirrel-startup')) {
  app.quit();
}

let mainWindow: BrowserWindow | null = null;
let authService: AuthService;
let directorService: DirectorService;
// let iracingService: IracingService;
let obsService: ObsService;
let extensionHost: ExtensionHostService;
let intentRegistry: IntentRegistry;
let capabilityCatalog: CapabilityCatalog;
let eventBus: ExtensionEventBus;
let viewRegistry: ViewRegistry;
let eventMapper: EventMapper;
let sequenceLibrary: SequenceLibraryService;
let sequenceScheduler: SequenceScheduler;
let sequenceExecutor: SequenceExecutor;
let overlayBus: OverlayBus;



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
  discordService.setAuthService(authService);
  discordService.setTelemetryService(telemetryService);

  obsService = new ObsService();
  obsService.start('ws://localhost:4455');
  // Initialize Extension Host with Two-Tier Registry
  intentRegistry = new IntentRegistry();
  capabilityCatalog = new CapabilityCatalog();
  eventBus = new ExtensionEventBus();
  viewRegistry = new ViewRegistry();
  
  // Initialize Overlay Bus
  overlayBus = new OverlayBus();
  
  // Use dist-electron/extensions (which is __dirname/../extensions in compiled structure)
  // In development/tsc structure: dist-electron/main/main.js -> dist-electron/extensions
  const extensionsPath = path.join(__dirname, '../extensions');
  extensionHost = new ExtensionHostService(extensionsPath, intentRegistry, eventBus, viewRegistry, authService, capabilityCatalog, overlayBus);

  // Initialize Director Service — no longer depends on ObsService directly.
  // OBS scene switching is now handled by the obs extension via intents.
  directorService = new DirectorService(authService, extensionHost);

  // Initialize Event Mapper
  eventMapper = new EventMapper(eventBus, directorService);

  // Initialize Sequence Executor & Scheduler
  sequenceExecutor = new SequenceExecutor(extensionHost);
  sequenceLibrary = new SequenceLibraryService(capabilityCatalog);
  sequenceScheduler = new SequenceScheduler(sequenceExecutor);

  // Forward sequence progress to renderer
  sequenceScheduler.on('progress', (progress) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('sequence:progress', progress);
    }
  });

  // Start extension host (async)
  extensionHost.start().then(() => {
    // Initialize sequence library after extensions are loaded (needs catalog)
    return sequenceLibrary.initialize();
  }).catch(err => {
    console.error('Failed to start extension host:', err);
    telemetryService.trackException(err, { component: 'ExtensionHost' });
  });

  // Forward extension events to Renderer
  eventBus.on('*', (data) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('extension:event', data);
    }
  });

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

  // Config IPC Handlers
  ipcMain.handle('config:get', (event, key) => {
    return configService.get(key as any);
  });

  ipcMain.handle('extensions:get-status', () => {
    return extensionHost.getStatus();
  });

  ipcMain.handle('extensions:execute-intent', async (event, intent, data) => {
    return extensionHost.executeIntent(intent, data);
  });

  ipcMain.handle('extensions:get-views', (event, type) => {
      return extensionHost.getViews(type);
  });
  
  ipcMain.handle('extensions:set-enabled', async (event, extensionId, enabled) => {
      await extensionHost.setExtensionEnabled(extensionId, enabled);
      return true;
  });

  ipcMain.handle('config:set', async (event, key, value) => {
    configService.set(key as any, value);

    if (key === 'iracing.enabled') {
      if (value) {
        // iracingService.start();
        // TODO: Enable extension
      } else {
        // iracingService.stop();
        // TODO: Disable extension
      }
    } else if (key === 'obs.enabled') {
      if (value) {
        obsService.start();
      } else {
        obsService.stop();
      }
    }
    // YouTube handling requires more specific service methods, skipping for now to avoid errors
  });

  ipcMain.handle('config:save-secure', async (event, key, value) => {
    return await configService.saveSecure(key, value);
  });

  ipcMain.handle('config:is-secure-set', async (event, key) => {
    return configService.isSecureSet(key);
  });


  // iRacing IPC Handlers - REMOVED (Migrated to Extension)

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

  // Discord IPC
  ipcMain.handle('discord:get-status', () => discordService.getStatus());
  // The UI can ask to "Connect" or "Test Output"
  ipcMain.handle('discord:connect', async (_, token?: string, channelId?: string) => {
    let finalToken = token;
    let finalChannelId = channelId;

    if (!finalToken) {
      finalToken = await configService.getSecure('discord.token') || undefined;
    }
    if (!finalChannelId) {
      const conf = configService.get('discord');
      finalChannelId = conf?.channelId;
    }

    if (!finalToken || !finalChannelId) {
      throw new Error("Missing Discord Token or Channel ID configuration");
    }

    return discordService.connect(finalToken, finalChannelId);
  });
  ipcMain.handle('discord:disconnect', async () => discordService.disconnect());
  ipcMain.handle('discord:send-test', async (_, text: string) => discordService.playTts(text));

  // ============================================================================
  // Sequence Library & Execution IPC Handlers
  // ============================================================================

  ipcMain.handle('sequence:list', async (_, filter?: any) => {
    return sequenceLibrary.listSequences(filter);
  });

  ipcMain.handle('sequence:get', async (_, id: string) => {
    return sequenceLibrary.getSequence(id);
  });

  ipcMain.handle('sequence:save', async (_, sequence: any) => {
    return sequenceLibrary.saveCustomSequence(sequence);
  });

  ipcMain.handle('sequence:delete', async (_, id: string) => {
    return sequenceLibrary.deleteCustomSequence(id);
  });

  ipcMain.handle('sequence:export', async (_, id: string) => {
    return sequenceLibrary.exportSequence(id);
  });

  ipcMain.handle('sequence:import', async (_, json: string) => {
    return sequenceLibrary.importSequence(json);
  });

  ipcMain.handle('sequence:execute', async (_, id: string, variables?: Record<string, unknown>, options?: any) => {
    const sequence = await sequenceLibrary.getSequence(id);
    if (!sequence) throw new Error(`Sequence not found: ${id}`);
    return sequenceScheduler.enqueue(sequence, variables ?? {}, {
      source: options?.source ?? 'manual',
      priority: options?.priority,
    });
  });

  ipcMain.handle('sequence:cancel', async () => {
    return sequenceScheduler.cancelCurrent();
  });

  ipcMain.handle('sequence:cancel-queued', async (_, executionId: string) => {
    return sequenceScheduler.cancelQueued(executionId);
  });

  ipcMain.handle('sequence:queue', async () => {
    return sequenceScheduler.getQueue();
  });

  ipcMain.handle('sequence:history', async () => {
    return sequenceScheduler.getHistory();
  });

  // Capability Catalog IPC
  ipcMain.handle('catalog:intents', async () => {
    return sequenceLibrary.getRegisteredIntents();
  });

  ipcMain.handle('catalog:events', async () => {
    return sequenceLibrary.getRegisteredEvents();
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

app.on('will-quit', async () => {
  if (extensionHost) {
    await extensionHost.stop();
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
