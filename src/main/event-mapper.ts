import { ExtensionEventBus } from './extension-host/event-bus';
import { SequenceScheduler } from './sequence-scheduler';
import { configService } from './config-service';
import { AuthService } from './auth-service';
import { normalizeApiResponse } from './normalizer';
import { apiConfig } from './auth-config';

export class EventMapper {
  private mappings: Map<string, string> = new Map(); // eventId -> sequenceId

  constructor(
    private eventBus: ExtensionEventBus,
    private sequenceScheduler: SequenceScheduler,
    private authService: AuthService
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
            this.executeSequenceById(sequenceId);
        });
    });
  }

  /**
   * Fetch and execute a sequence by ID.
   * Enqueues the sequence in SequenceScheduler with 'event-mapper' source.
   */
  private async executeSequenceById(sequenceId: string): Promise<void> {
    if (!sequenceId) return;

    console.log(`[EventMapper] Executing sequence: ${sequenceId}`);

    // Fetch sequence definition
    const token = await this.authService.getAccessToken();
    if (!token) {
      console.warn('[EventMapper] Cannot execute sequence: No auth token.');
      return;
    }

    try {
      const url = `${apiConfig.baseUrl}${apiConfig.endpoints.getSequence(sequenceId)}`;
      const response = await fetch(url, {
        headers: { 'Authorization': `Bearer ${token}` }
      });

      if (!response.ok) {
        console.error(`[EventMapper] Failed to fetch sequence ${sequenceId}: ${response.status}`);
        return;
      }

      const sequenceData: any = await response.json();

      // Normalize API response using centralised normalizer
      const portable = normalizeApiResponse(sequenceData);

      // Enqueue via SequenceScheduler with 'event-mapper' source
      await this.sequenceScheduler.enqueue(portable, {}, { source: 'event-mapper' });

    } catch (err) {
      console.error(`[EventMapper] Error executing sequence ${sequenceId}:`, err);
    }
  }
}
