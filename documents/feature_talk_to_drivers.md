# Feature: Talk to Drivers (Communication System)

> **Status:** Active (Implemented via Discord Extension)
> **Extension Location:** `src/extensions/discord`
> **Primary Intent:** `communication.announce`

## 1. Feature Overview
The "Talk to Drivers" feature allows the Race Control system (Director) to broadcast audible messages to race participants. This is critical for conveying high-priority instructions that might be missed in text chat, such as "Red Flag", "Safety Car Deployed", or "Driver Briefing Started".

### User Story
> "As a Race Director, I want to automatically or manually broadcast voice messages to the drivers' specified voice channel so that I can issue penalties, safety car instructions, or start/stop commands clearly."

## 2. Abstraction & Intents
To align with the **Director Extension System**, this feature is defined by its *Intent*, not its implementation. The Core system issues a command to "Announce", and the loaded Communication Extension handles the delivery.

### Defined Intents
The feature contributes the following intents to the Director ecosystem:

#### `communication.announce`
Broadcasting a message to the entire field.
*   **Parameters**:
    *   `message` (string, optional): Text to be converted to speech.
    *   `audioUrl` (string, optional): Path or URL to a pre-recorded audio file (e.g., a siren or recorded briefing).
    *   `priority` (enum: `low`, `normal`, `critical`): Determines if other audio should be ducked or interrupted.
*   **Behavior**: The active communication provider takes the input and broadcasts it to the configured "All Drivers" channel.

#### `communication.direct` (Future)
Talking to a specific driver or team.
*   **Parameters**: `driverId`, `message`.

## 3. Current Implementation: Discord Bot
The reference implementation for this feature is the **Discord Extension**. It fulfills the "Talk to Drivers" requirement by acting as a bot that joins a Discord Voice Channel.

### 3.1 Why Discord?
Most Sim Racing leagues use Discord for race control and driver briefings. It provides high-quality, low-latency voice capabilities and is ubiquitous in the community.

### 3.2 Technical Architecture
The Discord Extension operates as an adaptor in the Extension Host:

1.  **Configuration**:
    *   The extension manages its own settings (Bot Token, Guild ID, Target Voice Channel ID).
    *   These are configured via the Extension Panel UI.

2.  **Execution Flow**:
    *   **Trigger**: A Sequence (e.g., "Full Course Yellow") contains a `communication.announce` step.
    *   **Routing**: The Director Core routes this intent to the enabled `director-discord` extension.
    *   **Action**:
        1.  The Extension receives the payload.
        2.  If `message` is provided, it uses a TTS engine (e.g., Google TTS or OS Native) to generate an MP3 stream.
        3.  The Discord Bot joins the configured Voice Channel.
        4.  The Audio Stream is played into the channel.
        5.  The Bot remains connected or disconnects based on "Keep Alive" settings.

### 3.3 Manifest Definition
The extension `package.json` declares:

```json
{
  "name": "director-discord",
  "displayName": "Discord Communication Bridge",
  "contributes": {
    "intents": [
      {
        "name": "communication.announce",
        "description": "Broadcasts a voice message to the specific Discord channel",
        "schema": {
          "type": "object",
          "properties": {
            "message": { "type": "string" },
            "audioUrl": { "type": "string" }
          }
        }
      }
    ],
    "views": [
      { "id": "discord-status", "type": "widget" },
      { "id": "discord-settings", "type": "panel" }
    ]
  }
}
```

## 4. Alternative Implementations (Future)
By focusing on the "Talk to Drivers" feature set, we allow for future drivers to be swapped in without changing the core automation sequences:
*   **TeamSpeak Integration**: Common in older leagues.
*   **iRacing Radio**: Using the iRacing SDK to transmit directly to the in-game radio frequency (if API permits).
*   **SRS / SRCom**: Integration with dedicated Sim Racing voice tools.

