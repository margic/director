# Implementation Plan: Sequence UX Enhancements + Broadcast Overlay System

## Status: PLAN — Ready for Review

**Date**: 2026-02-14
**Branch**: `extensions`
**Design Doc**: `documents/design_sequence_ux_enhancements.md`
**Baseline Commit**: `6c15b62` (extensible overlay design)
**Phase 1 Restore Point**: `fc29b30` (functional implementation)

---

## 0. Pre-Implementation Decisions

These open questions from the design doc **must be resolved before coding begins**. Each has a recommended default.

| # | Question | Recommendation | Rationale |
|:---|:---|:---|:---|
| 1 | Three-panel builder: always or edit-mode only? | **B) Two-panel viewing, three-panel editing** | Avoids empty Properties panel when just viewing a sequence |
| 2 | Add `@dnd-kit` now or defer? | **A) Add in Phase 2** | DnD builder is Phase 2 work; install the dep when we build it |
| 3 | Step card default: expanded or collapsed? | **C) Smart collapse: collapse if > 3 payload fields** | Best of both worlds; small payloads stay visible |
| 4 | Progress ring: dashboard-only or shared? | **B) Shared `<ProgressRing>` component** | Reusable in dashboard widget + execution header + overlay template |
| 5 | Overlay server port: fixed or configurable? | **B) Configurable via Settings**, default `9100` | Allows conflict resolution without code changes |
| 6 | Region conflict resolution? | **B) Priority number in manifest** | Predictable, declarative; fallback to last-write-wins for equal priority |
| 7 | Custom templates: bundled-only or user-creatable? | **A) Bundled only (for now)** | Ship V1 with built-in templates; extension-provided HTML is P3 |
| 8 | Admin panel for overlay regions? | **A) Yes, in Settings** | Operators need visibility into what's being broadcast |

---

## 1. Implementation Phases

The work is split into **4 phases**, each independently shippable. Phases 1–2 can run in parallel on separate branches since they touch different subsystems.

```
Phase 1: Operator UI Enhancements (Renderer)   ← Can start immediately
Phase 2: Overlay Infrastructure (Main Process)  ← Can start in parallel with Phase 1
Phase 3: Overlay Templates + Contributors       ← Depends on Phase 2
Phase 4: DnD Builder + Polish                   ← Depends on Phase 1
```

### Effort Key

| Label | Time Estimate | Description |
|:---|:---|:---|
| **XS** | < 1 hour | Config change, single-component tweak |
| **S** | 1–3 hours | New utility + component update |
| **M** | 3–8 hours | New component or service + integration |
| **L** | 1–2 days | Multi-file feature with new subsystem |
| **XL** | 2–4 days | Major subsystem with multiple services |

---

## 2. Phase 1 — Operator UI Visual Enhancements

**Goal**: Transform the text-heavy sequence panel into a visually rich operator interface.
**Branch**: `feat/sequence-ui-enhancements`
**Dependencies**: None — all changes are in `src/renderer/`
**Estimated Total Effort**: ~2–3 days

### Sprint 1.1: Domain Icon System (§2.1) — Effort: S

**File Changes:**

| File | Action | Detail |
|:---|:---|:---|
| `src/renderer/lib/intent-utils.ts` | **CREATE** | New utility module |
| `src/renderer/components/sequences/IntentBadge.tsx` | **MODIFY** | Consume new utility |
| `src/renderer/components/sequences/SequenceStepCard.tsx` | **MODIFY** | Add domain icon |
| `src/renderer/components/sequences/SequenceLibrary.tsx` | **MODIFY** | Add domain icons to list items |

**Tasks:**

1. **Create `src/renderer/lib/intent-utils.ts`**
   - Export `getIntentDomain(intent: string): string` — extracts namespace before `.`
   - Export `getIntentDomainIcon(domain: string): LucideIcon` — maps domain → Lucide icon component:
     - `system` → `Settings`
     - `obs` → `Monitor`
     - `broadcast` → `Flag`
     - `communication` → `MessageSquare`
     - `youtube` → `Youtube`
     - `discord` → `Disc` (or `Headphones`)
     - default → `Puzzle` (unknown extension)
   - Export `getIntentDomainColor(domain: string): string` — maps domain → Tailwind class (move existing logic from `IntentBadge.tsx`)
   - Export `humanizeIntent(intent: string): string` — camelCase → human-readable label (needed later for overlay, build it now)

2. **Update `IntentBadge.tsx`** (67 → ~50 lines)
   - Replace inline color map with `getIntentDomainColor()` import
   - `IntentDomainBadge`: render `<DomainIcon className="w-3 h-3">` before the domain label text
   - Remove duplicated color logic

3. **Update `SequenceStepCard.tsx`** (88 lines)
   - Import `getIntentDomainIcon`
   - Render domain icon (16×16) in the step header next to the intent name
   - Add 3px left border in domain color (via `getIntentDomainColor`)

4. **Update `SequenceLibrary.tsx`** (194 lines)
   - For each sequence in the list, show small domain icons (de-duplicated across steps)
   - Use `getIntentDomainIcon` to render a row of icons next to the sequence name

**Acceptance Criteria:**
- Every intent badge shows an icon + colored text
- Step cards have a domain-colored left border + icon
- Library entries show which domains a sequence touches
- No regressions in existing functionality

---

### Sprint 1.2: Vertical Timeline Rail (§2.2) — Effort: M

**File Changes:**

| File | Action | Detail |
|:---|:---|:---|
| `src/renderer/components/sequences/TimelineRail.tsx` | **CREATE** | New component |
| `src/renderer/components/sequences/TimelineStepNode.tsx` | **CREATE** | New component |
| `src/renderer/components/sequences/SequenceDetail.tsx` | **MODIFY** | Replace step list with TimelineRail |
| `src/renderer/app.css` (or inline Tailwind) | **MODIFY** | Timeline CSS pseudo-elements |

**Tasks:**

1. **Create `TimelineStepNode.tsx`**
   - Props: `step: SequenceStep`, `index: number`, `status: 'pending' | 'active' | 'completed' | 'failed' | 'skipped'`, `result?: StepResult`, `isExpanded: boolean`, `onToggle: () => void`
   - Renders the node circle (12px) on the left rail:
     - Pending: hollow, grey border
     - Active: filled orange, pulse animation (`animate-pulse`)
     - Completed: filled green, checkmark
     - Failed: filled red, × mark
     - Skipped: hollow yellow
   - Renders step content to the right of the rail (step number, domain icon, intent, duration)
   - Expand/collapse: collapsed shows intent + status only; expanded shows payload key-values
   - Smart collapse default: expand if ≤ 3 payload fields, collapse if > 3

2. **Create `TimelineRail.tsx`**
   - Props: `steps: SequenceStep[]`, `stepResultMap: Map<number, StepResult>`, `currentStepIndex?: number`, `isExecuting: boolean`
   - Renders vertical rail using CSS `::before` pseudo-element (2px solid `border-border`)
   - Maps steps → `TimelineStepNode` with calculated status per step
   - Highlighted segment: rail between step 0 → `currentStepIndex` is green (completed portion)
   - Global progress bar at bottom: horizontal bar showing `currentStep / totalSteps` percentage
   - Elapsed time display: timer starts on execution, shows "1.2s elapsed · ~18s remaining"

3. **Update `SequenceDetail.tsx`** (275 lines)
   - Replace the `steps.map(step => <SequenceStepCard />)` block with `<TimelineRail>`
   - Pass `stepResultMap`, `currentStepIndex` (from `currentProgress`), `isExecuting`
   - Keep `SequenceStepCard` available (used by Builder in Phase 4) but no longer primary in Detail view

4. **Timeline CSS**
   - Use Tailwind's `@apply` in a `<style>` block or inline styles for pseudo-elements
   - Timeline connector: `relative pl-8` on each step, `::before` for vertical line, `::after` for node circle
   - Active step glow: `shadow-[0_0_8px_rgba(255,95,31,0.2)]` on the active step card
   - Transition: `transition-all duration-300` on status changes

**Acceptance Criteria:**
- Steps render as a connected vertical timeline with node circles
- Node circles reflect execution state (pending/active/completed/failed)
- Clicking a step expands/collapses the payload detail
- Progress bar shows percentage during execution
- Active step has a subtle orange glow

---

### Sprint 1.3: Execution Progress Bar (§2.5 partial) — Effort: S

**File Changes:**

| File | Action | Detail |
|:---|:---|:---|
| `src/renderer/components/sequences/ProgressRing.tsx` | **CREATE** | Shared SVG progress ring |
| `src/renderer/components/sequences/ExecutionProgressBar.tsx` | **CREATE** | Panel header progress bar |
| `src/renderer/pages/SequencesPanel.tsx` | **MODIFY** | Add progress bar to header |
| `src/renderer/components/sequences/SequencesDashboardCard.tsx` | **MODIFY** | Add progress ring |

**Tasks:**

1. **Create `ProgressRing.tsx`**
   - Props: `progress: number` (0–100), `size?: number` (default 48), `strokeWidth?: number` (default 4), `label?: string`
   - SVG circle with `stroke-dasharray` / `stroke-dashoffset` for progress arc
   - Colors: track = `var(--border)`, progress = `var(--primary)`, completed = green
   - Center text: shows `label` or percentage

2. **Create `ExecutionProgressBar.tsx`**
   - Props: `progress: SequenceProgress | null`, `isExecuting: boolean`
   - Conditionally renders a horizontal bar in the panel header area
   - Shows: sequence name, step N/M, percentage bar, elapsed time
   - Bar uses `bg-primary` fill with `transition-[width] duration-500`
   - Hidden when not executing (animates out with `opacity-0 h-0` transition)

3. **Update `SequencesPanel.tsx`** (214 lines)
   - Import and render `<ExecutionProgressBar>` between the header and the two-column content
   - Wire up `currentProgress` and `isExecuting` props

4. **Update `SequencesDashboardCard.tsx`** (128 lines)
   - Replace the text-based "Step N of M" with `<ProgressRing>`
   - Show ring only when executing; otherwise show sequence count summary

**Acceptance Criteria:**
- Horizontal progress bar appears during execution in the Sequences panel header
- Progress ring renders in the dashboard card during execution
- Both components animate smoothly between states
- ProgressRing is reusable (exported, documented props)

---

### Sprint 1.4: Enhanced Library Cards (§2.4) — Effort: M

**File Changes:**

| File | Action | Detail |
|:---|:---|:---|
| `src/renderer/components/sequences/SequenceLibraryCard.tsx` | **CREATE** | New visual card component |
| `src/renderer/components/sequences/StepCompositionBar.tsx` | **CREATE** | Domain proportion bar |
| `src/renderer/components/sequences/SequenceLibrary.tsx` | **MODIFY** | Use new card component |

**Tasks:**

1. **Create `StepCompositionBar.tsx`**
   - Props: `steps: SequenceStep[]`
   - Computes domain proportion (count per domain / total steps)
   - Renders a 3px-tall horizontal bar with colored segments (like GitHub language bar)
   - Each segment uses `getIntentDomainColor()` background
   - Minimum segment width: 8px (to be visible even for single-step domains)

2. **Create `SequenceLibraryCard.tsx`**
   - Props: `sequence: PortableSequence`, `isSelected: boolean`, `isExecuting: boolean`, `onClick: () => void`
   - Layout:
     - 3px left color strip (dominant domain color)
     - Title row: name + category badge (BUILT-IN / CLOUD / CUSTOM)
     - Info row: domain icons (de-duped) + step count + estimated duration + variable count pill
     - Bottom: `<StepCompositionBar>`
   - Selected state: `ring-1 ring-primary/50 bg-card/80`
   - Executing state: pulsing left border + mini progress indicator

3. **Update `SequenceLibrary.tsx`** (194 lines)
   - Replace flat list items with `<SequenceLibraryCard>` components
   - Pass `isSelected` (compare with `selectedSequenceId`), `isExecuting`
   - Keep search/filter logic unchanged

**Acceptance Criteria:**
- Library entries render as visual cards with domain icons, composition bar, and category badge
- Selected card has a visible highlight ring
- Executing card has pulsing animation
- Duration estimate shown per card

---

### Phase 1 Deliverable

After Sprints 1.1–1.4, the Sequences panel is visually transformed:
- Domain icons throughout
- Connected timeline rail in Detail view
- Progress bar + progress ring during execution
- Rich library cards with composition bars

**Test manually**: Open app → navigate to Sequences → verify each sequence renders with icons, timeline, and composition bar. Execute a sequence and verify progress visualization.

---

## 3. Phase 2 — Overlay Infrastructure (Main Process)

**Goal**: Build the Overlay Bus, HTTP/WebSocket server, and Host SPA so extensions can contribute broadcast overlays.
**Branch**: `feat/overlay-system`
**Dependencies**: None — all new code, no renderer changes
**Estimated Total Effort**: ~3–4 days

### Sprint 2.1: Overlay Bus Service — Effort: M

**File Changes:**

| File | Action | Detail |
|:---|:---|:---|
| `src/main/overlay/overlay-types.ts` | **CREATE** | Type definitions for overlay system |
| `src/main/overlay/overlay-bus.ts` | **CREATE** | Core overlay state management |

**Tasks:**

1. **Create `src/main/overlay/overlay-types.ts`**
   ```typescript
   export type OverlayRegion =
     | 'top-bar'
     | 'lower-third'
     | 'ticker'
     | 'center-popup'
     | 'corner-top-left'
     | 'corner-top-right';

   export interface OverlayRegistration {
     id: string;               // "race-info"
     region: OverlayRegion;
     title: string;
     template: string;         // built-in template ID or path
     autoHide?: number;        // ms
     priority?: number;        // higher wins region conflicts
   }

   export interface OverlaySlot extends OverlayRegistration {
     extensionId: string;
     data?: Record<string, unknown>;
     visible: boolean;
   }

   export type OverlayServerMessage =
     | { type: 'connected'; overlays: OverlaySlot[] }
     | { type: 'overlay:registered'; overlay: OverlaySlot }
     | { type: 'overlay:update'; id: string; data: Record<string, unknown> }
     | { type: 'overlay:show'; id: string }
     | { type: 'overlay:hide'; id: string }
     | { type: 'overlay:unregistered'; id: string };
   ```

2. **Create `src/main/overlay/overlay-bus.ts`**
   - Class `OverlayBus` extends `EventEmitter`
   - Internal state: `Map<string, OverlaySlot>` keyed by `${extensionId}.${overlayId}`
   - Methods:
     - `registerOverlay(extensionId: string, registration: OverlayRegistration): void` — adds slot, emits `'registered'`
     - `unregisterOverlay(extensionId: string, overlayId: string): void` — removes slot, emits `'unregistered'`
     - `unregisterAllForExtension(extensionId: string): void` — cleanup on extension unload
     - `updateOverlay(extensionId: string, overlayId: string, data: Record<string, unknown>): void` — updates slot data, auto-shows if hidden, emits `'update'`
     - `showOverlay(extensionId: string, overlayId: string): void` — sets visible=true, emits `'show'`
     - `hideOverlay(extensionId: string, overlayId: string): void` — sets visible=false, handles autoHide timer, emits `'hide'`
     - `getOverlays(): OverlaySlot[]` — returns all slots (for initial state on WS connect)
     - `getOverlaysByRegion(region: OverlayRegion): OverlaySlot[]` — filtered by region
   - Region conflict handling: when two overlays target the same region, the one with higher `priority` wins; equal priority = last-write-wins
   - AutoHide: `setTimeout` → `hideOverlay()` after `autoHide` ms, cleared on new `updateOverlay`

**Acceptance Criteria:**
- OverlayBus manages overlay slot lifecycle (register/update/show/hide/unregister)
- Events emitted for every state change
- Region conflict resolution works with priority
- AutoHide timers work correctly (cleared on update, fire on timeout)

---

### Sprint 2.2: Extension API — Overlay Methods — Effort: M

**File Changes:**

| File | Action | Detail |
|:---|:---|:---|
| `src/main/extension-host/extension-host.ts` | **MODIFY** | Wire overlay API into extension invoke bridge |
| `src/main/extension-host/extension-process.ts` | **MODIFY** | Add overlay methods to extension API surface |
| `src/main/main.ts` | **MODIFY** | Create OverlayBus, pass to ExtensionHostService |

**Tasks:**

1. **Update `extension-host.ts`** (302 lines)
   - Constructor: accept `OverlayBus` instance
   - Add invoke handlers for overlay methods:
     - `updateOverlay` → `overlayBus.updateOverlay(extensionId, overlayId, data)`
     - `showOverlay` → `overlayBus.showOverlay(extensionId, overlayId)`
     - `hideOverlay` → `overlayBus.hideOverlay(extensionId, overlayId)`
   - On extension load: parse `contributes.overlays` from manifest → call `overlayBus.registerOverlay()` for each
   - On extension unload: call `overlayBus.unregisterAllForExtension(extensionId)`

2. **Update `extension-process.ts`** (the UtilityProcess child)
   - Add to the `ExtensionAPI` interface:
     ```typescript
     updateOverlay(overlayId: string, data: Record<string, unknown>): void;
     showOverlay(overlayId: string): void;
     hideOverlay(overlayId: string): void;
     ```
   - Implementation: send `INVOKE` message to host with `{ method: 'updateOverlay', args: [overlayId, data] }`
   - The host resolves `extensionId` from the message source (already tracked per extension)

3. **Update `main.ts`** (297 lines)
   - Import `OverlayBus` from `./overlay/overlay-bus`
   - Create instance in the `app.on('ready')` initialization chain (after ExtensionEventBus, before ExtensionHostService)
   - Pass `overlayBus` to `ExtensionHostService` constructor
   - Wire sequence executor as overlay contributor (Sprint 3.1)

**Acceptance Criteria:**
- Extensions can call `context.updateOverlay('my-overlay', { ... })` from their `activate()` function
- Overlay registrations from `contributes.overlays` are auto-registered on extension load
- Overlay methods are routed through the existing invoke bridge (no new IPC channels)
- Extension unload cleans up all overlays

---

### Sprint 2.3: Overlay Server (HTTP + WebSocket) — Effort: L

**File Changes:**

| File | Action | Detail |
|:---|:---|:---|
| `src/main/overlay/overlay-server.ts` | **CREATE** | HTTP + WebSocket server |
| `package.json` | **MODIFY** | Add `ws` + `@types/ws` dependencies |
| `src/main/main.ts` | **MODIFY** | Start overlay server |

**Tasks:**

1. **Install dependency**
   ```bash
   npm install ws
   npm install -D @types/ws
   ```

2. **Create `src/main/overlay/overlay-server.ts`**
   - Class `OverlayServer`
   - Constructor: takes `OverlayBus`, `port: number` (default 9100)
   - Creates Node `http.createServer`:
     - `GET /overlay` → serves the overlay host SPA (static files from `dist/overlay/`)
     - `GET /overlay?regions=lower-third,top-bar` → passes region filter as query param (SPA reads it)
     - `GET /api/overlays` → JSON response with `overlayBus.getOverlays()`
     - All other paths → 404
   - Creates `ws.WebSocketServer` attached to HTTP server for path `/ws`:
     - On connection: send `{ type: 'connected', overlays: overlayBus.getOverlays() }` (initial state)
     - Subscribe to OverlayBus events → broadcast to all connected clients:
       - `'registered'` → `{ type: 'overlay:registered', overlay }`
       - `'update'` → `{ type: 'overlay:update', id, data }`
       - `'show'` → `{ type: 'overlay:show', id }`
       - `'hide'` → `{ type: 'overlay:hide', id }`
       - `'unregistered'` → `{ type: 'overlay:unregistered', id }`
     - Heartbeat: ping every 30s, terminate stale connections
   - Methods:
     - `start(): Promise<void>` — starts listening on port
     - `stop(): Promise<void>` — closes all connections, stops server
     - `getPort(): number` — returns actual port
     - `getUrl(): string` — returns `http://localhost:${port}/overlay`
   - Error handling: port in use → log error + emit failover message (don't crash app)

3. **Update `main.ts`**
   - Import `OverlayServer`
   - Create after OverlayBus: `const overlayServer = new OverlayServer(overlayBus, configPort)`
   - Call `overlayServer.start()` during init (non-blocking — server failure doesn't block app startup)
   - Add IPC handler: `'overlay:getUrl'` → returns `overlayServer.getUrl()` (for Settings page)
   - On `app.on('before-quit')`: call `overlayServer.stop()`

4. **Add config for port**
   - Read from config service: `configService.get('overlay.port', 9100)`
   - Expose in Settings page (Phase 3 or later)

**Acceptance Criteria:**
- Server starts on port 9100 (or configured port) during app init
- `GET /overlay` serves static HTML (placeholder for now — real SPA in Sprint 2.4)
- `GET /api/overlays` returns JSON array of current overlay slots
- WebSocket at `ws://localhost:9100/ws` connects and receives initial state
- OverlayBus events are broadcast to all connected WebSocket clients in real-time
- Server failure doesn't crash the Electron app

---

### Sprint 2.4: Overlay Host SPA — Effort: L

**File Changes:**

| File | Action | Detail |
|:---|:---|:---|
| `src/overlay/index.html` | **CREATE** | Overlay SPA entry HTML |
| `src/overlay/main.tsx` | **CREATE** | Overlay SPA entry point |
| `src/overlay/OverlayHost.tsx` | **CREATE** | Region layout + WebSocket connection |
| `src/overlay/OverlayRegion.tsx` | **CREATE** | Individual region container |
| `src/overlay/overlay.css` | **CREATE** | OBS-specific CSS (transparent body, regions) |
| `src/overlay/useOverlaySocket.ts` | **CREATE** | WebSocket hook for real-time updates |
| `vite.config.ts` | **MODIFY** | Add multi-entry build for overlay |
| `tsconfig.json` | **MODIFY** | Include `src/overlay` in compilation |

**Tasks:**

1. **Create `src/overlay/index.html`**
   - Minimal HTML: transparent body, `<div id="overlay-root">`, loads `main.tsx`
   - Meta tag: `<meta name="viewport" content="width=1920">` (fixed canvas)

2. **Create `src/overlay/main.tsx`**
   - React root render into `#overlay-root`
   - Parse URL query params: `regions` (comma-separated filter)
   - Render `<OverlayHost regions={filterRegions} />`

3. **Create `useOverlaySocket.ts`**
   - Custom hook: `useOverlaySocket(url: string)`
   - Returns: `{ overlays: Map<string, OverlaySlot>, connected: boolean }`
   - Manages WebSocket lifecycle: connect, reconnect on close (exponential backoff: 1s, 2s, 4s, max 30s)
   - Processes all `OverlayServerMessage` types, updates overlays state
   - On `overlay:hide`: sets `visible=false` (component handles exit animation before removal)

4. **Create `OverlayHost.tsx`**
   - Renders a 1920×1080 fixed canvas (`position: relative; width: 1920px; height: 1080px`)
   - Uses `useOverlaySocket('ws://localhost:9100/ws')`
   - Groups overlays by region
   - Renders `<OverlayRegion>` for each of the 6 regions
   - Passes only overlays matching that region (filtered by `regions` prop if present)

5. **Create `OverlayRegion.tsx`**
   - Props: `region: OverlayRegion`, `overlays: OverlaySlot[]`
   - Positioned absolutely per region (CSS classes from §6.6 of design doc)
   - Renders the template component based on `overlay.template`
   - Handles enter/exit animations: CSS class toggling `overlay-enter` / `overlay-exit`
   - On `overlay-exit` animation end → actually remove from DOM
   - Empty region → renders nothing (fully transparent)

6. **Create `src/overlay/overlay.css`**
   - Transparent body, hidden overflow, 1920×1080 canvas
   - Region position classes (top-bar, lower-third, ticker, center-popup, corners)
   - Semi-transparent backgrounds with backdrop blur
   - Slide-up/slide-down animation keyframes
   - Font imports for Rajdhani + JetBrains Mono (same brand tokens)

7. **Update `vite.config.ts`** (28 lines)
   - Add multi-entry build:
     ```typescript
     build: {
       rollupOptions: {
         input: {
           main: resolve(__dirname, 'index.html'),
           overlay: resolve(__dirname, 'src/overlay/index.html'),
         },
       },
     }
     ```
   - Ensure overlay output goes to `dist/overlay/`

8. **Update overlay server** (`overlay-server.ts`)
   - Serve `dist/overlay/` as static files for `GET /overlay*` path
   - In dev mode: proxy to Vite dev server or serve from `src/overlay/` with Vite middleware

**Acceptance Criteria:**
- Opening `http://localhost:9100/overlay` in a browser shows a transparent 1920×1080 canvas
- WebSocket connects and receives overlay state
- Regions appear/disappear based on overlay visibility
- Enter/exit animations work (slide up/down)
- Region filtering via `?regions=lower-third` works
- Overlay renders correctly as an OBS Browser Source (transparent background, correct dimensions)

---

### Sprint 2.5: Overlay IPC for Electron App — Effort: S

**File Changes:**

| File | Action | Detail |
|:---|:---|:---|
| `src/main/preload.ts` | **MODIFY** | Expose overlay API to renderer |
| `src/renderer/types.d.ts` | **MODIFY** | Add overlay types |
| `src/main/main.ts` | **MODIFY** | Add overlay IPC handlers |

**Tasks:**

1. **Add IPC handlers to `main.ts`**
   - `'overlay:getUrl'` → returns overlay server URL string
   - `'overlay:getOverlays'` → returns `overlayBus.getOverlays()`
   - `'overlay:setRegionEnabled'` → toggle region visibility (for admin panel)

2. **Update `preload.ts`**
   - Add `overlay` namespace:
     ```typescript
     overlay: {
       getUrl: () => ipcRenderer.invoke('overlay:getUrl'),
       getOverlays: () => ipcRenderer.invoke('overlay:getOverlays'),
       setRegionEnabled: (region: string, enabled: boolean) =>
         ipcRenderer.invoke('overlay:setRegionEnabled', region, enabled),
     }
     ```

3. **Update `types.d.ts`**
   - Add overlay types to `IElectronAPI`

**Acceptance Criteria:**
- Renderer can query the overlay URL (to display in Settings)
- Renderer can list current overlays (for admin panel)

---

### Phase 2 Deliverable

After Sprints 2.1–2.5, the overlay infrastructure is complete:
- OverlayBus manages overlay lifecycle
- Extensions can contribute overlays via API + manifest
- HTTP + WebSocket server serves the overlay SPA
- Overlay Host SPA renders regions with templates (placeholder templates for now)
- Electron app can query overlay state via IPC

**Test manually**: Start app → open `http://localhost:9100/overlay` in Chrome → verify WebSocket connects. (No visible content until Phase 3 adds templates.)

---

## 4. Phase 3 — Overlay Templates + Extension Contributors

**Goal**: Build the first overlay templates and wire up sequence executor + iRacing as contributors.
**Branch**: `feat/overlay-templates`
**Dependencies**: Phase 2 complete
**Estimated Total Effort**: ~2–3 days

### Sprint 3.1: Built-in Overlay Templates — Effort: M

**File Changes:**

| File | Action | Detail |
|:---|:---|:---|
| `src/overlay/templates/ActivityProgress.tsx` | **CREATE** | Sequence activity overlay |
| `src/overlay/templates/RaceInfoBar.tsx` | **CREATE** | Race info top bar |
| `src/overlay/templates/StatusBadge.tsx` | **CREATE** | Corner badge |
| `src/overlay/templates/FlagAlert.tsx` | **CREATE** | Flag change popup |
| `src/overlay/templates/ChatTicker.tsx` | **CREATE** | Scrolling chat feed |
| `src/overlay/templates/Standings.tsx` | **CREATE** | Mini leaderboard |
| `src/overlay/templates/index.ts` | **CREATE** | Template registry |

**Tasks:**

1. **Create template registry** (`index.ts`)
   - Export `getTemplate(templateId: string): React.ComponentType<{ data: Record<string, unknown> }>` 
   - Maps template ID → component

2. **Create `ActivityProgress.tsx`** (P1 — First template)
   - Data shape: `{ title: string, step: number, total: number, label: string }`
   - Renders: sequence name, current step label, step N/M, horizontal progress bar
   - Design: semi-transparent card with brand fonts, primary (orange) progress fill
   - Animations: text fades on update, progress bar transitions width

3. **Create `RaceInfoBar.tsx`** (P1)
   - Data shape: `{ lap: string, flag: string, leader: string, leaderCarNum: string, gap: string }`
   - Renders: horizontal bar with key stats separated by dividers
   - Flag colors: green/yellow/red/white/checkered background accents
   - Font: `font-jetbrains` for numbers, `font-rajdhani` for labels

4. **Create `StatusBadge.tsx`** (P1)
   - Data shape: `{ icon: string, label: string, detail?: string }`
   - Renders: compact corner badge with icon + text
   - Use case: Discord voice count, YouTube viewers, OBS recording status

5. **Create `FlagAlert.tsx`** (P2)
   - Data shape: `{ flag: string, message: string }`
   - Renders: full-width centered alert with flag-colored background
   - Animation: dramatic enter (scale + fade), auto-exit after `autoHide`

6. **Create `ChatTicker.tsx`** (P2)
   - Data shape: `{ messages: Array<{ text: string, author?: string, time?: string }> }`
   - Renders: horizontally scrolling text feed (CSS marquee or `translateX` animation)
   - New messages push from right

7. **Create `Standings.tsx`** (P2)
   - Data shape: `{ positions: Array<{ pos: number, name: string, gap: string }> }`
   - Renders: compact leaderboard table with `font-jetbrains` for numbers

8. **Wire templates into `OverlayRegion.tsx`**
   - Import `getTemplate`, look up template by `overlay.template` ID
   - Pass `overlay.data` as the `data` prop
   - Handle unknown template gracefully (render nothing, log warning)

**Acceptance Criteria:**
- All 6 templates render correctly with sample data
- Templates use brand tokens (correct fonts, colors, opacity)
- Templates handle missing/partial data gracefully
- `OverlayRegion` routes data → template correctly

---

### Sprint 3.2: Sequence Executor as Overlay Contributor — Effort: S

**File Changes:**

| File | Action | Detail |
|:---|:---|:---|
| `src/main/main.ts` | **MODIFY** | Wire sequence progress → overlay bus |
| `src/main/overlay/overlay-bus.ts` | **MODIFY** | Add built-in contributor support |
| `src/renderer/lib/intent-utils.ts` | **MODIFY** | Ensure `humanizeIntent` is also available on main process |
| `src/main/overlay/intent-humanizer.ts` | **CREATE** | Main-process copy of humanizeIntent |

**Tasks:**

1. **Create `src/main/overlay/intent-humanizer.ts`**
   - Export `humanizeIntent(intent: string): string`
   - Same logic as renderer utility but usable from main process
   - Converts `obs.switchScene` → "Switching Scene", `broadcast.muteDrivers` → "Muting Drivers"

2. **Update `main.ts`**
   - Register the sequence executor overlay during init:
     ```typescript
     overlayBus.registerOverlay('sequences', {
       id: 'director-activity',
       region: 'lower-third',
       title: 'Director Activity',
       template: 'activity-progress',
     });
     ```
   - Subscribe to `sequenceScheduler.on('progress')`:
     - Map `SequenceProgress` → overlay data: `{ title, step, total, label }`
     - Use `stepLabel` from metadata, fallback to `humanizeIntent(stepIntent)`
     - Call `overlayBus.updateOverlay('sequences', 'director-activity', data)`
   - Subscribe to `sequenceScheduler.on('historyChanged')` (sequence complete):
     - `setTimeout(() => overlayBus.hideOverlay('sequences', 'director-activity'), 3000)`

**Acceptance Criteria:**
- When a sequence executes, the lower-third overlay shows the activity progress template
- Human-readable labels are shown (not intent IDs)
- Overlay auto-hides 3 seconds after sequence completes
- No overlay visible when no sequence is executing

---

### Sprint 3.3: iRacing Extension Overlay Registration — Effort: M

**File Changes:**

| File | Action | Detail |
|:---|:---|:---|
| `src/extensions/iracing/package.json` | **MODIFY** | Add `contributes.overlays` |
| `src/extensions/iracing/src/index.ts` | **MODIFY** | Add `updateOverlay` calls on telemetry |

**Tasks:**

1. **Update iracing `package.json`**
   - Add `contributes.overlays` section:
     ```json
     "overlays": [
       {
         "id": "race-info",
         "region": "top-bar",
         "title": "Race Information Bar",
         "template": "race-info"
       },
       {
         "id": "flag-alert",
         "region": "center-popup",
         "title": "Flag Change Alert",
         "template": "flag-alert",
         "autoHide": 5000
       }
     ]
     ```

2. **Update iracing `index.ts`** (156 lines)
   - Use the new overlay API methods provided via `ExtensionAPI`:
     - On telemetry polling: `director.updateOverlay('race-info', { lap, flag, leader, ... })`
     - On flag state change: `director.showOverlay('flag-alert')` + `director.updateOverlay('flag-alert', { flag, message })`
   - Depends on: iRacing telemetry data actually being extracted (current implementation uses native FFI polling — extend the data read to include lap count, flag, positions if not already present)

**Acceptance Criteria:**
- iRacing extension declares overlay contributions in manifest
- When iRacing is connected, the top-bar shows race info
- Flag changes trigger a center-popup alert that auto-hides after 5s
- When iRacing is disconnected, overlays are hidden

---

### Sprint 3.4: Extension Manifest Overlay Parsing — Effort: S

**File Changes:**

| File | Action | Detail |
|:---|:---|:---|
| `src/main/extension-host/extension-host.ts` | **MODIFY** | Parse `contributes.overlays` on extension load |

**Tasks:**

1. **Update extension loading in `extension-host.ts`**
   - After reading `package.json` manifest, check for `contributes.overlays`
   - For each entry: call `overlayBus.registerOverlay(extensionId, overlayEntry)`
   - Validate required fields: `id`, `region`, `title`, `template`
   - Log warning for invalid entries, skip them
   - On extension unload: `overlayBus.unregisterAllForExtension(extensionId)` (already added in Sprint 2.2)

**Acceptance Criteria:**
- Extensions with `contributes.overlays` in their manifest get overlays auto-registered on load
- Invalid overlay entries are logged and skipped (don't crash extension loading)
- Extension unload cleans up overlays

---

### Sprint 3.5: Overlay Admin in Settings Page — Effort: M

**File Changes:**

| File | Action | Detail |
|:---|:---|:---|
| `src/renderer/pages/SettingsPage.tsx` | **MODIFY** | Add Overlay section |

**Tasks:**

1. **Add "Broadcast Overlay" section to Settings page**
   - Show overlay server URL with copy button (for OBS setup)
   - Show overlay server status (running/stopped, port)
   - List all registered overlay slots with:
     - Extension name, region, template, visible status
     - Toggle to enable/disable each overlay
   - Mini preview: link to open overlay in system browser
   - OBS Setup instructions (§6.11 from design doc)

**Acceptance Criteria:**
- Settings page shows overlay URL and status
- All registered overlays are listed with their details
- Copy URL button works
- Link opens overlay in browser for preview

---

### Phase 3 Deliverable

After Sprints 3.1–3.5:
- 6 overlay templates render broadcast-quality graphics
- Sequence executor contributes "Director Activity" to lower-third
- iRacing contributes race info bar + flag alerts
- Extension manifests with `contributes.overlays` are parsed automatically
- Settings page shows overlay admin panel

**Test manually**: Execute a sequence → verify lower-third appears in the overlay browser source. Connect iRacing (or mock) → verify top-bar shows race info. Open Settings → verify overlay URL and slot list.

---

## 5. Phase 4 — Drag & Drop Builder + Polish

**Goal**: Transform the sequence builder into a visual drag-and-drop canvas and add micro-interactions.
**Branch**: `feat/dnd-builder`
**Dependencies**: Phase 1 complete (uses domain icon system, timeline rail)
**Estimated Total Effort**: ~3–4 days

### Sprint 4.1: DnD Library Installation + Foundation — Effort: S

**File Changes:**

| File | Action | Detail |
|:---|:---|:---|
| `package.json` | **MODIFY** | Add `@dnd-kit` dependencies |
| `src/renderer/components/sequences/dnd/DndContext.tsx` | **CREATE** | Shared DnD context wrapper |

**Tasks:**

1. **Install dependencies**
   ```bash
   npm install @dnd-kit/core @dnd-kit/sortable @dnd-kit/utilities
   ```

2. **Create `DndContext.tsx`**
   - Wraps `@dnd-kit/core`'s `DndContext` with project-specific configuration
   - Custom collision detection (closestCenter for canvas drops)
   - Drag overlay styling (semi-transparent, follows cursor, brand styling)
   - Accessibility announcements for screen readers

---

### Sprint 4.2: Intent Palette (Draggable Source) — Effort: M

**File Changes:**

| File | Action | Detail |
|:---|:---|:---|
| `src/renderer/components/sequences/dnd/IntentPalette.tsx` | **CREATE** | Draggable intent chips grouped by domain |
| `src/renderer/components/sequences/dnd/DraggableIntentChip.tsx` | **CREATE** | Individual draggable intent |

**Tasks:**

1. **Create `DraggableIntentChip.tsx`**
   - Uses `@dnd-kit/core`'s `useDraggable` hook
   - Renders domain icon + intent name + domain label
   - Drag preview: semi-transparent copy follows cursor
   - Data payload: `{ intentId: string, domain: string }` attached to drag event

2. **Create `IntentPalette.tsx`**
   - Props: `intents: IntentCatalogEntry[]`
   - Groups intents by domain
   - Renders collapsible domain sections (⚙️ System, 🖥️ OBS, 🏎️ Broadcast, etc.)
   - Each intent is a `<DraggableIntentChip>`
   - Click-to-add: clicking a chip appends a new step (alternative to drag)
   - Search/filter within palette

---

### Sprint 4.3: Builder Canvas (Drop Target + Sortable) — Effort: L

**File Changes:**

| File | Action | Detail |
|:---|:---|:---|
| `src/renderer/components/sequences/dnd/BuilderCanvas.tsx` | **CREATE** | Central drop target + sortable step list |
| `src/renderer/components/sequences/dnd/SortableStepCard.tsx` | **CREATE** | Sortable step in canvas |
| `src/renderer/components/sequences/dnd/DropZone.tsx` | **CREATE** | Visual drop indicator between steps |

**Tasks:**

1. **Create `DropZone.tsx`**
   - Renders between steps as a thin dashed line
   - On drag-over: expands to show "⊕ Drop intent here" with highlight
   - Uses `@dnd-kit/core`'s `useDroppable` hook

2. **Create `SortableStepCard.tsx`**
   - Uses `@dnd-kit/sortable`'s `useSortable` hook
   - Renders step with drag handle (≡), domain icon, intent name, payload preview
   - Selected state: highlighted border, connected to Properties panel
   - Delete button (×) on hover
   - Animated position changes on reorder

3. **Create `BuilderCanvas.tsx`**
   - Uses `SortableContext` from `@dnd-kit/sortable`
   - Renders `SortableStepCard` for each step with `DropZone` between
   - Handles drop events:
     - Drop from IntentPalette → create new step at drop position
     - Drop from reorder → move step to new position
   - Empty state: animated arrow → "Drag an intent from the palette to begin"
   - Supports keyboard step navigation (`↑↓` to select, `Delete` to remove)

---

### Sprint 4.4: Properties Panel + Three-Panel Layout — Effort: M

**File Changes:**

| File | Action | Detail |
|:---|:---|:---|
| `src/renderer/components/sequences/dnd/PropertiesPanel.tsx` | **CREATE** | Step properties editor |
| `src/renderer/components/sequences/SequenceBuilder.tsx` | **MODIFY** | Rewrite to three-panel layout |

**Tasks:**

1. **Create `PropertiesPanel.tsx`**
   - Props: `selectedStep: SequenceStep | null`, `variables: SequenceVariable[]`, `onStepChange`, `onVariableChange`
   - Sections:
     - **Metadata** (when no step selected): name, description, version, priority editors
     - **Step Config** (when step selected): intent display, payload field editors, metadata label
     - **Variables**: variable manager (move from existing `SequenceBuilderVariableManager`)
     - **JSON Preview**: collapsible raw JSON for entire sequence or selected step

2. **Rewrite `SequenceBuilder.tsx`** (234 lines → ~150 lines)
   - Three-panel layout:
     - Left: `<IntentPalette>` (w-56)
     - Center: `<BuilderCanvas>` (flex-1)
     - Right: `<PropertiesPanel>` (w-72)
   - Wrap all three in `<DndContext>` with `<DndOverlay>`
   - Handle drop events at this level → dispatch to canvas
   - Keyboard shortcuts: `Ctrl+S` save, `Escape` cancel

---

### Sprint 4.5: Micro-Interactions (§2.6) — Effort: S

**File Changes:**

| File | Action | Detail |
|:---|:---|:---|
| `src/renderer/components/sequences/SequenceLibrary.tsx` | **MODIFY** | Selection transition |
| `src/renderer/pages/SequencesPanel.tsx` | **MODIFY** | Success flash, transitions |
| Various sequence components | **MODIFY** | Hover, keyboard, animation polish |

**Tasks:**

1. **Selection transition**: Library → Detail crossfade using `transition-opacity duration-200`
2. **Hover preview**: Tooltip on library items showing first 3 step intents
3. **Success flash**: Green border flash on panel after successful execution
4. **Shake on error**: CSS `@keyframes shake` on execute button when variables are missing
5. **Empty canvas animation**: Subtle bouncing arrow in BuilderCanvas empty state
6. **Keyboard shortcuts**: `Ctrl+S` save (builder), `Delete` remove step, `↑↓` navigate

**Acceptance Criteria:**
- Transitions feel smooth and intentional
- No jank or layout shifts during animations
- Keyboard shortcuts documented in UI (tooltip on buttons)

---

### Phase 4 Deliverable

After Sprints 4.1–4.5:
- Three-panel drag-and-drop builder with intent palette, canvas, and properties panel
- Steps are draggable from palette and reorderable on canvas
- Micro-interactions throughout (transitions, hovers, keyboard shortcuts)

**Test manually**: Create New Sequence → drag intents from palette → reorder steps → edit properties → save.

---

## 6. File Inventory (All Phases)

### New Files (27)

| Phase | File | Purpose |
|:---|:---|:---|
| 1 | `src/renderer/lib/intent-utils.ts` | Domain icon/color/humanize utilities |
| 1 | `src/renderer/components/sequences/TimelineRail.tsx` | Vertical timeline rail |
| 1 | `src/renderer/components/sequences/TimelineStepNode.tsx` | Individual timeline node |
| 1 | `src/renderer/components/sequences/ProgressRing.tsx` | SVG progress ring |
| 1 | `src/renderer/components/sequences/ExecutionProgressBar.tsx` | Panel header progress bar |
| 1 | `src/renderer/components/sequences/SequenceLibraryCard.tsx` | Visual library card |
| 1 | `src/renderer/components/sequences/StepCompositionBar.tsx` | Domain proportion bar |
| 2 | `src/main/overlay/overlay-types.ts` | Overlay type definitions |
| 2 | `src/main/overlay/overlay-bus.ts` | Overlay state management |
| 2 | `src/main/overlay/overlay-server.ts` | HTTP + WebSocket server |
| 2 | `src/overlay/index.html` | Overlay SPA entry HTML |
| 2 | `src/overlay/main.tsx` | Overlay SPA entry point |
| 2 | `src/overlay/OverlayHost.tsx` | Region layout + WebSocket |
| 2 | `src/overlay/OverlayRegion.tsx` | Region container |
| 2 | `src/overlay/overlay.css` | OBS-specific CSS |
| 2 | `src/overlay/useOverlaySocket.ts` | WebSocket React hook |
| 3 | `src/overlay/templates/ActivityProgress.tsx` | Activity progress template |
| 3 | `src/overlay/templates/RaceInfoBar.tsx` | Race info top bar |
| 3 | `src/overlay/templates/StatusBadge.tsx` | Corner badge template |
| 3 | `src/overlay/templates/FlagAlert.tsx` | Flag alert popup |
| 3 | `src/overlay/templates/ChatTicker.tsx` | Scrolling chat ticker |
| 3 | `src/overlay/templates/Standings.tsx` | Mini leaderboard |
| 3 | `src/overlay/templates/index.ts` | Template registry |
| 3 | `src/main/overlay/intent-humanizer.ts` | Intent → human label |
| 4 | `src/renderer/components/sequences/dnd/DndContext.tsx` | DnD context wrapper |
| 4 | `src/renderer/components/sequences/dnd/IntentPalette.tsx` | Draggable intent chips |
| 4 | `src/renderer/components/sequences/dnd/DraggableIntentChip.tsx` | Individual draggable chip |
| 4 | `src/renderer/components/sequences/dnd/BuilderCanvas.tsx` | Drop target + sortable |
| 4 | `src/renderer/components/sequences/dnd/SortableStepCard.tsx` | Sortable step card |
| 4 | `src/renderer/components/sequences/dnd/DropZone.tsx` | Drop indicator |
| 4 | `src/renderer/components/sequences/dnd/PropertiesPanel.tsx` | Properties editor |

### Modified Files (17)

| Phase | File | Change |
|:---|:---|:---|
| 1 | `src/renderer/components/sequences/IntentBadge.tsx` | Use utility, add icons |
| 1 | `src/renderer/components/sequences/SequenceStepCard.tsx` | Add domain icon, left border |
| 1 | `src/renderer/components/sequences/SequenceLibrary.tsx` | Use SequenceLibraryCard + domain icons |
| 1 | `src/renderer/components/sequences/SequenceDetail.tsx` | Replace step list with TimelineRail |
| 1 | `src/renderer/pages/SequencesPanel.tsx` | Add ExecutionProgressBar |
| 1 | `src/renderer/components/sequences/SequencesDashboardCard.tsx` | Add ProgressRing |
| 2 | `src/main/extension-host/extension-host.ts` | Wire overlay API, parse manifests |
| 2 | `src/main/extension-host/extension-process.ts` | Add overlay methods to extension API |
| 2 | `src/main/main.ts` | Create OverlayBus, OverlayServer, IPC handlers |
| 2 | `src/main/preload.ts` | Add overlay namespace |
| 2 | `src/renderer/types.d.ts` | Add overlay types |
| 2 | `vite.config.ts` | Multi-entry build for overlay |
| 2 | `package.json` | Add `ws` dependency |
| 3 | `src/extensions/iracing/package.json` | Add `contributes.overlays` |
| 3 | `src/extensions/iracing/src/index.ts` | Add overlay update calls |
| 3 | `src/renderer/pages/SettingsPage.tsx` | Add overlay admin section |
| 4 | `src/renderer/components/sequences/SequenceBuilder.tsx` | Rewrite to three-panel DnD |
| 4 | `package.json` | Add `@dnd-kit` dependencies |

---

## 7. Dependency Graph

```
Phase 1 (Operator UI)          Phase 2 (Overlay Infra)
├── 1.1 Domain Icons           ├── 2.1 Overlay Bus
├── 1.2 Timeline Rail ←────┐  ├── 2.2 Extension API (← 2.1)
├── 1.3 Progress Bar        │  ├── 2.3 Overlay Server (← 2.1)
└── 1.4 Library Cards       │  ├── 2.4 Overlay Host SPA (← 2.3)
                            │  └── 2.5 Overlay IPC (← 2.1)
                            │
Phase 4 (DnD + Polish)     │  Phase 3 (Templates + Contributors)
├── 4.1 DnD Foundation     │  ├── 3.1 Built-in Templates (← 2.4)
├── 4.2 Intent Palette      │  ├── 3.2 Sequence Contributor (← 2.1, 3.1)
├── 4.3 Builder Canvas ←───┘  ├── 3.3 iRacing Contributor (← 2.2, 3.1)
├── 4.4 Properties Panel       ├── 3.4 Manifest Parsing (← 2.2)
└── 4.5 Micro-Interactions     └── 3.5 Settings Admin (← 2.5, 3.4)
```

Phase 1 and Phase 2 have **zero dependencies** between them — they can be built in parallel.
Phase 3 depends on Phase 2. Phase 4 depends on Phase 1.
Within each phase, sprints are ordered by dependency.

---

## 8. New Dependencies

| Package | Version | Phase | Size | Purpose |
|:---|:---|:---|:---|:---|
| `ws` | `^8.x` | 2 | ~50KB | WebSocket server for overlay |
| `@types/ws` | `^8.x` | 2 | dev only | TypeScript types |
| `@dnd-kit/core` | `^6.x` | 4 | ~40KB | Drag and drop foundation |
| `@dnd-kit/sortable` | `^8.x` | 4 | ~15KB | Sortable lists |
| `@dnd-kit/utilities` | `^3.x` | 4 | ~5KB | Utility functions |

Total new production bundle: ~110KB (before tree-shaking).

---

## 9. Risk Register

| Risk | Impact | Likelihood | Mitigation |
|:---|:---|:---|:---|
| Vite multi-entry build complexity | Overlay SPA build fails or conflicts with renderer | Medium | Test build pipeline early (Sprint 2.4); fallback to separate Vite config if needed |
| OBS Browser Source CSS quirks | Transparency, fonts, or animations render differently | Medium | Test in OBS early (Sprint 2.4); add OBS-specific CSS overrides |
| iRacing telemetry data gaps | Not all overlay data fields available from SDK | High | Sprint 3.3 scoped to available data only; placeholder for missing fields |
| `@dnd-kit` React 19 compatibility | Library may not support React 19 RC | Low | Check compatibility before Sprint 4.1; fallback to `react-dnd` |
| WebSocket reconnection in OBS | OBS may not handle WS drops gracefully | Medium | Exponential backoff (Sprint 2.4); OBS auto-refreshes on source edit |
| Port 9100 conflict | Another service uses 9100 on user's machine | Low | Configurable port (Sprint 2.3 + settings UI in 3.5) |

---

## 10. Testing Strategy

### Phase 1 — Manual Visual Testing
- Screenshot comparison: before/after for each component
- Execute sequences and verify timeline node state transitions
- Check progress bar animation smoothness (aim for 60fps CSS transitions)
- Verify domain icons render for all 5+ domains
- Test with 0, 1, 5, 20+ step sequences

### Phase 2 — Integration Testing
- WebSocket connection lifecycle: connect, receive state, reconnect on drop
- Overlay Server: HTTP responses, WebSocket message format
- OverlayBus: unit tests for register/update/show/hide/unregister/region-conflict
- Multi-client: open 2+ browser tabs → both receive updates

### Phase 3 — End-to-End Visual Testing
- Execute sequence → verify lower-third appears in overlay browser
- OBS Browser Source: add overlay, verify transparency, dimensions, font rendering
- Flag change → verify center-popup appears and auto-hides
- Template fallbacks: send partial data → verify graceful rendering

### Phase 4 — Interaction Testing
- Drag from palette → drop on canvas → step created
- Reorder via drag handle → steps reorder with animation
- Keyboard: Tab/↑↓ navigation, Delete removal, Ctrl+S save
- Accessibility: screen reader announces drag operations

---

## 11. Rollback Points

Each phase produces a stable, mergeable commit. If a phase introduces issues:

| Phase | Rollback To | Impact |
|:---|:---|:---|
| Phase 1 | `6c15b62` | Reverts to text-only UI (Phase 1 functional implementation still works) |
| Phase 2 | Pre-Phase 2 commit | No overlay system; app works as before |
| Phase 3 | End of Phase 2 | Overlay infra exists but no templates render |
| Phase 4 | End of Phase 1 | DnD builder reverts to form-based builder |

---

## 12. Estimated Timeline

| Phase | Effort | Calendar Estimate | Parallelizable |
|:---|:---|:---|:---|
| Phase 1: Operator UI | 2–3 days | Week 1 | Yes (with Phase 2) |
| Phase 2: Overlay Infrastructure | 3–4 days | Week 1–2 | Yes (with Phase 1) |
| Phase 3: Templates + Contributors | 2–3 days | Week 2–3 | No (needs Phase 2) |
| Phase 4: DnD Builder + Polish | 3–4 days | Week 3–4 | No (needs Phase 1) |
| **Total** | **10–14 days** | **~3–4 weeks** | |

With Phases 1 + 2 running in parallel, the critical path is **~7–11 days** to reach a fully functional overlay system with visual UI enhancements.
