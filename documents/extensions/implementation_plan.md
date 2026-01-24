# Implementation Plan: Director Extension System

This document tracks the technical implementation tasks required to transition the Director App to the new Core + Extensions architecture.

## Phase 1: Core Architecture Infrastructure

### 1.1 Extension Host Service (Isolated)
- [x] Create `src/main/extension-host/extension-scanner.ts`
    - Logic to scan `src/extensions/` directory.
    - Logic to read and validate `package.json` manifest files.
- [x] Create `src/main/extension-host/extension-host.ts` (Main Process Manager)
    - Manages lifecycle of the Electron `UtilityProcess` (sandbox).
    - Establishes IPC channel for `Main <-> Extension Host`.
- [x] Create `src/main/extension-host/extension-process.ts` (The Isolated Entry Point)
    - The actual entry point for the utility process.
    - Implements the `require` logic within the sandbox.
    - Exposes the defined `ExtensionAPI` to loaded modules.
- [x] Create `ExtensionAPI` interface
    - Define what functionality is exposed to extensions (Node.js subset + Director specific).

### 1.2 Intent Registry
- [x] Create `src/main/extension-host/intent-registry.ts`
    - Store registered intents (e.g., `communication.announce`) mapped to the owner extension.
    - Validate intent schemas against manifest.

### 1.3 Event Bus
- [x] Create `src/main/extension-host/event-bus.ts`
    - Typed `EventEmitter` for strictly defined extension events.
    - Methods for extensions to `emit` events (bridged over IPC from `UtilityProcess`).
    - Methods for Core to `subscribe`.

## Phase 2: Feature Migration (Proof of Concept)

### 2.1 Refactor OBS to Core Module
OBS is now considered a "Native" feature, not an extension, but needs to sit alongside the sequence executor.
- [x] Move `ObsService` to `src/main/modules/obs-core/`.
- [x] Ensure `ObsService` exposes methods directly to `SequenceExecutor` without going through the Intent Registry (optimization).
- [x] Update `documents/feature_obs_integration.md` to reflect status as Core.

### 2.2 Refactor Discord to Extension
Migrate the existing Discord integration to the new extension format to test the architecture.
- [x] Create `src/extensions/discord/` structure.
- [x] Create `src/extensions/discord/package.json` manifest.
    - Define intent: `communication.announce` (was `DRIVER_TTS`).
- [x] Move `DiscordService` logic into `src/extensions/discord/main.ts` (Created `index.ts`).
- [x] Adapt code to use the new `ExtensionAPI` to register its intent handler.
- [ ] Update `documents/feature_discord_integration.md`.

### 2.3 Refactor YouTube to Extension (Chat Context & Comms)
Refactor `YoutubeService` from a generic client to a specific Chat extension.
- [x] Create `src/extensions/youtube/` structure.
- [x] Create manifest with:
    - Intent: `communication.talkToChat` (Send text to live chat).
    - Event: `chat.messageReceived` (Emit scraper events for AI context).
- [x] Port `YoutubeService` logic to `src/extensions/youtube/index.ts`.
- [x] Add Scraper Capability to Extension Host (`openScraper`).
- [ ] Implement full Polling/Scraping loop in Extension (Next Step).
- [ ] Remove legacy generic `YoutubeService` from Core.

### 2.4 Refactor iRacing to Extension (Broadcast Controller)
Refactor `IracingService` to focus purely on Camera and Replay automation.
- [x] Create `src/extensions/iracing/` structure.
- [x] Create manifest with:
    - Intent: `broadcast.showLiveCam` (Follow specific car/camera).
    - Intent: `broadcast.replayFromTo` (Play replay segment).
- [x] Move `IracingService` logic to the extension.
    - *Note: iRacing SDK likely requires Node integration. Ensure Extension Host `utilityProcess` handles native modules correctly.*
- [x] Remove legacy `IracingService` from Core.

## Phase 3: Execution Engine Updates

### 3.1 Sequence Executor Update
- [x] Modify `SequenceExecutor` to handle new `EXECUTE_INTENT` command type.
- [x] Implement lookup logic:
    - Receive `EXECUTE_INTENT` -> Query `IntentRegistry` -> Dispatch to `Extension`.
- [x] Deprecate/Remove hardcoded `DRIVER_TTS` handler (replace with intent execution).

### 3.2 Trigger System (Hardware Mapping)
- [x] Implement `EventMapper` service in Core.
    - Loads user config mapping `event_id` -> `sequence_id`.
- [x] Subscribe `EventMapper` to `EventBus`.
- [x] Trigger `SequenceExecutor.execute(sequenceId)` when event matches.

## Phase 4: UI & Documentation Updates

- [x] Update `feature_iracing_integration.md` (Reflect Extension status).
- [x] Update `feature_youtube_integration.md` (Reflect Extension status).
- [x] Create scaffolding for "Control Deck" UI (Renderer).
