/**
 * Sequence Scheduler
 *
 * Manages execution concurrency for the SequenceExecutor:
 * - Default: queue behind current Director Loop sequence
 * - Priority: execute in parallel immediately
 * - Maintains an in-memory ring buffer of execution history (max 25)
 *
 * See: documents/feature_sequence_executor_ux.md §8
 */

import { randomUUID } from 'crypto';
import {
  PortableSequence,
  SequenceVariable,
  ExecutionResult,
  StepResult,
  SequenceProgress,
  QueuedSequence,
  ExecutionHistoryConfig,
} from './director-types';
import { SequenceExecutor } from './sequence-executor';
import { EventEmitter } from 'events';

const VAR_PATTERN = /\$var\(([^)]+)\)/g;

/**
 * Resolves all $var(name) references in a sequence's step payloads.
 * Substitution-only — no expression evaluation.
 */
function resolveVariables(
  sequence: PortableSequence,
  provided: Record<string, unknown>
): PortableSequence {
  const variables = sequence.variables ?? [];

  // Build resolution map: explicit → default → undefined
  const resolved: Record<string, unknown> = {};
  for (const varDef of variables) {
    if (varDef.name in provided) {
      resolved[varDef.name] = provided[varDef.name];
    } else if (varDef.default !== undefined) {
      resolved[varDef.name] = varDef.default;
    }
  }

  // Check required variables
  for (const varDef of variables) {
    if (varDef.required && !(varDef.name in resolved)) {
      throw new Error(`Missing required variable: ${varDef.name} (${varDef.label})`);
    }
  }

  // Deep-substitute $var(name) references in step payloads
  const resolvedSteps = sequence.steps.map((step) => ({
    ...step,
    payload: substitutePayload(step.payload, resolved),
  }));

  return { ...sequence, steps: resolvedSteps };
}

/**
 * Recursively substitute $var(name) in a payload object.
 */
function substitutePayload(
  payload: Record<string, unknown>,
  vars: Record<string, unknown>
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(payload)) {
    if (typeof value === 'string') {
      // Check if the entire string is a single $var() reference
      const fullMatch = value.match(/^\$var\(([^)]+)\)$/);
      if (fullMatch) {
        // Return the raw value (preserves type: number, boolean, etc.)
        result[key] = vars[fullMatch[1]] ?? value;
      } else {
        // Partial substitution within a string
        result[key] = value.replace(VAR_PATTERN, (_, name) => {
          const val = vars[name];
          return val !== undefined ? String(val) : `$var(${name})`;
        });
      }
    } else if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
      result[key] = substitutePayload(value as Record<string, unknown>, vars);
    } else {
      result[key] = value;
    }
  }
  return result;
}

export interface SequenceSchedulerOptions {
  historyConfig?: ExecutionHistoryConfig;
}

export class SequenceScheduler extends EventEmitter {
  private queue: QueuedSequence[] = [];
  private history: ExecutionResult[] = [];
  private maxHistory: number;
  private currentExecution: { executionId: string; cancel: () => void } | null = null;
  private isProcessing = false;
  private executingSequences: Map<string, PortableSequence> = new Map();

  constructor(
    private executor: SequenceExecutor,
    options?: SequenceSchedulerOptions
  ) {
    super();
    this.maxHistory = options?.historyConfig?.maxEntries ?? 25;
  }

  /**
   * Enqueue a sequence for execution.
   * Returns an execution ID for tracking.
   */
  async enqueue(
    sequence: PortableSequence,
    variables: Record<string, unknown> = {},
    options?: {
      source?: 'manual' | 'director-loop' | 'ai-agent' | 'stream-deck' | 'webhook' | 'event-mapper';
      priority?: boolean;
    }
  ): Promise<string> {
    const executionId = randomUUID();
    const priority = options?.priority ?? sequence.priority ?? false;
    const source = options?.source ?? 'manual';

    if (priority) {
      // Priority: execute immediately in parallel
      this.executePriority(executionId, sequence, variables, source);
      return executionId;
    }

    // Default: add to queue
    const queued: QueuedSequence = {
      executionId,
      sequence,
      variables,
      queuedAt: new Date().toISOString(),
      position: this.queue.length + 1,
      source,
    };
    this.queue.push(queued);
    this.emit('queueChanged', this.queue);

    // Start processing if not already
    if (!this.isProcessing) {
      this.processQueue();
    }

    return executionId;
  }

  /**
   * Get the current queue.
   */
  getQueue(): QueuedSequence[] {
    return [...this.queue];
  }

  /**
   * Check if a sequence is currently executing.
   */
  isExecuting(): boolean {
    return this.currentExecution !== null;
  }

  /**
   * Cancel the currently executing sequence.
   */
  async cancelCurrent(): Promise<void> {
    if (this.currentExecution) {
      this.currentExecution.cancel();
      this.currentExecution = null;
    }
  }

  /**
   * Cancel a queued (not yet executing) sequence by execution ID.
   */
  async cancelQueued(executionId: string): Promise<void> {
    this.queue = this.queue.filter((q) => q.executionId !== executionId);
    // Recalculate positions
    this.queue.forEach((q, i) => (q.position = i + 1));
    this.emit('queueChanged', this.queue);
  }

  /**
   * Get the PortableSequence for a currently or recently executing sequence.
   * Used by the renderer to display sequences not in the library (e.g. cloud/agent).
   */
  getExecutingSequence(sequenceId: string): PortableSequence | null {
    return this.executingSequences.get(sequenceId) ?? null;
  }

  /**
   * Get execution history (in-memory ring buffer).
   */
  getHistory(): ExecutionResult[] {
    return [...this.history];
  }

  // ---------------------------------------------------------------------------
  // Private execution
  // ---------------------------------------------------------------------------

  private async processQueue(): Promise<void> {
    this.isProcessing = true;

    while (this.queue.length > 0) {
      const queued = this.queue.shift()!;
      // Recalculate positions
      this.queue.forEach((q, i) => (q.position = i + 1));
      this.emit('queueChanged', this.queue);

      await this.executeSequence(
        queued.executionId,
        queued.sequence,
        queued.variables,
        queued.source,
        false
      );
    }

    this.isProcessing = false;
  }

  private async executePriority(
    executionId: string,
    sequence: PortableSequence,
    variables: Record<string, unknown>,
    source: string
  ): Promise<void> {
    // Cancel-and-replace: cancel current execution and clear queue
    if (this.currentExecution) {
      console.log(`[SequenceScheduler] Priority sequence: cancelling current execution ${this.currentExecution.executionId}`);
      this.currentExecution.cancel();
      this.currentExecution = null;
    }

    // Clear the queue
    if (this.queue.length > 0) {
      console.log(`[SequenceScheduler] Priority sequence: clearing queue of ${this.queue.length} items`);
      this.queue = [];
      this.emit('queueChanged', this.queue);
    }

    // Execute immediately (fire and don't block)
    this.executeSequence(executionId, sequence, variables, source, true);
  }

  private async executeSequence(
    executionId: string,
    sequence: PortableSequence,
    variables: Record<string, unknown>,
    source: string,
    priority: boolean
  ): Promise<void> {
    const startedAt = new Date().toISOString();
    const stepResults: StepResult[] = [];
    let cancelled = false;

    // Resolve variables
    let resolvedSequence: PortableSequence;
    try {
      resolvedSequence = resolveVariables(sequence, variables);
    } catch (err: any) {
      // Variable resolution failed
      const result: ExecutionResult = {
        executionId,
        sequenceId: sequence.id,
        sequenceName: sequence.name ?? sequence.id,
        status: 'failed',
        source: source as ExecutionResult['source'],
        priority,
        startedAt,
        completedAt: new Date().toISOString(),
        totalDurationMs: 0,
        resolvedVariables: variables,
        steps: [],
      };
      this.pushHistory(result);
      this.emitProgress({
        executionId,
        sequenceId: sequence.id,
        sequenceName: sequence.name ?? sequence.id,
        currentStep: 0,
        totalSteps: sequence.steps.length,
        stepIntent: 'system.error',
        stepStatus: 'failed',
        log: `[ERROR] Variable resolution failed: ${err.message}`,
      });
      return;
    }

    // Set up cancel handle
    const cancelController = { cancelled: false };
    if (!priority) {
      this.currentExecution = {
        executionId,
        cancel: () => {
          cancelController.cancelled = true;
        },
      };
    }

    const totalSteps = resolvedSequence.steps.length;

    // Track the executing sequence so the renderer can look it up
    this.executingSequences.set(sequence.id, sequence);

    // Emit start
    this.emitProgress({
      executionId,
      sequenceId: sequence.id,
      sequenceName: sequence.name ?? sequence.id,
      currentStep: 0,
      totalSteps,
      stepIntent: 'sequence.start',
      stepStatus: 'running',
      log: `▶ Starting sequence: "${sequence.name ?? sequence.id}" (${totalSteps} steps)`,
    });

    for (let i = 0; i < resolvedSequence.steps.length; i++) {
      if (cancelController.cancelled) {
        cancelled = true;
        break;
      }

      const step = resolvedSequence.steps[i];
      const stepStart = Date.now();

      this.emitProgress({
        executionId,
        sequenceId: sequence.id,
        sequenceName: sequence.name ?? sequence.id,
        currentStep: i + 1,
        totalSteps,
        stepIntent: step.intent,
        stepStatus: 'running',
        log: `⏳ Step ${i + 1}/${totalSteps}: ${step.intent}...`,
      });

      try {
        // Execute single step via the executor  
        await this.executor.executeStep(step);

        const durationMs = Date.now() - stepStart;
        stepResults.push({
          stepId: step.id,
          intent: step.intent,
          status: 'success',
          durationMs,
        });

        this.emitProgress({
          executionId,
          sequenceId: sequence.id,
          sequenceName: sequence.name ?? sequence.id,
          currentStep: i + 1,
          totalSteps,
          stepIntent: step.intent,
          stepStatus: 'success',
          log: `✅ Step ${i + 1}/${totalSteps}: ${step.intent} (${durationMs}ms)`,
        });
      } catch (err: any) {
        const durationMs = Date.now() - stepStart;
        const isSkip = err.message?.includes('No active handler');
        stepResults.push({
          stepId: step.id,
          intent: step.intent,
          status: isSkip ? 'skipped' : 'failed',
          durationMs,
          message: err.message,
        });

        const icon = isSkip ? '⚠️' : '❌';
        const statusText = isSkip ? 'SKIPPED' : 'FAILED';
        this.emitProgress({
          executionId,
          sequenceId: sequence.id,
          sequenceName: sequence.name ?? sequence.id,
          currentStep: i + 1,
          totalSteps,
          stepIntent: step.intent,
          stepStatus: isSkip ? 'skipped' : 'failed',
          log: `${icon} Step ${i + 1}/${totalSteps}: ${step.intent} → ${statusText}: ${err.message}`,
        });
      }
    }

    // Determine overall status
    const completedAt = new Date().toISOString();
    const totalDurationMs = new Date(completedAt).getTime() - new Date(startedAt).getTime();
    let status: ExecutionResult['status'];

    if (cancelled) {
      status = 'cancelled';
    } else if (stepResults.every((s) => s.status === 'success')) {
      status = 'completed';
    } else if (stepResults.some((s) => s.status === 'success')) {
      status = 'partial';
    } else {
      status = 'failed';
    }

    const succeeded = stepResults.filter((s) => s.status === 'success').length;
    this.emitProgress({
      executionId,
      sequenceId: sequence.id,
      sequenceName: sequence.name ?? sequence.id,
      currentStep: totalSteps,
      totalSteps,
      stepIntent: 'sequence.end',
      stepStatus: status === 'completed' ? 'success' : 'failed',
      log: `🏁 Sequence ${cancelled ? 'cancelled' : 'complete'}: ${succeeded}/${totalSteps} steps succeeded (${(totalDurationMs / 1000).toFixed(1)}s)`,
    });

    const result: ExecutionResult = {
      executionId,
      sequenceId: sequence.id,
      sequenceName: sequence.name ?? sequence.id,
      status,
      source: source as ExecutionResult['source'],
      priority,
      startedAt,
      completedAt,
      totalDurationMs,
      resolvedVariables: variables,
      steps: stepResults,
    };

    this.pushHistory(result);

    if (!priority) {
      this.currentExecution = null;
    }
  }

  private pushHistory(result: ExecutionResult): void {
    this.history.push(result);
    if (this.history.length > this.maxHistory) {
      this.history.shift();
    }
    this.emit('historyChanged', this.history);
  }

  private emitProgress(progress: SequenceProgress): void {
    this.emit('progress', progress);
  }
}
