/**
 * token-budget.ts — Issue #183
 *
 * Cost guardrail for the EventEnricher. Counts both input and output tokens
 * against a single shared budget. Once exhausted the enricher MUST stop
 * making provider calls until the budget is reset.
 */

export interface TokenBudgetSnapshot {
  consumedIn: number;
  consumedOut: number;
  total: number;
  exhausted: boolean;
}

export class TokenBudget {
  private consumedIn = 0;
  private consumedOut = 0;
  /** Total token cap (in + out). Use Number.POSITIVE_INFINITY for "no cap". */
  constructor(private readonly cap: number) {
    if (!(cap > 0)) {
      throw new Error('TokenBudget cap must be positive');
    }
  }

  /** Pre-flight check — call BEFORE issuing a provider request. */
  isExhausted(): boolean {
    return this.consumedIn + this.consumedOut >= this.cap;
  }

  /** Remaining tokens (never negative). */
  remaining(): number {
    return Math.max(0, this.cap - (this.consumedIn + this.consumedOut));
  }

  /** Record actual usage after a provider call returns. */
  consume(tokensIn: number, tokensOut: number): void {
    if (tokensIn < 0 || tokensOut < 0) {
      throw new Error('TokenBudget.consume: negative tokens');
    }
    this.consumedIn += tokensIn;
    this.consumedOut += tokensOut;
  }

  snapshot(): TokenBudgetSnapshot {
    return {
      consumedIn: this.consumedIn,
      consumedOut: this.consumedOut,
      total: this.consumedIn + this.consumedOut,
      exhausted: this.isExhausted(),
    };
  }

  reset(): void {
    this.consumedIn = 0;
    this.consumedOut = 0;
  }
}
