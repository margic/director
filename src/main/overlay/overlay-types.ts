/**
 * Overlay Type Definitions
 *
 * Types for the overlay bus, server, and host SPA subsystems.
 * Extensions contribute overlays via manifest `contributes.overlays` and
 * update them at runtime through the extension API.
 *
 * See: documents/design_sequence_ux_enhancements.md §6
 * See: documents/implementation_plan_ux_enhancements.md §Sprint 2.1
 */

/** Named screen regions where overlays can be placed. */
export type OverlayRegion =
  | 'top-bar'
  | 'lower-third'
  | 'ticker'
  | 'center-popup'
  | 'corner-top-left'
  | 'corner-top-right';

/** All valid overlay regions (for iteration / validation). */
export const OVERLAY_REGIONS: OverlayRegion[] = [
  'top-bar',
  'lower-third',
  'ticker',
  'center-popup',
  'corner-top-left',
  'corner-top-right',
];

/**
 * Static registration declared in an extension's package.json:
 *
 * ```json
 * "contributes": {
 *   "overlays": [{
 *     "id": "race-info",
 *     "region": "top-bar",
 *     "title": "Race Info Bar",
 *     "template": "RaceInfoBar",
 *     "autoHide": 0,
 *     "priority": 100
 *   }]
 * }
 * ```
 */
export interface OverlayRegistration {
  /** Unique overlay ID within the extension (e.g. "race-info") */
  id: string;
  /** Screen region to render in */
  region: OverlayRegion;
  /** Human-readable title for admin panel */
  title: string;
  /** Built-in template ID or relative path to extension HTML template */
  template: string;
  /** Auto-hide after N ms (0 = stay visible until explicitly hidden) */
  autoHide?: number;
  /** Higher priority wins region conflicts (default 0) */
  priority?: number;
}

/**
 * Runtime overlay slot — an active overlay instance managed by the OverlayBus.
 * Extends the static registration with runtime state.
 */
export interface OverlaySlot extends OverlayRegistration {
  /** The extension that owns this overlay */
  extensionId: string;
  /** Current data payload passed to the template */
  data?: Record<string, unknown>;
  /** Whether the overlay is currently visible */
  visible: boolean;
}

/**
 * Messages sent from the OverlayServer to connected WebSocket clients.
 * The Host SPA processes these to update the overlay DOM in real-time.
 */
export type OverlayServerMessage =
  | { type: 'connected'; overlays: OverlaySlot[] }
  | { type: 'overlay:registered'; overlay: OverlaySlot }
  | { type: 'overlay:update'; id: string; data: Record<string, unknown> }
  | { type: 'overlay:show'; id: string }
  | { type: 'overlay:hide'; id: string }
  | { type: 'overlay:unregistered'; id: string };

/**
 * Manifest contribution shape for overlays.
 * Added to ExtensionManifest.contributes.overlays
 */
export interface OverlayContribution {
  id: string;
  region: OverlayRegion;
  title: string;
  template: string;
  autoHide?: number;
  priority?: number;
}
