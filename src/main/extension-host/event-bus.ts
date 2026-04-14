import { EventEmitter } from 'events';

export class ExtensionEventBus extends EventEmitter {
  /**
   * Emits an event from an extension to the Core system.
   * @param extensionId The ID of the extension emitting the event
   * @param eventName The fully qualified event name (e.g. "streamdeck.buttonPressed")
   * @param payload The event data
   */
  public emitExtensionEvent(extensionId: string, eventName: string, payload: any) {
    // We emit a generic 'event' that listeners can subscribe to
    // or specific events if needed.
    // For now, let's emit both the specific event name and a wild card.
    
    this.emit(eventName, { extensionId, payload });
    this.emit('*', { extensionId, eventName, payload });
  }
}
