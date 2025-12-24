# Sim RaceCenter Brand Kit & Component Library

This document serves as the "Brand Folder" for developers and designers. It contains the visual scheme (colors, typography) and a library of ready-to-use HTML/Tailwind components.

## 1. Core Identity
**Keywords:** Data-Driven, Precision, Cinematic, Control Room Vibe.
**Concept:** "The Racing is Real" - AI-Powered Broadcast Producer.

## 2. Brand Scheme

### 2.1 Color Palette
The UI is designed to be high-contrast and cinematic, not monochromatic. Use the **Cockpit Grey** surface to create distinct layers against the **Race Control** background.

| Role | Color Name | Hex | Tailwind Class | Usage |
| :--- | :--- | :--- | :--- | :--- |
| **Primary Action** | **Apex Orange** | `#FF5F1F` | `bg-brand-orange` | Call-to-actions, Highlights, "Live" status, Active states. |
| **AI / Data** | **Telemetry Blue** | `#0EA5E9` | `bg-brand-blue` | Data visualization, Information, AI Agents, Secondary accents. |
| **Background** | **Race Control** | `#05070A` | `bg-bg-base` | Main application background (Deepest Black). |
| **Surface** | **Cockpit Grey** | `#111827` | `bg-bg-elevated` | Cards, Sidebars, Modals, Panels. **Crucial for contrast.** |
| **Flag Yellow** | **Racing Flag Yellow** | `#FBBF24` | `text-yellow-400` | Caution alerts, warnings, yellow flag sectors. |
| **Flag Red** | **Racing Flag Red** | `#EF4444` | `text-red-500` | Critical failures, stop alerts, red flag sessions. |

### 2.2 Typography
*   **Headings:** Inter (**ExtraBold**). Use for page titles, marketing copy, and major section headers.
*   **Body:** Inter (Regular). Use for general UI text, labels, and descriptions.
*   **Data:** Monospace (or Inter with tabular nums). Use for timers, lap deltas, telemetry, and coordinates.

## 3. Reference Components

Copy these snippets directly into your layout to maintain brand consistency.

### 3.1 Buttons

**Primary Action (Start Engine)**
High visibility, used for the main action on a page.
```html
<button class="px-5 py-2.5 bg-brand-orange hover:bg-brand-orangeDim text-black text-sm font-bold rounded shadow-[0_0_20px_rgba(255,99,31,0.3)] hover:scale-105 transition-all flex items-center gap-2">
    Start Session
    <i data-lucide="arrow-right" class="w-4 h-4"></i>
</button>
```

**Secondary / Ghost (Settings, Cancel)**
Low prominence, used for secondary tasks.
```html
<button class="px-5 py-2.5 text-text-muted hover:text-white hover:bg-white/5 rounded text-sm font-medium transition-colors">
    Configure Settings
</button>
```

**Destructive / Live (Stop Broadcast)**
Used for stopping live events or deleting data.
```html
<button class="px-3 py-1 bg-red-600 hover:bg-red-700 text-white text-xs font-bold rounded flex items-center gap-2 shadow-[0_0_10px_rgba(220,38,38,0.5)]">
    <div class="w-2 h-2 bg-white rounded-full animate-pulse"></div>
    STOP BROADCAST
</button>
```

### 3.2 Status Indicators & Badges

**Live / Connected**
```html
<!-- Green Connected -->
<span class="px-1.5 py-0.5 rounded text-[10px] font-bold bg-green-500/20 text-green-500 border border-green-500/30">
    CONNECTED
</span>

<!-- Orange Warning/Action Needed -->
<span class="px-1.5 py-0.5 rounded text-[10px] font-bold bg-brand-orange/10 text-brand-orange border border-brand-orange/20">
    ACTION REQUIRED
</span>

<!-- Yellow Caution -->
<span class="px-1.5 py-0.5 rounded text-[10px] font-bold bg-yellow-500/10 text-yellow-400 border border-yellow-500/30">
    YELLOW FLAG
</span>

<!-- Red Critical -->
<span class="px-1.5 py-0.5 rounded text-[10px] font-bold bg-red-500/10 text-red-500 border border-red-500/30">
    RED FLAG
</span>
```

### 3.3 Cards & Containers

**Standard Dashboard Card**
The standard container for any content in the Director Console. Note the use of `bg-bg-elevated` (Cockpit Grey) to stand out from the background.
```html
<div class="bg-bg-elevated border border-border-strong rounded-xl p-4">
    <div class="flex justify-between items-center mb-4">
        <h3 class="text-xs font-bold text-text-muted uppercase tracking-wider">
            Card Title
        </h3>
        <button class="text-text-subtle hover:text-white">
            <i data-lucide="more-horizontal" class="w-4 h-4"></i>
        </button>
    </div>
    <!-- Content goes here -->
    <div class="text-text-primary text-sm">
        Panel content...
    </div>
</div>
```

**AI Suggestion Card (Interactive)**
Used for the "AI Director" suggestions stream.
```html
<div class="p-3 bg-bg-base border border-brand-orange rounded-lg shadow-[0_0_10px_rgba(255,99,31,0.1)] group cursor-pointer hover:bg-brand-orange/5 transition-colors">
    <div class="flex justify-between items-start mb-2">
        <span class="text-[10px] font-bold text-brand-orange bg-brand-orange/10 px-1.5 py-0.5 rounded">
            SUGGESTION
        </span>
        <span class="text-[10px] text-text-muted">Now</span>
    </div>
    <p class="text-sm text-white font-medium mb-2">
        Overtake detected at Turn 4.
    </p>
    <button class="w-full py-1.5 bg-brand-orange hover:bg-brand-orangeDim text-black text-xs font-bold rounded transition-colors opacity-80 group-hover:opacity-100">
        Switch Camera
    </button>
</div>
```

### 3.4 Data Visualizations

**Progress Bar (Telemetry)**
```html
<div class="w-full bg-bg-subtle rounded-full h-2 overflow-hidden">
    <div class="bg-brand-blue h-full rounded-full" style="width: 75%"></div>
</div>
```

**Metric Unit (Speed/RPM)**
```html
<div class="flex flex-col">
    <span class="text-[10px] text-text-muted uppercase font-bold">Speed</span>
    <span class="text-xl font-mono font-bold text-white leading-none">
        214 <span class="text-xs text-text-subtle font-sans">KPH</span>
    </span>
</div>
```

## 4. Logo Assets

**Scalable SVG Logo**
Use this code block to insert the logo anywhere. It inherits the text color (fill="currentColor").
```html
<svg width="24" height="24" viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg">
    <!-- Top Swoosh -->
    <path d="M10 75 C 10 35, 45 15, 95 15 L 95 30 C 55 30, 25 50, 25 75 Z" fill="currentColor"/>
    <!-- Middle Swoosh -->
    <path d="M20 85 C 20 55, 45 40, 85 38 L 85 52 C 55 54, 35 65, 35 85 Z" fill="currentColor"/>
    <!-- Bottom Swoosh -->
    <path d="M30 95 C 30 75, 50 65, 75 62 L 75 72 C 60 74, 42 80, 42 95 Z" fill="currentColor"/>
</svg>
```
