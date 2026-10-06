import { afterEach, describe, expect, it, vi } from 'vitest';
import { formatDate, formatTime, weekdayName } from '../src/lib/dates';

describe('date and time labels', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('use the browser language', () => {
    vi.stubGlobal('navigator', { language: 'en-GB' });
    expect(formatDate('2026-10-08', { day: 'numeric', month: 'long' })).toBe('8 October');
    expect(weekdayName(1, 'long')).toBe('Monday');
  });

  it('fall back to the default language when the browser reports a tag Intl rejects', () => {
    vi.stubGlobal('navigator', { language: 'en-US@posix' });
    expect(() => formatDate('2026-10-08')).not.toThrow();
    expect(() => weekdayName(1)).not.toThrow();
    expect(() => formatTime('18:00')).not.toThrow();
  });
});
