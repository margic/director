# Feature: Merged Dynamic Header

## Problem

The application has a "double header" layout issue. The Global App Bar renders a static "RACE CONTROL DIRECTOR" title, and every page/extension renders its own H1 title immediately below it. This wastes ~48px of vertical space that is critical on sim rig screens and tablets.

**Before (2 rows of headers):**

```
┌──────────────────────────────────────────────────────────────────────┐
│ RACE CONTROL DIRECTOR  [SYSTEM ONLINE]                    User ▾    │  ← App Bar (h-16)
├──────────────────────────────────────────────────────────────────────┤
│ ⚡ SEQUENCE EXECUTOR  3 sequences · 11 intents                      │  ← Page H1 (~h-12)
├──────────────────────────────────────────────────────────────────────┤
│ Content starts here...                                              │
```

**After (single merged header):**

```
┌──────────────────────────────────────────────────────────────────────┐
│ ⚡ SEQUENCE EXECUTOR  ┃3 sequences · 11 intents┃ [ONLINE]  User ▾   │  ← Merged (h-16)
├──────────────────────────────────────────────────────────────────────┤
│ Content starts here...                                              │
```

**Vertical space reclaimed: ~48px**

---

## Architecture: `PageHeaderContext`

A React context allows each page to declare its header content on mount without prop-drilling through App.tsx.

### New file: `src/renderer/contexts/PageHeaderContext.tsx`

```tsx
interface PageHeaderState {
  title: string;              // "SEQUENCE EXECUTOR", "OBS CONTROL", etc.
  icon?: LucideIcon;          // Zap, Settings, Car, Aperture, etc.
  subtitle?: string;          // "3 sequences · 11 intents", "Connected", etc.
  subtitleVariant?: 'default' | 'success' | 'danger';
  actions?: ReactNode;        // Optional right-aligned actions (back button, tab bar, etc.)
}
```

- `PageHeaderProvider` wraps the main content area in App.tsx.
- `useSetPageHeader(state)` — each page calls this on mount / when data changes.
- `usePageHeader()` — App.tsx consumes the context to render the dynamic header.

### Flow

1. User clicks sidebar → `currentView` changes → new page component mounts.
2. Page calls `useSetPageHeader({ title: 'iRacing', icon: Car, subtitle: 'Active', subtitleVariant: 'success' })`.
3. App.tsx reads context → header updates instantly.
4. When data changes (e.g. OBS disconnects), the page calls `useSetPageHeader` again in a `useEffect`.

### Dashboard Special Case

When `currentView === 'dashboard'`, the header reverts to the original branded "Race Control **Director**" text with no icon or subtitle. This preserves the home-screen identity.

---

## Per-View Header Mapping

| `currentView` | Header Title | Icon | Subtitle | Variant | Notes |
|:---|:---|:---|:---|:---|:---|
| `dashboard` | Race Control **Director** | *(none — logo in sidebar)* | — | — | Branded home state |
| `sequences` | Sequence Executor | `Zap` | `{n} sequences · {n} intents` | default | Dynamic counts |
| `settings` | System Configuration | `Settings` | — | — | |
| `session-details` | Session Details: **{name}** | *(back button)* | — | — | Back click → dashboard |
| `director-iracing` | iRacing | `Car` | `Active` / `Inactive` | success / danger | Reactive polling |
| `director-obs` | OBS Control | `Aperture` | `Connected` / `Disconnected` | success / danger | Reactive polling |
| `director-youtube` | YouTube | `Play` | — | — | Tab bar stays in content |
| `director-discord` | Discord / Voice | `Mic` | — | — | Tab bar stays in content |

---

## File Changes

| # | File | Action | Detail | Status |
|:---|:---|:---|:---|:---|
| 1 | `src/renderer/contexts/PageHeaderContext.tsx` | **CREATE** | Provider, `useSetPageHeader`, `usePageHeader` | ✅ |
| 2 | `src/renderer/App.tsx` | **MODIFY** | Wrap in Provider, replace static H1 with context-driven header | ✅ |
| 3 | `src/renderer/pages/SequencesPanel.tsx` | **MODIFY** | Remove H1 block, call `useSetPageHeader` with dynamic counts | ✅ |
| 4 | `src/renderer/pages/SettingsPage.tsx` | **MODIFY** | Remove H1, call `useSetPageHeader` | ✅ |
| 5 | `src/extensions/iracing/renderer/Panel.tsx` | **MODIFY** | Remove H1 + status badge, call `useSetPageHeader` | ✅ |
| 6 | `src/extensions/obs/renderer/Panel.tsx` | **MODIFY** | Remove H1 + status badge, call `useSetPageHeader` | ✅ |
| 7 | `src/extensions/youtube/renderer/Panel.tsx` | **MODIFY** | Remove H1 (keep tab bar), call `useSetPageHeader` | ✅ |
| 8 | `src/extensions/discord/renderer/Panel.tsx` | **MODIFY** | Remove H1 (keep tab bar), call `useSetPageHeader` | ✅ |

---

## Edge Cases & Risks

1. **Tab bars (YouTube/Discord)** — Currently in the same `<div>` as the H1. After removing the H1, the tab bar becomes the first element in content. May need top margin adjustment.

2. **Status badges (iRacing/OBS)** — Driven by polling state inside the panels. `useSetPageHeader` calls will be reactive via `useEffect`, so status changes propagate automatically.

3. **Extension coupling** — Extensions now depend on `PageHeaderContext`. This is lightweight (single hook call) and follows standard React context patterns.

4. **Session Details back button** — Moves into the header. Currently an `ArrowLeft` inside the content body.

5. **Cleanup timing** — When navigating between views, context holds stale state until the new view mounts. App.tsx should compute a fallback title from `currentView` so the header is always correct between mounts.

6. **Subtitle pill styling** — `subtitleVariant` maps to:
   - `default` → muted text, no border (metadata like counts)
   - `success` → green text, green border (Connected, Active)
   - `danger` → red text, red border (Disconnected, Inactive)

---

## Acceptance Criteria

- [ ] Global app bar shows the current page/extension title instead of static "RACE CONTROL DIRECTOR"
- [ ] Metadata (counts, status) appears as a pill/badge in the app bar
- [ ] No page renders its own H1 title — content starts immediately below app bar
- [ ] Dashboard view preserves the branded "Race Control Director" text
- [ ] Status badges (iRacing, OBS) update reactively in the app bar
- [ ] Tab bars (YouTube, Discord) remain in the content area, not the app bar
- [ ] Build passes with zero errors
- [ ] No visual regressions in existing content layouts
