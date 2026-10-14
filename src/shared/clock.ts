export interface Clock {
  /** Current instant as an ISO-8601 UTC string, e.g. `2026-09-28T10:00:00.000Z`. */
  now(): string;
}

export const systemClock: Clock = {
  now: () => new Date().toISOString(),
};

export function fixedClock(instant: string | Date): Clock {
  const iso = new Date(instant).toISOString();
  return { now: () => iso };
}
