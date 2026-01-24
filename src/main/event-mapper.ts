import { ExtensionEventBus } from './extension-host/event-bus';
import { DirectorService } from './director-service';
import { configService } from './config-service';

export class EventMapper {
  private mappings: Map<string, string> = new Map(); // eventId -> sequenceId

  constructor(
    private eventBus: ExtensionEventBus,
    private directorService: DirectorService
  ) {
    this.loadMappings();
    this.subscribe();
  }

  private loadMappings() {
    const config = configService.getAny('eventMappings');
    if (config) {
      for (const [event, sequenceId] of Object.entries(config)) {
        this.mappings.set(event, sequenceId as string);
      }
    }
  }

  private subscribe() {
    // Listen to all events? 
    // The EventBus allows subscribing to specific events.
    // We should iterate our mappings and subscribe.
    
    // For now, since we don't know the event names dynamically until config load,
    // and EventBus might not support wildcard (it's typed EventEmitter), 
    // we might need to change EventBus to allow a global listener or we subscribe to each mapped event.
    // Our EventBus implementation in `event-bus.ts` uses TypedEmitter.
    
    console.log('[EventMapper] Subscribing to mapped events...');
    this.mappings.forEach((sequenceId, eventName) => {
        // We need a way to listen to dynamic events on the event bus.
        // The current EventBus likely expects specific typed events.
        // Let's verify EventBus capability.
        this.eventBus.on(eventName, (payload: any) => {
            console.log(`[EventMapper] Event '${eventName}' triggered. Executing sequence '${sequenceId}'`);
            this.directorService.executeSequenceById(sequenceId);
        });
    });
  }
}
