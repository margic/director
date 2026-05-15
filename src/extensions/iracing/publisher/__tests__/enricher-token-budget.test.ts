/**
 * token-budget.test.ts — Issue #183
 */
import { describe, it, expect } from 'vitest';
import { TokenBudget } from '../enricher/token-budget';

describe('TokenBudget', () => {
  it('rejects non-positive caps', () => {
    expect(() => new TokenBudget(0)).toThrow();
    expect(() => new TokenBudget(-1)).toThrow();
  });

  it('starts un-exhausted with full remaining', () => {
    const b = new TokenBudget(100);
    expect(b.isExhausted()).toBe(false);
    expect(b.remaining()).toBe(100);
  });

  it('counts both input and output tokens', () => {
    const b = new TokenBudget(100);
    b.consume(30, 20);
    expect(b.remaining()).toBe(50);
    expect(b.snapshot()).toEqual({ consumedIn: 30, consumedOut: 20, total: 50, exhausted: false });
  });

  it('marks exhausted at the cap', () => {
    const b = new TokenBudget(50);
    b.consume(40, 10);
    expect(b.isExhausted()).toBe(true);
    expect(b.remaining()).toBe(0);
  });

  it('marks exhausted past the cap', () => {
    const b = new TokenBudget(50);
    b.consume(40, 20);
    expect(b.isExhausted()).toBe(true);
    expect(b.remaining()).toBe(0);
  });

  it('reset() returns to fresh state', () => {
    const b = new TokenBudget(50);
    b.consume(50, 0);
    b.reset();
    expect(b.isExhausted()).toBe(false);
    expect(b.remaining()).toBe(50);
  });

  it('rejects negative consumption', () => {
    const b = new TokenBudget(100);
    expect(() => b.consume(-1, 0)).toThrow();
    expect(() => b.consume(0, -1)).toThrow();
  });
});
