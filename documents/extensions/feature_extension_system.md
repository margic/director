# Feature: Director Extension System & Product Refinement

## 1. Product Vision & Philosophy

### 1.1 Core Philosophy
**"Orchestrate the Chaos"**

The Sim RaceCenter Director is an **Open Source Race Broadcast Orchestrator**. It serves as the secure on-premise agent for Sim RaceCenter's premium cloud automation, while also providing a standalone interface for manually triggering local broadcast sequences.

*   **Open Source Foundation**: The Core App and its execution engine are free and open source. If it runs locally on the user's hardware and requires no cloud compute from us, it is free.
*   **Extensions as Building Blocks**: functionality (Discord, Lighting, etc.) is not simple feature flags but independent **extensions**. This encourages community contribution.
*   **Premium Value**: We monetize the *intelligence*, not the *mechanics*.
    *   **Free**: Manual triggering of complex sequences (Stream Deck style).
    *   **Premium**: AI-driven automation (Race Control Cloud) that triggers those sequences automatically based on race context.

### 1.2 The Two-Tier Product Model

| Feature | Open Source (Core) | Premium (Cloud) |
| :--- | :--- | :--- |
| **Execution Engine** | Local Director Loop | n/a |
| **Native Support** | OBS Studio Integration | n/a |
| **Integrations** | Community Extensions (Discord, etc) | n/a |
| **Control** | **"Control Deck"** (Manual Buttons) | **"AI Director"** (Auto-triggering) |
| **Cost** | Free (Apache/MIT) | Subscription |

---

## 2. Feature Specification: The Extension System

To support this vision, the Director App architecture must shift from a monolithic application to a modular host.

### 2.1 Core Application Responsibilities
The "Core" is now a lightweight host responsible for:
1.  **Extension Lifecycle**: Loading, enabling, disabling, and isolating extensions.
2.  **The "Director Loop"**: The central heartbeat that processes queued commands.
3.  **The Sequence Executor**: The engine that executes strict lists of actions (e.g., "Mute Discord" -> "Wait 2s" -> "Switch OBS").
4.  **OBS Integration**: First-class, native support for OBS Studio control, ensuring maximum reliability for the broadcast's most critical component.
5.  **The "Control Deck" UI**: A customizable grid of buttons allowing the user to manually trigger sequences.

### 2.2 Extension Capabilities
An extension is a self-contained package (inspired by VS Code extensions) that can interact with the Core via a defined API.

#### Anatomy of an Extension
An extension consists of:
1.  **Manifest (`package.json`)**: Defines metadata, activation events, and contribution points.
2.  **Main Process (Node.js)**: The implementation of the logic (connecting to Discord Gateway, Hue Bridge, etc.), running in an isolated utility process.
3.  **Renderer Process (React)**:
    *   **Dashboard Widget**: A small summary card (React component) for the home screen (e.g., Discord: Connected).
    *   **Settings/Panel**: A dedicated full-page React component for configuration and deep control.

#### Contribution Points
Extensions contribute functionality to the Core via the `manifest`. Crucially, **Intents** must be self-describing to support the AI agent's inference engine.

*   **`intents`**: High-level semantic actions the extension can perform (e.g., `communication.announceToDrivers`, `lighting.signalRaceStart`).
    *   **Purpose**: **Automation & AI Control**. The AI executes *Intents* to control the broadcast context.
    *   **Abstraction Layer**: The AI executes *Intents*, not low-level actions.
    *   **Static Intents**: Simple built-in capabilities (e.g., "Send Message").
    *   **User-Defined Intents**: Complex configurations created by the user within the extension (e.g., a specific light show pattern) and exposed as a high-level intent (e.g., `lighting.victoryLap`).
    *   Must include **Input Schema** (JSON Schema): Defines required parameters (e.g., "messageText").
*   **`commands`**: Internal RPC methods for UI interactivity and Configuration.
    *   **Purpose**: **UI & Configuration**. Used by the Extension's Frontend (Panel/Widget) to trigger Main Process logic (e.g., `system.login`, `settings.save`).
    *   **Isolation**: Commands are **NOT** exposed to the Automator or Cloud AI. They are strictly for User interaction via the Control Deck or Extension Panel.
*   **`views`**: React components contributed to the Core application.
    *   **`widget`**: A small summary React component for the Dashboard (e.g., Status Indicator).
    *   **`panel`**: A full-page React component for the Extension (e.g., "YouTube Studio").
*   **`events`**: Triggers that the Core can listen to (e.g., `streamdeck.buttonPressed`, `iracing.flagChanged`).
    *   **Usage**: Enables hardware controllers (Stream Deck, Button Boxes) or external webhooks to initiate Director sequences.

### 2.3 Extension Configuration & Persistence
The Director Core intentionally **does not** provide a unified settings interface or storage mechanism for extensions, with ONE exception: The Master Toggle.

*   **Master Extension Toggle**: The Core Settings page provides a single "Enable/Disable" switch for each installed extension.
    *   **Behavior**: When disabled, the extension is **fully unloaded** from the Extension Host. It consumes no resources, runs no background processes, and removes its contributed Views and Intents from the system.
    *   **Life-Cycle**: Toggling ON triggers the `activate()` method. Toggling OFF triggers the `deactivate()` method (if defined) and then destroys the reference.
*   **Self-Managed State**: Extensions are fully responsible for managing their own granular configuration (API keys, preferences, local data).
*   **Custom UI**: Extensions must provide their own configuration interface within their contributed `panel` view.
    *   **Flexibility**: The `panel` view is the extension's full-canvas playground. Developers can structure this with tabs, navigation menus, or minimal forms as needed.
    *   **Example**: A "YouTube" extension might have a `Status` tab for the current stream and a `Settings` tab for authentication.
*   **No Central Schema**: The `manifest` does not define configuration schemas. The Core treats the extension as a black box that is either "enabled" or "disabled".

### 2.4 Event-Driven Triggers (Hardware Support)
To support hardware controllers, extensions can emit events that the user maps to specific Director Sequences.

#### Example: Stream Deck Integration
In this flow, the extension acts as a driver layer. It does not know *what* the button does, only that it was pressed. The Core handles the mapping and execution.

```mermaid
sequenceDiagram
    actor User
    participant HW as Stream Deck (Hardware)
    participant Ext as Extension (Node Process)
    participant Core as Director Core (Event Bus)
    participant Exec as Sequence Executor

    User->>HW: Presses Button 1
    HW->>Ext: HID Signal (Button 1 Down)
    Note over Ext: Normalizes Signal
    Ext->>Core: emit('streamdeck.button', { id: 1 })
    Note over Core: Looks up User Mapping\n(Button 1 = "Start Engine Sequence")
    Core->>Exec: Execute("Start Engine Sequence")
    Exec-->>User: (Sequence Actions Triggered)
```

### 2.5 Intent Discovery & Context Sync
To ensure the Cloud AI can create sequences effectively:

1.  **The Intent Registry**: On load, the Core scans all extension manifests for `intents` and builds a registry.
2.  **Capabilities Handshake**: When connecting to Race Control Cloud, the Director sends a `CapabilitiesManifest` listing all available **Intents**.
    *   *Example:* "I have an intent `communication.announceToDrivers` that accepts `text`."
3.  **The "Black Box" Approach**: The AI decides *what* it wants to achieve (the intent) but delegates the *how* (the implementation details) to the local extension.
    *   *AI Logic:* "There is a crash. I should `communication.announceToDrivers('Safety Car Deployed')`."

### 2.6 Extension Architecture
Extensions are built using the following architecture:

**Main Process (Extension Host)**
*   Extensions run in an isolated Node.js utility process managed by the Extension Host.
*   Each extension exports an `activate(extensionAPI)` function that receives the Extension API.
*   The Extension API provides methods to register intent handlers, emit events, and access configuration.

**Renderer Process (React Components)**
*   Extensions contribute React components directly to the Core UI.
*   **Widget Components**: Displayed on the Dashboard, imported and rendered by the Core.
*   **Panel Components**: Full-page views accessible via navigation, imported and rendered by the Core.
*   Components communicate with the Main Process via the `window.electronAPI.extensions` interface.
*   All communication uses typed IPC calls rather than postMessage/iframes.

**Communication Flow**
```
React Component -> window.electronAPI.extensions.executeIntent()
                                    ↓
                            IPC Main Process
                                    ↓
                           Extension Host Service
                                    ↓
                          Extension Utility Process
                                    ↓
                         Extension Intent Handler
```

    *   *Extension Logic:* Receives intent -> Generates TTS -> Connects to Discord -> Plays Audio.

---

## 3. User Experience (UX)

### 3.1 The "Control Deck" (New Core Feature)
Instead of just waiting for cloud commands, the user is presented with a **Control Deck** interface.
*   **Visuals**: A grid of physically distinct buttons (Stream Deck aesthetic).
*   **Function**: Users map a generic button (e.g., "Safety Car Protocol") to a Sequence of Actions provided by installed extensions.
*   **Example**:
    *   Button: "Race Start"
    *   Sequence:
        1.  `obs:switch-scene("Race Cam")`
        2.  `audio:play-file("intro.mp3")`
        3.  `discord:unmute-all()`

### 3.2 Extension Management
*   **Marketplace/Browser**: Users can browse available extensions (from a JSON registry or GitHub).
*   **Side Bar**: Installed extensions appear as icons in the left nav (just like VS Code). Clicking one opens its "Main Panel".

### 3.3 Trigger Configuration (Event Mapping)
To bridge the gap between "unknown events" and sequences, the Core provides a **Trigger Editor**.

1.  **Discovery**: The Core knows about available events because extensions declare them in their manifest (with a schema).
2.  **Configuration flow**:
    *   User opens the **Sequence Editor**.
    *   Creates a Sequence (e.g., "End Race").
    *   Clicks **"Add Trigger"**.
    *   Selects **"Extension Event"**.
    *   Dropdown 1 (Source): `Stream Deck Extension`
    *   Dropdown 2 (Event): `Button Pressed`
    *   Input (Filter): `Button ID` = `15`
3.  **Storage**: These mappings are stored in the Core's `user-config.json`, effectively subscribing the Sequence Executor to the specific event pattern.

---

## 4. Technical Architecture Migration

### Phase 1: Decoupling (Current Step)
Refactor existing hardcoded integrations (Discord) into the new internal folder structure `src/extensions/`.
*   Establish `ExtensionHost` service.
*   Define `ExtensionAPI` interface.

### Phase 2: The Manifest
Create the definition for extension manifests using `package.json`.
```json
{
  "name": "director-streamdeck-integration",
  "contributes": {
    "events": [
      { 
        "event": "streamdeck.buttonDown", 
        "title": "Button Pressed",
        "schema": {
          "type": "object",
          "properties": { "buttonId": { "type": "integer" } }
        }
      }
    ],
    "views": [
      {
        "id": "status-widget",
        "name": "Stream Deck Status",
        "type": "widget"
      },
      {
        "id": "main-panel",
        "name": "Stream Deck",
        "type": "panel"
      }
    ]
  }
}
```

**Note**: The `path` field in views is no longer used. React components are directly imported by the Core based on convention:
- Widget: `src/extensions/{extensionId}/renderer/Status.tsx`
- Panel: `src/extensions/{extensionId}/renderer/Panel.tsx`

### Phase 3: Public API & Sandbox
Ensure extensions cannot crash the main director loop. Implement error boundaries and possibly separate process execution for robust extensions.
