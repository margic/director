import { IntentContribution, EventContribution, ExtensionManifest } from './extension-types';

/**
 * Static Tier of the Two-Tier Registry.
 *
 * Built at startup by scanning ALL installed extension manifests,
 * regardless of enabled/disabled state. This catalog:
 *
 * 1. Powers the Sequence Editor UI (shows available intents even if extension is disabled).
 * 2. Is sent to Race Control Cloud during the Capabilities Handshake.
 * 3. Persists as long as the extension is installed.
 *
 * The catalog does NOT execute anything — that is the Handler Registry's job.
 */

export interface CatalogEntry {
  extensionId: string;
  extensionName: string;  // Human-readable (from manifest displayName or name)
  intent: IntentContribution;
  enabled: boolean;       // Whether the owning extension is currently active
}

export interface EventCatalogEntry {
  extensionId: string;
  extensionName: string;
  event: EventContribution;
}

export class CapabilityCatalog {
  private intents: Map<string, CatalogEntry> = new Map();
  private events: Map<string, EventCatalogEntry> = new Map();

  /**
   * Registers all intents and events from an extension manifest.
   * Called during scan phase — before any extensions are activated.
   */
  public registerExtension(extensionId: string, manifest: ExtensionManifest, enabled: boolean): void {
    const displayName = (manifest as any).displayName || manifest.name;

    if (manifest.contributes?.intents) {
      for (const intent of manifest.contributes.intents) {
        this.intents.set(intent.intent, {
          extensionId,
          extensionName: displayName,
          intent,
          enabled,
        });
        console.log(`[CapabilityCatalog] Cataloged intent '${intent.intent}' from ${extensionId} (${enabled ? 'active' : 'inactive'})`);
      }
    }

    if (manifest.contributes?.events) {
      for (const event of manifest.contributes.events) {
        this.events.set(event.event, {
          extensionId,
          extensionName: displayName,
          event,
        });
        console.log(`[CapabilityCatalog] Cataloged event '${event.event}' from ${extensionId}`);
      }
    }
  }

  /**
   * Removes all entries for an extension (e.g., when uninstalled).
   */
  public unregisterExtension(extensionId: string): void {
    for (const [key, entry] of this.intents.entries()) {
      if (entry.extensionId === extensionId) {
        this.intents.delete(key);
      }
    }
    for (const [key, entry] of this.events.entries()) {
      if (entry.extensionId === extensionId) {
        this.events.delete(key);
      }
    }
  }

  /**
   * Marks an extension as enabled/disabled in the catalog.
   * Does NOT add or remove entries — just updates the `enabled` flag.
   */
  public setExtensionEnabled(extensionId: string, enabled: boolean): void {
    for (const entry of this.intents.values()) {
      if (entry.extensionId === extensionId) {
        entry.enabled = enabled;
      }
    }
  }

  /**
   * Returns a single catalog entry for an intent.
   */
  public getIntent(intentId: string): CatalogEntry | undefined {
    return this.intents.get(intentId);
  }

  /**
   * Returns ALL cataloged intents (for Editor UI / Cloud Handshake).
   */
  public getAllIntents(): CatalogEntry[] {
    return Array.from(this.intents.values());
  }

  /**
   * Returns ALL cataloged events.
   */
  public getAllEvents(): EventCatalogEntry[] {
    return Array.from(this.events.values());
  }

  /**
   * Returns a JSON-serializable summary for Cloud sync.
   */
  public toCapabilitiesPayload(): {
    intents: Array<{ intent: string; title: string; schema?: object; extensionId: string; enabled: boolean }>;
    events: Array<{ event: string; title: string; schema?: object; extensionId: string }>;
  } {
    return {
      intents: this.getAllIntents().map(e => ({
        intent: e.intent.intent,
        title: e.intent.title,
        schema: e.intent.schema,
        extensionId: e.extensionId,
        enabled: e.enabled,
      })),
      events: this.getAllEvents().map(e => ({
        event: e.event.event,
        title: e.event.title,
        schema: e.event.schema,
        extensionId: e.extensionId,
      })),
    };
  }

  public clear(): void {
    this.intents.clear();
    this.events.clear();
  }
}
