import { EventEmitter } from 'events';

/**
 * High-frequency streaming events that fire every telemetry tick (4-5 Hz).
 * Logging these unconditionally floods the console; they are intentionally silenced.
 */
const SILENT_EVENTS = new Set([
  'iracing.raceStateChanged',
  'iracing.publisherStateChanged',
]);

export class ExtensionEventBus extends EventEmitter {
  /** Cache of the last payload received per event name — used by capabilities builder at check-in. */
  private readonly lastPayloads = new Map<string, any>();

  /**
   * Returns the last payload emitted for an event name, or undefined if never emitted.
   */
  public getLastEventPayload(eventName: string): any | undefined {
    return this.lastPayloads.get(eventName);
  }

  /**
   * Emits an event from an extension to the Core system.
   * @param extensionId The ID of the extension emitting the event
   * @param eventName The fully qualified event name (e.g. "streamdeck.buttonPressed")
   * @param payload The event data
   */
  public emitExtensionEvent(extensionId: string, eventName: string, payload: any) {
    this.lastPayloads.set(eventName, payload);
    // We emit a generic 'event' that listeners can subscribe to
    // or specific events if needed.
    // For now, let's emit both the specific event name and a wild card.
    
    this.emit(eventName, { extensionId, payload });
    this.emit('*', { extensionId, eventName, payload });
    
    if (!SILENT_EVENTS.has(eventName)) {
      console.log(`[EventBus] Extension '${extensionId}' emitted '${eventName}'`);
    }
  }
}
