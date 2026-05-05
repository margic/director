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

## 6. Architectural Constraint: OBS Broadcast Overlay System

### 6.1 Requirement

The Director app must serve a **broadcast overlay** via OBS Browser Source that shows **what the Director is doing** in human-readable, broadcast-quality graphics. This is **not** the sequence editor — viewers never see intent IDs, payloads, or technical internals. They see a cinematic representation of Director activity.

**Critical distinction:**

| Audience | Sees | Example |
|:---|:---|:---|
| **Director operator** (Electron app) | Intent IDs, payload key-values, variable references, execution logs | `obs.switchScene` → `sceneName: "Track Map"` |
| **Broadcast viewers** (OBS overlay) | Human-readable activity labels, progress, race info | "Switching to Track Overview" · Step 3/5 |

Additionally, the overlay must be **extensible** — not hardcoded to sequence progress. Any extension should be able to contribute its own overlay graphics:

| Extension | Could Contribute |
|:---|:---|
| **Sequence Executor** | "Safety Car Protocol — Step 3/5" activity indicator |
| **iRacing** | Lap counter, flag status, leader board, timing gaps |
| **Discord** | Voice channel status, who's speaking |
| **YouTube** | Live chat ticker, viewer count |
| **OBS** | Current scene name, recording/streaming status |

### 6.2 Design: Extensible Overlay Host

The overlay is **not** a UI component reuse play. It's a dedicated **broadcast graphics system** with its own architecture:

#### 6.2.1 Region-Based Layout

The 1920×1080 overlay canvas is divided into **named regions** — fixed screen areas that extensions claim:

```
┌─────────────────────────────────────────────────────────────────────┐
│ corner-top-left         top-bar                   corner-top-right  │
│ ┌────────────┐  ┌──────────────────────────────┐  ┌─────────────┐  │
│ │            │  │                              │  │             │  │
│ └────────────┘  └──────────────────────────────┘  └─────────────┘  │
│                                                                     │
│                        center-popup                                 │
│                  ┌──────────────────────┐                           │
│                  │                      │                           │
│                  └──────────────────────┘                           │
│                                                                     │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │  ticker (full-width, scrolling)                             │   │
│  └─────────────────────────────────────────────────────────────┘   │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │  lower-third (full-width)                                   │   │
│  └─────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────┘
```

| Region | Position | Typical Use |
|:---|:---|:---|
| `top-bar` | Top center, full width | Race info: lap, flag, leader |
| `corner-top-left` | Top left | Logo, session name |
| `corner-top-right` | Top right | Voice status, viewer count |
| `lower-third` | Bottom, full width | Director activity, sequence progress |
| `ticker` | Above lower third, full width | Chat feed, news ticker |
| `center-popup` | Center, modal | Alerts: safety car, red flag, winner |

Regions are **empty by default** — completely transparent until an extension sends content. Multiple extensions cannot claim the same region simultaneously; the most recent update wins, or priority is configurable.

#### 6.2.2 Extension Manifest: `contributes.overlays`

Extensions declare overlay contributions in their `package.json` manifest, following the existing `contributes` pattern:

```json
{
  "name": "director-iracing",
  "contributes": {
    "intents": [ ... ],
    "events": [ ... ],
    "overlays": [
      {
        "id": "race-info",
        "region": "top-bar",
        "title": "Race Information Bar",
        "description": "Shows lap count, flag status, leader, and timing gaps",
        "template": "race-info"
      },
      {
        "id": "flag-alert",
        "region": "center-popup",
        "title": "Flag Change Alert",
        "description": "Full-screen flag change announcement",
        "template": "flag-alert",
        "autoHide": 5000
      }
    ]
  }
}
```

#### 6.2.3 Extension API: Overlay Methods

Extensions get three new methods on their API surface during `activate()`:

```typescript
interface ExtensionOverlayAPI {
  /**
   * Send data to update the overlay region.
   * The overlay host renders this data using the declared template.
   */
  updateOverlay(overlayId: string, data: Record<string, unknown>): void;

  /**
   * Show the overlay (trigger enter animation).
   * Called automatically on first updateOverlay() if not already visible.
   */
  showOverlay(overlayId: string): void;

  /**
   * Hide the overlay (trigger exit animation).
   */
  hideOverlay(overlayId: string): void;
}
```

Usage in an extension:

```typescript
// In iracing extension activate()
export function activate(context: ExtensionContext) {
  // ... existing intent handler registration ...

  // When telemetry updates arrive:
  iracingSDK.on('telemetry', (data) => {
    context.updateOverlay('race-info', {
      lap: `${data.currentLap}/${data.totalLaps}`,
      flag: data.flagState,            // "green" | "yellow" | "red" | "white" | "checkered"
      leader: data.leaderName,
      leaderCarNum: data.leaderCarNum,
      gap: data.gapToLeader,
    });
  });

  iracingSDK.on('flagChanged', (flag) => {
    context.showOverlay('flag-alert');
    context.updateOverlay('flag-alert', {
      flag: flag.type,
      message: flag.description,    // "YELLOW FLAG — Caution on track"
    });
    // autoHide: 5000 in manifest handles the exit
  });
}
```

#### 6.2.4 Templates: How Data Becomes Graphics

Extensions send **structured data** — not HTML. The overlay host maps data to visual templates. This separation means:

- Extensions don't need to know about CSS, animations, or broadcast aesthetics
- Templates can be themed/branded consistently
- The overlay host controls layout, timing, and transitions

**Built-in templates:**

| Template ID | Renders | Data Shape |
|:---|:---|:---|
| `race-info` | Horizontal bar with key stats | `{ lap, flag, leader, gap }` |
| `status-badge` | Small corner badge with icon + text | `{ icon, label, detail }` |
| `ticker` | Scrolling horizontal text feed | `{ messages: [{ text, author?, time }] }` |
| `activity-progress` | Progress bar with label + step count | `{ title, step, total, label }` |
| `flag-alert` | Full-width centered alert with flag color | `{ flag, message }` |
| `standings` | Mini leaderboard table | `{ positions: [{ pos, name, gap }] }` |

Extensions can also provide **custom templates** as HTML files in their package, referenced by path instead of built-in ID:

```json
{
  "overlays": [{
    "id": "custom-timing",
    "region": "top-bar",
    "templatePath": "overlay/timing-tower.html"
  }]
}
```

### 6.3 Sequence Executor Overlay Contribution

The Sequence Executor registers as an overlay contributor using the same system — it's not special-cased:

```typescript
// In sequence-scheduler.ts or main.ts initialization
overlayBus.registerOverlay('sequences', {
  id: 'director-activity',
  region: 'lower-third',
  title: 'Director Activity',
  template: 'activity-progress',
});

// On progress events:
sequenceScheduler.on('progress', (progress: SequenceProgress) => {
  overlayBus.updateOverlay('sequences.director-activity', {
    title: progress.sequenceName,             // "Safety Car Protocol"
    step: progress.currentStep,                // 3
    total: progress.totalSteps,                // 5
    label: progress.stepLabel || progress.stepIntent,  // "Switching to Track Overview" (label) or fallback to intent ID
  });
});

// On sequence complete:
sequenceScheduler.on('complete', (result) => {
  // Auto-hide after 3 seconds
  setTimeout(() => overlayBus.hideOverlay('sequences.director-activity'), 3000);
});
```

**Key detail:** The overlay shows `progress.stepLabel` — the human-readable label from `step.metadata.label` — **not** the intent ID. If no label exists, a human-readable fallback is generated from the intent:

```typescript
function humanizeIntent(intent: string): string {
  // "obs.switchScene" → "Switching Scene"
  // "broadcast.muteDrivers" → "Muting Drivers"  
  // "communication.talkToChat" → "Sending Chat Message"
  const [domain, action] = intent.split('.');
  return action
    .replace(/([A-Z])/g, ' $1')     // camelCase → spaced
    .replace(/^./, c => c.toUpperCase())
    .trim();
}
```

### 6.4 Overlay Server (Main Process)

A lightweight HTTP + WebSocket server running in the Electron main process on port `9100`:

| Endpoint | Method | Purpose |
|:---|:---|:---|
| `/overlay` | GET | Serves the overlay host SPA (HTML + JS + CSS) |
| `/overlay?regions=lower-third,top-bar` | GET | Optional: only render specified regions |
| `/api/overlays` | GET | REST: list registered overlay slots + current state |
| `/ws` | WS | WebSocket: real-time overlay updates |

**Technology**: Node.js built-in `http` module + `ws` package (no Express needed — minimal surface area).

**WebSocket Message Protocol**:

```typescript
// Server → Client messages
type OverlayServerMessage =
  | { type: 'connected'; overlays: OverlaySlot[] }           // Initial state on connect
  | { type: 'overlay:registered'; overlay: OverlaySlot }     // New overlay added
  | { type: 'overlay:update'; id: string; data: Record<string, unknown> }  // Data update
  | { type: 'overlay:show'; id: string }                     // Trigger enter animation
  | { type: 'overlay:hide'; id: string }                     // Trigger exit animation
  | { type: 'overlay:unregistered'; id: string }             // Extension deactivated

// Overlay slot definition
interface OverlaySlot {
  id: string;              // "iracing.race-info"
  extensionId: string;     // "director-iracing"
  region: OverlayRegion;
  title: string;
  template: string;
  autoHide?: number;       // ms before auto-exit animation
  data?: Record<string, unknown>;  // Current state (for late-joining clients)
  visible: boolean;
}

type OverlayRegion =
  | 'top-bar'
  | 'lower-third'
  | 'ticker'
  | 'center-popup'
  | 'corner-top-left'
  | 'corner-top-right';
```

### 6.5 Overlay Host SPA

The overlay host is a standalone web page that:

1. Connects to `ws://localhost:9100/ws`
2. Receives the initial overlay slot registry
3. Renders each region as an absolutely-positioned `<div>` on a transparent 1920×1080 canvas
4. Listens for `overlay:update` messages and re-renders the appropriate region using the declared template
5. Applies enter/exit CSS animations on `overlay:show` / `overlay:hide`

```
┌─────────────────────────────────────────────────────────────────────┐
│                                                                     │
│  top-bar: 🏁 Lap 12/45 · GREEN · Leader: #63 Verstappen · +1.234s │
│                                        corner-tr: 🎙️ 3 connected  │
│                                                                     │
│                                                                     │
│           (transparent — live video shows through)                  │
│                                                                     │
│                                                                     │
│  ticker: 💬 RaceFan42: Great battle!  ·  SpeedKing: Go #63!        │
│                                                                     │
│  lower-third: 🏁 RACE DIRECTOR · Safety Car Protocol               │
│               Announcing Safety Car in chat · Step 3/5              │
│               ████████████████████░░░░░░░░  60%                     │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

Extensions are **completely unaware** of overlay rendering, CSS, or OBS. They only call `updateOverlay(id, data)` — the host does the rest.

### 6.6 CSS Considerations for OBS

OBS Browser Sources require specific CSS patterns:

```css
/* Overlay root — transparent for OBS compositing */
body {
  background: transparent !important;
  overflow: hidden;
  margin: 0;
  width: 1920px;
  height: 1080px;
}

/* Semi-transparent containers for readability over video */
.overlay-region {
  position: absolute;
  background: rgba(9, 11, 16, 0.85);        /* --background at 85% opacity */
  backdrop-filter: blur(8px);                 /* Glass effect */
  border: 1px solid rgba(40, 42, 48, 0.6);   /* --border at 60% opacity */
}

/* Region positions */
.region-top-bar       { top: 0; left: 10%; right: 10%; }
.region-lower-third   { bottom: 0; left: 5%; right: 5%; }
.region-corner-top-right { top: 16px; right: 16px; }
.region-corner-top-left  { top: 16px; left: 16px; }
.region-center-popup  { top: 50%; left: 50%; transform: translate(-50%, -50%); }
.region-ticker        { bottom: 120px; left: 5%; right: 5%; }

/* Animations — CSS-only for OBS performance */
.overlay-enter { animation: slideUp 0.4s cubic-bezier(0.16, 1, 0.3, 1) forwards; }
.overlay-exit  { animation: slideDown 0.3s cubic-bezier(0.7, 0, 0.84, 0) forwards; }

@keyframes slideUp {
  from { transform: translateY(100%); opacity: 0; }
  to   { transform: translateY(0); opacity: 1; }
}
@keyframes slideDown {
  from { transform: translateY(0); opacity: 1; }
  to   { transform: translateY(100%); opacity: 0; }
}
```

### 6.7 Component Relationship: Electron App vs Overlay

The Electron app (sequence editor) and the OBS overlay are **completely separate UI surfaces** with no shared React components:

| Concern | Electron App | OBS Overlay |
|:---|:---|:---|
| **Purpose** | Operator tool — edit, inspect, execute | Broadcast graphic — show activity to viewers |
| **Audience** | Director operator on rig PC | Stream viewers on Twitch/YouTube |
| **Data detail** | Full: intent IDs, payloads, variables, logs | Minimal: human labels, progress, status |
| **Interactivity** | Full: click, type, drag, execute | Read-only: no mouse/keyboard interaction |
| **Layout** | Two-panel responsive layout | Absolute-positioned 1920×1080 regions |
| **React components** | SequenceEditor, Builder, Library, etc. | Overlay templates (race-info, activity-progress, etc.) |
| **Data transport** | `window.electronAPI` (Electron IPC) | WebSocket → template rendering |
| **Background** | `bg-background` (#090B10) solid | `transparent` for OBS compositing |

**What IS shared:**
- Design tokens (colors, fonts, brand identity)
- TypeScript types (`SequenceProgress`, `OverlaySlot`, etc.)
- Tailwind config (so overlay templates match the brand aesthetic)

**What is NOT shared:**
- React components — the overlay templates are purpose-built for broadcast
- Data providers — no `SequenceDataProvider` abstraction needed since the surfaces serve entirely different purposes
- Layout patterns — fixed 1920×1080 absolute positioning vs responsive flex layout

### 6.8 Build Architecture

```
src/
  renderer/           → Electron app (existing)
  overlay/            → OBS overlay host (new)
    main.tsx          → Overlay SPA entry
    OverlayHost.tsx   → Region layout + WebSocket connection
    templates/        → Built-in overlay templates
      RaceInfoBar.tsx
      ActivityProgress.tsx
      StatusBadge.tsx
      ChatTicker.tsx
      FlagAlert.tsx
      Standings.tsx
```

Vite multi-entry build:

```typescript
// vite.config.ts
build: {
  rollupOptions: {
    input: {
      main: 'index.html',           // Electron renderer
      overlay: 'overlay/index.html', // OBS Browser Source
    },
  },
}
```

### 6.9 Impact on Phase 2 Implementation

| Item | Priority | Reason |
|:---|:---|:---|
| Overlay Bus + Extension API (`registerOverlay`, `updateOverlay`, `hideOverlay`) | **P0** | Core infrastructure — all overlays depend on this |
| Overlay Server (HTTP + WebSocket) | **P0** | Serves the overlay to OBS |
| Overlay Host SPA + region layout | **P0** | The canvas that renders everything |
| `activity-progress` template (Sequence Executor) | **P1** | First overlay contributor |
| `race-info` template + iRacing overlay registration | **P1** | Highest-value broadcast graphic |
| Extension manifest `contributes.overlays` parsing | **P1** | Enables declarative overlay registration |
| Additional templates (ticker, badge, flag-alert) | **P2** | Expand as extensions need them |
| Custom template support (extension-provided HTML) | **P3** | Future extensibility |

### 6.10 New Dependency

```bash
npm install ws
npm install -D @types/ws
```

### 6.11 OBS Setup Instructions (User-Facing)

1. **Sources** → **+** → **Browser**
2. **URL**: `http://localhost:9100/overlay`
3. **Width**: `1920`, **Height**: `1080`
4. **Custom CSS**: *(none — transparency built in)*
5. **FPS**: `30`

Optional: filter to specific regions: `http://localhost:9100/overlay?regions=lower-third,top-bar`

---

## 7. Revised Implementation Priority

| Priority | Enhancement | Effort | Impact |
|:---|:---|:---|:---|
| **P0** | Overlay Bus + Extension API (`registerOverlay`, `updateOverlay`, `hideOverlay`) | Medium | **Critical** — core infrastructure for all overlay contributions |
| **P0** | Overlay Server (HTTP + WebSocket on `:9100`) | Medium | **Critical** — serves overlay to OBS |
| **P0** | Overlay Host SPA + region layout | Medium | **Critical** — the canvas that renders everything |
| **P1** | `activity-progress` template (Sequence Executor contribution) | Small | High — first overlay contributor |
| **P1** | `race-info` template + iRacing overlay registration | Small | High — highest-value broadcast graphic |
| **P1** | Extension manifest `contributes.overlays` parsing in Extension Host | Medium | High — enables declarative overlay registration |
| **P1** | Domain Icon System (§2.1) — Electron app | Small | High — instant visual improvement in operator UI |
| **P1** | Vertical Timeline Rail (§2.2) — Electron app | Medium | High — transforms step list in operator UI |
| **P1** | Progress Bar (§2.5) — Electron app | Small | High — execution feedback in operator UI |
| **P2** | Enhanced Library Cards (§2.4) — Electron app | Medium | Medium — better scanning |
| **P2** | Drag & Drop Builder (§2.3) — Electron app | Large | High — flagship builder feature |
| **P2** | Additional overlay templates (ticker, badge, flag-alert, standings) | Medium | Medium — expand as extensions need them |
| **P3** | Micro-Interactions (§2.6) — Electron app | Small each | Medium — polish |

> Note: Custom template support has been promoted from P3 to P1 per Decision Q7 — see implementation plan.

---

## 8. Open Questions — RESOLVED

All questions resolved on 2026-02-14. See `documents/implementation_plan_ux_enhancements.md` §0 for full rationale.

| # | Question | Decision |
|:---|:---|:---|
| 1 | Three-panel builder: always or edit-mode only? | **A) Always three-panel** |
| 2 | Add `@dnd-kit` now or defer? | **A) Add in Phase 2** |
| 3 | Step cards default expanded or collapsed? | **B) All collapsed, expand on click** |
| 4 | Progress ring: dashboard-only or shared? | **B) Shared `<ProgressRing>` component** |
| 5 | Overlay server port: fixed or configurable? | **B) Configurable via Settings, default 9100** |
| 6 | Region conflict resolution? | **C) User picks in Settings** |
| 7 | Overlay templates: bundled or extension-provided? | **Extension-provided HTML (no sandboxing — trusted codebase)** |
| 8 | Admin panel for overlay regions? | **A) Yes, in Settings** |
