import { describe, expect, it } from 'vitest';
import { reserveCost, withinBudget } from '../benchmarks/budget.js';
import { fixtures } from '../benchmarks/fixtures.js';

describe('synthetic benchmark controls', () => {
  it('has 60 distinct cases, evenly split and no application records', () => {
    expect(fixtures).toHaveLength(60);
    expect(new Set(fixtures.map(f => f.id)).size).toBe(60);
    expect(fixtures.filter(f => f.kind === 'email')).toHaveLength(30);
    expect(fixtures.every(f => !f.text.includes('@gmail.com'))).toBe(true);
  });
  it('reserves input overhead and maximum output, rejecting exhausted budgets', () => {
    expect(reserveCost({}, 1, 2)).toBeGreaterThan(.008);
    expect(withinBudget(4.99, .02)).toBe(false);
    expect(withinBudget(0, 5)).toBe(true);
    expect(withinBudget(0, Infinity)).toBe(false);
    expect(() => reserveCost({}, Infinity, 1)).toThrow();
  });
});
