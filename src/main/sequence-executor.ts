import {
  SequenceStep,
  PortableSequence,
} from './director-types';
import { ExtensionHostService } from './extension-host/extension-host';
import { OverlayBus } from './overlay/overlay-bus';

// Forward-declared to avoid circular dependency — set via setSequenceLibrary()
interface SequenceLibraryLike {
  getSequence(id: string): Promise<PortableSequence | null>;
}

/**
 * Sequence Executor — Intent-Driven, Headless Runtime
 *
 * This executor does NOT know how sequences were created (Visual Editor, 
 * AI, API, manual JSON). It only operates on the PortableSequence format.
 *
 * Architecture:
 * - Built-in handlers for `system.*` intents (wait, log, executeSequence)
 * - Built-in handlers for `overlay.*` intents (show, hide)
 * - All other intents dispatched to ExtensionHostService
 * - Soft Failure: missing handlers result in a skip + warning, not an abort
 *
 * See: documents/feature_sequence_executor.md
 */
export class SequenceExecutor {
  private sequenceLibrary: SequenceLibraryLike | null = null;

  constructor(
    private extensionHost: ExtensionHostService,
    private overlayBus?: OverlayBus,
  ) {}

  /**
   * Set the sequence library reference (avoids circular constructor dependency).
   */
  setSequenceLibrary(library: SequenceLibraryLike): void {
    this.sequenceLibrary = library;
  }

  /**
   * Execute a PortableSequence (the canonical format).
   */
  async execute(
    sequence: PortableSequence,
    onProgress?: (completed: number, total: number) => void
  ): Promise<void> {
    const { id, steps } = sequence;
    console.log(`[SequenceExecutor] Executing sequence '${id}' with ${steps.length} steps`);
    
    let completed = 0;
    const total = steps.length;

    if (onProgress) onProgress(completed, total);

    for (const step of steps) {
      const label = step.metadata?.label || step.intent;
      console.log(`[SequenceExecutor] Step ${completed + 1}/${total}: [${step.intent}]`, JSON.stringify(step.payload));

      try {
        await this.executeStep(step);
      } catch (error) {
        // Handler threw an error — log and continue (per spec: soft failure)
        console.error(`[SequenceExecutor] Error in step '${step.id}' (${step.intent}):`, error);
      }

      completed++;
      if (onProgress) onProgress(completed, total);
    }

    console.log(`[SequenceExecutor] Sequence '${id}' complete.`);
  }

  /**
   * Dispatch a single step to the appropriate handler.
   * Public so that SequenceScheduler can invoke steps individually
   * for fine-grained progress reporting and cancellation.
   */
  async executeStep(step: SequenceStep): Promise<void> {
    const { intent, payload } = step;

    // --- Built-in System Intents ---
    if (intent === 'system.wait') {
      const durationMs = (payload as any).durationMs ?? 0;
      if (durationMs > 0) {
        await new Promise(resolve => setTimeout(resolve, durationMs));
      }
      return;
    }

    if (intent === 'system.log') {
      const message = (payload as any).message ?? '';
      const level: string = (payload as any).level ?? 'INFO';
      const timestamp = new Date().toISOString();
      const logMessage = `[${timestamp}] [DIRECTOR-LOG] [${level}] ${message}`;
      switch (level) {
        case 'ERROR': console.error(logMessage); break;
        case 'WARN':  console.warn(logMessage); break;
        default:      console.log(logMessage); break;
      }
      return;
    }

    if (intent === 'system.executeSequence') {
      const sequenceId = (payload as any).sequenceId;
      if (!sequenceId) {
        console.warn('[SequenceExecutor] system.executeSequence: missing sequenceId');
        return;
      }
      if (!this.sequenceLibrary) {
        console.warn('[SequenceExecutor] system.executeSequence: no sequence library configured');
        return;
      }
      const nested = await this.sequenceLibrary.getSequence(sequenceId);
      if (!nested) {
        console.warn(`[SequenceExecutor] system.executeSequence: sequence '${sequenceId}' not found`);
        return;
      }
      console.log(`[SequenceExecutor] Executing nested sequence '${sequenceId}'`);
      await this.execute(nested);
      return;
    }

    // --- Built-in Overlay Intents ---
    if (intent === 'overlay.show') {
      if (!this.overlayBus) {
        console.warn('[SequenceExecutor] overlay.show: no OverlayBus configured');
        return;
      }
      const extensionId = (payload as any).extensionId;
      const overlayId = (payload as any).overlayId;
      if (!extensionId || !overlayId) {
        console.warn('[SequenceExecutor] overlay.show: missing extensionId or overlayId');
        return;
      }
      this.overlayBus.showOverlay(extensionId, overlayId);
      return;
    }

    if (intent === 'overlay.hide') {
      if (!this.overlayBus) {
        console.warn('[SequenceExecutor] overlay.hide: no OverlayBus configured');
        return;
      }
      const extensionId = (payload as any).extensionId;
      const overlayId = (payload as any).overlayId;
      if (!extensionId || !overlayId) {
        console.warn('[SequenceExecutor] overlay.hide: missing extensionId or overlayId');
        return;
      }
      this.overlayBus.hideOverlay(extensionId, overlayId);
      return;
    }

    // --- Extension Intents (Dynamic Handler Registry) ---
    if (!this.extensionHost.hasActiveHandler(intent)) {
      // Soft Failure: skip this step, do not abort the sequence
      console.warn(`[SequenceExecutor] Skipping step: No active handler for intent '${intent}'. Extension may be disabled or uninstalled.`);
      return;
    }

    await this.extensionHost.executeIntent(intent, payload);
  }
}

