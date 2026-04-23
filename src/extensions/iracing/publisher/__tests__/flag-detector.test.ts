import { describe, it, expect } from 'vitest';
import { detectFlags, FLAG_GREEN, FLAG_WHITE, FLAG_YELLOW, FLAG_CAUTION } from '../flag-detector';
import { createSessionState } from '../session-state';
import { makeFrame, FlagBits } from './frame-fixtures';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const CTX = { publisherCode: 'rig-01', raceSessionId: 'session-abc' };

function makeState() {
  return createSessionState('session-abc', 1);
}

function detect(prev: ReturnType<typeof makeFrame> | null, curr: ReturnType<typeof makeFrame>) {
  return detectFlags(prev, curr, makeState(), CTX);
}

// Shorthand: build a frame with only sessionFlags set (no car data)
function flagFrame(flags: number) {
  return makeFrame({ sessionFlags: flags });
}

// ---------------------------------------------------------------------------
// First frame guard
// ---------------------------------------------------------------------------

describe('first frame (prev=null)', () => {
  it('emits no events regardless of current flags', () => {
    const curr = flagFrame(FlagBits.Green | FlagBits.Yellow | FlagBits.Caution);
    expect(detect(null, curr)).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// FLAG_GREEN
// ---------------------------------------------------------------------------

describe('FLAG_GREEN', () => {
  it('fires on rising edge of Green bit', () => {
    const prev = flagFrame(0);
    const curr = flagFrame(FlagBits.Green);
    const events = detect(prev, curr);
    expect(events.find(e => e.type === 'FLAG_GREEN')).toBeDefined();
  });

  it('does NOT fire when Green bit was already set', () => {
    const prev = flagFrame(FlagBits.Green);
    const curr = flagFrame(FlagBits.Green);
    expect(detect(prev, curr).find(e => e.type === 'FLAG_GREEN')).toBeUndefined();
  });

  it('does NOT fire on falling edge (green bit cleared)', () => {
    const prev = flagFrame(FlagBits.Green);
    const curr = flagFrame(0);
    expect(detect(prev, curr).find(e => e.type === 'FLAG_GREEN')).toBeUndefined();
  });

  it('fires again when green bit rises after being cleared', () => {
    const step1 = detect(flagFrame(0), flagFrame(FlagBits.Green));
    expect(step1.find(e => e.type === 'FLAG_GREEN')).toBeDefined();

    const step2 = detect(flagFrame(FlagBits.Green), flagFrame(0));
    expect(step2.find(e => e.type === 'FLAG_GREEN')).toBeUndefined();

    const step3 = detect(flagFrame(0), flagFrame(FlagBits.Green));
    expect(step3.find(e => e.type === 'FLAG_GREEN')).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// FLAG_WHITE
// ---------------------------------------------------------------------------

describe('FLAG_WHITE', () => {
  it('fires on rising edge of White bit', () => {
    const prev = flagFrame(0);
    const curr = flagFrame(FlagBits.White);
    expect(detect(prev, curr).find(e => e.type === 'FLAG_WHITE')).toBeDefined();
  });

  it('does NOT fire when White bit unchanged', () => {
    const prev = flagFrame(FlagBits.White);
    const curr = flagFrame(FlagBits.White);
    expect(detect(prev, curr).find(e => e.type === 'FLAG_WHITE')).toBeUndefined();
  });

  it('event carries correct envelope fields', () => {
    const prev = flagFrame(0);
    const curr = flagFrame(FlagBits.White);
    const events = detect(prev, curr);
    const ev = events.find(e => e.type === 'FLAG_WHITE')!;
    expect(ev.raceSessionId).toBe('session-abc');
    expect(ev.publisherCode).toBe('rig-01');
  });
});

// ---------------------------------------------------------------------------
// FLAG_YELLOW_LOCAL
// ---------------------------------------------------------------------------

describe('FLAG_YELLOW_LOCAL', () => {
  it('fires when Yellow bit rises WITHOUT Caution bit', () => {
    const prev = flagFrame(FlagBits.Green);
    const curr = flagFrame(FlagBits.Green | FlagBits.Yellow);
    const events = detect(prev, curr);
    expect(events.find(e => e.type === 'FLAG_YELLOW_LOCAL')).toBeDefined();
  });

  it('does NOT also emit FLAG_YELLOW_FULL_COURSE for a local yellow', () => {
    const prev = flagFrame(0);
    const curr = flagFrame(FlagBits.Yellow);
    const events = detect(prev, curr);
    expect(events.find(e => e.type === 'FLAG_YELLOW_FULL_COURSE')).toBeUndefined();
    expect(events.find(e => e.type === 'FLAG_YELLOW_LOCAL')).toBeDefined();
  });

  it('does NOT fire when Yellow bit was already set', () => {
    const prev = flagFrame(FlagBits.Yellow);
    const curr = flagFrame(FlagBits.Yellow);
    expect(detect(prev, curr).find(e => e.type === 'FLAG_YELLOW_LOCAL')).toBeUndefined();
  });

  it('does NOT fire for FLAG_YELLOW_LOCAL when Yellow rises WITH Caution (full-course)', () => {
    const prev = flagFrame(0);
    const curr = flagFrame(FlagBits.Yellow | FlagBits.Caution);
    const events = detect(prev, curr);
    expect(events.find(e => e.type === 'FLAG_YELLOW_LOCAL')).toBeUndefined();
    expect(events.find(e => e.type === 'FLAG_YELLOW_FULL_COURSE')).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// FLAG_YELLOW_FULL_COURSE
// ---------------------------------------------------------------------------

describe('FLAG_YELLOW_FULL_COURSE', () => {
  it('fires when Yellow and Caution bits rise simultaneously', () => {
    const prev = flagFrame(0);
    const curr = flagFrame(FlagBits.Yellow | FlagBits.Caution);
    expect(detect(prev, curr).find(e => e.type === 'FLAG_YELLOW_FULL_COURSE')).toBeDefined();
  });

  it('fires when Caution bit rises while Yellow was already set (escalation)', () => {
    const prev = flagFrame(FlagBits.Yellow);           // local yellow existing
    const curr = flagFrame(FlagBits.Yellow | FlagBits.Caution); // escalated to full-course
    expect(detect(prev, curr).find(e => e.type === 'FLAG_YELLOW_FULL_COURSE')).toBeDefined();
  });

  it('emits exactly ONE FULL_COURSE event when both bits rise at the same time', () => {
    const prev = flagFrame(0);
    const curr = flagFrame(FlagBits.Yellow | FlagBits.Caution);
    const events = detect(prev, curr);
    expect(events.filter(e => e.type === 'FLAG_YELLOW_FULL_COURSE')).toHaveLength(1);
  });

  it('does NOT emit FLAG_YELLOW_LOCAL when full-course yellow fires', () => {
    const prev = flagFrame(0);
    const curr = flagFrame(FlagBits.Yellow | FlagBits.Caution);
    const events = detect(prev, curr);
    expect(events.find(e => e.type === 'FLAG_YELLOW_LOCAL')).toBeUndefined();
  });

  it('is idempotent — no duplicate event when full-course flags persist across frames', () => {
    const prev = flagFrame(FlagBits.Yellow | FlagBits.Caution);
    const curr = flagFrame(FlagBits.Yellow | FlagBits.Caution);
    expect(detect(prev, curr).find(e => e.type === 'FLAG_YELLOW_FULL_COURSE')).toBeUndefined();
  });

  it('uses the YellowFullCourse compound fixture value consistently', () => {
    // FlagBits.YellowFullCourse = Yellow | Caution = 0x4008
    expect(FlagBits.YellowFullCourse).toBe(FlagBits.Yellow | FlagBits.Caution);
    const prev = flagFrame(0);
    const curr = flagFrame(FlagBits.YellowFullCourse);
    expect(detect(prev, curr).find(e => e.type === 'FLAG_YELLOW_FULL_COURSE')).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// Multiple flags in a single frame
// ---------------------------------------------------------------------------

describe('multiple flags in one frame', () => {
  it('emits GREEN and WHITE in the same frame if both rise', () => {
    const prev = flagFrame(0);
    const curr = flagFrame(FlagBits.Green | FlagBits.White);
    const events = detect(prev, curr);
    expect(events.find(e => e.type === 'FLAG_GREEN')).toBeDefined();
    expect(events.find(e => e.type === 'FLAG_WHITE')).toBeDefined();
  });

  it('each event has a unique UUID id', () => {
    const prev = flagFrame(0);
    const curr = flagFrame(FlagBits.Green | FlagBits.White);
    const events = detect(prev, curr);
    const ids = events.map(e => e.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

// ---------------------------------------------------------------------------
// Envelope
// ---------------------------------------------------------------------------

describe('event envelope', () => {
  it('events carry sessionFlags in context', () => {
    const prev = flagFrame(0);
    const curr = flagFrame(FlagBits.Green);
    const [ev] = detect(prev, curr);
    expect(ev.context?.sessionFlags).toBe(FlagBits.Green);
  });

  it('events carry sessionTime from current frame', () => {
    const prev = makeFrame({ sessionFlags: 0, sessionTime: 100 });
    const curr = makeFrame({ sessionFlags: FlagBits.Green, sessionTime: 200 });
    const [ev] = detect(prev, curr);
    expect(ev.sessionTime).toBe(200);
  });
});
