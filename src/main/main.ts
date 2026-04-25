import { app, BrowserWindow, ipcMain } from 'electron';
import path from 'path';
import { url } from 'inspector';
import { AuthService } from './auth-service';
import { apiConfig } from './auth-config';
import { DirectorOrchestrator } from './director-orchestrator';
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
import { OverlayServer } from './overlay/overlay-server';
import { humanizeIntent } from './overlay/intent-humanizer';
import { SessionManager } from './session-manager';


// Handle creating/removing shortcuts on Windows when installing/uninstalling.
if (require('electron-squirrel-startup')) {
  app.quit();
}

let mainWindow: BrowserWindow | null = null;
let authService: AuthService;
let directorOrchestrator: DirectorOrchestrator;
let sessionManager: SessionManager;
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
let overlayServer: OverlayServer;



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
  // __dirname = dist-electron/main/ → need ../../dist/index.html
  if (app.isPackaged) {
    mainWindow.loadFile(path.join(__dirname, '../../dist/index.html'));
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

  // Initialize SessionManager
  sessionManager = new SessionManager(authService);

  obsService = new ObsService();
  // OBS auto-connect is deferred until extension host starts.
  // See extensionHost.start().then(...) below.
  // Initialize Extension Host with Two-Tier Registry
  intentRegistry = new IntentRegistry();
  capabilityCatalog = new CapabilityCatalog();
  eventBus = new ExtensionEventBus();
  viewRegistry = new ViewRegistry();
  
  // Initialize Overlay Bus
  overlayBus = new OverlayBus();

  // Initialize Overlay Server (HTTP + WebSocket)
  const overlayPort = configService.getAny('overlay.port') as number || 9100;
  overlayServer = new OverlayServer(overlayBus, overlayPort);
  overlayServer.start().catch((err) => {
    console.error('[Main] Overlay server failed to start:', err);
  });
  
  // Use dist-electron/extensions (which is __dirname/../extensions in compiled structure)
  // In development/tsc structure: dist-electron/main/main.js -> dist-electron/extensions
  const extensionsPath = path.join(__dirname, '../extensions');
  extensionHost = new ExtensionHostService(extensionsPath, intentRegistry, eventBus, viewRegistry, authService, capabilityCatalog, overlayBus);

  // Register invoke handlers so extensions can delegate to main-process services
  extensionHost.registerInvokeHandler('discordPlayTts', async ([text, context, voice]) => {
    return discordService.playTts(text, {
      context: {
        type: context?.type || 'race_update',
        urgency: context?.urgency || 'medium',
      },
      voice,
    });
  });

  // Initialize Sequence Executor & Scheduler (must be before DirectorOrchestrator)
  sequenceExecutor = new SequenceExecutor(extensionHost, overlayBus);
  sequenceLibrary = new SequenceLibraryService(capabilityCatalog, authService);
  sequenceExecutor.setSequenceLibrary(sequenceLibrary);
  sequenceScheduler = new SequenceScheduler(sequenceExecutor);

  // Initialize Director Orchestrator — no longer depends on ObsService directly.
  // OBS scene switching is now handled by the obs extension via intents.
  directorOrchestrator = new DirectorOrchestrator(authService, extensionHost, sessionManager, sequenceScheduler, eventBus, sequenceLibrary);

  // Wire SessionManager with capabilities builder and local sequences getter.
  // These depend on extensionHost and sequenceLibrary being initialized.
  sessionManager.setCapabilitiesBuilder(() => {
    const catalog = extensionHost.getCapabilityCatalog();
    const allIntents = catalog.getAllIntents();
    const connections = extensionHost.getConnectionHealth();
    return {
      intents: allIntents.map(entry => ({
        intent: entry.intent.intent,
        extensionId: entry.extensionId,
        active: entry.enabled,
        schema: entry.intent.schema as Record<string, unknown> | undefined,
      })),
      connections,
    };
  });
  sessionManager.setLocalSequencesGetter(async () => {
    const custom = await sequenceLibrary.listSequences({ category: 'custom' });
    const builtin = await sequenceLibrary.listSequences({ category: 'builtin' });
    return [...builtin, ...custom].slice(0, 50);
  });

  // Wire session lifecycle to sequence library — load cloud templates when session is available
  // Templates are generated server-side after check-in, but we attempt to load them early
  // in case a previous check-in already triggered the Planner.
  sessionManager.on('stateChanged', (state: any) => {
    if (state.state === 'selected' && state.selectedSession) {
      sequenceLibrary.setSession(state.selectedSession.raceSessionId).then((result) => {
        console.log(`[Main] Cloud templates for session ${state.selectedSession.raceSessionId}: ${result}`);
      }).catch((err) => {
        console.warn('[Main] Failed to load cloud templates:', err);
      });
    } else if (state.state === 'checked-in' && state.selectedSession) {
      // Refresh templates after check-in (Planner runs asynchronously after checkin)
      sequenceLibrary.setSession(state.selectedSession.raceSessionId).then((result) => {
        console.log(`[Main] Cloud templates after check-in: ${result}`);
      }).catch((err) => {
        console.warn('[Main] Failed to refresh cloud templates after check-in:', err);
      });
    } else if (state.state === 'none' || state.state === 'discovered') {
      sequenceLibrary.clearSession();
    }
  });

  // Initialize Event Mapper
  eventMapper = new EventMapper(eventBus, sequenceScheduler, authService);

  // Register sequence executor overlay contribution
  overlayBus.registerOverlay('sequences', {
    id: 'director-activity',
    region: 'lower-third',
    title: 'Director Activity',
    template: 'ActivityProgress',
  });

  // Forward sequence progress to renderer AND overlay
  sequenceScheduler.on('progress', (progress) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('sequence:progress', progress);
    }

    // Update overlay with sequence progress
    if (progress.currentStep > 0) {
      const data = {
        title: progress.sequenceName,
        step: progress.currentStep,
        total: progress.totalSteps,
        label: humanizeIntent(progress.stepIntent),
      };
      overlayBus.updateOverlay('sequences', 'director-activity', data);
      overlayBus.showOverlay('sequences', 'director-activity');
    }
  });

  // Auto-hide overlay 3 seconds after sequence completes
  sequenceScheduler.on('historyChanged', () => {
    setTimeout(() => {
      overlayBus.hideOverlay('sequences', 'director-activity');
    }, 3000);
  });

  // Start extension host (async)
  extensionHost.start().then(() => {
    // Initialize sequence library after extensions are loaded (needs catalog)
    return sequenceLibrary.initialize();
  }).then(async () => {
    // Auto-connect OBS only if the extension is enabled AND autoConnect is on
    const extStatus = extensionHost.getStatus();
    const obsExtEnabled = extStatus['director-obs']?.active ?? false;
    const obsConfig = configService.get('obs');
    if (obsExtEnabled && obsConfig?.autoConnect) {
      console.log('[Main] OBS extension enabled with autoConnect — connecting...');
      obsService.connect();
    } else {
      console.log(`[Main] OBS auto-connect skipped (enabled=${obsExtEnabled}, autoConnect=${!!obsConfig?.autoConnect})`);
    }

    // Auto-connect Discord only if the extension is enabled AND autoConnect is on
    const discordExtEnabled = extStatus['director-discord']?.active ?? false;
    const discordConfig = configService.get('discord');
    if (discordExtEnabled && discordConfig?.autoConnect) {
      const token = await configService.getSecure('discord.token');
      const channelId = discordConfig?.channelId;
      if (token && channelId) {
        console.log('[Main] Discord extension enabled with autoConnect — connecting...');
        discordService.connect(token, channelId).catch(err => {
          console.error('[Main] Discord auto-connect failed:', err.message);
        });
      } else {
        console.log('[Main] Discord auto-connect skipped (missing token or channelId)');
      }
    } else {
      console.log(`[Main] Discord auto-connect skipped (enabled=${discordExtEnabled}, autoConnect=${!!discordConfig?.autoConnect})`);
    }
  }).catch(err => {
    console.error('Failed to start extension host:', err);
    telemetryService.trackException(err, { component: 'ExtensionHost' });
  });

  // Forward extension events to Renderer, caching last event per eventName
  const extensionEventCache = new Map<string, { extensionId: string; eventName: string; payload: any }>();
  eventBus.on('*', (data: { extensionId: string; eventName: string; payload: any }) => {
    extensionEventCache.set(data.eventName, data);
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('extension:event', data);
    }
  });

  // Forward SessionManager state changes to Renderer via push events
  sessionManager.on('stateChanged', (state) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('session:stateChanged', state);
    }
  });

  ipcMain.handle('extensions:get-last-event', (_event, eventName: string) => {
    return extensionEventCache.get(eventName) ?? null;
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

      // Lifecycle hook: stop/start core services tied to extensions
      if (extensionId === 'director-obs') {
        if (!enabled) {
          console.log('[Main] OBS extension disabled — stopping ObsService.');
          obsService.stop();
        } else {
          // Only auto-connect if preference says so
          const obsConfig = configService.get('obs');
          if (obsConfig?.autoConnect) {
            console.log('[Main] OBS extension enabled — auto-connecting ObsService.');
            obsService.connect();
          }
        }
      }

      if (extensionId === 'director-discord') {
        if (!enabled) {
          console.log('[Main] Discord extension disabled — disconnecting DiscordService.');
          discordService.disconnect();
        } else {
          const discordConfig = configService.get('discord');
          if (discordConfig?.autoConnect) {
            const token = await configService.getSecure('discord.token');
            const channelId = discordConfig?.channelId;
            if (token && channelId) {
              console.log('[Main] Discord extension enabled — auto-connecting DiscordService.');
              discordService.connect(token, channelId).catch(err => {
                console.error('[Main] Discord auto-connect failed:', err.message);
              });
            }
          }
        }
      }

      return true;
  });

  ipcMain.handle('publisher:lookup-config', async (_event, publisherCode: string) => {
    const token = await authService.getAccessToken();
    if (!token) throw new Error('Not authenticated');
    const url = `${apiConfig.baseUrl}${apiConfig.endpoints.publisherConfig(publisherCode)}`;
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`HTTP ${res.status}${body ? ` — ${body}` : ''}`);
    }
    return res.json();
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
      // OBS lifecycle is managed through extensions:set-enabled for director-obs.
      // This path kept for backward compatibility but delegates to extension host.
      if (value) {
        await extensionHost.setExtensionEnabled('director-obs', true);
        const obsConfig = configService.get('obs');
        if (obsConfig?.autoConnect) obsService.connect();
      } else {
        await extensionHost.setExtensionEnabled('director-obs', false);
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

  ipcMain.handle('obs:connect', async () => {
    return obsService.connect();
  });

  ipcMain.handle('obs:disconnect', async () => {
    return obsService.stop();
  });

  ipcMain.handle('obs:get-config', () => {
    return obsService.getConfig();
  });

  ipcMain.handle('obs:save-settings', async (event, settings: { host: string; password?: string; autoConnect: boolean }) => {
    obsService.saveConfig(settings.host, settings.password, settings.autoConnect);
    return true;
  });

  // Director IPC Handlers
  ipcMain.handle('director:set-mode', async (_, mode: 'stopped' | 'manual' | 'auto') => {
    try {
      telemetryService.trackEvent('Director.SetModeRequested', { mode });
      const state = await directorOrchestrator.setMode(mode);
      telemetryService.trackEvent('Director.ModeSet', {
        mode,
        sessionId: state.sessionId || 'none',
      });
      return state;
    } catch (error) {
      telemetryService.trackException(error as Error, { operation: 'director.setMode' });
      throw error;
    }
  });

  ipcMain.handle('director:state', async () => {
    return directorOrchestrator.getState();
  });

  // Legacy handlers for backward compatibility (deprecated)
  ipcMain.handle('director:start', async () => {
    try {
      telemetryService.trackEvent('Director.StartRequested');
      const state = await directorOrchestrator.setMode('auto');
      telemetryService.trackEvent('Director.Started', {
        sessionId: state.sessionId || 'none',
        status: state.status,
      });
      return state;
    } catch (error) {
      telemetryService.trackException(error as Error, { operation: 'director.start' });
      throw error;
    }
  });

  ipcMain.handle('director:stop', async () => {
    try {
      telemetryService.trackEvent('Director.StopRequested');
      const state = await directorOrchestrator.setMode('stopped');
      telemetryService.trackEvent('Director.Stopped', {
        status: state.status,
      });
      return state;
    } catch (error) {
      telemetryService.trackException(error as Error, { operation: 'director.stop' });
      throw error;
    }
  });

  ipcMain.handle('director:status', async () => {
    return directorOrchestrator.getState();
  });

  // Deprecated: Use session:discover instead
  ipcMain.handle('director:list-sessions', async (_, centerId?: string) => {
    console.warn('[IPC] director:list-sessions is deprecated. Use session:discover instead.');
    await sessionManager.discover(centerId);
    return sessionManager.getSessions();
  });

  // Deprecated: Use session:select instead
  ipcMain.handle('director:set-session', async (_, raceSessionId: string) => {
    console.warn('[IPC] director:set-session is deprecated. Use session:select instead.');
    sessionManager.selectSession(raceSessionId);
    return directorOrchestrator.getState();
  });

  ipcMain.handle('director:checkin-session', async (_, raceSessionId: string, options?: { forceCheckin?: boolean }) => {
    try {
      telemetryService.trackEvent('Director.CheckinRequested', { sessionId: raceSessionId });
      return await directorOrchestrator.checkinSession(raceSessionId, options);
    } catch (error) {
      telemetryService.trackException(error as Error, { operation: 'director.checkin' });
      throw error;
    }
  });

  ipcMain.handle('director:wrap-session', async (_, reason?: string) => {
    try {
      telemetryService.trackEvent('Director.WrapRequested');
      return await directorOrchestrator.wrapSession(reason);
    } catch (error) {
      telemetryService.trackException(error as Error, { operation: 'director.wrap' });
      throw error;
    }
  });

  // Session IPC Handlers
  ipcMain.handle('session:state', async () => {
    return sessionManager.getState();
  });

  ipcMain.handle('session:discover', async (_, centerId?: string) => {
    try {
      telemetryService.trackEvent('Session.DiscoverRequested', { centerId: centerId || 'auto' });
      await sessionManager.discover(centerId);
      return sessionManager.getState();
    } catch (error) {
      telemetryService.trackException(error as Error, { operation: 'session.discover' });
      throw error;
    }
  });

  ipcMain.handle('session:select', async (_, raceSessionId: string) => {
    try {
      telemetryService.trackEvent('Session.SelectRequested', { sessionId: raceSessionId });
      sessionManager.selectSession(raceSessionId);
      return sessionManager.getState();
    } catch (error) {
      telemetryService.trackException(error as Error, { operation: 'session.select' });
      throw error;
    }
  });

  ipcMain.handle('session:clear', async () => {
    try {
      telemetryService.trackEvent('Session.ClearRequested');
      await sessionManager.clearSession();
      return sessionManager.getState();
    } catch (error) {
      telemetryService.trackException(error as Error, { operation: 'session.clear' });
      throw error;
    }
  });

  ipcMain.handle('session:checkin', async (_, options?: { forceCheckin?: boolean }) => {
    try {
      telemetryService.trackEvent('Session.CheckinRequested');
      return await sessionManager.checkinSession(options);
    } catch (error) {
      telemetryService.trackException(error as Error, { operation: 'session.checkin' });
      throw error;
    }
  });

  ipcMain.handle('session:wrap', async (_, reason?: string) => {
    try {
      telemetryService.trackEvent('Session.WrapRequested');
      return await sessionManager.wrapSession(reason);
    } catch (error) {
      telemetryService.trackException(error as Error, { operation: 'session.wrap' });
      throw error;
    }
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
  ipcMain.handle('discord:update-voice-preference', async (_, voice: string) => {
    const token = await authService.getAccessToken();
    if (!token) throw new Error('No access token available');
    const url = `${apiConfig.baseUrl}${apiConfig.endpoints.userVoice}`;
    const response = await fetch(url, {
      method: 'PATCH',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ voice }),
    });
    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[Main] Voice preference update failed: ${response.status}`, errorText);
      throw new Error(`Voice preference update failed: ${response.status} ${response.statusText}`);
    }
    return response.json();
  });

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

  ipcMain.handle('sequence:get-executing', async (_, sequenceId: string) => {
    return sequenceScheduler.getExecutingSequence(sequenceId);
  });

  // Overlay IPC
  ipcMain.handle('overlay:getUrl', () => overlayServer.getUrl());
  ipcMain.handle('overlay:getOverlays', () => overlayBus.getOverlays());
  ipcMain.handle('overlay:getRegionAssignments', () => overlayBus.getRegionAssignments());
  ipcMain.handle('overlay:setRegionOwner', (_, region: string, extensionId: string) => {
    overlayBus.setRegionOwner(region as any, extensionId);
    return true;
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
  // Auto-wrap current session on exit
  if (sessionManager) {
    await sessionManager.wrapSession('app-quit').catch(() => {});
  }
  if (overlayServer) {
    await overlayServer.stop();
  }
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
