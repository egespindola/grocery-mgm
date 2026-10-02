import { afterEach, describe, expect, it, vi } from 'vitest';
import { fixedClock, systemClock } from './clock';

describe('clock', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('systemClock returns the current instant as ISO-8601 UTC', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-28T10:00:00Z'));

    expect(systemClock.now()).toBe('2026-09-28T10:00:00.000Z');
  });

  it('fixedClock always returns the given instant normalized to UTC', () => {
    const clock = fixedClock('2026-09-28T07:00:00-03:00');

    expect(clock.now()).toBe('2026-09-28T10:00:00.000Z');
    expect(clock.now()).toBe('2026-09-28T10:00:00.000Z');
  });
});
