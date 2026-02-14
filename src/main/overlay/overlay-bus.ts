/**
 * OverlayBus — Core overlay state management service.
 *
 * Manages the lifecycle of overlay slots: register, update, show, hide, unregister.
 * Emits events for every state change so the OverlayServer can broadcast to
 * connected WebSocket clients in real-time.
 *
 * Region conflict resolution (Decision Q6): User picks region owner in Settings.
 * The bus stores a `regionAssignments` map. When multiple overlays target the same
 * region, only the user-assigned extension's overlay is active. Default assignment:
 * first extension to register wins until the user changes it.
 *
 * See: documents/implementation_plan_ux_enhancements.md §Sprint 2.1
 */

import { EventEmitter } from 'events';
import {
  OverlayRegion,
  OverlayRegistration,
  OverlaySlot,
} from './overlay-types';

export interface OverlayBusEvents {
  registered: (overlay: OverlaySlot) => void;
  unregistered: (id: string) => void;
  update: (id: string, data: Record<string, unknown>) => void;
  show: (id: string) => void;
  hide: (id: string) => void;
}

export class OverlayBus extends EventEmitter {
  /** All overlay slots keyed by `${extensionId}.${overlayId}` */
  private slots: Map<string, OverlaySlot> = new Map();

  /**
   * Region ownership: region → extensionId.
   * Only the assigned extension's overlays are "active" in a contested region.
   * Default: first registrant wins. Operator can reassign in Settings.
   */
  private regionAssignments: Map<OverlayRegion, string> = new Map();

  /** Active autoHide timers keyed by slot composite key */
  private autoHideTimers: Map<string, ReturnType<typeof setTimeout>> = new Map();

  // ─── Lifecycle Methods ──────────────────────────────────────────────

  /**
   * Register an overlay slot for an extension.
   * Called when an extension loads and declares `contributes.overlays` in its manifest.
   */
  registerOverlay(extensionId: string, registration: OverlayRegistration): void {
    const key = this.composeKey(extensionId, registration.id);

    if (this.slots.has(key)) {
      console.warn(`[OverlayBus] Overlay '${key}' already registered — updating.`);
    }

    const slot: OverlaySlot = {
      ...registration,
      extensionId,
      data: undefined,
      visible: false,
    };

    this.slots.set(key, slot);

    // Region assignment: first extension to claim a region wins by default
    if (!this.regionAssignments.has(registration.region)) {
      this.regionAssignments.set(registration.region, extensionId);
      console.log(
        `[OverlayBus] Region '${registration.region}' assigned to '${extensionId}' (first registrant).`
      );
    }

    console.log(
      `[OverlayBus] Registered overlay '${key}' in region '${registration.region}' (template: ${registration.template}).`
    );

    this.emit('registered', slot);
  }

  /**
   * Unregister a single overlay slot.
   */
  unregisterOverlay(extensionId: string, overlayId: string): void {
    const key = this.composeKey(extensionId, overlayId);
    const slot = this.slots.get(key);
    if (!slot) return;

    this.clearAutoHideTimer(key);
    this.slots.delete(key);

    console.log(`[OverlayBus] Unregistered overlay '${key}'.`);
    this.emit('unregistered', key);
  }

  /**
   * Unregister all overlay slots for an extension (called on extension unload).
   */
  unregisterAllForExtension(extensionId: string): void {
    const keysToRemove: string[] = [];
    for (const [key, slot] of this.slots) {
      if (slot.extensionId === extensionId) {
        keysToRemove.push(key);
      }
    }
    for (const key of keysToRemove) {
      this.clearAutoHideTimer(key);
      this.slots.delete(key);
      this.emit('unregistered', key);
    }

    // Remove region assignments for this extension
    for (const [region, owner] of this.regionAssignments) {
      if (owner === extensionId) {
        this.regionAssignments.delete(region);
        // Auto-assign to next registrant (if any)
        for (const slot of this.slots.values()) {
          if (slot.region === region) {
            this.regionAssignments.set(region, slot.extensionId);
            break;
          }
        }
      }
    }

    if (keysToRemove.length > 0) {
      console.log(
        `[OverlayBus] Unregistered ${keysToRemove.length} overlay(s) for extension '${extensionId}'.`
      );
    }
  }

  // ─── Data & Visibility ─────────────────────────────────────────────

  /**
   * Update overlay data. Auto-shows the overlay if it was hidden.
   * Resets autoHide timer if configured.
   */
  updateOverlay(
    extensionId: string,
    overlayId: string,
    data: Record<string, unknown>
  ): void {
    const key = this.composeKey(extensionId, overlayId);
    const slot = this.slots.get(key);
    if (!slot) {
      console.warn(`[OverlayBus] Cannot update unknown overlay '${key}'.`);
      return;
    }

    slot.data = { ...slot.data, ...data };
    this.emit('update', key, slot.data);

    // Auto-show if hidden
    if (!slot.visible) {
      this.showOverlay(extensionId, overlayId);
    }

    // Reset autoHide timer
    if (slot.autoHide && slot.autoHide > 0) {
      this.clearAutoHideTimer(key);
      const timer = setTimeout(() => {
        this.hideOverlay(extensionId, overlayId);
      }, slot.autoHide);
      this.autoHideTimers.set(key, timer);
    }
  }

  /**
   * Show an overlay (set visible = true).
   */
  showOverlay(extensionId: string, overlayId: string): void {
    const key = this.composeKey(extensionId, overlayId);
    const slot = this.slots.get(key);
    if (!slot) return;

    if (slot.visible) return; // Already visible

    slot.visible = true;
    console.log(`[OverlayBus] Show overlay '${key}'.`);
    this.emit('show', key);

    // Start autoHide timer if configured
    if (slot.autoHide && slot.autoHide > 0) {
      this.clearAutoHideTimer(key);
      const timer = setTimeout(() => {
        this.hideOverlay(extensionId, overlayId);
      }, slot.autoHide);
      this.autoHideTimers.set(key, timer);
    }
  }

  /**
   * Hide an overlay (set visible = false).
   */
  hideOverlay(extensionId: string, overlayId: string): void {
    const key = this.composeKey(extensionId, overlayId);
    const slot = this.slots.get(key);
    if (!slot) return;

    if (!slot.visible) return; // Already hidden

    slot.visible = false;
    this.clearAutoHideTimer(key);
    console.log(`[OverlayBus] Hide overlay '${key}'.`);
    this.emit('hide', key);
  }

  // ─── Query Methods ──────────────────────────────────────────────────

  /** Get all overlay slots (for initial WebSocket state). */
  getOverlays(): OverlaySlot[] {
    return Array.from(this.slots.values());
  }

  /** Get overlays filtered by region. */
  getOverlaysByRegion(region: OverlayRegion): OverlaySlot[] {
    return Array.from(this.slots.values()).filter((s) => s.region === region);
  }

  /** Get the current region→extensionId assignments. */
  getRegionAssignments(): Record<string, string> {
    const result: Record<string, string> = {};
    for (const [region, extensionId] of this.regionAssignments) {
      result[region] = extensionId;
    }
    return result;
  }

  /**
   * Check if an overlay is "active" — i.e. it belongs to the extension
   * that's assigned to own its region.
   */
  isOverlayActive(key: string): boolean {
    const slot = this.slots.get(key);
    if (!slot) return false;
    const regionOwner = this.regionAssignments.get(slot.region);
    return regionOwner === slot.extensionId;
  }

  // ─── Region Assignment (Settings/Admin) ─────────────────────────────

  /**
   * Assign a region to a specific extension.
   * Called from the Settings admin panel (Decision Q6).
   */
  setRegionOwner(region: OverlayRegion, extensionId: string): void {
    this.regionAssignments.set(region, extensionId);
    console.log(`[OverlayBus] Region '${region}' reassigned to '${extensionId}'.`);
  }

  // ─── Internal Helpers ───────────────────────────────────────────────

  private composeKey(extensionId: string, overlayId: string): string {
    return `${extensionId}.${overlayId}`;
  }

  private clearAutoHideTimer(key: string): void {
    const timer = this.autoHideTimers.get(key);
    if (timer) {
      clearTimeout(timer);
      this.autoHideTimers.delete(key);
    }
  }
}
