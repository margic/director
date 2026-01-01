# Copilot Instructions for Director Project

## Project Overview
"Director" is an Electron application designed to run on Sim RaceCenter PCs or Simulator Rigs running iRacing.
The application serves as a bridge and management tool for the simulator environment.

## Tech Stack
- **Runtime**: Electron
- **Language**: TypeScript (Recommended)
- **Frontend**: React (Recommended for component-based UI)
- **Backend**: Node.js (Electron Main Process)
- **Authentication**: Microsoft Entra ID (MSAL)
- **Integration**: iRacing SDK
- **CSS Framework**: Tailwind CSS v4 (using `@theme` variables)
- **Component Library**: shadcn/ui (customized with Sim RaceCenter tokens)
- **Icons**: Lucide React (preferred) or FontAwesome (if specific racing icons are needed)
- **Animations**: `tailwindcss-animate` for subtle, cinematic entries

## Race Control API
The application interacts with the Race Control API to fetch user profiles, discover sessions, and execute sequences.

**OFFICIAL SPECIFICATION POLICY:**
The official source of truth for the API is the OpenAPI specification located at:
`https://api.simracecenter.com/api/openapi.yaml`

*   **Code to the Spec:** Always implement against the official OpenAPI spec, even if manual tests suggest otherwise.
*   **Discrepancies:** If the API behaves differently than the spec, do not change the code to match the behavior. Instead, raise an issue with the Race Control team at:
    `https://github.com/margic/racecontrol/issues`

**Documentation:**
- **OpenAPI Spec:** [https://api.simracecenter.com/api/openapi.yaml](https://api.simracecenter.com/api/openapi.yaml)
- **API Docs:** [https://api.simracecenter.com/api/docs](https://api.simracecenter.com/api/docs)

**Key Endpoints (Production):**
- Base URL: `https://api.simracecenter.com`
- User Profile: `GET /api/auth/user`
- List Sessions: `GET /api/director/v1/sessions` (Query: `centerId`, `status`)
- Next Sequence: `GET /api/director/v1/sessions/{raceSessionId}/sequences/next`

**Data Models:**
- **RaceSession**: `{ raceSessionId, name, status, centerId, ... }`
- **UserProfile**: `{ userId, displayName, centerId, ... }`
- **DirectorSequence**: `{ sequenceId, commands: [ { type: 'WAIT'|'LOG', payload: {...} } ] }`

**Authentication:**
- All requests require `Authorization: Bearer <token>` (MSAL / Entra ID).

## Brand Identity & Aesthetic
* **Core Themes:** High-tech, Motorsport, Dark Mode, Telemetry-focused.
* **Visual Style:** "Control Room" aesthetic. Deep dark backgrounds with neon-bright data accents.
* **Tagline:** "The Racing Is Real."

## Design System Tokens

### Color Palette (Strict Adherence)
Do not use generic Tailwind colors (e.g., `bg-blue-500`). Use the semantic brand variables.

| Semantic Name | Hex Code | Usage |
| :--- | :--- | :--- |
| **Background** | `#090B10` | Main app background ("Race Control") |
| **Card / Surface** | `#111317` | Panels, cards, popovers ("Cockpit Grey") |
| **Primary** | `#FF5F1F` | Call-to-actions, active states ("Apex Orange") |
| **Secondary** | `#00A3E0` | Data visualization, info, accents ("Telemetry Blue") |
| **Destructive** | `#EF3340` | Critical errors, stop buttons ("Flag Red") |
| **Border** | `#282A30` | Subtle borders for cards |

### Racing Specific Tokens
* `--green-flag`: Safe/Go status.
* `--yellow-flag`: Caution/Warning status (`#FFBF00`).
* `--red-flag`: Stop/Critical status (`#EF3340`).

### Typography
* **Headings / UI:** `font-rajdhani` (Rajdhani). Use for all navigation, headers, and labels.
* **Data / Telemetry:** `font-jetbrains` (JetBrains Mono). Use for all changing numbers, lap times, and fuel stats to ensure tabular alignment.
* **Text Transform:** Use `uppercase` often for headers and labels (e.g., "TRACK TEMP", "RPM LOAD") to match the broadcast style.

### UI Shape & Depth
* **Border Radius:** Default is `0.5rem` (Rounded-md).
* **Borders:** Most cards should have a thin, subtle border (`border-border`).
* **Glows:** Use subtle colored shadows or gradients to create a "Cinematic" feel on active elements (e.g., an orange glow behind the "Start Engine" button).

## UI Architecture & Navigation Patterns
The application follows a **Module-Based Dashboard Architecture**.

### 1. The Dashboard (Hub)
- The default view (`/`) acts as a central hub.
- It contains **Preview Modules** (Widgets) for each active integration (e.g., iRacing Status, OBS Preview).
- **Interaction**: Clicking a Preview Module navigates to that integration's Detail Page.

### 2. Sidebar Navigation
- Persistent navigation on the left.
- Contains icons for the Dashboard and all major Integrations.
- **Behavior**: Allows direct access to Detail Pages from anywhere.

### 3. Detail Pages
- Dedicated full-screen views for specific integrations (e.g., `/iracing`, `/obs`).
- Contains detailed controls, configuration, and status for that specific system.

## Component Guidelines

### Buttons
* **Primary Button:** `bg-primary text-primary-foreground hover:opacity-90`. (Apex Orange).
* **Secondary Button:** `bg-secondary text-secondary-foreground`. (Telemetry Blue).
* **Destructive/Abort:** `bg-destructive text-destructive-foreground`.

### Cards (The "Cockpit" Panel)
* Cards represent modules in a car dashboard or broadcast desk.
* Background: `bg-card` (Cockpit Grey).
* Header: Small, uppercase, muted text (e.g., "TIRE TEMP (RL)").
* Content: High contrast data.

### Data Visualization
* **Graphs:** Use Telemetry Blue (`#00A3E0`) for main data lines.
* **Thresholds:** Use Apex Orange or Flag Red for limit/danger zones (e.g., Redline RPM).
* **Backgrounds:** Graph containers should be slightly darker than the card background to add depth.

## Coding Guidelines & Behavior Rules
- **Type Safety**: Use TypeScript for all new code to ensure type safety across the IPC bridge.
- **Security**: 
  - Enable Context Isolation.
  - Disable Node Integration in the Renderer process.
  - Use `contextBridge` to expose safe APIs to the renderer.
- **Error Handling**: Ensure robust error handling, especially for network requests and iRacing SDK interactions. Fail gracefully if iRacing is not running.
- **Async/Await**: Prefer async/await over raw promises or callbacks.
- **Dark Mode Default**: The app does not have a light mode. Assume dark context for all text colors (mostly white/off-white).
- **Mobile Responsiveness**: Sim racing rigs often use tablets/phones as dashboards. Ensure grids collapse gracefully into vertical stacks.
- **Variable Usage**: Always use the Tailwind v4 CSS variables (e.g., `var(--background)`) or Tailwind classes (e.g., `bg-background`) instead of hardcoding hex values.
- **Telemetry Precision**: When displaying numbers (Lap times, Fuel), ensure fixed widths or monospaced fonts (`font-jetbrains`) to prevent layout shifting during rapid updates.

## Architecture
- **Main Process**: Handles system integrations (iRacing SDK), authentication token management, and window management.
- **Renderer Process**: Handles the UI and user interactions.
- **IPC**: Use `ipcMain` and `ipcRenderer` for communication. Define typed channels.

## Example Snippets

**Primary Action Button:**
```tsx
<Button className="bg-primary hover:bg-primary/90 text-white font-rajdhani uppercase tracking-wider font-bold">
  Start Engine
</Button>
```

**Telemetry Card:**
```tsx
<Card className="bg-card border-border">
  <CardHeader>
    <CardTitle className="text-muted-foreground text-xs uppercase font-rajdhani tracking-widest">
      Oil Pressure
    </CardTitle>
  </CardHeader>
  <CardContent>
    <span className="text-4xl font-jetbrains text-foreground font-bold">
      85 <span className="text-sm text-muted-foreground">PSI</span>
    </span>
  </CardContent>
</Card>
```
