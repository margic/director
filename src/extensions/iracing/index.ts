import koffi from 'koffi';
import yaml from 'js-yaml';
import { resolveCameraGroup } from './camera-utils';
import { assembleTelemetryFrame, getTelemetryIntervalMs } from './telemetry-frame';
import type { RawTelemetryReads } from './telemetry-frame';
import type { TelemetryFrame } from './publisher/session-state';
import { PublisherOrchestrator } from './publisher/orchestrator';

// Extension manifest version — bump in package.json when changing capabilities.
// Kept as a literal because tsconfig.main.json doesn't enable resolveJsonModule.
const EXTENSION_VERSION = '1.0.0';

// Define Extension API (must match ExtensionApiImpl in extension-process.ts)
interface ExtensionAPI {
  settings: Record<string, any>;
  getAuthToken(): Promise<string | null>;
  registerIntentHandler(intent: string, handler: (payload: any) => Promise<void>): void;
  emitEvent(event: string, payload: any): void;
  log(level: 'info' | 'warn' | 'error', message: string): void;
  updateOverlay(overlayId: string, data: Record<string, unknown>): void;
  showOverlay(overlayId: string): void;
  hideOverlay(overlayId: string): void;
}

// --- Session Data Types ---
interface CameraGroup {
  groupNum: number;
  groupName: string;
  isScenic?: boolean;
}

interface DriverEntry {
  carIdx: number;
  carNumber: string;
  userName: string;
  teamName: string;
  carName: string;
  carClassName: string;
}

interface SessionInfoResult {
  cameraGroups: CameraGroup[];
  drivers: DriverEntry[];
  trackName: string;
  sessionLaps: number;
}

// --- Telemetry Types ---
const IRSDK_BOOL = 1;
const IRSDK_INT = 2;
const IRSDK_BITFIELD = 3;
const IRSDK_FLOAT = 4;
const IRSDK_DOUBLE = 5;
const VAR_HEADER_SIZE = 144; // bytes per variable header entry

interface VarHeader {
  type: number;
  offset: number;
  count: number;
  name: string;
}

interface FullHeader {
  ver: number;
  status: number;
  tickRate: number;
  sessionInfoUpdate: number;
  sessionInfoLen: number;
  sessionInfoOffset: number;
  numVars: number;
  varHeaderOffset: number;
  numBuf: number;
  bufLen: number;
}

interface RaceCarState {
  carIdx: number;
  carNumber: string;
  driverName: string;
  carClass: string;
  position: number;
  classPosition: number;
  lapDistPct: number;
  gapToLeader: number;
  gapToCarAhead: number;
  onPitRoad: boolean;
  lapsCompleted: number;
  lastLapTime: number;
  bestLapTime: number;
}

interface RaceState {
  cars: RaceCarState[];
  focusedCarIdx: number;
  sessionFlags: number;
  sessionLapsRemain: number;
  sessionTimeRemain: number;
  leaderLap: number;
  totalSessionLaps: number;
  trackName: string;
}

// Constants
const IRSDK_BROADCASTMSG_NAME = 'IRSDK_BROADCASTMSG';
const HWND_BROADCAST = 0xffff; 
const IRSDK_MEMMAPFILENAME = 'Local\\IRSDKMemMapFileName';
const FILE_MAP_READ = 0x0004;

// Command Constants
const IRSDK_CAM_SWITCHPOS = 0;
const IRSDK_CAM_SWITCHNUM = 1;
const IRSDK_REPLAY_SETSPEED = 3;
const IRSDK_REPLAY_SETPOS = 4;
const IRSDK_REPLAY_SEARCH = 5;
const IRSDK_REPLAY_SETSTATE = 6;

let directorAPI: ExtensionAPI | null = null;
let isWindows = false;
let msgId = 0;

// Native functions — user32
let RegisterWindowMessageA: any = null;
let PostMessageA: any = null;
let FindWindowA: any = null;

// Native functions — kernel32 (shared memory)
let OpenFileMappingA: any = null;
let MapViewOfFile: any = null;
let UnmapViewOfFile: any = null;
let CloseHandle: any = null;

// Shared memory state
let hMap: any = null;
let pBase: any = null;
let lastSessionInfoUpdate = -1;
let cachedCameraGroups: CameraGroup[] = [];
let cachedDrivers: DriverEntry[] = [];

let checkInterval: NodeJS.Timeout | null = null;
let isConnected = false;
let lastFlagState: string | null = null;

// Publisher pipeline callback — set via registerTelemetryFrameCallback()
type TelemetryFrameCallback = (frame: TelemetryFrame) => void;
let telemetryFrameCallback: TelemetryFrameCallback | null = null;

/**
 * Register a callback to receive a TelemetryFrame snapshot on each telemetry
 * poll tick. Called by the publisher pipeline (wired in a later issue).
 * Pass null to unregister.
 */
export function registerTelemetryFrameCallback(cb: TelemetryFrameCallback | null): void {
    telemetryFrameCallback = cb;
}

// Telemetry state
let varHeaders: Map<string, VarHeader> = new Map();
let lastVarHeaderCount = -1;
let telemetryInterval: NodeJS.Timeout | null = null;
let cachedTrackName = '';
let cachedSessionLaps = 0;

// Publisher orchestrator (issue #106) — instantiated at activate(), drives the
// detector + transport pipeline. Null when the extension is inactive.
let publisherOrchestrator: PublisherOrchestrator | null = null;

export async function activate(director: ExtensionAPI) {
    directorAPI = director;
    director.log('info', 'iRacing Extension Activating...');

    const enabled = director.settings['iracing.enabled'] !== false;
    if (!enabled) {
        director.log('info', 'iRacing Extension Disabled via settings.');
        return;
    }

    isWindows = process.platform === 'win32';

    // Initialize Native Functions
    initNativeFunctions(director);

    // Register Intents
    director.registerIntentHandler('broadcast.showLiveCam', async (payload: { carNum: string, camGroup?: string, camNum?: string }) => {
        handleShowLiveCam(payload);
    });

    director.registerIntentHandler('broadcast.replayFromTo', async (payload: { startFrame: number, endFrame: number, speed?: number }) => {
        handleReplayFromTo(payload);
    });

    director.registerIntentHandler('broadcast.setReplaySpeed', async (payload: { speed: number }) => {
        broadcastMessage(IRSDK_REPLAY_SETSPEED, payload.speed, 0, 0);
    });

    director.registerIntentHandler('broadcast.setReplayPosition', async (payload: { frame: number }) => {
        broadcastMessage(IRSDK_REPLAY_SETPOS, payload.frame, 0, 0);
    });
    
    director.registerIntentHandler('broadcast.setReplayState', async (payload: { state: number }) => {
        broadcastMessage(IRSDK_REPLAY_SETSTATE, payload.state, 0, 0);
    });

    // Publisher orchestrator (issue #106) — starts internally only if
    // publisher.enabled === true. Registering the telemetry frame callback is
    // safe regardless of publisher state; the orchestrator no-ops when not running.
    publisherOrchestrator = new PublisherOrchestrator({
        director,
        version: EXTENSION_VERSION,
    });
    publisherOrchestrator.activate();
    registerTelemetryFrameCallback((frame) => {
        publisherOrchestrator?.onTelemetryFrame(frame);
    });

    // Driver swap — operator-triggered from the publisher panel UI.
    director.registerIntentHandler(
        'iracing.publisher.initiateDriverSwap',
        async (payload: { outgoingDriverId: string; incomingDriverId: string; incomingDriverName: string }) => {
            publisherOrchestrator?.initiateDriverSwap(
                payload.outgoingDriverId ?? '',
                payload.incomingDriverId ?? '',
                payload.incomingDriverName ?? '',
            );
        },
    );

    // Start Polling (if on Windows)
    startPolling(director);
}

function initNativeFunctions(director: ExtensionAPI) {
    if (!isWindows) {
        director.log('warn', 'Not running on Windows. iRacing Native functions mocked.');
        return;
    }

    try {
        const user32 = koffi.load('user32.dll');
        
        RegisterWindowMessageA = user32.func('RegisterWindowMessageA', 'uint', ['str']);
        PostMessageA = user32.func('PostMessageA', 'bool', ['void *', 'uint', 'uint', 'long']);
        FindWindowA = user32.func('FindWindowA', 'void *', ['str', 'str']);
        
        // Register the message immediately
        msgId = RegisterWindowMessageA(IRSDK_BROADCASTMSG_NAME);
        director.log('info', `Registered ${IRSDK_BROADCASTMSG_NAME} with ID: ${msgId}`);
    } catch (error: any) {
        director.log('error', `Failed to load user32.dll: ${error.message}`);
        isWindows = false; 
    }

    try {
        const kernel32 = koffi.load('kernel32.dll');

        OpenFileMappingA = kernel32.func('OpenFileMappingA', 'void *', ['uint32', 'bool', 'str']);
        MapViewOfFile = kernel32.func('MapViewOfFile', 'void *', ['void *', 'uint32', 'uint32', 'uint32', 'uintptr_t']);
        UnmapViewOfFile = kernel32.func('UnmapViewOfFile', 'bool', ['void *']);
        CloseHandle = kernel32.func('CloseHandle', 'bool', ['void *']);

        director.log('info', 'kernel32.dll loaded for shared memory access');
    } catch (error: any) {
        director.log('error', `Failed to load kernel32.dll: ${error.message}`);
    }
}

/**
 * Opens the iRacing shared memory mapped file. Called when iRacing is detected as connected.
 * Returns true if the mapping was successfully opened (or was already open).
 */
function openSharedMemory(director: ExtensionAPI): boolean {
    if (pBase) return true; // Already mapped
    if (!OpenFileMappingA || !MapViewOfFile) return false;

    try {
        hMap = OpenFileMappingA(FILE_MAP_READ, false, IRSDK_MEMMAPFILENAME);
        if (!hMap || hMap === 0) {
            director.log('warn', 'iRacing shared memory not available yet');
            return false;
        }

        pBase = MapViewOfFile(hMap, FILE_MAP_READ, 0, 0, 0);
        if (!pBase || pBase === 0) {
            director.log('error', 'Failed to map view of iRacing shared memory');
            CloseHandle(hMap);
            hMap = null;
            return false;
        }

        director.log('info', 'iRacing shared memory mapped successfully');
        return true;
    } catch (error: any) {
        director.log('error', `Failed to open shared memory: ${error.message}`);
        return false;
    }
}

/**
 * Closes the shared memory mapping. Called when iRacing disconnects.
 */
function closeSharedMemory(director: ExtensionAPI) {
    if (pBase && UnmapViewOfFile) {
        try { UnmapViewOfFile(pBase); } catch (_) { /* ignore */ }
        pBase = null;
    }
    if (hMap && CloseHandle) {
        try { CloseHandle(hMap); } catch (_) { /* ignore */ }
        hMap = null;
    }
    lastSessionInfoUpdate = -1;
    cachedCameraGroups = [];
    cachedDrivers = [];
    cachedTrackName = '';
    cachedSessionLaps = 0;
    director.log('info', 'iRacing shared memory unmapped');
}

/**
 * Reads the full IRSDK header from shared memory.
 * Header layout (int32 array indices):
 *   [0] ver, [1] status, [2] tickRate,
 *   [3] sessionInfoUpdate, [4] sessionInfoLen, [5] sessionInfoOffset,
 *   [6] numVars, [7] varHeaderOffset, [8] numBuf,
 *   [9] bufLen, [10] padding, [11] padding
 */
function readFullHeader(): FullHeader | null {
    if (!pBase) return null;
    try {
        const h: number[] = koffi.decode(pBase, 'int32', 12);
        return {
            ver: h[0],
            status: h[1],
            tickRate: h[2],
            sessionInfoUpdate: h[3],
            sessionInfoLen: h[4],
            sessionInfoOffset: h[5],
            numVars: h[6],
            varHeaderOffset: h[7],
            numBuf: h[8],
            bufLen: h[9],
        };
    } catch {
        return null;
    }
}

/**
 * Reads the session info YAML from shared memory and extracts camera groups and drivers.
 * Only re-parses if the sessionInfoUpdate counter has changed.
 * Returns null if nothing changed, or the parsed result on update.
 */
function readSessionInfo(director: ExtensionAPI): SessionInfoResult | null {
    const header = readFullHeader();
    if (!header) return null;

    // Skip re-parse if session info hasn't changed
    if (header.sessionInfoUpdate === lastSessionInfoUpdate) {
        return null; // No change
    }

    try {
        const rawBytes: Uint8Array = koffi.decode(pBase, header.sessionInfoOffset, 'uint8', header.sessionInfoLen);

        // Find null terminator to get actual string length
        let strLen = rawBytes.length;
        for (let i = 0; i < rawBytes.length; i++) {
            if (rawBytes[i] === 0) {
                strLen = i;
                break;
            }
        }

        const yamlStr = Buffer.from(rawBytes.buffer, rawBytes.byteOffset, strLen).toString('utf8');
        const parsed = yaml.load(yamlStr) as any;

        // --- Camera Groups ---
        let cameraGroups: CameraGroup[] = [];
        if (parsed?.CameraInfo?.Groups) {
            cameraGroups = parsed.CameraInfo.Groups.map((g: any) => ({
                groupNum: g.GroupNum,
                groupName: g.GroupName,
                isScenic: g.IsScenic === 1,
            }));
        } else {
            director.log('warn', 'No CameraInfo.Groups found in session info');
        }

        // --- Drivers ---
        let drivers: DriverEntry[] = [];
        if (parsed?.DriverInfo?.Drivers) {
            drivers = parsed.DriverInfo.Drivers
                .filter((d: any) => d.CarIsPaceCar !== 1)
                .map((d: any) => ({
                    carIdx: d.CarIdx,
                    carNumber: String(d.CarNumber),
                    userName: d.UserName ?? 'Unknown',
                    teamName: d.TeamName ?? '',
                    carName: d.CarScreenName ?? '',
                    carClassName: d.CarClassShortName ?? '',
                }));
        } else {
            director.log('warn', 'No DriverInfo.Drivers found in session info');
        }

        // --- Track & Session ---
        const trackName = parsed?.WeekendInfo?.TrackDisplayName ?? '';
        let sessionLaps = 0;
        if (parsed?.SessionInfo?.Sessions) {
            for (const s of parsed.SessionInfo.Sessions) {
                if (s.SessionType === 'Race' && typeof s.SessionLaps === 'number') {
                    sessionLaps = s.SessionLaps;
                    break;
                }
            }
        }

        lastSessionInfoUpdate = header.sessionInfoUpdate;
        director.log('info', `Parsed session info (update #${header.sessionInfoUpdate}): ${cameraGroups.length} cameras, ${drivers.length} drivers, track="${trackName}"`);
        return { cameraGroups, drivers, trackName, sessionLaps };
    } catch (error: any) {
        director.log('error', `Failed to parse session info YAML: ${error.message}`);
        return null;
    }
}

/* ------------------------------------------------------------------ */
/*  Telemetry variable reading                                         */
/* ------------------------------------------------------------------ */

/**
 * Parses the telemetry variable header table from shared memory.
 * Each variable has a 144-byte descriptor: type(int), offset(int), count(int),
 * countAsTime(int), name(char[32]), desc(char[64]), unit(char[32]).
 * Called once on connect; re-parsed only if numVars changes.
 */
function parseVarHeaders(director: ExtensionAPI): void {
    const header = readFullHeader();
    if (!header || header.numVars <= 0) return;
    if (header.numVars === lastVarHeaderCount && varHeaders.size > 0) return;

    varHeaders.clear();
    for (let i = 0; i < header.numVars; i++) {
        const base = header.varHeaderOffset + i * VAR_HEADER_SIZE;
        try {
            const ints: number[] = koffi.decode(pBase, base, 'int32', 4);
            const nameBytes: Uint8Array = koffi.decode(pBase, base + 16, 'uint8', 32);
            let nameEnd = nameBytes.indexOf(0);
            if (nameEnd < 0) nameEnd = 32;
            const name = Buffer.from(nameBytes.buffer, nameBytes.byteOffset, nameEnd).toString('utf8');

            varHeaders.set(name, {
                type: ints[0],
                offset: ints[1],
                count: ints[2],
                name,
            });
        } catch {
            // Skip unreadable headers
        }
    }

    lastVarHeaderCount = header.numVars;
    director.log('info', `Parsed ${varHeaders.size} telemetry variable headers`);
}

/**
 * Locates the most recent telemetry data buffer using triple-buffering.
 * Buffer headers start at byte offset 48 (12 int32s × 4 bytes),
 * each buffer header: { tickCount(int32), bufOffset(int32), pad(int32[2]) }.
 */
function getLatestBuffer(): { offset: number; tickCount: number } | null {
    const header = readFullHeader();
    if (!header || header.numBuf <= 0) return null;

    const BUF_HEADER_OFFSET = 48;
    let bestTick = -1;
    let bestOffset = -1;

    for (let i = 0; i < header.numBuf; i++) {
        const bhBase = BUF_HEADER_OFFSET + i * 16;
        const bh: number[] = koffi.decode(pBase, bhBase, 'int32', 2);
        if (bh[0] > bestTick) {
            bestTick = bh[0];
            bestOffset = bh[1];
        }
    }

    return bestOffset >= 0 ? { offset: bestOffset, tickCount: bestTick } : null;
}

/** Reads a float or double telemetry variable array from the data buffer. */
function readVarFloat(varName: string, bufOffset: number): number[] | null {
    const vh = varHeaders.get(varName);
    if (!vh || !pBase) return null;
    const off = bufOffset + vh.offset;
    try {
        if (vh.type === IRSDK_FLOAT) {
            return Array.from(koffi.decode(pBase, off, 'float32', vh.count) as number[]);
        } else if (vh.type === IRSDK_DOUBLE) {
            return Array.from(koffi.decode(pBase, off, 'float64', vh.count) as number[]);
        }
        return null;
    } catch { return null; }
}

/** Reads an int or bitfield telemetry variable array from the data buffer. */
function readVarInt(varName: string, bufOffset: number): number[] | null {
    const vh = varHeaders.get(varName);
    if (!vh || !pBase) return null;
    const off = bufOffset + vh.offset;
    try {
        if (vh.type === IRSDK_INT || vh.type === IRSDK_BITFIELD) {
            return Array.from(koffi.decode(pBase, off, 'int32', vh.count) as number[]);
        }
        return null;
    } catch { return null; }
}

/** Reads a boolean telemetry variable array from the data buffer. */
function readVarBool(varName: string, bufOffset: number): boolean[] | null {
    const vh = varHeaders.get(varName);
    if (!vh || !pBase) return null;
    const off = bufOffset + vh.offset;
    try {
        if (vh.type === IRSDK_BOOL) {
            const bytes: Uint8Array = koffi.decode(pBase, off, 'uint8', vh.count);
            return Array.from(bytes).map(b => b !== 0);
        }
        return null;
    } catch { return null; }
}

/**
 * Builds a complete RaceState from the current telemetry buffer,
 * merged with cached driver info from session YAML.
 */
function buildRaceState(_director: ExtensionAPI): RaceState | null {
    if (!pBase || varHeaders.size === 0 || cachedDrivers.length === 0) return null;

    const buf = getLatestBuffer();
    if (!buf) return null;

    // Per-car indexed arrays (up to 64 entries)
    const positions      = readVarInt('CarIdxPosition', buf.offset);
    const classPositions = readVarInt('CarIdxClassPosition', buf.offset);
    const lapDistPcts    = readVarFloat('CarIdxLapDistPct', buf.offset);
    const f2Times        = readVarFloat('CarIdxF2Time', buf.offset);
    const onPitRoad      = readVarBool('CarIdxOnPitRoad', buf.offset);
    const lapsCompleted  = readVarInt('CarIdxLapCompleted', buf.offset);
    const lastLapTimes   = readVarFloat('CarIdxLastLapTime', buf.offset);
    const bestLapTimes   = readVarFloat('CarIdxBestLapTime', buf.offset);

    // Scalar session values
    const camCarIdx         = readVarInt('CamCarIdx', buf.offset);
    const sessionFlags      = readVarInt('SessionFlags', buf.offset);
    const sessionLapsRemain = readVarInt('SessionLapsRemainEx', buf.offset)
                           ?? readVarInt('SessionLapsRemain', buf.offset);
    const sessionTimeRemain = readVarFloat('SessionTimeRemain', buf.offset);

    if (!positions || !lapDistPcts) return null;

    // Build car entries from cached drivers
    const cars: RaceCarState[] = [];
    for (const driver of cachedDrivers) {
        const idx = driver.carIdx;
        if (idx < 0 || idx >= 64) continue;
        const pos = positions[idx] ?? 0;
        if (pos <= 0) continue; // Not on track or unclassified

        cars.push({
            carIdx: idx,
            carNumber: driver.carNumber,
            driverName: driver.userName,
            carClass: driver.carClassName || '',
            position: pos,
            classPosition: classPositions?.[idx] ?? 0,
            lapDistPct: lapDistPcts[idx] ?? 0,
            gapToLeader: f2Times?.[idx] ?? 0,
            gapToCarAhead: 0, // computed after sorting
            onPitRoad: onPitRoad?.[idx] ?? false,
            lapsCompleted: lapsCompleted?.[idx] ?? 0,
            lastLapTime: lastLapTimes?.[idx] ?? 0,
            bestLapTime: bestLapTimes?.[idx] ?? 0,
        });
    }

    // Sort by overall position
    cars.sort((a, b) => a.position - b.position);

    // Compute gap to car ahead
    for (let i = 1; i < cars.length; i++) {
        const gap = cars[i].gapToLeader - cars[i - 1].gapToLeader;
        cars[i].gapToCarAhead = gap > 0 ? gap : 0;
    }

    return {
        cars,
        focusedCarIdx: camCarIdx?.[0] ?? -1,
        sessionFlags: sessionFlags?.[0] ?? 0,
        sessionLapsRemain: sessionLapsRemain?.[0] ?? -1,
        sessionTimeRemain: sessionTimeRemain?.[0] ?? -1,
        leaderLap: cars.length > 0 ? cars[0].lapsCompleted : 0,
        totalSessionLaps: cachedSessionLaps,
        trackName: cachedTrackName,
    };
}

/* ------------------------------------------------------------------ */
/*  Telemetry frame assembly (full publisher field set)                */
/* ------------------------------------------------------------------ */

/**
 * Reads all telemetry variables needed for the publisher pipeline and
 * assembles them into a typed TelemetryFrame. Returns null if shared
 * memory is not yet available.
 */
function buildTelemetryFrame(): TelemetryFrame | null {
    if (!pBase || varHeaders.size === 0) return null;
    const buf = getLatestBuffer();
    if (!buf) return null;

    const reads: RawTelemetryReads = {
        sessionTick:     readVarInt('SessionTick',   buf.offset),
        sessionTime:     readVarFloat('SessionTime', buf.offset),
        sessionState:    readVarInt('SessionState',  buf.offset),
        sessionFlags:    readVarInt('SessionFlags',  buf.offset),
        sessionUniqueId: readVarInt('SessionUniqueID', buf.offset),

        carIdxPosition:      readVarInt('CarIdxPosition',       buf.offset),
        carIdxClassPosition: readVarInt('CarIdxClassPosition',  buf.offset),
        carIdxOnPitRoad:     readVarBool('CarIdxOnPitRoad',     buf.offset),
        carIdxTrackSurface:  readVarInt('CarIdxTrackSurface',   buf.offset),
        carIdxLastLapTime:   readVarFloat('CarIdxLastLapTime',  buf.offset),
        carIdxBestLapTime:   readVarFloat('CarIdxBestLapTime',  buf.offset),
        carIdxLapCompleted:  readVarInt('CarIdxLapCompleted',   buf.offset),
        carIdxLapDistPct:    readVarFloat('CarIdxLapDistPct',   buf.offset),
        carIdxF2Time:        readVarFloat('CarIdxF2Time',       buf.offset),
        carIdxSessionFlags:  readVarInt('CarIdxSessionFlags',   buf.offset),

        fuelLevel:           readVarFloat('FuelLevel',                      buf.offset),
        fuelLevelPct:        readVarFloat('FuelLevelPct',                   buf.offset),
        playerIncidentCount: readVarInt('PlayerCarMyIncidentCount',          buf.offset),
        teamIncidentCount:   readVarInt('PlayerCarTeamIncidentCount',        buf.offset),
        incidentLimit:       readVarInt('IncidentLimit',                     buf.offset),

        skies:       readVarInt('Skies',           buf.offset),
        trackTemp:   readVarFloat('TrackTemp',     buf.offset),
        windDir:     readVarFloat('WindDir',       buf.offset),
        windVel:     readVarFloat('WindVel',       buf.offset),
        airHumidity: readVarFloat('AirHumidity',   buf.offset),
        fogLevel:    readVarFloat('FogLevel',      buf.offset),
    };

    return assembleTelemetryFrame(reads);
}

/* ------------------------------------------------------------------ */
/*  Telemetry polling (fast loop for race state)                       */
/* ------------------------------------------------------------------ */

function startTelemetryPolling(director: ExtensionAPI) {
    if (telemetryInterval) return;

    // Parse variable headers on first connect
    parseVarHeaders(director);

    const publisherEnabled = director.settings['publisher.enabled'] === true;
    const intervalMs = getTelemetryIntervalMs(publisherEnabled);

    telemetryInterval = setInterval(() => {
        pollTelemetry(director);
    }, intervalMs);

    director.log('info', `Telemetry polling started (${intervalMs}ms interval, ${publisherEnabled ? '5Hz publisher' : '4Hz standard'})`);
}

function stopTelemetryPolling(director: ExtensionAPI) {
    if (telemetryInterval) {
        clearInterval(telemetryInterval);
        telemetryInterval = null;
    }
    varHeaders.clear();
    lastVarHeaderCount = -1;
    director.log('info', 'Telemetry polling stopped');
}

function pollTelemetry(director: ExtensionAPI) {
    if (!pBase) return;

    // Ensure var headers are parsed (they come from shared memory, not YAML)
    if (varHeaders.size === 0) {
        parseVarHeaders(director);
        if (varHeaders.size === 0) return;
    }

    const state = buildRaceState(director);
    if (state) {
        director.emitEvent('iracing.raceStateChanged', state);
    }

    // Feed the publisher pipeline if a callback is registered
    if (telemetryFrameCallback) {
        const frame = buildTelemetryFrame();
        if (frame) {
            telemetryFrameCallback(frame);
        }
    }
}

function startPolling(director: ExtensionAPI) {
     if (checkInterval) return;
     checkConnection(director);
     checkInterval = setInterval(() => {
         checkConnection(director);
     }, 2000);
}

function checkConnection(director: ExtensionAPI) {
    if (!isWindows) return;
    try {
        const handle = FindWindowA(null, 'iRacing.com Simulator');
        const running = handle !== null && handle !== 0;
        if (running !== isConnected) {
            isConnected = running;
            director.log('info', `Sim Connection Status: ${isConnected ? 'Connected' : 'Disconnected'}`);
            director.emitEvent('iracing.connectionStateChanged', { connected: isConnected });
            publisherOrchestrator?.onConnectionChange(isConnected);

            if (isConnected) {
                // Attempt to open shared memory when iRacing connects
                openSharedMemory(director);
                startTelemetryPolling(director);
                director.showOverlay('race-info');
            } else {
                // Clean up when disconnected
                stopTelemetryPolling(director);
                closeSharedMemory(director);

                // Hide overlays when disconnected
                director.hideOverlay('race-info');
                director.hideOverlay('flag-alert');
                lastFlagState = null;
            }
        }

        // Poll session data if connected
        if (isConnected) {
            pollSessionData(director);
        }
    } catch (error: any) {
        director.log('error', `Error checking connection: ${error.message}`);
    }
}

/**
 * Polls iRacing shared memory for session data changes.
 * - Reads camera groups from session info YAML (only when changed).
 * - Emits iracing.cameraGroupsChanged when groups are updated.
 * - Updates overlay data (flag state, etc.) — placeholder for now.
 */
function pollSessionData(director: ExtensionAPI) {
    // --- Shared Memory: Camera Groups ---
    if (!pBase) {
        // Try to open if not yet mapped (iRacing may not have created it immediately)
        openSharedMemory(director);
    }

    if (pBase) {
        const result = readSessionInfo(director);
        if (result !== null) {
            // Session info changed — emit updated data
            cachedCameraGroups = result.cameraGroups;
            cachedDrivers = result.drivers;
            cachedTrackName = result.trackName;
            cachedSessionLaps = result.sessionLaps;
            director.emitEvent('iracing.cameraGroupsChanged', { groups: result.cameraGroups });
            director.emitEvent('iracing.driversChanged', { drivers: result.drivers });
        }
    }
}

function handleShowLiveCam(payload: { carNum: string, camGroup?: string, camNum?: string }) {
    if (!directorAPI) return;
    const group = resolveCameraGroup(payload.camGroup, cachedCameraGroups);
    const carVal = parseInt(payload.carNum);
    directorAPI.log('info', `Switching Cam: Car ${carVal}, Group ${group}`);
    // Legacy: sendCommand(1, car, group) => cmd=1, var1=car, var2=group
    broadcastMessage(IRSDK_CAM_SWITCHNUM, carVal, group, 0);
}

function handleReplayFromTo(payload: { startFrame: number, endFrame: number, speed?: number }) {
    const speed = payload.speed || 1;
    broadcastMessage(IRSDK_REPLAY_SETSPEED, speed, 0, 0); 
    broadcastMessage(IRSDK_REPLAY_SEARCH, payload.startFrame, 0, 0);
}

function broadcastMessage(cmd: number, var1: number, var2: number, var3: number = 0) {
    if (!isWindows) return;
    if (!msgId) {
        directorAPI?.log('warn', 'Message ID not registered');
        return;
    }
    try {
        const wParam = (cmd & 0xFFFF) | ((var1 & 0xFFFF) << 16);
        let lParam = var2;
        if (var3 && var3 !== 0) {
                lParam = (var3 & 0xFFFF) | ((var2 & 0xFFFF) << 16);
        }
        PostMessageA(HWND_BROADCAST, msgId, wParam, lParam);
    } catch (error: any) {
        directorAPI?.log('error', `Broadcast failed: ${error.message}`);
    }
}

/**
 * Called when the extension is unloaded. Cleans up polling timers and shared memory.
 */
export function deactivate() {
    if (checkInterval) {
        clearInterval(checkInterval);
        checkInterval = null;
    }
    if (telemetryInterval) {
        clearInterval(telemetryInterval);
        telemetryInterval = null;
    }
    if (publisherOrchestrator) {
        publisherOrchestrator.deactivate();
        publisherOrchestrator = null;
    }
    registerTelemetryFrameCallback(null);
    if (directorAPI) {
        closeSharedMemory(directorAPI);
    }
    directorAPI = null;
}
