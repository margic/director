import { describe, it, expect } from 'vitest';
import { mapIntentToContextType, deriveUrgency } from './discord-service';

describe('TTS Context Mapping', () => {
  describe('mapIntentToContextType', () => {
    it('returns "race_update" when no intent is provided', () => {
      expect(mapIntentToContextType()).toBe('race_update');
      expect(mapIntentToContextType(undefined)).toBe('race_update');
    });

    it('returns "safety" for safety-related intents', () => {
      expect(mapIntentToContextType('safety.fullCourseYellow')).toBe('safety');
      expect(mapIntentToContextType('system.safety')).toBe('safety');
      expect(mapIntentToContextType('caution.deployed')).toBe('safety');
    });

    it('returns "commentary" for chat/commentary intents', () => {
      expect(mapIntentToContextType('communication.talkToChat')).toBe('commentary');
      expect(mapIntentToContextType('broadcast.commentary')).toBe('commentary');
    });

    it('returns "driver_message" for driver-targeted intents', () => {
      expect(mapIntentToContextType('communication.talkToDriver')).toBe('driver_message');
      expect(mapIntentToContextType('driver.radio')).toBe('driver_message');
    });

    it('returns "race_update" for generic intents', () => {
      expect(mapIntentToContextType('communication.announce')).toBe('race_update');
      expect(mapIntentToContextType('broadcast.showLiveCam')).toBe('race_update');
    });
  });

  describe('deriveUrgency', () => {
    it('defaults to "medium" with no options', () => {
      expect(deriveUrgency()).toBe('medium');
      expect(deriveUrgency({})).toBe('medium');
    });

    it('returns explicit urgency when provided', () => {
      expect(deriveUrgency({ urgency: 'high' })).toBe('high');
      expect(deriveUrgency({ urgency: 'low' })).toBe('low');
    });

    it('returns "high" when priority is true and no explicit urgency', () => {
      expect(deriveUrgency({ priority: true })).toBe('high');
    });

    it('prefers explicit urgency over priority flag', () => {
      expect(deriveUrgency({ priority: true, urgency: 'low' })).toBe('low');
    });
  });
});
