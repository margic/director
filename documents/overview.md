# Project Overview: Race Control

Race Control is the central command center for Sim RaceCenter’s broadcast operations. It is a web-based portal designed to professionalize and streamline the complex configuration required to produce live sim racing events.

## The Problem

Currently, managing a live broadcast involves tracking critical data—which driver is in which simulator rig, which camera feeds (OBS scenes) correspond to them, and the details of the current race session—across spreadsheets, mental notes, or ad-hoc messages. This manual process is error-prone and stressful, especially during the high-pressure environment of a live race start.

## The Solution

Race Control provides a single source of truth for all broadcast configuration data. It allows the production team to define, manage, and associate Drivers, Rigs, OBS Scenes, and Race Sessions in a structured, reliable system.

## Key Capabilities

*   **Unified Configuration:** A centralized dashboard to manage the roster of drivers, the physical simulator rigs available, and the broadcast scenes associated with them.
*   **Session Management:** Tools to plan and initiate specific race sessions, ensuring that the telemetry systems know exactly who is racing and where.
*   **The "Broadcast Agent":** An intelligent, conversational assistant integrated into the UI. It guides the Broadcast Director through complex setup flows (like "onboarding a new driver" or "starting a multi-class race"), reducing cognitive load and manual data entry.
*   **Bridge to Production:** Acts as the configuration authority for our telemetry systems. When the race starts, our low-latency broadcasting tools fetch their setup instructions directly from Race Control, ensuring the on-screen graphics and camera feeds match reality.

## Target Audience

*   **Broadcast Director:** The primary user. They use the tool to ensure the show is set up correctly and to make quick adjustments during an event.
*   **Race Organizer:** Uses the system to prepare entry lists and assignments days before the event.
*   **Technical Operator:** Relies on the system to ensure the underlying hardware and software (OBS, iRacing) are synced with the broadcast plan.

## Technical Foundation

The platform is built for reliability and modern usability:

*   **Interface:** A responsive, professional web application built with Next.js and Tailwind UI Catalyst, ensuring a consistent and accessible user experience.
*   **Backend:** Powered by Azure Static Web Apps and Azure Cosmos DB, providing a scalable, serverless architecture that is low-maintenance and highly available.
*   **Security:** Enterprise-grade authentication via Microsoft Entra ID ensures only authorized staff can modify broadcast configurations.

---

# The Director App

The Director App is the on-premise execution engine for Sim RaceCenter. It runs locally on the race center PC, acting as a secure bridge between the cloud-based Race Control and the local hardware and software environment.

## Elevator Pitch

Think of the Director App as a "Network Proxy Application." It is a lightweight, on-premise client that executes instructions from SimRaceCenter.com. It is not "smart" in itself; rather, it faithfully executes sequences of commands to orchestrate the local broadcast environment.

## Core Responsibilities

The Director App manages the "last mile" of integration that cloud services cannot reach:

*   **Authentication Hub:** Handles the human interaction required for OAuth logins, securely managing tokens for:
    *   **YouTube API:** For sending and receiving live chat messages.
    *   **Discord:** For managing voice chat channels with drivers.
    *   **iRacing Data API:** For retrieving series results and session info.
*   **Local Hardware Control:**
    *   **OBS Studio:** Connects via WebSocket to switch scenes, toggle sources, and manage the broadcast stream.
    *   **iRacing Simulator:** Uses Windows Events to control in-game cameras for replays and live cuts.
*   **Sequence Execution:** Orchestrates complex timing sequences (e.g., "Switch to Replay Scene" -> "Trigger iRacing Replay" -> "Wait 10s" -> "Switch to Live"). It manages the complexity of asynchronous events (chat) versus synchronous commands (voice/OBS).

## Technical Foundation

The Director App is built on a modern, cross-platform desktop stack designed for reliability and ease of development:

*   **Runtime:** **Node.js** and **Electron**. This allows deep integration with the host operating system (Windows) while maintaining a web-standard codebase.
*   **Frontend:** React-based UI for configuration and status monitoring.
*   **Architecture:**
    *   **Main Process:** Handles low-level integrations (OBS WebSocket, Windows Events, Token Storage).
    *   **Renderer Process:** Provides the user interface for authentication flows and connection status.
