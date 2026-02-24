/**
 * Sequence Library Service
 *
 * Manages the three-tier sequence library:
 * 1. Built-in — shipped with the app (read-only)
 * 2. Cloud   — fetched from Race Control API (read-only, cached)
 * 3. Custom  — user-created, stored in userData/sequences/ (full CRUD)
 *
 * See: documents/feature_sequence_executor_ux.md §7
 */

import { app } from 'electron';
import path from 'path';
import fs from 'fs/promises';
import {
  PortableSequence,
  SequenceFilter,
  IntentCatalogEntry,
  EventCatalogEntry,
} from './director-types';
import { CapabilityCatalog } from './extension-host/capability-catalog';

export class SequenceLibraryService {
  private builtInDir: string;
  private customDir: string;
  private builtInCache: PortableSequence[] = [];
  private customCache: PortableSequence[] = [];

  constructor(private capabilityCatalog: CapabilityCatalog) {
    // Built-in sequences are bundled in the app resources
    // In development: src/renderer/sequences/built-in/ compiled alongside the app
    // At runtime: relative to __dirname (dist-electron/main/) → ../sequences/built-in/
    this.builtInDir = path.join(__dirname, '../sequences/built-in');

    // Custom sequences live in the user's data directory
    this.customDir = path.join(app.getPath('userData'), 'sequences');
  }

  /**
   * Initialize the library by loading built-in and custom sequences from disk.
   */
  async initialize(): Promise<void> {
    // Ensure custom directory exists
    await fs.mkdir(this.customDir, { recursive: true });

    await Promise.all([
      this.loadBuiltIn(),
      this.loadCustom(),
    ]);

    console.log(
      `[SequenceLibrary] Initialized: ${this.builtInCache.length} built-in, ${this.customCache.length} custom sequences`
    );
  }

  /**
   * List all sequences, optionally filtered by category and/or search text.
   */
  async listSequences(filter?: SequenceFilter): Promise<PortableSequence[]> {
    let all = [...this.builtInCache, ...this.customCache];

    if (filter?.category) {
      all = all.filter((s) => s.category === filter.category);
    }

    if (filter?.search) {
      const term = filter.search.toLowerCase();
      all = all.filter(
        (s) =>
          (s.name?.toLowerCase().includes(term) ?? false) ||
          (s.description?.toLowerCase().includes(term) ?? false) ||
          s.steps.some((step) => step.intent.toLowerCase().includes(term))
      );
    }

    return all;
  }

  /**
   * Get a single sequence by ID.
   */
  async getSequence(id: string): Promise<PortableSequence | null> {
    return (
      this.builtInCache.find((s) => s.id === id) ||
      this.customCache.find((s) => s.id === id) ||
      null
    );
  }

  /**
   * Save a custom sequence (create or overwrite).
   * Simple overwrite semantics — no version history.
   */
  async saveCustomSequence(sequence: PortableSequence): Promise<void> {
    // Enforce category
    const toSave: PortableSequence = { ...sequence, category: 'custom' };
    const filePath = this.customFilePath(toSave.id);
    await fs.writeFile(filePath, JSON.stringify(toSave, null, 2), 'utf-8');

    // Update cache
    const idx = this.customCache.findIndex((s) => s.id === toSave.id);
    if (idx >= 0) {
      this.customCache[idx] = toSave;
    } else {
      this.customCache.push(toSave);
    }

    console.log(`[SequenceLibrary] Saved custom sequence: ${toSave.id}`);
  }

  /**
   * Delete a custom sequence by ID.
   */
  async deleteCustomSequence(id: string): Promise<void> {
    const filePath = this.customFilePath(id);
    try {
      await fs.unlink(filePath);
    } catch {
      // File may not exist — that's okay
    }

    this.customCache = this.customCache.filter((s) => s.id !== id);
    console.log(`[SequenceLibrary] Deleted custom sequence: ${id}`);
  }

  /**
   * Import a sequence from a JSON string. Validates and saves to custom.
   */
  async importSequence(json: string): Promise<PortableSequence> {
    const parsed = JSON.parse(json) as PortableSequence;

    // Basic validation
    if (!parsed.id || !Array.isArray(parsed.steps)) {
      throw new Error('Invalid sequence: must have id and steps array');
    }

    await this.saveCustomSequence(parsed);
    return { ...parsed, category: 'custom' };
  }

  /**
   * Export a sequence as a JSON string.
   */
  async exportSequence(id: string): Promise<string> {
    const seq = await this.getSequence(id);
    if (!seq) throw new Error(`Sequence not found: ${id}`);
    return JSON.stringify(seq, null, 2);
  }

  /**
   * Get all registered intents from the Capability Catalog,
   * formatted for the renderer's Intents Browser.
   * Includes built-in system intents (system.wait, system.log).
   */
  getRegisteredIntents(): IntentCatalogEntry[] {
    // Built-in system intents handled directly by SequenceExecutor
    const systemIntents: IntentCatalogEntry[] = [
      {
        intentId: 'system.wait',
        label: 'Wait / Delay',
        extensionId: 'system',
        extensionLabel: 'System',
        inputSchema: {
          type: 'object',
          properties: {
            durationMs: {
              type: 'number',
              description: 'Duration to wait in milliseconds.',
            },
          },
          required: ['durationMs'],
        },
        active: true,
      },
      {
        intentId: 'system.log',
        label: 'Log Message',
        extensionId: 'system',
        extensionLabel: 'System',
        inputSchema: {
          type: 'object',
          properties: {
            message: {
              type: 'string',
              description: 'Message to log.',
            },
            level: {
              type: 'string',
              description: 'Log level.',
              enum: ['INFO', 'WARN', 'ERROR'],
            },
          },
          required: ['message'],
        },
        active: true,
      },
    ];

    const extensionIntents = this.capabilityCatalog.getAllIntents().map((entry) => ({
      intentId: entry.intent.intent,
      label: entry.intent.title,
      extensionId: entry.extensionId,
      extensionLabel: entry.extensionName,
      inputSchema: entry.intent.schema as Record<string, unknown> | undefined,
      active: entry.enabled,
    }));

    return [...systemIntents, ...extensionIntents];
  }

  /**
   * Get all registered events from the Capability Catalog,
   * formatted for the renderer's Events Browser.
   */
  getRegisteredEvents(): EventCatalogEntry[] {
    const allEvents = this.capabilityCatalog.getAllEvents();
    return allEvents.map((entry) => ({
      eventId: entry.event.event,
      label: entry.event.title,
      extensionId: entry.extensionId,
      extensionLabel: entry.extensionName,
      payloadSchema: entry.event.schema as Record<string, unknown> | undefined,
    }));
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private customFilePath(id: string): string {
    // Sanitize ID for filesystem safety
    const safe = id.replace(/[^a-zA-Z0-9_-]/g, '_');
    return path.join(this.customDir, `${safe}.json`);
  }

  private async loadBuiltIn(): Promise<void> {
    try {
      const files = await fs.readdir(this.builtInDir);
      const jsonFiles = files.filter((f) => f.endsWith('.json'));
      const sequences = await Promise.all(
        jsonFiles.map(async (f) => {
          const content = await fs.readFile(path.join(this.builtInDir, f), 'utf-8');
          const seq = JSON.parse(content) as PortableSequence;
          return { ...seq, category: 'builtin' as const };
        })
      );
      this.builtInCache = sequences;
    } catch (err) {
      // Built-in dir may not exist yet in dev — that's okay
      console.warn('[SequenceLibrary] No built-in sequences directory found:', this.builtInDir);
      this.builtInCache = [];
    }
  }

  private async loadCustom(): Promise<void> {
    try {
      const files = await fs.readdir(this.customDir);
      const jsonFiles = files.filter((f) => f.endsWith('.json'));
      const sequences = await Promise.all(
        jsonFiles.map(async (f) => {
          try {
            const content = await fs.readFile(path.join(this.customDir, f), 'utf-8');
            const seq = JSON.parse(content) as PortableSequence;
            return { ...seq, category: 'custom' as const };
          } catch (err) {
            console.warn(`[SequenceLibrary] Failed to parse custom sequence: ${f}`, err);
            return null;
          }
        })
      );
      this.customCache = sequences.filter((s): s is NonNullable<typeof s> => s !== null) as PortableSequence[];
    } catch {
      this.customCache = [];
    }
  }
}
