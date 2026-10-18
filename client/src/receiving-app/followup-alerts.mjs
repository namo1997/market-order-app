import { canManageFollowups } from '../pages/receiving/receiving-queue.js';

// One queue across refresh/focus events, scoped to API origin and signed-in user.
// Preferences contains only notified IDs, never bill contents or credentials.
export function createFollowupAlerts({ preferences, notifyUrgent, supported = () => true, scopeToBranch = false }) {
  let queue = Promise.resolve();
  async function deliver({ user, origin, items, isCurrent = () => true }) {
    if (!supported() || !canManageFollowups(user) || !user.id || !origin || !Array.isArray(items) || !isCurrent()) return;
    const key = `receiving.followupNotified.v1:${encodeURIComponent(origin)}:${encodeURIComponent(user.id)}`;
    const { value } = await preferences.get({ key });
    // Fail closed on corrupt storage rather than ring again for every old ID.
    const stored = value ? JSON.parse(value) : [];
    if (!Array.isArray(stored) || stored.some(id => typeof id !== 'string')) throw Error('Invalid notified IDs');
    const seen = new Set(stored);
    const fresh = [...new Map(items.filter(item => item?.status === 'open' &&
      (!scopeToBranch || (Number(user.branch_id) > 0 && Number(item.branch_id) === Number(user.branch_id))) &&
      /^[1-9]\d*$/.test(String(item.id)) && !seen.has(String(item.id)))
      .map(item => [String(item.id), item])).values()];
    if (!fresh.length || !isCurrent()) return;
    for (const item of fresh) seen.add(String(item.id));
    // Reserve durably before posting. A failed write never rings; rejected
    // notifications release the reservation for a later permission retry.
    await preferences.set({ key, value: JSON.stringify([...seen]) });
    if (!isCurrent()) { await preferences.set({ key, value: JSON.stringify(stored) }); return; }
    try {
      await notifyUrgent({ title: 'เรื่องด่วนตามของ',
        body: fresh.length === 1 ? `ตามของ ${String(fresh[0].supplier_name || 'ร้านค้า').slice(0, 160)} · มีรายการยังไม่ส่ง` : `มีเรื่องตามของใหม่ ${fresh.length} เรื่อง กรุณาเปิดกระดิ่งเพื่อตรวจสอบ`,
        data: { kind: 'followup', followup_ids: [...new Set(fresh.map(item => String(item.id)))].slice(0, 50) } });
    } catch (error) {
      await preferences.set({ key, value: JSON.stringify(stored) });
      throw error;
    }
  }
  return { receive(options) {
    const task = queue.then(() => deliver(options));
    queue = task.catch(() => {});
    return task;
  } };
}
