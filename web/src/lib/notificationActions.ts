import * as db from './db';
import type { NotificationData } from './notify';
import { checkinKey } from './schedule';

/**
 * Handles the ✅ Yes / ❌ No buttons on a check-in notification: the answer is written straight
 * to IndexedDB by the service worker, so the user never has to open the app.
 * Returns true when an answer was recorded.
 */
export async function recordAnswerFromNotification(
  data: NotificationData | undefined,
  action: string,
  now: Date = new Date(),
): Promise<boolean> {
  if (action !== 'yes' && action !== 'no') return false;
  if (data?.kind !== 'checkin' || !data.habitId || !data.date || !/^\d{4}-\d{2}-\d{2}$/.test(data.date)) return false;
  if (!(await db.getHabit(data.habitId))) return false; // habit was deleted meanwhile
  await db.putCheckin({
    id: checkinKey(data.habitId, data.date),
    habitId: data.habitId,
    date: data.date,
    answer: action,
    answeredAt: now.toISOString(),
    via: 'notification',
  });
  return true;
}
