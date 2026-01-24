# Implementation Plan: Director Extension System

This document tracks the technical implementation tasks required to transition the Director App to the new Core + Extensions architecture.

## Phase 1: Core Architecture Infrastructure

### 1.1 Extension Host Service
- [ ] Create `src/main/extension-host/extension-host.ts`
    - Logic to scan `src/extensions/` directory.
    - Logic to read `package.json` manifest files.
    - Logic to load the main entry point of an extension (in a sandbox or isolated scope if possible, initially just `require`).
- [ ] Create `ExtensionAPI` interface
    - Define what functionality is exposed to extensions (Node.js subset + Director specific).

### 1.2 Intent Registry
- [ ] Create `src/main/extension-host/intent-registry.ts`
    - Store registered intents (e.g., `communication.announce`) mapped to the owner extension.
    - Validate intent schemas against manifest.

### 1.3 Event Bus
- [ ] Create `src/main/extension-host/event-bus.ts`
    - Typed `EventEmitter` for strictly defined extension events.
    - Methods for extensions to `emit` events.
    - Methods for Core to `subscribe`.

## Phase 2: Feature Migration (Proof of Concept)

### 2.1 Refactor OBS to Core Module
OBS is now considered a "Native" feature, not an extension, but needs to sit alongside the sequence executor.
- [ ] Move `ObsService` to `src/main/modules/obs-core/`.
- [ ] Ensure `ObsService` exposes methods directly to `SequenceExecutor` without going through the Intent Registry (optimization).
- [ ] Update `documents/feature_obs_integration.md` to reflect status as Core.

### 2.2 Refactor Discord to Extension
Migrate the existing Discord integration to the new extension format to test the architecture.
- [ ] Create `src/extensions/discord/` structure.
- [ ] Create `src/extensions/discord/package.json` manifest.
    - Define intent: `communication.announce` (was `DRIVER_TTS`).
- [ ] Move `DiscordService` logic into `src/extensions/discord/main.ts`.
- [ ] Adapt code to use the new `ExtensionAPI` to register its intent handler.
- [ ] Update `documents/feature_discord_integration.md`.

## Phase 3: Execution Engine Updates

### 3.1 Sequence Executor Update
- [ ] Modify `SequenceExecutor` to handle new `EXECUTE_INTENT` command type.
- [ ] Implement lookup logic:
    - Receive `EXECUTE_INTENT` -> Query `IntentRegistry` -> Dispatch to `Extension`.
- [ ] Deprecate/Remove hardcoded `DRIVER_TTS` handler (replace with intent execution).

### 3.2 Trigger System (Hardware Mapping)
- [ ] Implement `EventMapper` service in Core.
    - Loads user config mapping `event_id` -> `sequence_id`.
- [ ] Subscribe `EventMapper` to `EventBus`.
- [ ] Trigger `SequenceExecutor.execute(sequenceId)` when event matches.

## Phase 4: UI & Documentation Updates

- [ ] Update `feature_iracing_integration.md` (Move to extension or stay core? TBD, likely Extension).
- [ ] Update `feature_youtube_integration.md` (Move to extension).
- [ ] Create scaffolding for "Control Deck" UI (Renderer).
