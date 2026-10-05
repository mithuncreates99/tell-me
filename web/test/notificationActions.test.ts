import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it } from 'vitest';
import * as db from '../src/lib/db';
import { recordAnswerFromNotification } from '../src/lib/notificationActions';
import { habit } from './helpers';

afterEach(async () => {
  await db.clearAll();
});

const data = { kind: 'checkin' as const, habitId: 'gym', date: '2026-10-05', path: '#/checkin/gym/2026-10-05' };

describe('notification Yes/No buttons', () => {
  it('records the answer from the notification', async () => {
    await db.putHabit(habit());
    expect(await recordAnswerFromNotification(data, 'yes', new Date('2026-10-05T19:05:00Z'))).toBe(true);
    const [c] = (await db.loadAll()).checkins;
    expect(c).toMatchObject({ id: 'gym:2026-10-05', answer: 'yes', via: 'notification', answeredAt: '2026-10-05T19:05:00.000Z' });
    expect(await recordAnswerFromNotification(data, 'no')).toBe(true);
    expect((await db.loadAll()).checkins[0]!.answer).toBe('no');
  });

  it('ignores body taps, test notifications and deleted habits', async () => {
    await db.putHabit(habit());
    expect(await recordAnswerFromNotification(data, '')).toBe(false);
    expect(await recordAnswerFromNotification({ kind: 'test', path: '#/' }, 'yes')).toBe(false);
    expect(await recordAnswerFromNotification({ ...data, habitId: 'gone' }, 'yes')).toBe(false);
    expect(await recordAnswerFromNotification({ ...data, date: 'not-a-date' }, 'yes')).toBe(false);
    expect((await db.loadAll()).checkins).toHaveLength(0);
  });
});
