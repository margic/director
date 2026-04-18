/**
 * Tests for detectBattles() — battle detection with track-type-aware
 * thresholds and developing-battle tracking (#77)
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { detectBattles } from './director-orchestrator';

function makeCars(...gaps: number[]) {
  // First car has no gap (leader), subsequent cars have gapToCarAhead
  return gaps.map((gap, i) => ({
    carNumber: String(i + 1),
    gapToCarAhead: i === 0 ? 0 : gap,
  }));
}

describe('detectBattles', () => {
  let gapHistory: Map<string, number[]>;

  beforeEach(() => {
    gapHistory = new Map();
  });

  describe('threshold by track type', () => {
    it('should use 1.0s threshold for ovals', () => {
      const cars = makeCars(0, 0.8, 1.2, 0.5);
      const battles = detectBattles(cars, 'oval', gapHistory);

      const active = battles.filter(b => !b.developing);
      expect(active).toHaveLength(2);
      expect(active[0].cars).toEqual(['1', '2']);
      expect(active[0].gapSec).toBe(0.8);
      expect(active[1].cars).toEqual(['3', '4']);
      expect(active[1].gapSec).toBe(0.5);
    });

    it('should use 1.5s threshold for road courses', () => {
      const cars = makeCars(0, 1.3, 0.9, 1.6);
      const battles = detectBattles(cars, 'road course', gapHistory);

      const active = battles.filter(b => !b.developing);
      expect(active).toHaveLength(2);
      expect(active[0].cars).toEqual(['1', '2']);
      expect(active[0].gapSec).toBe(1.3);
      expect(active[1].cars).toEqual(['2', '3']);
      expect(active[1].gapSec).toBe(0.9);
    });

    it('should detect road course from "dirt road" track type', () => {
      const cars = makeCars(0, 1.3);
      const battles = detectBattles(cars, 'dirt road', gapHistory);
      expect(battles.filter(b => !b.developing)).toHaveLength(1);
    });

    it('should default to 1.0s for empty track type', () => {
      const cars = makeCars(0, 0.9, 1.3);
      const battles = detectBattles(cars, '', gapHistory);
      const active = battles.filter(b => !b.developing);
      expect(active).toHaveLength(1);
      expect(active[0].cars).toEqual(['1', '2']);
    });
  });

  describe('developing battles', () => {
    it('should detect developing battle when gap is closing over 3+ samples', () => {
      const trackType = 'oval';
      // Gap is outside 1.0s threshold but inside 2.0s (developing threshold)
      // Simulate 3 polls with closing gap
      const cars1 = makeCars(0, 1.8);
      detectBattles(cars1, trackType, gapHistory);

      const cars2 = makeCars(0, 1.5);
      detectBattles(cars2, trackType, gapHistory);

      const cars3 = makeCars(0, 1.3);
      const battles = detectBattles(cars3, trackType, gapHistory);

      expect(battles).toHaveLength(1);
      expect(battles[0].developing).toBe(true);
      expect(battles[0].gapSec).toBe(1.3);
    });

    it('should NOT flag developing if gap is not consistently closing', () => {
      const trackType = 'oval';
      // Gap fluctuates — not closing
      detectBattles(makeCars(0, 1.8), trackType, gapHistory);
      detectBattles(makeCars(0, 1.5), trackType, gapHistory);
      detectBattles(makeCars(0, 1.7), trackType, gapHistory); // gap increased

      const battles = detectBattles(makeCars(0, 1.4), trackType, gapHistory);
      // Even though latest is 1.4, the history has a non-monotonic decrease
      // (1.8, 1.5, 1.7, 1.4) — not "every step closing"
      expect(battles.filter(b => b.developing)).toHaveLength(0);
    });

    it('should NOT detect developing battle with fewer than 3 samples', () => {
      const trackType = 'oval';
      detectBattles(makeCars(0, 1.8), trackType, gapHistory);
      const battles = detectBattles(makeCars(0, 1.5), trackType, gapHistory);

      // Only 2 samples — not enough
      expect(battles.filter(b => b.developing)).toHaveLength(0);
    });

    it('should NOT detect developing if gap is outside developing threshold', () => {
      const trackType = 'oval'; // threshold 1.0, developing threshold 2.0
      detectBattles(makeCars(0, 2.5), trackType, gapHistory);
      detectBattles(makeCars(0, 2.3), trackType, gapHistory);
      const battles = detectBattles(makeCars(0, 2.1), trackType, gapHistory);

      // Gap > 2.0s — outside developing threshold
      expect(battles).toHaveLength(0);
    });

    it('should promote developing battle to active when gap drops below threshold', () => {
      const trackType = 'oval';
      detectBattles(makeCars(0, 1.5), trackType, gapHistory);
      detectBattles(makeCars(0, 1.2), trackType, gapHistory);

      const battles3 = detectBattles(makeCars(0, 0.8), trackType, gapHistory);
      // Gap now < 1.0 — active battle, not developing
      expect(battles3).toHaveLength(1);
      expect(battles3[0].developing).toBeUndefined();
      expect(battles3[0].gapSec).toBe(0.8);
    });
  });

  describe('gap history management', () => {
    it('should prune history for pairs no longer consecutive', () => {
      detectBattles(makeCars(0, 0.5), 'oval', gapHistory);
      expect(gapHistory.has('1:2')).toBe(true);

      // Now cars are in a different order — pair 1:2 no longer consecutive
      detectBattles(
        [
          { carNumber: '3', gapToCarAhead: 0 },
          { carNumber: '1', gapToCarAhead: 0.5 },
        ],
        'oval',
        gapHistory,
      );

      expect(gapHistory.has('1:2')).toBe(false);
      expect(gapHistory.has('3:1')).toBe(true);
    });

    it('should cap history at 5 samples', () => {
      for (let i = 0; i < 8; i++) {
        detectBattles(makeCars(0, 0.5 + i * 0.01), 'oval', gapHistory);
      }
      expect(gapHistory.get('1:2')!.length).toBe(5);
    });
  });

  describe('edge cases', () => {
    it('should handle empty car list', () => {
      expect(detectBattles([], 'oval', gapHistory)).toEqual([]);
    });

    it('should handle single car', () => {
      expect(detectBattles(makeCars(0), 'oval', gapHistory)).toEqual([]);
    });

    it('should skip cars with zero gap', () => {
      const cars = makeCars(0, 0, 0.5);
      const battles = detectBattles(cars, 'oval', gapHistory);
      expect(battles).toHaveLength(1);
      expect(battles[0].cars).toEqual(['2', '3']);
    });

    it('should round gapSec to 2 decimal places', () => {
      const cars = makeCars(0, 0.456);
      const battles = detectBattles(cars, 'oval', gapHistory);
      expect(battles[0].gapSec).toBe(0.46);
    });
  });
});
