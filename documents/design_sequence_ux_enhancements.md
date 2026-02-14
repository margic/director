# Design: Sequence Executor UX Visual Enhancements

## Status: PROPOSAL — Phase 2 Visual Upgrade

**Date**: 2025-02-14  
**Branch**: `extensions`  
**Baseline**: `fc29b30` (Phase 1 functional implementation)

---

## 1. Problem Statement

The Phase 1 Sequence Executor UX is **functional but text-heavy**. Every component renders information as stacked text with minimal graphical differentiation. This creates several UX issues:

| Issue | Where | Impact |
|:---|:---|:---|
| No visual flow | Step list in Detail & Builder | User can't scan the sequence "shape" at a glance |
| No domain iconography | IntentBadge, StepCard, Builder | Domains are differentiated only by tiny colored text labels |
| No drag-and-drop | Builder step list | Reordering requires manual effort; GripVertical icon is decorative only |
| No progress visualization | Execution states | Progress is communicated via text log only, no progress bar or timeline |
| Flat library cards | SequenceLibrary rows | Every sequence looks identical — just name + stat text |
| No visual canvas | Builder mode | Sequence creation feels like filling forms, not designing a workflow |

The current view in production (see screenshot) confirms: the Safety Car Protocol renders as a wall of text cards with payload key-value pairs.

---

## 2. Proposed Enhancements (6 Areas)

### 2.1 Domain Icon System

Replace text-only domain badges with **icon + color** domain identifiers.

| Domain | Icon (Lucide) | Color | Label |
|:---|:---|:---|:---|
| `system.*` | `Settings` (gear) | `text-muted-foreground` / grey | SYS |
| `obs.*` | `Monitor` | `text-secondary` / Telemetry Blue | OBS |
| `broadcast.*` | `Flag` | `text-primary` / Apex Orange | BROADCAST |
| `communication.*` | `MessageSquare` | `text-green-400` / green | COMMS |
| `youtube.*` | `Youtube` | `text-red-400` | YT |

**Impact**: Every step card, intent badge, library item, and builder step gains a domain-specific icon instead of relying solely on colored text.

**Implementation**: Update `IntentBadge.tsx` and `IntentDomainBadge` to render a Lucide icon alongside the label. Add an `intentDomainIcon(domain: string)` utility function.

---

### 2.2 Vertical Timeline Rail (Step Cards)

Replace the flat `space-y-2` step list with a **connected vertical timeline** that visually links steps and shows execution progress.

```
┌─ SEQUENCE TIMELINE ──────────────────────────────┐
│                                                   │
│  ●━━ 1. Switch to Track Map             ✅ 42ms  │
│  ┃   🖥️ OBS · sceneName: "Track Map"             │
│  ┃                                                │
│  ●━━ 2. Mute All Drivers                ✅ 15ms  │
│  ┃   🏎️ BROADCAST · command: mute-all             │
│  ┃                                                │
│  ●━━ 3. Announce Safety Car              ⏳ ...   │
│  ┃   💬 COMMS · message: "Safety Car..."          │
│  ┃   ┌─ $var(returnDelayMs) ─┐                    │
│  ┃                                                │
│  ○── 4. Wait $var(returnDelayMs)         ○ pending│
│  ┃   ⚙️ SYS · durationMs: 30000                   │
│  ┃                                                │
│  ○── 5. Return to Live Race              ○ pending│
│      🖥️ OBS · sceneName: "Live Race"              │
│                                                   │
│  ━━━━━━━━━━━━━━━━━ 60% ━━━░░░░░░░░░░░░           │
│  Step 3/5 · 1.2s elapsed · ~18s remaining         │
└───────────────────────────────────────────────────┘
```

**Key visual elements:**
- **Timeline rail**: A 2px vertical line (`border-l-2`) connecting all steps
- **Step nodes**: Circles on the rail — filled green (done), pulsing orange (active), hollow grey (pending)
- **Domain color left-border**: Each step card has a 3px left border in its domain color
- **Progress bar**: Horizontal bar below the step list showing % + elapsed/remaining

**CSS approach:**
```css
/* Timeline connector */
.timeline-step { position: relative; padding-left: 2rem; }
.timeline-step::before {
  content: '';
  position: absolute;
  left: 0.5rem;
  top: 0;
  bottom: 0;
  width: 2px;
  background: var(--border);
}
.timeline-step::after {
  content: '';
  position: absolute;
  left: calc(0.5rem - 5px);
  top: 1rem;
  width: 12px;
  height: 12px;
  border-radius: 50%;
  border: 2px solid var(--border);
  background: var(--background);
}
.timeline-step.completed::after { background: #22c55e; border-color: #22c55e; }
.timeline-step.active::after { background: var(--primary); border-color: var(--primary); animation: pulse 2s infinite; }
```

---

### 2.3 Drag & Drop Sequence Builder

Transform the builder from a **form stack** into a **visual canvas with a draggable intent palette**.

#### Layout: Three-Panel Builder

```
┌───────────────────────────────────────────────────────────────┐
│  CREATE NEW SEQUENCE                    [Discard] [💾 Save]   │
├────────────┬──────────────────────────────┬───────────────────┤
│            │                              │                   │
│  INTENT    │  SEQUENCE CANVAS             │  PROPERTIES       │
│  PALETTE   │                              │                   │
│            │  ┌─────────────────────┐     │  ── METADATA ──   │
│  ⚙️ System  │  │ ⊕ Drop here or      │     │  Name: [      ]   │
│   wait     │  │   click to add      │     │  Version: [   ]   │
│   log      │  └─────────────────────┘     │  Priority: [ ]    │
│            │                              │                   │
│  🖥️ OBS    │  ┌ 1 ─────────────────┐     │  ── STEP 2 ──     │
│  switchSc… │  │ ≡ 🖥️ Switch Scene   │     │  Intent:          │
│  setSourc… │  │   sceneName: Pit    │     │  broadcast.       │
│            │  └─────────────────────┘     │  selectCamera     │
│  🏎️ Broad. │       │                      │                   │
│  showLive… │  ┌ 2 ─────────────────┐     │  Payload:         │
│  selectCa… │  │ ≡ 🏎️ Select Camera  │◀━━━│  camera: [TV1  ]  │
│  switchRe… │  │   camera: TV1      │     │  carNum: [$var()]│
│            │  └─────────────────────┘     │                   │
│  💬 Comms   │       │                      │  ── VARIABLES ──  │
│  announce  │  ┌ 3 ─────────────────┐     │  + Add Variable   │
│  talkChat  │  │ ≡ ⏱️ Wait 5000ms    │     │                   │
│            │  └─────────────────────┘     │  ── JSON ──       │
│            │                              │  { "id": "seq_…"  │
│            │  ┌─────────────────────┐     │    "steps": [     │
│            │  │ ⊕ Drop here         │     │      ...          │
│            │  └─────────────────────┘     │  }                │
│            │                              │                   │
└────────────┴──────────────────────────────┴───────────────────┘
```

#### Drag & Drop Behavior

1. **Intent Palette** (left): Grouped by domain, each intent is a draggable chip
2. **Canvas** (center): Drop zones appear between steps; dropping an intent creates a new step
3. **Properties** (right): Clicking a step on the canvas selects it and shows its editable properties
4. **Reorder**: Steps on the canvas are reorderable via drag handle (≡)

#### Library: `@dnd-kit/core`

Recommended DnD library for React — lightweight, accessible, performant.

```bash
npm install @dnd-kit/core @dnd-kit/sortable @dnd-kit/utilities
```

**Why @dnd-kit:**
- Purpose-built for React (hooks-based, not wrapper-based)
- Supports both sortable (reorder) and droppable (palette → canvas) patterns
- Keyboard accessible out of the box
- ~10KB gzipped — minimal bundle impact
- Active maintenance, TypeScript-first

#### Interaction Model

| Action | Gesture | Result |
|:---|:---|:---|
| Add step from palette | Drag intent chip → drop on canvas zone | New step created with intent pre-filled |
| Add step via click | Click intent in palette | Step appended to end of canvas |
| Reorder step | Drag step by ≡ handle | Steps reorder with animated shift |
| Select step | Click step on canvas | Properties panel shows step config |
| Remove step | Click × on step card, or Delete key | Step removed, canvas reflows |
| Edit payload | Edit fields in Properties panel | Canvas step preview updates live |

---

### 2.4 Enhanced Library Cards

Replace flat text rows with **visual sequence cards** that show the domain composition.

```
┌──────────────────────────────────────┐
│ ▌ Stream Introduction         ⊷ OBS  │
│ ▌ 🖥️🏎️💬  3 steps · ~12s    BUILT-IN │
│ ▌ ████████████████████████  (no vars)│
└──────────────────────────────────────┘

┌──────────────────────────────────────┐
│ ▌ Show Replay for Driver      ⊷ MIX  │
│ ▌ 🏎️⏱️🖥️  5 steps · ~45s    BUILT-IN │
│ ▌ ██████░░██████████░░████  2 vars   │
└──────────────────────────────────────┘
```

**Visual elements per card:**
- **Left color strip**: 3px bar using the dominant domain color
- **Domain icon row**: Small icons showing which domains the sequence touches (de-duplicated)
- **Step composition bar**: A tiny horizontal stacked bar showing the proportion of steps per domain (like a GitHub language bar)
- **Variable indicator**: Pill showing var count if > 0
- **Executing state**: Pulsing left border + mini step counter overlay

**Step composition bar detail:**
```
OBS(blue)━━━━BROADCAST(orange)━━━━SYSTEM(grey)━━
```
A 100%-width, 3px-tall, rounded bar where each domain segment is proportionally sized and colored.

---

### 2.5 Execution Progress Visualization

Replace the text-only execution log with a **visual progress system**.

#### Progress Bar (Global)

When a sequence is executing, show a progress bar in the panel header:

```
 ⚡ SEQUENCE EXECUTOR          Step 3/5 · 60%
 ━━━━━━━━━━━━━━━━━━━░░░░░░░░░░░░░  1.2s / ~3.0s
```

#### Step State Machine (Visual)

Each step node on the timeline transitions through visual states:

| State | Node Style | Card Style |
|:---|:---|:---|
| **Pending** | Hollow circle, grey border | `opacity-50`, grey left-border |
| **Active** | Pulsing filled circle, orange | `border-primary/50`, subtle orange glow `shadow-[0_0_8px_rgba(255,95,31,0.2)]` |
| **Succeeded** | Solid green circle | Green left-border, `opacity-100` |
| **Failed** | Solid red circle with × | Red left-border, red tint `bg-destructive/5` |
| **Skipped** | Hollow yellow circle | Yellow left-border, `opacity-70`, strikethrough on intent |

#### Dashboard Widget Enhancement

Add a **ring progress indicator** to the dashboard card:

```
┌─ SEQUENCE EXECUTOR ──────────── ◉ ──┐
│                                      │
│         ╭───╮                        │
│        ╱ 3/5 ╲    Stream Intro       │
│       │  60%  │   Step 3: Wait...    │
│        ╲     ╱                       │
│         ╰───╯                        │
│                                      │
│  [    OPEN SEQUENCES    ]            │
└──────────────────────────────────────┘
```

The ring is an SVG circle with `stroke-dasharray` animated to show progress percentage.

---

### 2.6 Micro-Interactions & Polish

| Enhancement | Where | Detail |
|:---|:---|:---|
| **Selection transition** | Library → Detail | Crossfade or slide-in when selecting a different sequence |
| **Step expand/collapse** | Step cards in Detail | Click a step to expand payload; collapsed shows just intent + status |
| **Hover preview** | Library items | Hovering a sequence shows a tooltip with the first 3 step intents |
| **Keyboard shortcuts** | Builder canvas | `Ctrl+S` save, `Delete` remove step, `↑↓` navigate steps |
| **Empty canvas animation** | Builder | Subtle animated arrow pointing to the intent palette: "Drag an intent to begin" |
| **Success flash** | After execution | Brief green flash on the panel border when sequence completes successfully |
| **Shake on error** | Execute button | Brief shake animation when execution is blocked (missing required variables) |

---

## 3. Implementation Priority

| Priority | Enhancement | Effort | Impact |
|:---|:---|:---|:---|
| **P1** | Domain Icon System (§2.1) | Small | High — instant visual differentiation |
| **P1** | Vertical Timeline Rail (§2.2) | Medium | High — transforms step list from text to visual |
| **P1** | Progress Bar (§2.5 partial) | Small | High — execution feedback during runs |
| **P2** | Enhanced Library Cards (§2.4) | Medium | Medium — better scanning in the library |
| **P2** | Drag & Drop Builder (§2.3) | Large | High — the flagship visual builder feature |
| **P3** | Micro-Interactions (§2.6) | Small each | Medium — polish and delight |
| **P3** | Ring Progress on Dashboard (§2.5) | Small | Low-Medium — nice-to-have |

---

## 4. Technology Choices

| Concern | Choice | Rationale |
|:---|:---|:---|
| **Drag & Drop** | `@dnd-kit/core` + `@dnd-kit/sortable` | React-native hooks, TypeScript-first, accessible, small bundle |
| **SVG Progress Ring** | Inline SVG with `stroke-dasharray` | Zero dependencies, works with Tailwind, animatable |
| **Timeline CSS** | `::before`/`::after` pseudo-elements | No extra DOM, clean Tailwind integration via `@apply` |
| **Icons** | Lucide React (existing) | Already in the project, comprehensive icon set |
| **Animations** | `tailwindcss-animate` (existing) + `CSS transitions` | Already configured, no new dependency for basic transitions |

---

## 5. Mockup Reference

### 5.1 Step Card with Timeline Rail

```
                  ╭──╮
   completed ──── │✓│━━ 1. obs.switchScene ─────────── ✅ 42ms
                  ╰──╯  🖥️ OBS
                  │     sceneName: "Track Map"
                  │     transition: "fade"
                  │
                  ╭──╮
   completed ──── │✓│━━ 2. broadcast.muteDrivers ──── ✅ 15ms
                  ╰──╯  🏎️ BROADCAST
                  │     scope: "all"
                  │
                  ╭──╮
   active    ──── │◉│━━ 3. communication.announce ──── ⏳ running
                  ╰──╯  💬 COMMS                      ▓▓▓▓░░░░
                  │     message: "Safety Car..."
                  │
                  ╭──╮
   pending   ──── │○│━━ 4. system.wait ──────────────── ○
                  ╰──╯  ⚙️ SYS
                  ┊     durationMs: $var(returnDelayMs)
                  ┊
                  ╭──╮
   pending   ──── │○│━━ 5. obs.switchScene ──────────── ○
                  ╰──╯  🖥️ OBS
                        sceneName: "Live Race"
```

### 5.2 Intent Palette Chip

```
┌────────────────────┐
│ 🖥️  switchScene     │  ← Draggable chip
│ OBS                │
└────────────────────┘

┌────────────────────┐
│ 🏎️  selectCamera    │
│ BROADCAST          │
└────────────────────┘

┌────────────────────┐
│ ⏱️  wait            │
│ SYSTEM             │
└────────────────────┘
```

### 5.3 Drop Zone (Between Steps)

```
                          │
     ┌────────────────────────────────────────┐
     │  ┄┄┄┄┄ ⊕ Drop intent here ┄┄┄┄┄      │  ← Visible on drag-over
     └────────────────────────────────────────┘
                          │
```

### 5.4 Step Composition Bar (Library Card)

```
   Stream Introduction  ⊷ 3 steps · ~12s
   ┃━━━━━━━━━━━┃━━━━━━━━━━━┃━━━━━━━━━━━┃
      OBS(33%)    BCAST(33%)   COMMS(33%)
```

---

## 6. Architectural Constraint: OBS Browser Source Overlay

### 6.1 Requirement

Sequence Executor UI components must be **reusable as OBS overlays** via OBS Browser Source. This means a subset of the sequence UI (primarily execution progress visualization) must render in a **standalone web page** served over HTTP, with **no dependency on Electron APIs**.

OBS Browser Sources load a URL and composite it over the video output. This enables:
- **Live broadcast viewers** see what sequence is running (e.g., "Safety Car Protocol — Step 3/5")
- **Production value** — cinematic lower-third graphics showing automation activity
- **Transparency** — viewers can see what the Director AI is doing in real time

### 6.2 Current Architecture Gap

| Requirement | Current State |
|:---|:---|
| HTTP server to serve overlay HTML | **Does not exist** — must be created |
| WebSocket server for real-time push | **Does not exist** — need `ws` package |
| Components without `window.electronAPI` | **All components call IPC directly** — must be decoupled |
| Transparent background page | **Does not exist** — need standalone overlay SPA |
| Overlay view type | Type exists in `ViewRegistry` but has zero infrastructure |

### 6.3 Solution: Dual Transport Architecture

The key insight is a **Data Provider abstraction** that decouples UI components from their data transport.

#### Data Provider Interface

```typescript
interface SequenceDataProvider {
  // Queries
  listSequences(filter?: SequenceFilter): Promise<PortableSequence[]>;
  getSequence(id: string): Promise<PortableSequence | null>;
  getHistory(): Promise<ExecutionResult[]>;
  getIntents(): Promise<IntentCatalogEntry[]>;
  getEvents(): Promise<EventCatalogEntry[]>;

  // Commands
  execute(id: string, variables?: Record<string, unknown>): Promise<void>;
  cancel(): Promise<void>;

  // Subscriptions
  onProgress(callback: (progress: SequenceProgress) => void): () => void;
  onQueueChanged(callback: (queue: QueuedSequence[]) => void): () => void;
}
```

#### Two Implementations

| Provider | Transport | Used By |
|:---|:---|:---|
| `ElectronDataProvider` | `window.electronAPI` (IPC) | Electron renderer (main app) |
| `WebSocketDataProvider` | WebSocket + REST on `:9100` | OBS Browser Source overlay |

#### React Context Delivery

```tsx
const SequenceDataContext = React.createContext<SequenceDataProvider | null>(null);

// In Electron renderer:
<SequenceDataContext.Provider value={new ElectronDataProvider()}>
  <App />
</SequenceDataContext.Provider>

// In OBS overlay:
<SequenceDataContext.Provider value={new WebSocketDataProvider('ws://localhost:9100/ws')}>
  <OverlayApp />
</SequenceDataContext.Provider>
```

Components use `useSequenceData()` hook instead of calling `window.electronAPI` directly:

```tsx
function useSequenceData(): SequenceDataProvider {
  const ctx = React.useContext(SequenceDataContext);
  if (!ctx) throw new Error('SequenceDataProvider not found');
  return ctx;
}

// In any sequence component:
const { listSequences, onProgress } = useSequenceData();
```

### 6.4 Overlay Server (Main Process)

A lightweight HTTP + WebSocket server running in the Electron main process on port `9100`:

| Endpoint | Method | Purpose |
|:---|:---|:---|
| `/overlay` | GET | Serves the standalone overlay SPA (HTML + JS + CSS) |
| `/overlay?theme=lower-third` | GET | Query param selects overlay variant |
| `/overlay?theme=minimal` | GET | Compact status-only overlay |
| `/overlay?theme=timeline` | GET | Full horizontal timeline rail |
| `/api/sequences` | GET | REST: list sequences |
| `/api/sequences/:id` | GET | REST: get sequence detail |
| `/api/history` | GET | REST: execution history |
| `/ws` | WS | WebSocket: real-time progress, queue, and state events |

**Technology**: Node.js built-in `http` module + `ws` package (no Express needed — minimal surface area).

**WebSocket Message Protocol**:

```typescript
// Server → Client messages
type OverlayMessage =
  | { type: 'connected'; sequences: PortableSequence[]; intents: IntentCatalogEntry[] }
  | { type: 'progress'; data: SequenceProgress }
  | { type: 'queue-changed'; data: QueuedSequence[] }
  | { type: 'history-changed'; data: ExecutionResult[] }
  | { type: 'complete'; data: ExecutionResult }
  | { type: 'error'; message: string };

// Client → Server messages (for bidirectional future use)
type OverlayCommand =
  | { type: 'subscribe'; topics: ('progress' | 'queue' | 'history')[] }
  | { type: 'execute'; sequenceId: string; variables?: Record<string, unknown> };
```

### 6.5 Overlay Themes

The overlay SPA supports multiple visual themes via query parameter, all sharing the same components but with different layouts:

#### Lower Third (`?theme=lower-third`)

Positioned at the bottom of the 1920×1080 canvas. Shows during sequence execution, auto-hides after completion.

```
┌───────────────────────────────────────────────────────────────────────┐
│                                                                       │
│                    (transparent — live video shows through)            │
│                                                                       │
│                                                                       │
│                                                                       │
├───────────────────────────────────────────────────────────────────────┤
│ ⚡ SAFETY CAR PROTOCOL                                      Step 3/5 │
│ ●━━━━━━━●━━━━━━━●━━━━━━━◉━━━━━━━○━━━━━━━○                           │
│ Switch   Mute    Announce Wait    Return                    ⏱️ 1.2s  │
│ ██████████████████████████░░░░░░░░░░░░░░░  60%                       │
└───────────────────────────────────────────────────────────────────────┘
```

- **Horizontal timeline rail** (not vertical — broadcast-appropriate)
- Semi-transparent dark background (`#090B10CC`)
- Auto-enter on execution start (slide up), auto-exit on complete (slide down)
- Domain-colored step nodes on the rail

#### Minimal (`?theme=minimal`)

Corner badge — small, unobtrusive. Good for "always-on" status.

```
                                            ┌──────────────────────┐
                                            │ ⚡ Safety Car  3/5   │
                                            │ ██████████░░░░  60%  │
                                            └──────────────────────┘
```

- Fixed top-right position
- Shows sequence name + progress
- Fades in/out on execution start/end

#### Timeline (`?theme=timeline`)

Full horizontal timeline for dedicated "director cam" views:

```
┌───────────────────────────────────────────────────────────────────────┐
│                                                                       │
│  ⚡ SAFETY CAR PROTOCOL — v1.0.0 — EXECUTING                        │
│                                                                       │
│  ✅━━━━━━━━✅━━━━━━━━⏳━━━━━━━━○━━━━━━━━○                            │
│  Switch    Mute     Announce  Wait      Return                       │
│  Scene     Drivers  Chat      30s       Live                         │
│  42ms      15ms     running…  pending   pending                      │
│                                                                       │
│  ██████████████████████████████░░░░░░░░░░░░░░░░░░  60% · 1.2s       │
│                                                                       │
└───────────────────────────────────────────────────────────────────────┘
```

### 6.6 Build Architecture

Vite multi-entry configuration to produce two bundles from one source tree:

```typescript
// vite.config.ts — overlay build
export default defineConfig({
  build: {
    rollupOptions: {
      input: {
        main: 'index.html',           // Electron renderer
        overlay: 'overlay/index.html', // OBS Browser Source
      },
    },
  },
});
```

**Shared source** (`src/renderer/components/sequences/*`) imports no Electron APIs directly — all data access goes through the `SequenceDataProvider` context.

**Overlay entry** (`src/overlay/main.tsx`) imports only the subset of components needed for broadcast overlays + the `WebSocketDataProvider`.

### 6.7 Component Reuse Matrix

| Component | Electron App | OBS Overlay | Notes |
|:---|:---|:---|:---|
| `SequenceStepCard` | ✅ Detail view | ✅ Timeline theme | Core reusable unit |
| `IntentBadge` / `IntentDomainBadge` | ✅ Everywhere | ✅ Timeline labels | Pure display |
| `SequenceExecutionLog` | ✅ Detail view | ❌ Not overlay-appropriate | Too text-heavy for broadcast |
| `SequenceLibrary` | ✅ Panel | ❌ No browsing in overlay | Not relevant |
| `SequenceBuilder` | ✅ Panel | ❌ Not overlay-appropriate | Author-side only |
| `SequenceVariablesForm` | ✅ Detail view | ❌ No input in overlay | Author-side only |
| `ProgressBar` (new) | ✅ Detail + Dashboard | ✅ All themes | New shared component |
| `TimelineRail` (new) | ✅ Detail view (vertical) | ✅ Overlay (horizontal) | Orientation prop |
| `ProgressRing` (new) | ✅ Dashboard widget | ✅ Minimal theme | New shared component |
| `SequencesDashboardCard` | ✅ Dashboard | ❌ Wrong form factor | Electron-only |

### 6.8 CSS Considerations for OBS

OBS Browser Sources require specific CSS patterns:

```css
/* Overlay root — transparent for OBS compositing */
body {
  background: transparent !important;
  overflow: hidden;
  margin: 0;
}

/* Semi-transparent containers for readability over video */
.overlay-panel {
  background: rgba(9, 11, 16, 0.85);        /* --background at 85% opacity */
  backdrop-filter: blur(8px);                 /* Glass effect */
  border: 1px solid rgba(40, 42, 48, 0.6);   /* --border at 60% opacity */
}

/* Animations must be CSS-only (no JS requestAnimationFrame) for OBS performance */
.overlay-enter { animation: slideUp 0.4s cubic-bezier(0.16, 1, 0.3, 1); }
.overlay-exit  { animation: slideDown 0.3s cubic-bezier(0.7, 0, 0.84, 0); }

@keyframes slideUp {
  from { transform: translateY(100%); opacity: 0; }
  to   { transform: translateY(0); opacity: 1; }
}
```

### 6.9 Impact on Phase 2 Implementation

This constraint **elevates several P1 items** and adds new work:

| Item | Original Priority | New Priority | Reason |
|:---|:---|:---|:---|
| Timeline Rail (§2.2) | P1 | **P0** | Core overlay component — must support both vertical (app) and horizontal (overlay) |
| Progress Bar (§2.5) | P1 | **P0** | Required for every overlay theme |
| Domain Icon System (§2.1) | P1 | P1 | Used in overlay timeline labels |
| Data Provider abstraction | N/A | **P0** | Must decouple all components from `window.electronAPI` before any visual work |
| Overlay Server | N/A | **P0** | HTTP + WebSocket server in main process |
| Overlay entry point + themes | N/A | **P1** | Standalone SPA with theme selector |
| `@dnd-kit` Drag & Drop (§2.3) | P2 | P2 | Electron-only, not affected by overlay constraint |

### 6.10 New Dependency

```bash
npm install ws
npm install -D @types/ws
```

`ws` is the standard Node.js WebSocket library (~50KB). It runs in the main process only — the overlay client uses the browser-native `WebSocket` API.

### 6.11 OBS Setup Instructions (User-Facing)

When implemented, users add the overlay in OBS via:

1. **Sources** → **+** → **Browser**
2. **URL**: `http://localhost:9100/overlay?theme=lower-third`
3. **Width**: `1920`, **Height**: `1080`
4. **Custom CSS**: *(none needed — transparency handled internally)*
5. **FPS**: `30` (sufficient for status updates)

The overlay connects automatically when Director is running and reconnects on disconnection.

---

## 7. Revised Implementation Priority

| Priority | Enhancement | Effort | Impact |
|:---|:---|:---|:---|
| **P0** | Data Provider abstraction + React Context | Medium | **Critical** — unblocks all component sharing |
| **P0** | Overlay Server (HTTP + WebSocket) | Medium | **Critical** — enables OBS Browser Source |
| **P0** | Timeline Rail component (vertical + horizontal) | Medium | High — core visual for both app and overlay |
| **P0** | Progress Bar component | Small | High — required for all overlay themes |
| **P1** | Domain Icon System (§2.1) | Small | High — used in overlay timeline labels |
| **P1** | Overlay SPA entry point + 3 themes | Medium | High — the deliverable overlay |
| **P1** | Enhanced Library Cards (§2.4) | Medium | Medium — Electron app only |
| **P2** | Drag & Drop Builder (§2.3) | Large | High — Electron app only, not overlay-affected |
| **P3** | Micro-Interactions (§2.6) | Small each | Medium — polish |

---

## 8. Open Questions

| # | Question | Options |
|:---|:---|:---|
| 1 | Should the three-panel builder layout replace the current two-panel layout globally, or only activate in "edit" mode? | A) Always three-panel / B) Two-panel for viewing, three-panel for editing |
| 2 | Should `@dnd-kit` be added now or deferred to avoid scope creep? | A) Add in Phase 2 / B) Defer to Phase 3 |
| 3 | Should collapsed step cards be the default in Detail view, expanding on click? | A) All expanded (current) / B) Collapsed, expand on click / C) Smart: collapse payload if > 3 fields |
| 4 | Should the progress ring SVG live in the Dashboard widget or use a shared component? | A) Dashboard-only / B) Shared `<ProgressRing>` component |
| 5 | Should the overlay server port be configurable or fixed at `9100`? | A) Fixed `9100` / B) Configurable via Settings page |
| 6 | Should the overlay support bidirectional control (execute sequences from OBS)? | A) Read-only (progress display) / B) Bidirectional (allow triggering from overlay) |
| 7 | Should overlay themes be bundled or user-creatable (custom HTML/CSS templates)? | A) Bundled only / B) Allow custom themes from a themes directory |
