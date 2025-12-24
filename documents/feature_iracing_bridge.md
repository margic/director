# Feature Specification: iRacing Bridge (MVP)

## Overview
The core functionality of the "Director" app is to bridge the gap between the local iRacing simulator and the management system. This feature focuses on establishing the connection to the iRacing SDK.

## User Stories
- As a Director, I want to see if the application is connected to iRacing so I know the system is working.
- As a System, I need to read real-time telemetry from iRacing to monitor the car's status.
- As a System, I need to read session data to identify the current track and session type.

## Requirements
1.  **SDK Integration**:
    - Integrate a Node.js wrapper for the iRacing SDK (e.g., `node-irsdk` or similar).
    - The integration must run in the Main process to avoid blocking the UI.
2.  **Connection Management**:
    - Automatically detect when the iRacing simulator starts.
    - Automatically detect when the iRacing simulator closes.
    - Reconnect logic if the connection is dropped.
3.  **Data Retrieval**:
    - **Telemetry**: Retrieve basic telemetry at a configurable rate (e.g., 60Hz or lower for MVP). Data points: Speed, RPM, Gear, Steering Angle, Pedals.
    - **Session Info**: Retrieve static session data. Data points: Track Name, Car Name, Driver Name, Session Type (Practice, Qualify, Race).
4.  **State Broadcasting**:
    - Send connection status updates to the Renderer (Connected, Disconnected, Searching).
    - Send telemetry updates to the Renderer via IPC.

## Technical Considerations
- **Performance**: The telemetry loop must be efficient. Avoid sending data to the renderer if values haven't changed significantly (throttling).
- **Native Dependencies**: The iRacing SDK uses memory mapped files. Ensure the chosen library is compatible with the Electron version (ABI compatibility).
